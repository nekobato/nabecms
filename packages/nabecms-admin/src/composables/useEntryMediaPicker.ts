import { encodeResourceId } from "@/utils/resourceId";
import { computed, ref, watch, type ComputedRef, type Ref } from "vue";
import type { ModelField } from "@/modules/entries";
import { useAuthStore } from "@/stores/auth";
import { authorizedFetch } from "@/utils/http";
import { getActivePinia } from "pinia";

export type MediaItem = {
  id: string;
  name: string;
  mimeType: string;
  url: string;
  type?: string | null;
  updatedAt?: string | null;
};

export type UseEntryMediaPickerOptions = {
  model: Ref<{ fields: ModelField[] }>;
  initialValues: Ref<Record<string, unknown> | undefined>;
};

export type UseEntryMediaPickerResult = {
  mediaDialogVisible: Ref<boolean>;
  mediaDialogSelection: Ref<string | string[] | null>;
  mediaMap: ComputedRef<Map<string, MediaItem>>;
  activeMediaField: ComputedRef<ModelField | null>;
  openMediaDialog: (field: ModelField, apply: (value: unknown) => void, currentValue: unknown) => Promise<void>;
  handleMediaConfirm: (selectedItems: MediaItem[]) => void;
  mediaVariant: (field?: ModelField | null) => "multiple" | "single";
  mediaAllowedKinds: (field: ModelField) => string | string[] | undefined;
  stringifyIds: (value: unknown) => string;
  parseIds: (value: string) => string[];
  moveMediaItem: (current: unknown, index: number, delta: number, onChange: (val: unknown) => void) => void;
};

/** Resolve field variant into a media selection mode. */
const mediaVariant = (field?: ModelField | null) => (field && field.variant === "multiple" ? "multiple" : "single");

/** Normalize arbitrary values into newline-delimited IDs. */
const stringifyIds = (value: unknown): string =>
  Array.isArray(value)
    ? value
        .map((v) => (typeof v === "string" ? v : String(v ?? "")))
        .filter((v) => v.length > 0)
        .join("\n")
    : typeof value === "string"
      ? value
      : "";

/** Split newline-delimited IDs into an array. */
const parseIds = (value: string): string[] =>
  value
    .split(/\r?\n/)
    .map((v) => v.trim())
    .filter((v) => v.length > 0);

/** Extract allowed media kinds from field options. */
const mediaAllowedKinds = (field: ModelField): string | string[] | undefined => {
  const opts = (field.options ?? {}) as Record<string, unknown>;
  return opts.allowedKinds as string[] | string | undefined;
};

/** Move a media item within a list of IDs. */
const moveMediaItem = (current: unknown, index: number, delta: number, onChange: (val: unknown) => void) => {
  const ids = parseIds(stringifyIds(current));
  const target = index + delta;
  if (target < 0 || target >= ids.length) return;
  const next = [...ids];
  const [picked] = next.splice(index, 1);
  if (picked === undefined) return;
  next.splice(target, 0, picked);
  onChange(next);
};

/** Build a media picker composable with dialog and cache handling. */
export const useEntryMediaPicker = (options: UseEntryMediaPickerOptions): UseEntryMediaPickerResult => {
  const { model, initialValues } = options;
  const mediaDialogVisible = ref(false);
  const mediaDialogSelection = ref<string | string[] | null>(null);
  const mediaDialogField = ref<{ field: ModelField; apply: (value: unknown) => void } | null>(null);
  const mediaMapData = ref(new Map<string, MediaItem>());
  const mediaMap = computed(() => mediaMapData.value);
  const activeMediaField = computed(() => mediaDialogField.value?.field ?? null);

  /** Upsert media items into the local cache. */
  const upsertMediaItems = (items: MediaItem[]) => {
    const map = new Map(mediaMapData.value);
    items.forEach((item) => map.set(item.id, item));
    mediaMapData.value = map;
  };

  /** Extract IDs from any media value input. */
  const extractIds = (value: unknown): string[] => {
    if (Array.isArray(value)) return parseIds(stringifyIds(value));
    if (typeof value === "string") return parseIds(value);
    return [];
  };

  /** Collect media IDs from initial values for preloading. */
  const collectInitialMediaIds = (values: Record<string, unknown> | undefined | null): string[] => {
    if (!values) return [];
    const ids = new Set<string>();
    model.value.fields
      .filter((f) => f.type === "media")
      .forEach((field) => {
        const val = (values as Record<string, unknown>)[field.name];
        if (field.hasLocales && val && typeof val === "object") {
          Object.values(val as Record<string, unknown>).forEach((v) => extractIds(v).forEach((id) => ids.add(id)));
        } else {
          extractIds(val).forEach((id) => ids.add(id));
        }
      });
    return Array.from(ids);
  };

  /** Fetch the full media list to hydrate the cache. */
  const fetchMediaList = async () => {
    const active = getActivePinia();
    if (!active) {
      console.warn("Pinia is not active; media list fetch skipped in test/mount context.");
      mediaMapData.value = new Map();
      return;
    }
    try {
      const auth = useAuthStore();
      if (!auth.accessToken) {
        await auth.refresh().catch(() => undefined);
      }
      const res = await authorizedFetch(auth, "/api/admin/media");
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      const items = Array.isArray(data?.items) ? data.items : [];
      const mapped: MediaItem[] = items.map((item: Record<string, unknown>) => ({
        id: String(item.id ?? ""),
        name: typeof item.name === "string" ? item.name : String(item.id ?? ""),
        mimeType: typeof item.mimeType === "string" ? item.mimeType : "",
        url: typeof item.url === "string" ? item.url : "",
        type: typeof item.type === "string" ? item.type : null,
        updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : null,
      }));
      upsertMediaItems(mapped);
    } catch (error) {
      console.error("Failed to load media list", error);
    }
  };

  /** Fetch a specific media item by ID. */
  const fetchMediaById = async (id: string) => {
    const active = getActivePinia();
    if (!active) return null;
    try {
      const auth = useAuthStore();
      if (!auth.accessToken) {
        await auth.refresh().catch(() => undefined);
      }
      const res = await authorizedFetch(auth, `/api/admin/media/${encodeResourceId(id)}`);
      if (!res.ok) return null;
      const data = await res.json();
      const item = (data?.item ?? data) as Record<string, unknown>;
      const media: MediaItem = {
        id,
        name: typeof item.name === "string" ? item.name : id,
        mimeType: typeof item.mimeType === "string" ? item.mimeType : "",
        url: typeof item.url === "string" ? item.url : "",
        type: typeof item.type === "string" ? item.type : null,
        updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : null,
      };
      upsertMediaItems([media]);
      return media;
    } catch (error) {
      console.error("Failed to load media by id", id, error);
      return null;
    }
  };

  /** Ensure the media cache contains the specified IDs. */
  const ensureMediaMap = async (ids: string[]) => {
    const missing = ids.filter((id) => !mediaMap.value.has(id));
    if (missing.length === 0) return;
    await Promise.all(missing.map((id) => fetchMediaById(id)));
  };

  watch(
    () => initialValues.value,
    async (val) => {
      const ids = collectInitialMediaIds(val as Record<string, unknown>);
      if (ids.length === 0) return;
      if (mediaMapData.value.size === 0) {
        await fetchMediaList();
      }
      await ensureMediaMap(ids);
    },
    { immediate: true },
  );

  /** Open the media picker dialog with a seeded selection. */
  const openMediaDialog = async (field: ModelField, apply: (value: unknown) => void, currentValue: unknown) => {
    mediaDialogField.value = { field, apply };
    mediaDialogVisible.value = true;
    mediaDialogSelection.value = mediaVariant(field) === "multiple" ? parseIds(stringifyIds(currentValue)) : stringifyIds(currentValue) || null;
  };

  /** Apply media selection and close the dialog. */
  const handleMediaConfirm = (selectedItems: MediaItem[]) => {
    const ctx = mediaDialogField.value;
    if (!ctx) return;
    const variant = mediaVariant(ctx.field);
    if (variant === "multiple") {
      const ids = selectedItems.map((item) => item.id);
      ctx.apply(ids);
    } else {
      const id = selectedItems[0]?.id ?? "";
      ctx.apply(id || null);
    }
    upsertMediaItems(selectedItems);
    mediaDialogVisible.value = false;
  };

  return {
    mediaDialogVisible,
    mediaDialogSelection,
    mediaMap,
    activeMediaField,
    openMediaDialog,
    handleMediaConfirm,
    mediaVariant,
    mediaAllowedKinds,
    stringifyIds,
    parseIds,
    moveMediaItem,
  };
};
