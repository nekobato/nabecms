import { reactive } from "vue";
import { useAuthStore } from "@/stores/auth";
import { authorizedFetch } from "@/utils/http";

type MediaReferenceMetadata = {
  id: string;
  url: string;
  name: string;
  description: string | null;
  mimeType: string;
  width: number | null;
  height: number | null;
  size: number | null;
  status: string | null;
  updatedAt: string | null;
};

const metadataCache = reactive(new Map<string, MediaReferenceMetadata>());
const pendingRequests = new Map<string, Promise<MediaReferenceMetadata>>();

async function fetchMetadata(mediaIds: string[]): Promise<MediaReferenceMetadata[]> {
  if (mediaIds.length === 0) return [];
  const authStore = useAuthStore();
  if (!authStore.accessToken) {
    await authStore.refresh().catch(() => undefined);
  }
  const params = mediaIds.map((id) => `mediaId=${encodeURIComponent(id)}`).join("&");
  const res = await authorizedFetch(authStore, `/api/admin/media-references?${params}`);
  if (!res.ok) {
    const message = await res.text();
    throw new Error(message || res.statusText);
  }
  const data = await res.json();
  const rawItems = Array.isArray(data?.items) ? data.items : [];
  const items: MediaReferenceMetadata[] = rawItems.map((item: Record<string, unknown>) => {
    const id = typeof item.id === "string" ? item.id : String(item.id ?? "");
    const url = typeof item.url === "string" ? item.url : "";
    const name = typeof item.name === "string" ? item.name : id;
    const description = typeof item.description === "string" ? item.description : null;
    const mimeType = typeof item.mimeType === "string" ? item.mimeType : "";
    const width = Number.isFinite(item.width as number) ? (item.width as number) : null;
    const height = Number.isFinite(item.height as number) ? (item.height as number) : null;
    const size = Number.isFinite(item.size as number) ? (item.size as number) : null;
    const status = typeof item.status === "string" ? item.status : null;
    const updatedAt = typeof item.updatedAt === "string" ? item.updatedAt : null;
    return { id, url, name, description, mimeType, width, height, size, status, updatedAt } satisfies MediaReferenceMetadata;
  });
  for (const item of items) {
    metadataCache.set(item.id, item);
  }
  return items;
}

export async function loadMediaReference(mediaId: string): Promise<MediaReferenceMetadata> {
  if (metadataCache.has(mediaId)) {
    return metadataCache.get(mediaId)!;
  }
  const existing = pendingRequests.get(mediaId);
  if (existing) return existing;
  const promise = fetchMetadata([mediaId]).then((items) => {
    const match = items.find((i) => i.id === mediaId);
    if (!match) throw new Error("Media metadata not found");
    return match;
  });
  pendingRequests.set(mediaId, promise);
  try {
    return await promise;
  } finally {
    pendingRequests.delete(mediaId);
  }
}

export function getCachedMediaReference(mediaId: string): MediaReferenceMetadata | undefined {
  return metadataCache.get(mediaId);
}

const normalizeIds = (ids: readonly unknown[]): string[] => {
  const set = new Set<string>();
  for (const value of ids) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    set.add(trimmed);
  }
  return Array.from(set);
};

export async function preloadMediaReferences(mediaIds: readonly unknown[]): Promise<void> {
  const normalized = normalizeIds(mediaIds);
  if (normalized.length === 0) return;
  const missing = normalized.filter((id) => !metadataCache.has(id));
  const idsToFetch = missing.filter((id) => !pendingRequests.has(id));
  const pending: Promise<unknown>[] = [];
  if (idsToFetch.length > 0) {
    const fetchPromise = fetchMetadata(idsToFetch);
    for (const id of idsToFetch) {
      const p = fetchPromise.then((items) => {
        const match = items.find((i) => i.id === id);
        if (!match) throw new Error(`Media metadata not found for ${id}`);
        return match;
      });
      pendingRequests.set(id, p as Promise<MediaReferenceMetadata>);
      pending.push(p);
    }
  }
  for (const id of missing) {
    const p = pendingRequests.get(id);
    if (p) pending.push(p);
  }
  if (pending.length > 0) {
    await Promise.all(pending);
  }
}

export function primeMediaReferences(items: MediaReferenceMetadata[]): void {
  for (const item of items) {
    if (!item?.id) continue;
    metadataCache.set(item.id, item);
  }
}
