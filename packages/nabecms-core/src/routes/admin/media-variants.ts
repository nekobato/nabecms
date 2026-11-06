import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import type { AppContext } from "../../types";
import { bearerTokenFrom } from "../../lib/auth";
import { requireActor, requirePermission, type Actor } from "./_authz";
import { MEDIA_READ_PERMISSIONS, MEDIA_WRITE_PERMISSION } from "./_permissions";
import { createMediaVariantRepository } from "../../repositories/media-variants";
import { createMediaRepository } from "../../repositories/media";
import { createSettingsRepository } from "../../repositories/settings";
import { createMediaUrlResolver } from "../../lib/media-url";
import {
  buildVariantKey,
  resolveVariantFormat,
  upsertMediaVariantRecord,
} from "../../services/media-variants";
import type { MediaVariantTemplate } from "../../services/media-settings";
import {
  getMediaSettings,
  resolveCloudflareFit,
} from "../../services/media-settings";
import { generateIdWithPrefix } from "../../utils/id";
import { sanitizeFilename } from "../../utils/strings";
import { resolveSupportedMediaMimeType } from "../../services/media-validation";
import * as schema from "../../database/schema";

const FORMAT_MIME_MAP: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
};

type OptionalActorResolution =
  { actor: Actor; error: null } | { actor: null; error: null | "invalid" };

async function authenticateActor(c: any): Promise<OptionalActorResolution> {
  const token = bearerTokenFrom(c);
  if (!token) return { actor: null, error: null };

  const actor = await requireActor(c);
  if (actor instanceof Response) {
    return { actor: null, error: "invalid" };
  }
  return { actor, error: null };
}

/**
 * Build a worker URL for the original media file.
 * @param c - Hono context
 * @param mediaId - Media identifier
 * @returns Worker URL
 */
function buildWorkerMediaUrl(c: any, mediaId: string): string {
  const url = new URL(c.req.url);
  url.pathname = `/api/admin/media/${mediaId}/file`;
  url.search = "";
  return url.toString();
}

/**
 * Resolve a mime type for a given format string.
 * @param format - Image format
 * @returns Mime type
 */
function formatToMime(format: string): string {
  return FORMAT_MIME_MAP[format] ?? `image/${format}`;
}

const app = new Hono<AppContext>()
  .get("/api/admin/media/:mediaId/variants", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const permission = await requirePermission(
      c,
      actor,
      MEDIA_READ_PERMISSIONS,
    );
    if (permission instanceof Response) return permission;

    const db = drizzle(c.env.DB, { schema });
    const repo = createMediaVariantRepository(db);
    const mediaId = c.req.param("mediaId");
    const variants = await repo.list({ mediaId });

    const createPublicVariantUrl = createMediaUrlResolver({
      fallbackPath: ({ id }) => `/api/admin/media-variants/${id}/file`,
    });

    return c.json({
      items: variants.map((variant) => ({
        id: variant.id,
        mediaId: variant.mediaId,
        templateKey: variant.templateKey,
        url: variant.url
          ? createPublicVariantUrl({ key: variant.url, id: variant.id })
          : null,
        width: variant.width ?? null,
        height: variant.height ?? null,
        size: variant.size ?? null,
        mimeType: variant.mimeType ?? null,
        format: variant.format ?? null,
        status: variant.status,
        provider: variant.provider,
        error: variant.error ?? null,
        createdAt: variant.createdAt,
        updatedAt: variant.updatedAt,
      })),
    });
  })
  .get("/api/admin/media-variants", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const permission = await requirePermission(
      c,
      actor,
      MEDIA_READ_PERMISSIONS,
    );
    if (permission instanceof Response) return permission;

    const status = c.req.query("status") || undefined;
    const limit = Number(c.req.query("limit") ?? 50);
    const offset = Number(c.req.query("offset") ?? 0);

    const db = drizzle(c.env.DB, { schema });
    const repo = createMediaVariantRepository(db);
    const variants = await repo.list({
      status: status as any,
      limit: Number.isFinite(limit) ? limit : 50,
      offset: Number.isFinite(offset) ? offset : 0,
    });

    const mediaIds = Array.from(new Set(variants.map((v) => v.mediaId)));
    const mediaRows = mediaIds.length
      ? await db
          .select({
            id: schema.media.id,
            name: schema.media.name,
            url: schema.media.url,
            status: schema.media.status,
          })
          .from(schema.media)
          .where(inArray(schema.media.id, mediaIds))
      : [];

    const mediaMap = new Map(mediaRows.map((row) => [row.id, row] as const));

    const createPublicMediaUrl = createMediaUrlResolver({
      fallbackPath: ({ id }) => `/api/admin/media/${id}/file`,
    });
    const createPublicVariantUrl = createMediaUrlResolver({
      fallbackPath: ({ id }) => `/api/admin/media-variants/${id}/file`,
    });

    return c.json({
      items: variants.map((variant) => {
        const media = mediaMap.get(variant.mediaId) ?? null;
        return {
          id: variant.id,
          mediaId: variant.mediaId,
          mediaName: media?.name ?? null,
          mediaUrl: media?.url
            ? createPublicMediaUrl({ key: media.url, id: media.id })
            : null,
          templateKey: variant.templateKey,
          url: variant.url
            ? createPublicVariantUrl({ key: variant.url, id: variant.id })
            : null,
          status: variant.status,
          provider: variant.provider,
          error: variant.error ?? null,
          updatedAt: variant.updatedAt,
        };
      }),
    });
  })
  .post("/api/admin/media/:mediaId/variants/retry", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const permission = await requirePermission(
      c,
      actor,
      MEDIA_WRITE_PERMISSION,
    );
    if (permission instanceof Response) return permission;

    const mediaId = c.req.param("mediaId");
    const body = await c.req.json().catch(() => ({}));
    const parsed = z
      .object({
        templateKeys: z.array(z.string().trim()).optional(),
      })
      .safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: { code: "INVALID_REQUEST", message: "Invalid payload" } },
        400,
      );
    }

    const db = drizzle(c.env.DB, { schema });
    const mediaRepo = createMediaRepository(db);
    const variantRepo = createMediaVariantRepository(db);
    const settingsRepo = createSettingsRepository(db);

    const media = await mediaRepo.findById(mediaId);
    if (!media) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Media not found" } },
        404,
      );
    }

    const settings = await getMediaSettings({ repo: settingsRepo });
    if (settings.transformMode !== "cloudflare") {
      return c.json(
        {
          error: {
            code: "INVALID_STATE",
            message: "Cloudflare transform is disabled",
          },
        },
        409,
      );
    }

    const templates = filterTemplates(
      settings.templates,
      parsed.data.templateKeys,
    );
    const results = await runCloudflareTransform({
      c,
      mediaId,
      templates,
      variantRepo,
      provider: "cloudflare",
    });

    return c.json({ items: results });
  })
  .post("/api/admin/media/:mediaId/variants/transform", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const permission = await requirePermission(
      c,
      actor,
      MEDIA_WRITE_PERMISSION,
    );
    if (permission instanceof Response) return permission;

    const mediaId = c.req.param("mediaId");
    const body = await c.req.json().catch(() => ({}));
    const parsed = z
      .object({
        templateKeys: z.array(z.string().trim()).optional(),
      })
      .safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: { code: "INVALID_REQUEST", message: "Invalid payload" } },
        400,
      );
    }

    const db = drizzle(c.env.DB, { schema });
    const mediaRepo = createMediaRepository(db);
    const variantRepo = createMediaVariantRepository(db);
    const settingsRepo = createSettingsRepository(db);

    const media = await mediaRepo.findById(mediaId);
    if (!media) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Media not found" } },
        404,
      );
    }

    const settings = await getMediaSettings({ repo: settingsRepo });
    if (settings.transformMode !== "cloudflare") {
      return c.json(
        {
          error: {
            code: "INVALID_STATE",
            message: "Cloudflare transform is disabled",
          },
        },
        409,
      );
    }

    const templates = filterTemplates(
      settings.templates,
      parsed.data.templateKeys,
    );
    const results = await runCloudflareTransform({
      c,
      mediaId,
      templates,
      variantRepo,
      provider: "cloudflare",
    });

    return c.json({ items: results });
  })
  .get("/api/admin/media-variants/:variantId/file", async (c) => {
    const auth = await authenticateActor(c);
    if (auth.error === "invalid") {
      return c.json(
        { error: { code: "UNAUTHORIZED", message: "Invalid token" } },
        401,
      );
    }
    if (auth.actor) {
      const permission = await requirePermission(
        c,
        auth.actor,
        MEDIA_READ_PERMISSIONS,
      );
      if (permission instanceof Response) return permission;
    }

    const db = drizzle(c.env.DB, { schema });
    const variantRepo = createMediaVariantRepository(db);
    const mediaRepo = createMediaRepository(db);
    const variantId = c.req.param("variantId");
    const variant = await variantRepo.findById(variantId);
    if (!variant || !variant.url) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Variant not found" } },
        404,
      );
    }

    const media = await mediaRepo.findById(variant.mediaId);
    if (!media) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Media not found" } },
        404,
      );
    }

    if (!auth.actor && media.status !== "published") {
      return c.json(
        { error: { code: "UNAUTHORIZED", message: "Missing token" } },
        401,
      );
    }

    const obj: any = await c.env.R2.get(variant.url);
    if (!obj) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Variant object not found" } },
        404,
      );
    }

    const safeMimeType = resolveSupportedMediaMimeType(
      variant.mimeType ?? undefined,
      "variant",
    );
    const disposition = safeMimeType ? "inline" : "attachment";
    const filename = sanitizeFilename(
      `${variant.templateKey || variant.id}.${variant.format || "file"}`,
    );
    const headers = new Headers({
      "Cache-Control": "private, no-store",
      "Content-Disposition": `${disposition}; filename="${filename}"`,
      "Content-Type": safeMimeType ?? "application/octet-stream",
      Vary: "Authorization",
      "X-Content-Type-Options": "nosniff",
    });
    if (typeof obj.httpEtag === "string") {
      headers.set("ETag", obj.httpEtag);
    }

    return new Response(obj.body, { headers, status: 200 });
  });

/**
 * Filter templates by requested keys.
 * @param templates - All templates
 * @param keys - Optional key filter
 * @returns Filtered templates
 */
function filterTemplates(
  templates: MediaVariantTemplate[],
  keys?: string[],
): MediaVariantTemplate[] {
  if (!keys || keys.length === 0) return templates;
  const keySet = new Set(keys.map((k) => k.trim()));
  return templates.filter((template) => keySet.has(template.key));
}

/**
 * Run Cloudflare transforms for the selected templates.
 * @param input - Transform input
 * @returns Result summaries
 */
async function runCloudflareTransform(input: {
  c: any;
  mediaId: string;
  templates: MediaVariantTemplate[];
  variantRepo: ReturnType<typeof createMediaVariantRepository>;
  provider: "cloudflare";
}): Promise<
  Array<{
    templateKey: string;
    status: "succeeded" | "failed";
    url: string | null;
    error: string | null;
  }>
> {
  const results: Array<{
    templateKey: string;
    status: "succeeded" | "failed";
    url: string | null;
    error: string | null;
  }> = [];

  if (input.templates.length === 0) return results;

  const authHeader = input.c.req.header("Authorization") ?? undefined;
  const originUrl = buildWorkerMediaUrl(input.c, input.mediaId);
  const createPublicVariantUrl = createMediaUrlResolver({
    fallbackPath: ({ id }) => `/api/admin/media-variants/${id}/file`,
  });

  for (const template of input.templates) {
    const nowIso = new Date().toISOString();
    const format = resolveVariantFormat(template, "jpg");
    const variantKey = buildVariantKey({
      mediaId: input.mediaId,
      templateKey: template.key,
      format,
    });

    try {
      const cfImage: Record<string, any> = { format };
      if (template.width) cfImage.width = template.width;
      if (template.height) cfImage.height = template.height;
      cfImage.fit = resolveCloudflareFit(template);
      if (template.quality) cfImage.quality = template.quality;

      const res = await fetch(originUrl, {
        headers: authHeader ? { Authorization: authHeader } : undefined,
        cf: { image: cfImage },
      } as RequestInit & { cf?: any });

      if (!res.ok) {
        throw new Error(`Transform failed (${res.status})`);
      }

      const buffer = await res.arrayBuffer();
      const mimeType = res.headers.get("Content-Type") ?? formatToMime(format);
      const size = buffer.byteLength;

      await input.c.env.R2.put(variantKey, buffer, {
        httpMetadata: {
          contentType: mimeType,
          cacheControl: "private, no-store",
        },
        customMetadata: {
          mediaId: input.mediaId,
          templateKey: template.key,
        },
      });

      const variantId = await upsertMediaVariantRecord({
        repo: input.variantRepo,
        mediaId: input.mediaId,
        templateKey: template.key,
        provider: input.provider,
        status: "succeeded",
        url: variantKey,
        width: template.width ?? null,
        height: template.height ?? null,
        size,
        mimeType,
        format,
        error: null,
        nowIso,
        generateId: generateIdWithPrefix,
      });

      results.push({
        templateKey: template.key,
        status: "succeeded",
        url: createPublicVariantUrl({ key: variantKey, id: variantId }),
        error: null,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Transform failed";
      await upsertMediaVariantRecord({
        repo: input.variantRepo,
        mediaId: input.mediaId,
        templateKey: template.key,
        provider: input.provider,
        status: "failed",
        url: null,
        width: template.width ?? null,
        height: template.height ?? null,
        size: null,
        mimeType: null,
        format,
        error: message,
        nowIso,
        generateId: generateIdWithPrefix,
      });
      results.push({
        templateKey: template.key,
        status: "failed",
        url: null,
        error: message,
      });
    }
  }

  return results;
}

export default app;
