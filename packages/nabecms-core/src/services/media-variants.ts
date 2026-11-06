import type { MediaVariantTemplate } from "./media-settings";
import type { MediaVariantRepository } from "../repositories/media-variants";

export type VariantUpsertInput = {
  repo: MediaVariantRepository;
  mediaId: string;
  templateKey: string;
  provider: "frontend" | "cloudflare";
  status: "pending" | "processing" | "succeeded" | "failed";
  url: string | null;
  width: number | null;
  height: number | null;
  size: number | null;
  mimeType: string | null;
  format: string | null;
  error: string | null;
  nowIso: string;
  generateId: (prefix?: string) => string;
};

export type VariantKeyInput = {
  mediaId: string;
  templateKey: string;
  format: string;
};

/**
 * Sanitize template keys for use in R2 object keys.
 * @param value - Raw template key
 * @returns Sanitized key
 */
export function sanitizeTemplateKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/**
 * Build an R2 object key for a media variant.
 * @param input - Media and template identifiers
 * @returns Variant object key
 */
export function buildVariantKey(input: VariantKeyInput): string {
  const sanitizedKey = sanitizeTemplateKey(input.templateKey || "variant");
  const extension = input.format.trim().toLowerCase();
  return `media/variants/${input.mediaId}/${sanitizedKey}.${extension}`;
}

/**
 * Resolve a variant format based on template or fallback mime type.
 * @param template - Variant template
 * @param fallback - Fallback format
 * @returns Resolved format string
 */
export function resolveVariantFormat(
  template: MediaVariantTemplate,
  fallback: string,
): string {
  if (template.format && template.format.trim().length > 0) {
    return template.format.trim().toLowerCase();
  }
  return fallback.trim().toLowerCase();
}

/**
 * Upsert a media variant record for a media + template pair.
 * @param input - Variant persistence inputs
 * @returns Variant id
 */
export async function upsertMediaVariantRecord(
  input: VariantUpsertInput,
): Promise<string> {
  const existing = await input.repo.findByMediaIdAndTemplateKey(
    input.mediaId,
    input.templateKey,
  );
  if (existing) {
    await input.repo.updateById(existing.id, {
      url: input.url,
      width: input.width,
      height: input.height,
      size: input.size,
      mimeType: input.mimeType,
      format: input.format,
      status: input.status,
      provider: input.provider,
      error: input.error,
      updatedAt: input.nowIso,
    });
    return existing.id;
  }
  const id = input.generateId("variant");
  await input.repo.insert({
    id,
    mediaId: input.mediaId,
    templateKey: input.templateKey,
    url: input.url,
    width: input.width,
    height: input.height,
    size: input.size,
    mimeType: input.mimeType,
    format: input.format,
    status: input.status,
    provider: input.provider,
    error: input.error,
    createdAt: input.nowIso,
    updatedAt: input.nowIso,
  });
  return id;
}
