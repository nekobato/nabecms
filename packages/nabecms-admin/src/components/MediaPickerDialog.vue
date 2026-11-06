<script lang="ts" setup>
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { ElPagination, ElTable, ElTableColumn, type TableInstance } from "element-plus";
import { useI18n } from "vue-i18n";
import { useAuthStore } from "@/stores/auth";
import { getActivePinia } from "pinia";
import { authorizedFetch } from "@/utils/http";
import { formatJapaneseDateTime } from "@/utils/dateTime";

import Button from "@/components/NabeButton.vue";
import { Dialog, RadioButton } from "@/components/ui/element-plus";
type MediaItem = {
  id: string;
  name: string;
  mimeType: string;
  url: string;
  type?: string | null;
  updatedAt?: string | null;
  size?: number | null;
};

const props = withDefaults(
  defineProps<{
    modelValue: string | string[] | null;
    visible: boolean;
    selectionMode?: "single" | "multiple";
    allowedKinds?: string | string[];
    title?: string;
  }>(),
  {
    selectionMode: "single",
    title: "メディアを選択",
  },
);

const emit = defineEmits<{
  (e: "update:visible", value: boolean): void;
  (e: "update:modelValue", value: string | string[] | null): void;
  (e: "confirm", items: MediaItem[]): void;
  (e: "cancel"): void;
}>();

const { t } = useI18n();
const visibleModel = computed({
  get: () => props.visible,
  set: (val: boolean) => emit("update:visible", val),
});

const loading = ref(false);
const errorMessage = ref<string | null>(null);
const items = ref<MediaItem[]>([]);
const selection = ref<MediaItem | MediaItem[] | null>(null);
const mediaTableRef = ref<TableInstance>();
const syncingTableSelection = ref(false);

const currentPage = ref(1);
const pageSize = ref(10);

const selectionMode = computed(() => props.selectionMode ?? "single");
const isMulti = computed(() => selectionMode.value === "multiple");
const allowedKindSet = computed(() => {
  const raw = props.allowedKinds;
  const values = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  const normalized = values.map((value) => value.trim()).filter((value) => value.length > 0);
  return normalized.length > 0 ? new Set(normalized) : null;
});
const displayedItems = computed(() => {
  const allowed = allowedKindSet.value;
  if (!allowed) return items.value;
  return items.value.filter((item) => typeof item.type === "string" && allowed.has(item.type));
});
const paginatedItems = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return displayedItems.value.slice(start, start + pageSize.value);
});
const selectedSingleId = computed(() => (Array.isArray(selection.value) ? selection.value[0]?.id : selection.value?.id) ?? null);

const selectionEmpty = computed(() => {
  if (isMulti.value) return !(Array.isArray(selection.value) && selection.value.length > 0);
  return !selection.value;
});

const applyModelValueToSelection = () => {
  const value = props.modelValue;
  if (selectionMode.value === "multiple") {
    const ids = Array.isArray(value) ? value : value ? [value] : [];
    selection.value = displayedItems.value.filter((item) => ids.includes(item.id));
  } else {
    const id = typeof value === "string" ? value : Array.isArray(value) ? value[0] : null;
    selection.value = displayedItems.value.find((item) => item.id === id) ?? null;
  }
};

/** Reflect the externally controlled multi-selection in the visible table page. */
const syncTableSelection = async () => {
  if (!isMulti.value) return;
  await nextTick();
  const table = mediaTableRef.value;
  if (!table) return;
  const selectedIds = new Set((Array.isArray(selection.value) ? selection.value : []).map((item) => item.id));
  syncingTableSelection.value = true;
  try {
    table.clearSelection();
    for (const item of paginatedItems.value) {
      if (selectedIds.has(item.id)) table.toggleRowSelection(item, true);
    }
  } finally {
    syncingTableSelection.value = false;
  }
};

/** Build the media list endpoint, using server filtering when a single media kind is allowed. */
const buildMediaListUrl = (): string => {
  const allowed = allowedKindSet.value;
  if (!allowed || allowed.size !== 1) return "/api/admin/media";
  const type = Array.from(allowed)[0];
  if (!type) return "/api/admin/media";
  return `/api/admin/media?type=${encodeURIComponent(type)}`;
};

const fetchMedia = async () => {
  loading.value = true;
  errorMessage.value = null;
  try {
    const active = getActivePinia();
    if (!active) {
      console.warn("Pinia is not active; media list fetch skipped in test/mount context.");
      items.value = [];
      return;
    }
    const authStore = useAuthStore();
    if (!authStore.accessToken) {
      await authStore.refresh().catch(() => undefined);
    }
    const res = await authorizedFetch(authStore, buildMediaListUrl());
    if (!res.ok) {
      const message = await res.text();
      throw new Error(message || res.statusText);
    }
    const data = await res.json();
    const fetched = Array.isArray(data?.items) ? data.items : [];
    items.value = fetched.map((item: Record<string, unknown>) => ({
      id: typeof item.id === "string" ? item.id : String(item.id ?? ""),
      name: typeof item.name === "string" ? item.name : String(item.id ?? ""),
      mimeType: typeof item.mimeType === "string" ? item.mimeType : "",
      url: typeof item.url === "string" ? item.url : "",
      type: typeof item.type === "string" ? item.type : null,
      updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : null,
      size: Number.isFinite(Number(item.size)) ? Number(item.size) : null,
    }));
    applyModelValueToSelection();
  } catch (error) {
    console.error("Failed to fetch media list", error);
    errorMessage.value = "メディアの取得に失敗しました。";
  } finally {
    loading.value = false;
  }
};

onMounted(async () => {
  if (props.visible) {
    await fetchMedia();
  }
});

watch(
  () => props.visible,
  async (visible) => {
    if (visible && items.value.length === 0 && !loading.value) {
      await fetchMedia();
    }
  },
);

watch(
  () => props.modelValue,
  () => {
    applyModelValueToSelection();
    void syncTableSelection();
  },
);

watch([paginatedItems, isMulti], () => void syncTableSelection());

watch(
  () => props.allowedKinds,
  async () => {
    if (!props.visible) return;
    await fetchMedia();
  },
);

const close = () => {
  emit("update:visible", false);
  emit("cancel");
};

const confirm = () => {
  const selectedArray = Array.isArray(selection.value) ? selection.value : selection.value ? [selection.value] : [];
  const ids = selectionMode.value === "multiple" ? selectedArray.map((i) => i.id) : (selectedArray[0]?.id ?? null);
  emit("update:modelValue", ids as string | string[] | null);
  emit("confirm", selectedArray);
  emit("update:visible", false);
};

const onSelectionChange = (value: MediaItem | MediaItem[] | null) => {
  if (syncingTableSelection.value) return;
  selection.value = value;
  const ids = selectionMode.value === "multiple" ? (Array.isArray(value) ? value.map((v) => v.id) : []) : ((value as MediaItem | null)?.id ?? null);
  emit("update:modelValue", ids as string | string[] | null);
};

/** Select a single row from the radio column. */
const selectSingleItem = (item: MediaItem) => {
  onSelectionChange(item);
};

const formatDate = (value?: string | null) => {
  if (!value) return "-";
  return formatJapaneseDateTime(value);
};

const formatSize = (bytes?: number | null) => {
  if (!bytes || bytes <= 0) return "-";
  const units = ["B", "KB", "MB", "GB"] as const;
  const idx = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const val = bytes / 1024 ** idx;
  return `${val.toFixed(val >= 10 ? 0 : 1)} ${units[idx]}`;
};

const dialogStyle = { width: "52rem" } as const;
const dialogBreakpoints: Record<string, string> = {
  "1400px": "48rem",
  "1200px": "44rem",
  "992px": "38rem",
  "768px": "90vw",
  "576px": "95vw",
};
</script>

<template>
  <Dialog
    v-model:visible="visibleModel"
    modal
    :header="title"
    :style="dialogStyle"
    :breakpoints="dialogBreakpoints"
    class="media-picker-dialog"
    :draggable="false"
    @hide="close"
  >
    <div v-if="errorMessage" class="media-error">{{ errorMessage }}</div>
    <div v-else>
      <p class="selection-hint">
        {{ isMulti ? "複数のメディアを選択できます" : "1件のみ選択できます" }}
      </p>
      <ElTable
        ref="mediaTableRef"
        :data="paginatedItems"
        row-key="id"
        class="media-table"
        size="small"
        stripe
        v-loading="loading"
        @selection-change="onSelectionChange"
      >
        <ElTableColumn v-if="isMulti" type="selection" width="48" reserve-selection />
        <!-- @vue-generic {MediaItem} -->
        <ElTableColumn v-else width="48" align="center">
          <template #default="{ row }">
            <RadioButton :model-value="selectedSingleId" :value="row.id" :aria-label="row.name" @update:model-value="selectSingleItem(row)" />
          </template>
        </ElTableColumn>
        <ElTableColumn label="プレビュー" width="112">
          <template #default="slotProps">
            <div class="preview">
              <img v-if="slotProps.row.url" :src="slotProps.row.url" :alt="slotProps.row.name" loading="lazy" />
              <div v-else class="placeholder">No Image</div>
            </div>
          </template>
        </ElTableColumn>
        <ElTableColumn label="名前" prop="name" />
        <ElTableColumn label="MIME" prop="mimeType" width="192" />
        <ElTableColumn label="更新日" prop="updatedAt" width="224">
          <template #default="slotProps">
            <span class="mono">{{ formatDate(slotProps.row.updatedAt) }}</span>
          </template>
        </ElTableColumn>
        <ElTableColumn label="サイズ" prop="size" width="128">
          <template #default="slotProps">{{ formatSize(slotProps.row.size) }}</template>
        </ElTableColumn>
      </ElTable>
      <ElPagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :page-sizes="[10, 20, 50]"
        :total="displayedItems.length"
        layout="total, sizes, prev, pager, next"
        class="media-pagination"
      />
    </div>

    <template #footer>
      <div class="dialog-footer">
        <Button severity="secondary" :label="t('common.cancel')" @click="close" />
        <Button severity="primary" icon="lucide:check" :label="t('contents.edit.media_dialog_apply')" :disabled="loading || selectionEmpty" @click="confirm" />
      </div>
    </template>
  </Dialog>
</template>

<style lang="scss" scoped>
.media-picker-dialog {
  :deep(.el-dialog__body) {
    padding-top: var(--space-12);
  }
}

.media-error {
  color: var(--danger-500);
  margin-bottom: var(--space-8);
}

.media-table {
  .preview {
    width: 96px;
    height: 64px;
    border: 1px solid var(--surface-200);
    border-radius: var(--radius-sm);
    background: var(--surface-50);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .placeholder {
      font-size: var(--font-12);
      color: var(--surface-500);
    }
  }

  .mono {
    font-family: "SFMono-Regular", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  }
}

.selection-hint {
  color: var(--surface-600);
  font-size: var(--font-12);
  margin-bottom: var(--space-8);
}

.media-pagination {
  margin-top: var(--space-16);
  justify-content: flex-end;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-8);
}
</style>
