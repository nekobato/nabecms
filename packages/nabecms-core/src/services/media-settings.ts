import { z } from "zod";
import type { SettingsRepository } from "../repositories/settings";

export type MediaVariantFit = "cover" | "contain";

type LegacyMediaVariantFit = MediaVariantFit | "fill" | "scale-down";

export type CloudflareFitOption = "cover" | "contain" | "crop" | "scale-down";

export type MediaVariantTemplate = {
  key: string;
  label?: string;
  width?: number;
  height?: number;
  fit?: MediaVariantFit;
  format?: "jpg" | "jpeg" | "png" | "webp" | "avif";
  quality?: number;
  upscale?: boolean;
};

export type MediaSettings = {
  transformMode: "frontend" | "cloudflare";
  templates: MediaVariantTemplate[];
  cloudflare: {
    enabled: boolean;
  };
};

export type MediaSettingsDeps = {
  repo: SettingsRepository;
  now?: () => Date;
};

export const MEDIA_SETTINGS_KEY = "media_settings" as const;

export const defaultMediaSettings: MediaSettings = {
  transformMode: "frontend",
  templates: [],
  cloudflare: { enabled: false },
};

const legacyFitSchema = z
  .enum(["cover", "contain", "fill", "scale-down"])
  .optional();

const templateSchema = z
  .object({
    key: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-zA-Z0-9_-]+$/),
    label: z.string().trim().max(120).optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    fit: legacyFitSchema,
    format: z.enum(["jpg", "jpeg", "png", "webp", "avif"]).optional(),
    quality: z.number().int().min(1).max(100).optional(),
    upscale: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.width && !value.height) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "width or height is required",
      });
    }
  });

const mediaSettingsSchema = z
  .object({
    transformMode: z.enum(["frontend", "cloudflare"]).default("frontend"),
    templates: z.array(templateSchema).default([]),
    cloudflare: z
      .object({
        enabled: z.boolean().default(false),
      })
      .default({ enabled: false }),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const tmpl of value.templates) {
      const normalized = tmpl.key.toLowerCase();
      if (seen.has(normalized)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate template key: ${tmpl.key}`,
        });
        break;
      }
      seen.add(normalized);
    }
  });

type ParsedTemplate = z.infer<typeof templateSchema>;

/**
 * Normalize legacy fit values to current public semantics.
 * @param fit - Stored fit value
 * @returns Current fit value
 */
function normalizeTemplateFit(
  fit?: LegacyMediaVariantFit,
): MediaVariantTemplate["fit"] {
  if (fit === "contain" || fit === "scale-down") return "contain";
  if (fit === "cover" || fit === "fill") return "cover";
  return undefined;
}

/**
 * Normalize a template entry while keeping backward compatibility.
 * @param template - Parsed template
 * @returns Normalized template
 */
function normalizeTemplate(template: ParsedTemplate): MediaVariantTemplate {
  const fit = normalizeTemplateFit(template.fit);
  const forceNoUpscale = template.fit === "scale-down";

  return {
    ...template,
    key: template.key.trim(),
    fit,
    upscale: forceNoUpscale ? false : template.upscale,
  };
}

/**
 * Resolve Cloudflare fit from unified `fit + upscale` semantics.
 * @param template - Variant template
 * @returns Cloudflare fit option
 */
export function resolveCloudflareFit(
  template: MediaVariantTemplate,
): CloudflareFitOption {
  const allowUpscale = template.upscale ?? false;
  const hasBothAxes = Boolean(template.width && template.height);
  const fit = template.fit ?? "cover";

  if (!hasBothAxes) {
    return allowUpscale ? "contain" : "scale-down";
  }

  if (fit === "contain") {
    return allowUpscale ? "contain" : "scale-down";
  }

  return allowUpscale ? "cover" : "crop";
}

/**
 * Validation error for media settings payloads.
 */
export class MediaSettingsValidationError extends Error {
  /**
   * @param issues - Zod validation issues
   */
  constructor(public readonly issues: z.ZodIssue[]) {
    super("Invalid media settings payload");
  }
}

/**
 * Normalize and validate media settings payload.
 * @param input - Raw settings payload
 * @returns Validated media settings
 */
export function normalizeMediaSettings(input: unknown): MediaSettings {
  const parsed = mediaSettingsSchema.parse(input ?? {});
  return {
    transformMode: parsed.transformMode,
    templates: parsed.templates.map((template) => normalizeTemplate(template)),
    cloudflare: {
      enabled: parsed.cloudflare?.enabled ?? false,
    },
  };
}

/**
 * Resolve current media settings.
 * @param deps - Settings repository dependency
 * @returns Media settings with defaults
 */
export async function getMediaSettings(
  deps: MediaSettingsDeps,
): Promise<MediaSettings> {
  const record = await deps.repo.findByKey(MEDIA_SETTINGS_KEY);
  if (!record) return defaultMediaSettings;
  try {
    return normalizeMediaSettings(record.value);
  } catch (error) {
    console.warn("Failed to normalize media settings", error);
    return defaultMediaSettings;
  }
}

/**
 * Update media settings and persist them.
 * @param deps - Settings repository dependency
 * @param input - Proposed media settings
 * @returns Stored media settings
 */
export async function updateMediaSettings(
  deps: MediaSettingsDeps,
  input: unknown,
): Promise<MediaSettings> {
  let normalized: MediaSettings;
  try {
    normalized = normalizeMediaSettings(input);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new MediaSettingsValidationError(error.issues);
    }
    throw error;
  }

  const nowIso = (deps.now ?? (() => new Date()))().toISOString();
  await deps.repo.upsert(MEDIA_SETTINGS_KEY, normalized, nowIso);
  return normalized;
}
