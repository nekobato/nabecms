import { reactive } from "vue";
import { useAuthStore } from "@/stores/auth";
import { authorizedFetch } from "@/utils/http";

export type EntryReferenceMetadata = {
  entryId: string;
  modelId: string;
  modelName: string;
  displayTitle: string;
  status: string;
};

export type EntryBackReference = EntryReferenceMetadata & {
  fieldId: string;
  fieldName: string;
  fieldKey: string;
};

export type EntryBackReferenceResult = {
  relations: EntryBackReference[];
  richText: EntryBackReference[];
};

const metadataCache = reactive(new Map<string, EntryReferenceMetadata>());
const pendingRequests = new Map<string, Promise<EntryReferenceMetadata>>();

async function fetchMetadata(entryIds: string[]): Promise<EntryReferenceMetadata[]> {
  if (entryIds.length === 0) return [];
  const authStore = useAuthStore();
  if (!authStore.accessToken) {
    await authStore.refresh().catch(() => undefined);
  }
  const params = entryIds.map((id) => `entryId=${encodeURIComponent(id)}`).join("&");
  const res = await authorizedFetch(authStore, `/api/admin/entry-references?${params}`);
  if (!res.ok) {
    const message = await res.text();
    throw new Error(message || res.statusText);
  }
  const data = await res.json();
  const rawItems = Array.isArray(data?.items) ? data.items : [];
  const items: EntryReferenceMetadata[] = rawItems.map((item: Record<string, unknown>) => {
    const entryId = typeof item.entryId === "string" ? item.entryId : String(item.entryId ?? "");
    const modelId = typeof item.modelId === "string" ? item.modelId : String(item.modelId ?? "");
    const modelName = typeof item.modelName === "string" && item.modelName.trim().length > 0 ? item.modelName : modelId;
    const displayTitle = typeof item.displayTitle === "string" && item.displayTitle.trim().length > 0 ? item.displayTitle : entryId;
    const status = typeof item.status === "string" && item.status.trim().length > 0 ? item.status : "";
    return { entryId, modelId, modelName, displayTitle, status } satisfies EntryReferenceMetadata;
  });
  for (const id of entryIds) metadataCache.delete(id);
  for (const item of items) {
    metadataCache.set(item.entryId, item);
  }
  return items;
}

export async function loadEntryReference(entryId: string): Promise<EntryReferenceMetadata> {
  if (metadataCache.has(entryId)) {
    return metadataCache.get(entryId)!;
  }
  const existing = pendingRequests.get(entryId);
  if (existing) {
    return existing;
  }
  const promise = fetchMetadata([entryId]).then((items) => {
    const match = items.find((item) => item.entryId === entryId);
    if (!match) {
      throw new Error("Entry metadata not found");
    }
    return match;
  });
  pendingRequests.set(entryId, promise);
  try {
    const result = await promise;
    return result;
  } finally {
    pendingRequests.delete(entryId);
  }
}

export function getCachedEntryReference(entryId: string): EntryReferenceMetadata | undefined {
  return metadataCache.get(entryId);
}

export function primeEntryReferences(metadataList: EntryReferenceMetadata[]): void {
  for (const item of metadataList) {
    if (!item?.entryId) continue;
    metadataCache.set(item.entryId, item);
  }
}

export async function fetchEntryBackReferences(entryId: string): Promise<EntryBackReferenceResult> {
  if (!entryId) return { relations: [], richText: [] };
  const authStore = useAuthStore();
  if (!authStore.accessToken) {
    await authStore.refresh().catch(() => undefined);
  }
  const res = await authorizedFetch(authStore, `/api/admin/entry-reverse-references?entryId=${encodeURIComponent(entryId)}`);
  if (!res.ok) {
    const message = await res.text();
    throw new Error(message || res.statusText);
  }
  const data = await res.json();
  const normalizeList = (raw: unknown): EntryBackReference[] => {
    const rawItems = Array.isArray(raw) ? raw : [];
    return rawItems.map((item: Record<string, unknown>) => {
      const entryIdValue = typeof item.entryId === "string" ? item.entryId : String(item.entryId ?? "");
      const modelId = typeof item.modelId === "string" ? item.modelId : String(item.modelId ?? "");
      const modelName = typeof item.modelName === "string" && item.modelName.trim().length > 0 ? item.modelName : modelId;
      const displayTitle = typeof item.displayTitle === "string" && item.displayTitle.trim().length > 0 ? item.displayTitle : entryIdValue;
      const status = typeof item.status === "string" && item.status.trim().length > 0 ? item.status : "";
      const fieldId = typeof item.fieldId === "string" ? item.fieldId : String(item.fieldId ?? "");
      const fieldName = typeof item.fieldName === "string" && item.fieldName.trim().length > 0 ? item.fieldName : fieldId;
      const fieldKey = typeof item.fieldKey === "string" ? item.fieldKey : fieldId;
      return {
        entryId: entryIdValue,
        modelId,
        modelName,
        displayTitle,
        status,
        fieldId,
        fieldName,
        fieldKey,
      } satisfies EntryBackReference;
    });
  };

  return {
    relations: normalizeList(data?.relations),
    richText: normalizeList(data?.richText),
  };
}

const normalizeIds = (entryIds: readonly unknown[]): string[] => {
  const seen = new Set<string>();
  for (const value of entryIds) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length === 0) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
  }
  return Array.from(seen);
};

/** Fetch entry reference metadata for a normalized list of entry IDs. */
export async function fetchEntryReferences(entryIds: readonly unknown[]): Promise<EntryReferenceMetadata[]> {
  const normalized = normalizeIds(entryIds);
  return fetchMetadata(normalized);
}

export async function preloadEntryReferences(entryIds: readonly unknown[]): Promise<void> {
  const normalized = normalizeIds(entryIds);
  if (normalized.length === 0) return;

  const missing = normalized.filter((id) => !metadataCache.has(id));
  const pending = new Set<Promise<EntryReferenceMetadata>>();

  const idsToFetch = missing.filter((id) => !pendingRequests.has(id));
  if (idsToFetch.length > 0) {
    const fetchPromise = fetchMetadata(idsToFetch);
    for (const id of idsToFetch) {
      const promise = fetchPromise
        .then((items) => {
          const match = items.find((item) => item.entryId === id);
          if (!match) {
            throw new Error(`Entry metadata not found for ${id}`);
          }
          return match;
        })
        .finally(() => {
          pendingRequests.delete(id);
        });
      pendingRequests.set(id, promise);
      pending.add(promise);
    }
  }

  for (const id of missing) {
    const pendingPromise = pendingRequests.get(id);
    if (pendingPromise) {
      pending.add(pendingPromise);
    }
  }

  if (pending.size > 0) {
    await Promise.all(Array.from(pending));
  }
}
