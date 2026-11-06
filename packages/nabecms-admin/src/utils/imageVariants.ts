export type MediaVariantTemplate = {
  key: string;
  label?: string;
  width?: number;
  height?: number;
  fit?: "cover" | "contain";
  format?: "jpg" | "jpeg" | "png" | "webp" | "avif";
  quality?: number;
  upscale?: boolean;
};

export type ResizeResult = {
  blob: Blob;
  width: number;
  height: number;
  format: string;
};

const FORMAT_MIME_MAP: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
};

/**
 * Resolve a mime type for a given format string.
 * @param format - Image format
 * @returns Mime type
 */
export function formatToMime(format: string): string {
  const normalized = format.trim().toLowerCase();
  return FORMAT_MIME_MAP[normalized] ?? `image/${normalized}`;
}

/**
 * Infer a format string from a mime type.
 * @param mimeType - Mime type
 * @returns Format string or null
 */
export function inferFormatFromMime(mimeType?: string): string | null {
  if (!mimeType) return null;
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("jpeg")) return "jpg";
  if (normalized.includes("png")) return "png";
  if (normalized.includes("webp")) return "webp";
  if (normalized.includes("avif")) return "avif";
  return null;
}

/**
 * Build a variant filename based on the original name.
 * @param originalName - Original filename
 * @param templateKey - Template key
 * @param format - Variant format
 * @returns Filename
 */
export function buildVariantFileName(originalName: string, templateKey: string, format: string): string {
  const base = originalName.replace(/\.[^/.]+$/, "");
  const sanitizedKey = templateKey.trim().replace(/\s+/g, "-");
  return `${base}__${sanitizedKey}.${format}`;
}

/**
 * Resize an image file according to template settings.
 * @param file - Source image file
 * @param template - Variant template
 * @returns Resize result
 */
export async function resizeImageToTemplate(file: File, template: MediaVariantTemplate): Promise<ResizeResult> {
  const bitmap = await createImageBitmap(file);
  const srcWidth = bitmap.width;
  const srcHeight = bitmap.height;
  const allowUpscale = template.upscale ?? false;

  let targetWidth = template.width ?? 0;
  let targetHeight = template.height ?? 0;

  if (targetWidth === 0 && targetHeight === 0) {
    targetWidth = srcWidth;
    targetHeight = srcHeight;
  }

  if (targetWidth === 0) {
    const scale = targetHeight / srcHeight;
    const resolvedScale = !allowUpscale && scale > 1 ? 1 : scale;
    targetWidth = Math.round(srcWidth * resolvedScale);
  }

  if (targetHeight === 0) {
    const scale = targetWidth / srcWidth;
    const resolvedScale = !allowUpscale && scale > 1 ? 1 : scale;
    targetHeight = Math.round(srcHeight * resolvedScale);
  }

  if (!allowUpscale) {
    targetWidth = Math.min(targetWidth, srcWidth);
    targetHeight = Math.min(targetHeight, srcHeight);
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, targetWidth);
  canvas.height = Math.max(1, targetHeight);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas context is unavailable");
  }

  const fit = template.fit ?? "cover";

  if (template.width && template.height && fit === "cover") {
    const scale = Math.max(targetWidth / srcWidth, targetHeight / srcHeight);
    const resolvedScale = !allowUpscale && scale > 1 ? 1 : scale;
    const sw = targetWidth / resolvedScale;
    const sh = targetHeight / resolvedScale;
    const sx = Math.max(0, (srcWidth - sw) / 2);
    const sy = Math.max(0, (srcHeight - sh) / 2);
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight);
  } else if (template.width && template.height) {
    const scale = Math.min(targetWidth / srcWidth, targetHeight / srcHeight);
    const resolvedScale = !allowUpscale && scale > 1 ? 1 : scale;
    const drawWidth = Math.round(srcWidth * resolvedScale);
    const drawHeight = Math.round(srcHeight * resolvedScale);
    const dx = Math.round((targetWidth - drawWidth) / 2);
    const dy = Math.round((targetHeight - drawHeight) / 2);
    ctx.clearRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(bitmap, 0, 0, srcWidth, srcHeight, dx, dy, drawWidth, drawHeight);
  } else {
    ctx.drawImage(bitmap, 0, 0, srcWidth, srcHeight, 0, 0, targetWidth, targetHeight);
  }

  const format = template.format ?? inferFormatFromMime(file.type) ?? "jpg";
  const mimeType = formatToMime(format);
  const quality = template.quality ? Math.min(1, Math.max(0, template.quality / 100)) : undefined;

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (!result) {
          reject(new Error("Failed to encode image"));
          return;
        }
        resolve(result);
      },
      mimeType,
      quality,
    );
  });

  return {
    blob,
    width: targetWidth,
    height: targetHeight,
    format,
  };
}
