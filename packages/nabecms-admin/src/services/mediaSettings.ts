import { encodeResourceId } from "@/utils/resourceId";
import { authorizedFetch } from "@/utils/http";
import type { AuthStore } from "@/utils/http";
import type { MediaVariantTemplate } from "@/utils/imageVariants";

export type MediaSettings = {
  transformMode: "frontend" | "cloudflare";
  templates: MediaVariantTemplate[];
  cloudflare: { enabled: boolean };
};

export type FailedMediaVariant = {
  id: string;
  mediaId: string;
  mediaName: string | null;
  mediaUrl: string | null;
  templateKey: string;
  url: string | null;
  status: string;
  provider: string;
  error: string | null;
  updatedAt: string;
};

/**
 * Normalize media settings from the API or UI state.
 * Falls back to frontend mode when Cloudflare transforms are unavailable.
 * @param value - Partial media settings payload
 * @returns Safe media settings
 */
function normalizeMediaSettingsPayload(value?: Partial<MediaSettings> | null): MediaSettings {
  const cloudflareEnabled = value?.cloudflare?.enabled === true;
  const transformMode = cloudflareEnabled && value?.transformMode === "cloudflare" ? "cloudflare" : "frontend";

  return {
    transformMode,
    templates: Array.isArray(value?.templates) ? [...value.templates] : [],
    cloudflare: { enabled: cloudflareEnabled },
  };
}

/**
 * Fetch media settings from the admin API.
 * @param authStore - Auth store
 * @returns Media settings
 */
export async function fetchMediaSettings(authStore: AuthStore): Promise<MediaSettings> {
  const res = await authorizedFetch(authStore, "/api/admin/settings/media");
  if (!res.ok) {
    throw new Error(`Failed to fetch media settings (${res.status})`);
  }
  const data = (await res.json()) as { item?: MediaSettings };
  return normalizeMediaSettingsPayload(data.item);
}

/**
 * Update media settings through the admin API.
 * @param authStore - Auth store
 * @param settings - Media settings
 * @returns Stored settings
 */
export async function updateMediaSettings(authStore: AuthStore, settings: MediaSettings): Promise<MediaSettings> {
  const payload = normalizeMediaSettingsPayload(settings);
  const res = await authorizedFetch(authStore, "/api/admin/settings/media", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to update media settings (${res.status}): ${text}`);
  }
  const data = (await res.json()) as { item?: MediaSettings };
  return normalizeMediaSettingsPayload(data.item ?? payload);
}

/**
 * Fetch failed media variants.
 * @param authStore - Auth store
 * @returns Failed variants
 */
export async function fetchFailedVariants(authStore: AuthStore): Promise<FailedMediaVariant[]> {
  const res = await authorizedFetch(authStore, "/api/admin/media-variants?status=failed");
  if (!res.ok) {
    throw new Error(`Failed to fetch failed variants (${res.status})`);
  }
  const data = (await res.json()) as { items?: FailedMediaVariant[] };
  return Array.isArray(data.items) ? data.items : [];
}

/**
 * Retry a failed variant for a media item.
 * @param authStore - Auth store
 * @param mediaId - Media identifier
 * @param templateKey - Template key
 */
export async function retryMediaVariant(authStore: AuthStore, mediaId: string, templateKey: string): Promise<void> {
  const res = await authorizedFetch(authStore, `/api/admin/media/${encodeResourceId(mediaId)}/variants/retry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ templateKeys: [templateKey] }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to retry variant (${res.status}): ${text}`);
  }
}
