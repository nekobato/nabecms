import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { drizzle } from "drizzle-orm/d1";
import { inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppContext } from "../../types";
import { bearerTokenFrom } from "../../lib/auth";
import { createMediaUrlResolver } from "../../lib/media-url";
import { generateIdWithPrefix } from "../../utils/id";
import { sanitizeFilename } from "../../utils/strings";
import { createMediaRepository } from "../../repositories/media";
import type { MediaRecord } from "../../repositories/media";
import { createMediaVariantRepository } from "../../repositories/media-variants";
import { createSettingsRepository } from "../../repositories/settings";
import { createUserRepository } from "../../repositories/users";
import type { UserRepository } from "../../repositories/users";
import * as schema from "../../database/schema";
import { listMediaFiles, uploadMediaFiles } from "../../services/media";
import {
  MAX_MEDIA_FILES_PER_UPLOAD,
  MAX_MEDIA_FILE_SIZE_BYTES,
  MAX_MEDIA_REQUEST_SIZE_BYTES,
  MediaUploadValidationError,
  readAndValidateMediaFile,
  resolveSupportedMediaMimeType,
} from "../../services/media-validation";
import {
  buildVariantKey,
  resolveVariantFormat,
  upsertMediaVariantRecord,
} from "../../services/media-variants";
import type {
  MediaSettings,
  MediaVariantTemplate,
} from "../../services/media-settings";
import {
  getMediaSettings,
  resolveCloudflareFit,
} from "../../services/media-settings";
import { requireActor, requirePermission, type Actor } from "./_authz";
import { MEDIA_READ_PERMISSIONS, MEDIA_WRITE_PERMISSION } from "./_permissions";

const mediaUpdateSchema = z.object({
  name: z.string().min(1).max(255),
  description: z
    .string()
    .max(1024)
    .nullish()
    .transform((value) => (value === undefined ? undefined : (value ?? null))),
  status: z.enum(["published", "draft", "archived"]).default("published"),
});

const FORMAT_MIME_MAP: Readonly<Record<string, string>> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
};

const INLINE_MEDIA_MIME_TYPES = new Set([
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "image/gif",
  "image/jpeg",
  "image/png",
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);

const mediaUploadBodyLimit = bodyLimit({
  maxSize: MAX_MEDIA_REQUEST_SIZE_BYTES,
  onError: (c) =>
    c.json(
      {
        error: {
          code: "REQUEST_TOO_LARGE",
          message: "Media upload request is too large",
        },
      },
      413,
    ),
});

type UploadedFile = {
  name: string;
  type?: string;
  size: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

type VariantMeta = {
  sourceIndex: number;
  templateKey: string;
  width?: number;
  height?: number;
  format?: string;
  mimeType?: string;
  size?: number;
};

type VariantUpload = {
  file: UploadedFile;
  meta: VariantMeta;
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

type UserSummary = {
  id: string;
  name: string | null;
};

/**
 * Parse an optional bounded integer query parameter.
 * @param input - Raw query parameter
 * @param options - Bounds for the parsed value
 * @returns Parsed integer or undefined when absent/invalid
 */
const parseOptionalInt = (
  input: string | undefined,
  { min = 0, max = 200 } = {},
): number | undefined => {
  if (input === undefined) return undefined;
  const value = Number.parseInt(input, 10);
  if (!Number.isFinite(value) || value < min) return undefined;
  return Math.min(value, max);
};

/**
 * Build a mapper from media records to API output.
 * @param createPublicUrl - Public URL builder
 * @param resolveUser - User resolver
 * @returns Mapper function
 */
const toPublicMediaRecord =
  (
    createPublicUrl: (input: { id: string; key: string }) => string,
    resolveUser: (id: string) => UserSummary,
  ) =>
  (record: MediaRecord) => ({
    id: record.id,
    groupId: record.groupId,
    url: createPublicUrl({ key: record.url, id: record.id }),
    type: record.type,
    mimeType: record.mimeType,
    name: record.name,
    description: record.description ?? null,
    width: record.width ?? null,
    height: record.height ?? null,
    size: record.size,
    status: record.status ?? "published",
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    updatedBy: resolveUser(record.updatedBy),
  });

/**
 * Provide a fallback user summary.
 * @param id - User identifier
 * @returns User summary
 */
const fallbackUserSummary = (id: string): UserSummary => ({ id, name: null });

/**
 * Resolve user summaries from a preloaded map.
 * @param userMap - Map of user summaries
 * @returns User resolver
 */
const createUserResolver =
  (userMap: Map<string, UserSummary>) =>
  (id: string): UserSummary =>
    userMap.get(id) ?? fallbackUserSummary(id);

/**
 * Load user summaries for updatedBy values.
 * @param repo - User repository
 * @param ids - User identifiers
 * @returns User map
 */
async function loadUpdatedByUsers(
  repo: UserRepository,
  ids: readonly string[],
): Promise<Map<string, UserSummary>> {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) return new Map();
  const users = await repo.findManyByIds(uniqueIds);
  return new Map(
    users.map((user) => [
      user.id,
      { id: user.id, name: user.name } as UserSummary,
    ]),
  );
}

/**
 * Resolve a mime type for a given format string.
 * @param format - Image format
 * @returns Mime type
 */
function formatToMime(format: string): string {
  const normalized = format.trim().toLowerCase();
  return FORMAT_MIME_MAP[normalized] ?? `image/${normalized}`;
}

/**
 * Infer a format string from a mime type.
 * @param mimeType - Mime type
 * @returns Format string or null
 */
function inferFormatFromMime(mimeType?: string): string | null {
  if (!mimeType) return null;
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("jpeg")) return "jpg";
  if (normalized.includes("png")) return "png";
  if (normalized.includes("webp")) return "webp";
  if (normalized.includes("avif")) return "avif";
  return null;
}

/**
 * Convert form-data entries into uploadable file objects.
 * @param entries - FormData entries
 * @returns Uploadable files
 */
async function parseUploadedFiles(
  entries: FormDataEntryValue[],
): Promise<UploadedFile[]> {
  const files = await Promise.all(
    entries.map(async (entry): Promise<UploadedFile | null> => {
      if (!entry || typeof entry !== "object") return null;
      const candidate = entry as any;
      const hasArrayBuffer = typeof candidate.arrayBuffer === "function";
      const hasStream = typeof candidate.stream === "function";
      if (!hasArrayBuffer && !hasStream) return null;

      if (
        typeof candidate.size === "number" &&
        candidate.size > MAX_MEDIA_FILE_SIZE_BYTES
      ) {
        throw new MediaUploadValidationError(
          "FILE_TOO_LARGE",
          413,
          "Media files must not exceed 50 MiB",
        );
      }

      const rawBuffer = hasArrayBuffer
        ? await candidate.arrayBuffer()
        : await new Response(candidate.stream()).arrayBuffer();

      if (!(rawBuffer instanceof ArrayBuffer)) return null;
      if (rawBuffer.byteLength > MAX_MEDIA_FILE_SIZE_BYTES) {
        throw new MediaUploadValidationError(
          "FILE_TOO_LARGE",
          413,
          "Media files must not exceed 50 MiB",
        );
      }
      const buffer = rawBuffer;
      const name =
        typeof candidate.name === "string" && candidate.name.trim().length > 0
          ? candidate.name
          : "file";
      const type =
        typeof candidate.type === "string" && candidate.type.trim().length > 0
          ? candidate.type
          : undefined;
      const size =
        typeof candidate.size === "number" && Number.isFinite(candidate.size)
          ? candidate.size
          : buffer.byteLength;

      return {
        name: String(name),
        type,
        size,
        arrayBuffer: async () => buffer,
      } satisfies UploadedFile;
    }),
  );

  return files.filter((value): value is UploadedFile => value !== null);
}

/**
 * Parse variant metadata entries from FormData.
 * @param entries - FormData entries
 * @returns Variant metadata list
 */
function parseVariantMetaEntries(entries: FormDataEntryValue[]): VariantMeta[] {
  const metas: VariantMeta[] = [];
  for (const entry of entries) {
    if (typeof entry !== "string") continue;
    try {
      const parsed = JSON.parse(entry) as Partial<VariantMeta>;
      if (
        typeof parsed.sourceIndex === "number" &&
        typeof parsed.templateKey === "string"
      ) {
        metas.push({
          sourceIndex: parsed.sourceIndex,
          templateKey: parsed.templateKey,
          width: parsed.width,
          height: parsed.height,
          format: parsed.format,
          mimeType: parsed.mimeType,
          size: parsed.size,
        });
      }
    } catch (error) {
      console.warn("Failed to parse variant meta", error);
    }
  }
  return metas;
}

/**
 * Build a map of variant uploads keyed by sourceIndex + templateKey.
 * @param files - Variant files
 * @param metas - Variant metadata
 * @returns Variant upload map
 */
function buildVariantUploadMap(
  files: UploadedFile[],
  metas: VariantMeta[],
): Map<string, VariantUpload> {
  const map = new Map<string, VariantUpload>();
  const count = Math.min(files.length, metas.length);
  for (let i = 0; i < count; i += 1) {
    const meta = metas[i];
    const file = files[i];
    if (!meta || !file) continue;
    const key = `${meta.sourceIndex}:${meta.templateKey}`;
    map.set(key, { file, meta });
  }
  return map;
}

/**
 * Build the worker URL for the original media file.
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
 * Process media variants based on current settings.
 * @param input - Variant processing inputs
 */
async function processMediaVariants(input: {
  c: any;
  mediaItems: MediaRecord[];
  settings: MediaSettings;
  variantUploads: Map<string, VariantUpload>;
  variantRepo: ReturnType<typeof createMediaVariantRepository>;
}): Promise<void> {
  const templates = input.settings.templates ?? [];
  if (templates.length === 0) return;

  try {
    if (input.settings.transformMode === "frontend") {
      await handleFrontendVariants({
        c: input.c,
        mediaItems: input.mediaItems,
        templates,
        variantUploads: input.variantUploads,
        variantRepo: input.variantRepo,
      });
      return;
    }
    await handleCloudflareVariants({
      c: input.c,
      mediaItems: input.mediaItems,
      templates,
      variantRepo: input.variantRepo,
    });
  } catch (error) {
    console.error("Failed to process media variants", error);
  }
}

/**
 * Handle frontend-generated variant uploads.
 * @param input - Variant processing inputs
 */
async function handleFrontendVariants(input: {
  c: any;
  mediaItems: MediaRecord[];
  templates: MediaVariantTemplate[];
  variantUploads: Map<string, VariantUpload>;
  variantRepo: ReturnType<typeof createMediaVariantRepository>;
}): Promise<void> {
  for (let index = 0; index < input.mediaItems.length; index += 1) {
    const media = input.mediaItems[index];
    if (media.type !== "image") continue;

    for (const template of input.templates) {
      const key = `${index}:${template.key}`;
      const upload = input.variantUploads.get(key);
      if (!upload) {
        await upsertMediaVariantRecord({
          repo: input.variantRepo,
          mediaId: media.id,
          templateKey: template.key,
          provider: "frontend",
          status: "failed",
          url: null,
          width: template.width ?? null,
          height: template.height ?? null,
          size: null,
          mimeType: null,
          format: resolveVariantFormat(template, "jpg"),
          error: "Variant file not provided",
          nowIso: new Date().toISOString(),
          generateId: generateIdWithPrefix,
        });
        continue;
      }

      const nowIso = new Date().toISOString();
      const format = resolveVariantFormat(
        template,
        upload.meta.format ??
          inferFormatFromMime(upload.file.type ?? upload.meta.mimeType) ??
          "jpg",
      );
      const variantKey = buildVariantKey({
        mediaId: media.id,
        templateKey: template.key,
        format,
      });

      try {
        const validated = await readAndValidateMediaFile(
          upload.file,
          "variant",
        );
        const expectedMimeType = formatToMime(format);
        if (validated.mimeType !== expectedMimeType) {
          throw new MediaUploadValidationError(
            "MEDIA_TYPE_MISMATCH",
            415,
            "Variant content does not match its configured format",
          );
        }
        const buffer = validated.buffer;
        const mimeType = validated.mimeType;
        await input.c.env.R2.put(variantKey, buffer, {
          httpMetadata: {
            contentType: mimeType,
            contentDisposition: `inline; filename=\"${sanitizeFilename(media.name)}\"`,
            cacheControl: "private, no-store",
          },
          customMetadata: {
            mediaId: media.id,
            templateKey: template.key,
          },
        });

        await upsertMediaVariantRecord({
          repo: input.variantRepo,
          mediaId: media.id,
          templateKey: template.key,
          provider: "frontend",
          status: "succeeded",
          url: variantKey,
          width: upload.meta.width ?? template.width ?? null,
          height: upload.meta.height ?? template.height ?? null,
          size: upload.meta.size ?? buffer.byteLength,
          mimeType,
          format,
          error: null,
          nowIso,
          generateId: generateIdWithPrefix,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Upload failed";
        await upsertMediaVariantRecord({
          repo: input.variantRepo,
          mediaId: media.id,
          templateKey: template.key,
          provider: "frontend",
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
      }
    }
  }
}

/**
 * Handle Cloudflare-based variant transforms.
 * @param input - Variant processing inputs
 */
async function handleCloudflareVariants(input: {
  c: any;
  mediaItems: MediaRecord[];
  templates: MediaVariantTemplate[];
  variantRepo: ReturnType<typeof createMediaVariantRepository>;
}): Promise<void> {
  const authHeader = input.c.req.header("Authorization") ?? undefined;

  for (const media of input.mediaItems) {
    if (media.type !== "image") continue;
    const originUrl = buildWorkerMediaUrl(input.c, media.id);

    for (const template of input.templates) {
      const nowIso = new Date().toISOString();
      const format = resolveVariantFormat(template, "jpg");
      const variantKey = buildVariantKey({
        mediaId: media.id,
        templateKey: template.key,
        format,
      });
      const cfImage: Record<string, any> = { format };
      if (template.width) cfImage.width = template.width;
      if (template.height) cfImage.height = template.height;
      cfImage.fit = resolveCloudflareFit(template);
      if (template.quality) cfImage.quality = template.quality;

      try {
        const res = await fetch(originUrl, {
          headers: authHeader ? { Authorization: authHeader } : undefined,
          cf: { image: cfImage },
        } as RequestInit & { cf?: any });

        if (!res.ok) {
          throw new Error(`Transform failed (${res.status})`);
        }

        const buffer = await res.arrayBuffer();
        const mimeType =
          res.headers.get("Content-Type") ?? formatToMime(format);

        await input.c.env.R2.put(variantKey, buffer, {
          httpMetadata: {
            contentType: mimeType,
            cacheControl: "private, no-store",
          },
          customMetadata: {
            mediaId: media.id,
            templateKey: template.key,
          },
        });

        await upsertMediaVariantRecord({
          repo: input.variantRepo,
          mediaId: media.id,
          templateKey: template.key,
          provider: "cloudflare",
          status: "succeeded",
          url: variantKey,
          width: template.width ?? null,
          height: template.height ?? null,
          size: buffer.byteLength,
          mimeType,
          format,
          error: null,
          nowIso,
          generateId: generateIdWithPrefix,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Transform failed";
        await upsertMediaVariantRecord({
          repo: input.variantRepo,
          mediaId: media.id,
          templateKey: template.key,
          provider: "cloudflare",
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
      }
    }
  }
}

const app = new Hono<AppContext>()
  .get("/api/admin/media", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const permission = await requirePermission(
      c,
      actor,
      MEDIA_READ_PERMISSIONS,
    );
    if (permission instanceof Response) return permission;

    const createPublicMediaUrl = createMediaUrlResolver({
      fallbackPath: ({ id }) => `/api/admin/media/${id}/file`,
    });

    const db = drizzle(c.env.DB, { schema });
    const repo = createMediaRepository(db);
    const userRepo = createUserRepository(db);

    const type = c.req.query("type") || undefined;
    const search = c.req.query("search") || undefined;
    const limit = parseOptionalInt(c.req.query("limit"), { min: 1, max: 100 });
    const offset =
      limit === undefined
        ? undefined
        : (parseOptionalInt(c.req.query("offset"), {
            min: 0,
            max: 10_000,
          }) ?? 0);

    const result = await listMediaFiles(
      {
        repo,
        createPublicUrl: createPublicMediaUrl,
      },
      { type, search, limit, offset },
    );

    const mediaIds = result.items.map((item) => item.id);
    let variantCountMap = new Map<string, number>();
    if (mediaIds.length > 0) {
      try {
        const variantCounts = await db
          .select({
            mediaId: schema.mediaVariants.mediaId,
            count: sql<number>`count(*)`,
          })
          .from(schema.mediaVariants)
          .where(inArray(schema.mediaVariants.mediaId, mediaIds))
          .groupBy(schema.mediaVariants.mediaId);
        variantCountMap = new Map(
          variantCounts.map((row) => [row.mediaId, Number(row.count)] as const),
        );
      } catch (error) {
        console.error("Failed to load media variant counts", error);
      }
    }

    const userMap = await loadUpdatedByUsers(
      userRepo,
      result.items.map((item) => item.updatedBy),
    );
    const resolveUser = createUserResolver(userMap);
    const items = result.items.map((item) => ({
      ...item,
      updatedBy: resolveUser(item.updatedBy),
      variantCount: variantCountMap.get(item.id) || null,
    }));

    return c.json({
      ...result,
      items,
      total: result.total ?? result.items.length,
      limit,
      offset,
    });
  })

  .post("/api/admin/media", mediaUploadBodyLimit, async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const permission = await requirePermission(
      c,
      actor,
      MEDIA_WRITE_PERMISSION,
    );
    if (permission instanceof Response) return permission;

    try {
      const createPublicMediaUrl = createMediaUrlResolver({
        fallbackPath: ({ id }) => `/api/admin/media/${id}/file`,
      });

      const formData = await c.req.formData();
      const templateKeyEntries = [
        ...formData.getAll("templateKeys"),
        ...formData.getAll("templateKeys[]"),
      ];
      const templateKeys = templateKeyEntries
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
      const descriptionsRaw = [
        ...formData.getAll("descriptions"),
        ...formData.getAll("descriptions[]"),
      ];
      const descriptions = descriptionsRaw.map((value) =>
        typeof value === "string" ? value : null,
      );

      const fileEntries = [
        ...formData.getAll("files"),
        ...formData.getAll("files[]"),
      ];
      if (fileEntries.length !== MAX_MEDIA_FILES_PER_UPLOAD) {
        throw new MediaUploadValidationError(
          "INVALID_FILE_COUNT",
          400,
          "Exactly one media file is required",
        );
      }
      const files = await parseUploadedFiles(fileEntries);

      const variantEntries = [
        ...formData.getAll("variants"),
        ...formData.getAll("variants[]"),
      ];
      const variantMetaEntries = [
        ...formData.getAll("variantMeta"),
        ...formData.getAll("variantMeta[]"),
      ];
      const variantFiles = await parseUploadedFiles(variantEntries);
      const variantMetas = parseVariantMetaEntries(variantMetaEntries);
      const variantUploads = buildVariantUploadMap(variantFiles, variantMetas);

      const db = drizzle(c.env.DB, { schema });
      const repo = createMediaRepository(db);
      const variantRepo = createMediaVariantRepository(db);
      const settingsRepo = createSettingsRepository(db);
      const userRepo = createUserRepository(db);

      const mediaSettings = await getMediaSettings({ repo: settingsRepo });
      const templateKeySet = new Set(templateKeys);
      const resolvedSettings: MediaSettings =
        templateKeys.length > 0
          ? {
              ...mediaSettings,
              templates: mediaSettings.templates.filter((template) =>
                templateKeySet.has(template.key),
              ),
            }
          : mediaSettings;

      const result = await uploadMediaFiles(
        {
          repo,
          bucket: c.env.R2,
          generateId: (prefix) => generateIdWithPrefix(prefix),
          now: () => new Date(),
          createPublicUrl: createPublicMediaUrl,
        },
        {
          files,
          actorId: actor.id,
          descriptions,
        },
      );

      await processMediaVariants({
        c,
        mediaItems: result.items,
        settings: resolvedSettings,
        variantUploads,
        variantRepo,
      });

      const userMap = await loadUpdatedByUsers(
        userRepo,
        result.items.map((item) => item.updatedBy),
      );
      const resolveUser = createUserResolver(userMap);
      const items = result.items.map((item) => ({
        ...item,
        updatedBy: resolveUser(item.updatedBy),
      }));

      return c.json({ ...result, items }, 201);
    } catch (error) {
      if (error instanceof MediaUploadValidationError) {
        return c.json(
          { error: { code: error.code, message: error.message } },
          error.status,
        );
      }
      console.error("Failed to upload media", error);
      return c.json(
        { error: { code: "UPLOAD_FAILED", message: "Failed to upload media" } },
        500,
      );
    }
  })

  .get("/api/admin/media/:mediaId", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const permission = await requirePermission(
      c,
      actor,
      MEDIA_READ_PERMISSIONS,
    );
    if (permission instanceof Response) return permission;

    const db = drizzle(c.env.DB, { schema });
    const repo = createMediaRepository(db);
    const userRepo = createUserRepository(db);
    const createPublicMediaUrl = createMediaUrlResolver({
      fallbackPath: ({ id }) => `/api/admin/media/${id}/file`,
    });

    const mediaId = c.req.param("mediaId");
    const record = await repo.findById(mediaId);
    if (!record) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Media not found" } },
        404,
      );
    }

    const userMap = await loadUpdatedByUsers(userRepo, [record.updatedBy]);
    const resolveUser = createUserResolver(userMap);
    const mapRecord = toPublicMediaRecord(createPublicMediaUrl, resolveUser);

    return c.json({ item: mapRecord(record) });
  })

  .put("/api/admin/media/:mediaId", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const permission = await requirePermission(
      c,
      actor,
      MEDIA_WRITE_PERMISSION,
    );
    if (permission instanceof Response) return permission;

    const db = drizzle(c.env.DB, { schema });
    const repo = createMediaRepository(db);
    const userRepo = createUserRepository(db);
    const createPublicMediaUrl = createMediaUrlResolver({
      fallbackPath: ({ id }) => `/api/admin/media/${id}/file`,
    });
    const mediaId = c.req.param("mediaId");

    const existing = await repo.findById(mediaId);
    if (!existing) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Media not found" } },
        404,
      );
    }

    let payload: z.infer<typeof mediaUpdateSchema>;
    try {
      const data = await c.req.json();
      payload = mediaUpdateSchema.parse(data);
    } catch (error) {
      if (error instanceof SyntaxError) {
        return c.json(
          {
            error: { code: "INVALID_REQUEST", message: "Invalid JSON payload" },
          },
          400,
        );
      }
      if (error instanceof z.ZodError) {
        return c.json(
          {
            error: {
              code: "INVALID_REQUEST",
              message: "Invalid media payload",
              issues: error.issues,
            },
          },
          400,
        );
      }
      throw error;
    }

    const nowIso = new Date().toISOString();
    await repo.updateById(mediaId, {
      name: payload.name,
      description: payload.description ?? null,
      status: payload.status,
      updatedAt: nowIso,
      updatedBy: actor.id,
    });

    const updated = await repo.findById(mediaId);
    if (!updated) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Media not found" } },
        404,
      );
    }

    const userMap = await loadUpdatedByUsers(userRepo, [updated.updatedBy]);
    const resolveUser = createUserResolver(userMap);
    const mapRecord = toPublicMediaRecord(createPublicMediaUrl, resolveUser);

    return c.json({ item: mapRecord(updated) });
  })

  .delete("/api/admin/media/:mediaId", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const permission = await requirePermission(
      c,
      actor,
      MEDIA_WRITE_PERMISSION,
    );
    if (permission instanceof Response) return permission;

    const db = drizzle(c.env.DB, { schema });
    const repo = createMediaRepository(db);
    const mediaId = c.req.param("mediaId");

    const existing = await repo.findById(mediaId);
    if (!existing) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Media not found" } },
        404,
      );
    }

    const variantRepo = createMediaVariantRepository(db);
    const variants = await variantRepo.list({ mediaId });
    const objectKeys = new Set([
      existing.url,
      ...variants
        .map((variant) => variant.url)
        .filter((key): key is string => Boolean(key)),
    ]);

    // Stop delivery before removing objects; deleting the parent cascades variants.
    await repo.deleteById(mediaId);

    for (const key of objectKeys) {
      try {
        await c.env.R2.delete(key);
      } catch (error) {
        console.error("Failed to delete media object from R2", {
          mediaId,
          key,
          error,
        });
      }
    }

    return c.body(null, 204);
  })

  .get("/api/admin/media/:mediaId/file", async (c) => {
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
    const repo = createMediaRepository(db);
    const mediaId = c.req.param("mediaId");
    const record = await repo.findById(mediaId);
    if (!record) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Media not found" } },
        404,
      );
    }

    if (!auth.actor && record.status !== "published") {
      return c.json(
        { error: { code: "UNAUTHORIZED", message: "Missing token" } },
        401,
      );
    }

    const obj: any = await c.env.R2.get(record.url);
    if (!obj) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Media object not found" } },
        404,
      );
    }

    const safeMimeType = resolveSupportedMediaMimeType(
      record.mimeType,
      "source",
    );
    const filename = sanitizeFilename(record.name);
    const disposition =
      safeMimeType && INLINE_MEDIA_MIME_TYPES.has(safeMimeType)
        ? "inline"
        : "attachment";
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

export default app;
