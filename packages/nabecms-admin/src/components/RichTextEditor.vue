<script lang="ts" setup>
import { encodeResourceId } from "@/utils/resourceId";
import { computed, onBeforeUnmount, watch, ref } from "vue";
import { useEditor, EditorContent, type JSONContent } from "@tiptap/vue-3";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import DragHandle from "@tiptap/extension-drag-handle";
import { Icon } from "@iconify/vue";
import EntryReference from "@/extensions/EntryReference";
import MediaReference from "@/extensions/MediaReference";
import MediaPickerDialog from "@/components/MediaPickerDialog.vue";
import { useAuthStore } from "@/stores/auth";
import { authorizedFetch } from "@/utils/http";
import { preloadMediaReferences } from "@/services/mediaReferences";
import { formatJapaneseDateTime } from "@/utils/dateTime";

import Button from "@/components/NabeButton.vue";
import { ElPagination, ElTable, ElTableColumn } from "element-plus";
import { Dialog, Divider, InputText, RadioButton, Select } from "@/components/ui/element-plus";
type RichTextPayload = {
  type: "rich_text";
  value: JSONContent;
};
type RichTextValue = string | RichTextPayload;

function isRichTextPayload(v: unknown): v is RichTextPayload {
  return !!v && typeof v === "object" && (v as Record<string, unknown>).type === "rich_text";
}

const props = withDefaults(
  defineProps<{
    id?: string | null;
    modelValue: RichTextValue | null | undefined;
    placeholder?: string;
    disabled?: boolean;
    minHeight?: string;
  }>(),
  {
    id: null,
    placeholder: "ここに本文を入力…",
    disabled: false,
    minHeight: "160px",
  },
);

const emit = defineEmits<{
  (e: "update:modelValue", v: RichTextValue): void;
  (e: "blur"): void;
  (e: "focus"): void;
}>();

let dragHandleEl: HTMLElement | null = null;

const initialContent = computed<JSONContent | string>(() => {
  const v = props.modelValue;
  if (isRichTextPayload(v)) return v.value;
  if (typeof v === "string" && v.trim().length > 0) {
    // Allow plain text/HTML seed for mocks
    return v;
  }
  return { type: "doc", content: [{ type: "paragraph" }] };
});

const editor = useEditor({
  content: initialContent.value,
  editable: !props.disabled,
  extensions: [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      // Avoid duplicate `link` extension; we provide our own below
      link: false,
    }),
    Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
    Placeholder.configure({ placeholder: props.placeholder }),
    MediaReference,
    DragHandle.configure({
      render: () => {
        const button = document.createElement("button");
        button.type = "button";
        button.classList.add("rt-drag-handle");
        button.dataset.visible = "false";
        button.setAttribute("aria-label", "ブロックをドラッグ");
        for (let i = 0; i < 4; i += 1) {
          const dot = document.createElement("span");
          dot.classList.add("rt-drag-handle__dot");
          button.appendChild(dot);
        }
        dragHandleEl = button;
        return button;
      },
      onNodeChange: ({ node }) => {
        if (!dragHandleEl) return;
        dragHandleEl.dataset.visible = node ? "true" : "false";
      },
    }),
    EntryReference,
  ],
  onUpdate({ editor }) {
    const json = editor.getJSON();
    emit("update:modelValue", { type: "rich_text", value: json });
  },
  onFocus() {
    emit("focus");
  },
  onBlur() {
    emit("blur");
  },
});

// Keep editor in sync when external modelValue changes
watch(
  () => props.modelValue,
  (val) => {
    if (!editor.value) return;
    const current = editor.value.getJSON();
    let next: JSONContent | string;
    if (isRichTextPayload(val)) next = val.value;
    else if (typeof val === "string") next = val;
    else next = { type: "doc", content: [{ type: "paragraph" }] };
    // Naive diff: replace if string or JSON differs in stringified form
    const shouldReplace = typeof next === "string" || JSON.stringify(current) !== JSON.stringify(next);
    if (shouldReplace) {
      editor.value.commands.setContent(next, { emitUpdate: false });
    }
  },
  { deep: true },
);

onBeforeUnmount(() => {
  editor.value?.destroy();
});

function setLink() {
  const url = window.prompt("リンク先URLを入力してください");
  if (url === null) return;
  if (url === "") {
    editor.value?.chain().focus().unsetLink().run();
    return;
  }
  editor.value?.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
}

type ModelOption = {
  label: string;
  value: string;
};

type EntrySearchResult = {
  id: string;
  modelId: string;
  displayTitle: string;
  status: string;
  updatedAt: string | null;
};

const formatDateTime = (value: string | null): string => {
  if (!value) return "-";
  return formatJapaneseDateTime(value);
};

const dialogStyle = { width: "52rem" } as const;
const dialogBreakpoints: Record<string, string> = {
  "1400px": "48rem",
  "1200px": "44rem",
  "992px": "38rem",
  "768px": "90vw",
  "576px": "95vw",
};

const authStore = useAuthStore();

const entryReferenceDialogVisible = ref(false);
const modelsLoading = ref(false);
const entriesLoading = ref(false);
const modelOptions = ref<ModelOption[]>([]);
const selectedModelId = ref<string | null>(null);
const entrySearchQuery = ref("");
const entryResults = ref<EntrySearchResult[]>([]);
const selectedEntry = ref<EntrySearchResult | null>(null);
const dialogError = ref<string | null>(null);
const currentPage = ref(1);
const pageSize = ref(10);
const paginatedEntryResults = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return entryResults.value.slice(start, start + pageSize.value);
});

type MediaItem = {
  id: string;
  url: string;
  name: string;
  mimeType: string;
};

const mediaDialogVisible = ref(false);
const mediaSelection = ref<string | null>(null);

const ensureModelsLoaded = async () => {
  if (modelOptions.value.length > 0 || modelsLoading.value) return;
  modelsLoading.value = true;
  try {
    if (!authStore.accessToken) {
      await authStore.refresh().catch(() => undefined);
    }
    const res = await authorizedFetch(authStore, "/api/admin/models");
    if (!res.ok) {
      const message = await res.text();
      throw new Error(message || res.statusText);
    }
    const data = await res.json();
    const items = Array.isArray(data?.items) ? data.items : [];
    modelOptions.value = items.map((item: Record<string, unknown>) => {
      const id = typeof item.id === "string" ? item.id : String(item.id ?? "");
      const name = typeof item.name === "string" && item.name.trim().length > 0 ? item.name : id;
      return { label: name, value: id } satisfies ModelOption;
    });
  } catch (error) {
    console.error("Failed to fetch models:", error);
    dialogError.value = "モデルの取得に失敗しました。";
  } finally {
    modelsLoading.value = false;
  }
};

const searchEntries = async () => {
  if (!selectedModelId.value) {
    dialogError.value = "モデルを選択してください。";
    entryResults.value = [];
    return;
  }
  entriesLoading.value = true;
  dialogError.value = null;
  try {
    if (!authStore.accessToken) {
      await authStore.refresh().catch(() => undefined);
    }
    const query = entrySearchQuery.value.trim();
    const searchParam = query.length > 0 ? `?q=${encodeURIComponent(query)}` : "";
    const res = await authorizedFetch(authStore, `/api/admin/models/${encodeResourceId(selectedModelId.value)}/entries${searchParam}`);
    if (!res.ok) {
      const message = await res.text();
      throw new Error(message || res.statusText);
    }
    const data = await res.json();
    const items: EntrySearchResult[] = (Array.isArray(data) ? data : []).map((item: Record<string, unknown>) => {
      const id = typeof item.id === "string" ? item.id : String(item.id ?? "");
      const modelId = typeof item.modelId === "string" ? item.modelId : selectedModelId.value!;
      const displayTitle = typeof item.displayTitle === "string" && item.displayTitle.trim().length > 0 ? item.displayTitle : id;
      const status = typeof item.status === "string" ? item.status : "";
      const updatedAt = typeof item.updatedAt === "string" ? item.updatedAt : null;
      return { id, modelId, displayTitle, status, updatedAt } satisfies EntrySearchResult;
    });
    entryResults.value = items;
    currentPage.value = 1;
    if (items.length === 0) {
      selectedEntry.value = null;
    }
  } catch (error) {
    console.error("Failed to search entries:", error);
    dialogError.value = "エントリーの検索に失敗しました。";
    entryResults.value = [];
  } finally {
    entriesLoading.value = false;
  }
};

const openEntryReferenceDialog = async () => {
  entryReferenceDialogVisible.value = true;
  dialogError.value = null;
  selectedEntry.value = null;
  entryResults.value = [];
  entrySearchQuery.value = "";
  await ensureModelsLoaded();
  if (!selectedModelId.value && modelOptions.value.length > 0) {
    const firstOption = modelOptions.value[0];
    if (firstOption) {
      selectedModelId.value = firstOption.value;
    }
  }
  if (selectedModelId.value) {
    await searchEntries();
  }
};

const closeEntryReferenceDialog = () => {
  entryReferenceDialogVisible.value = false;
};

const insertSelectedEntryReference = () => {
  if (!selectedEntry.value || !editor.value) return;
  const entry = selectedEntry.value;
  if (editor.value.isActive("entryReference")) {
    editor.value.commands.updateEntryReference({ entryId: entry.id });
  } else {
    editor.value.chain().focus().setEntryReference({ entryId: entry.id }).run();
  }
  closeEntryReferenceDialog();
};

const openMediaDialog = async () => {
  mediaDialogVisible.value = true;
};

const closeMediaDialog = () => {
  mediaDialogVisible.value = false;
};

const insertSelectedMedia = async (selected: MediaItem[]) => {
  if (!editor.value || selected.length === 0) return;
  const media = selected[0];
  if (!media) return;
  await preloadMediaReferences([media.id]).catch(() => undefined);
  editor.value.chain().focus().setMediaReference({ mediaId: media.id }).run();
  closeMediaDialog();
};

watch(entryReferenceDialogVisible, (visible) => {
  if (!visible) {
    entrySearchQuery.value = "";
    entryResults.value = [];
    selectedEntry.value = null;
    dialogError.value = null;
  }
});

watch(selectedModelId, async (modelId, previous) => {
  if (modelId && entryReferenceDialogVisible.value && modelId !== previous) {
    await searchEntries();
  }
});
</script>

<template>
  <div class="rt-editor" :id="id ?? undefined">
    <div class="rt-toolbar">
      <div class="left">
        <Button
          class="toolbar-button"
          size="small"
          :disabled="!editor"
          :severity="editor?.isActive('bold') ? 'secondary' : 'contrast'"
          v-tooltip.top="'太字'"
          aria-label="太字"
          @click="editor?.chain().focus().toggleBold().run()"
        >
          <Icon class="toolbar-icon" icon="heroicons:bold-16-solid" />
        </Button>
        <Button
          class="toolbar-button"
          size="small"
          :disabled="!editor"
          :severity="editor?.isActive('italic') ? 'secondary' : 'contrast'"
          v-tooltip.top="'斜体'"
          aria-label="斜体"
          @click="editor?.chain().focus().toggleItalic().run()"
        >
          <Icon class="toolbar-icon" icon="heroicons:italic-16-solid" />
        </Button>
        <Button
          class="toolbar-button"
          size="small"
          :disabled="!editor"
          :severity="editor?.isActive('strike') ? 'secondary' : 'contrast'"
          v-tooltip.top="'取り消し線'"
          aria-label="取り消し線"
          @click="editor?.chain().focus().toggleStrike().run()"
        >
          <Icon class="toolbar-icon" icon="heroicons:strikethrough-16-solid" />
        </Button>
        <Divider layout="vertical" />
        <Button
          class="toolbar-button"
          size="small"
          :disabled="!editor"
          :severity="editor?.isActive('heading', { level: 1 }) ? 'secondary' : 'contrast'"
          v-tooltip.top="'見出し1'"
          aria-label="見出し1"
          @click="editor?.chain().focus().toggleHeading({ level: 1 }).run()"
        >
          <Icon class="toolbar-icon" icon="heroicons:h1-16-solid" />
        </Button>
        <Button
          class="toolbar-button"
          size="small"
          :disabled="!editor"
          :severity="editor?.isActive('heading', { level: 2 }) ? 'secondary' : 'contrast'"
          v-tooltip.top="'見出し2'"
          aria-label="見出し2"
          @click="editor?.chain().focus().toggleHeading({ level: 2 }).run()"
        >
          <Icon class="toolbar-icon" icon="heroicons:h2-16-solid" />
        </Button>
        <Button
          class="toolbar-button"
          size="small"
          :disabled="!editor"
          :severity="editor?.isActive('heading', { level: 3 }) ? 'secondary' : 'contrast'"
          v-tooltip.top="'見出し3'"
          aria-label="見出し3"
          @click="editor?.chain().focus().toggleHeading({ level: 3 }).run()"
        >
          <Icon class="toolbar-icon" icon="heroicons:h3-16-solid" />
        </Button>
        <Divider layout="vertical" />
        <Button
          class="toolbar-button"
          size="small"
          :disabled="!editor"
          :severity="editor?.isActive('bulletList') ? 'secondary' : 'contrast'"
          v-tooltip.top="'箇条書き'"
          aria-label="箇条書き"
          @click="editor?.chain().focus().toggleBulletList().run()"
        >
          <Icon class="toolbar-icon" icon="heroicons:list-bullet-16-solid" />
        </Button>
        <Button
          class="toolbar-button"
          size="small"
          :disabled="!editor"
          :severity="editor?.isActive('orderedList') ? 'secondary' : 'contrast'"
          v-tooltip.top="'番号付きリスト'"
          aria-label="番号付きリスト"
          @click="editor?.chain().focus().toggleOrderedList().run()"
        >
          <Icon class="toolbar-icon" icon="heroicons:queue-list-16-solid" />
        </Button>
        <Button
          class="toolbar-button"
          size="small"
          :disabled="!editor"
          :severity="editor?.isActive('blockquote') ? 'secondary' : 'contrast'"
          v-tooltip.top="'引用'"
          aria-label="引用"
          @click="editor?.chain().focus().toggleBlockquote().run()"
        >
          <Icon class="toolbar-icon" icon="heroicons:chat-bubble-left-16-solid" />
        </Button>
        <Button
          class="toolbar-button"
          size="small"
          :disabled="!editor"
          v-tooltip.top="'区切り線'"
          aria-label="区切り線"
          @click="editor?.chain().focus().setHorizontalRule().run()"
        >
          <Icon class="toolbar-icon" icon="heroicons:minus-16-solid" />
        </Button>
        <Divider layout="vertical" />
        <Button
          class="toolbar-button"
          size="small"
          :disabled="!editor"
          :severity="editor?.isActive('link') ? 'secondary' : 'contrast'"
          v-tooltip.top="'リンク'"
          aria-label="リンク"
          @click="setLink"
        >
          <Icon class="toolbar-icon" icon="heroicons:link-16-solid" />
        </Button>
        <Button
          class="toolbar-button"
          size="small"
          :disabled="!editor"
          v-tooltip.top="'リンク解除'"
          aria-label="リンク解除"
          @click="editor?.chain().focus().unsetLink().run()"
        >
          <Icon class="toolbar-icon" icon="heroicons:link-slash-16-solid" />
        </Button>
        <Button
          class="toolbar-button"
          size="small"
          :disabled="!editor"
          v-tooltip.top="'エントリー参照を挿入'"
          aria-label="エントリー参照を挿入"
          @click="openEntryReferenceDialog"
        >
          <Icon class="toolbar-icon" icon="heroicons:document-text-16-solid" />
        </Button>
        <Button class="toolbar-button" size="small" :disabled="!editor" v-tooltip.top="'メディアを挿入'" aria-label="メディアを挿入" @click="openMediaDialog">
          <Icon class="toolbar-icon" icon="heroicons:photo" />
        </Button>
      </div>
      <div class="right">
        <Button
          class="toolbar-button"
          size="small"
          :disabled="!editor || !editor.can().undo()"
          v-tooltip.top="'元に戻す'"
          aria-label="元に戻す"
          @click="editor?.chain().focus().undo().run()"
        >
          <Icon class="toolbar-icon" icon="heroicons:arrow-uturn-left-16-solid" />
        </Button>
        <Button
          class="toolbar-button"
          size="small"
          :disabled="!editor || !editor.can().redo()"
          v-tooltip.top="'やり直し'"
          aria-label="やり直し"
          @click="editor?.chain().focus().redo().run()"
        >
          <Icon class="toolbar-icon" icon="heroicons:arrow-uturn-right-16-solid" />
        </Button>
      </div>
    </div>
    <div class="rt-surface" :style="{ minHeight: minHeight }">
      <EditorContent :editor="editor" class="tiptap-editor" />
    </div>
  </div>

  <Dialog
    v-model:visible="entryReferenceDialogVisible"
    modal
    header="エントリーを挿入"
    :style="dialogStyle"
    :breakpoints="dialogBreakpoints"
    :draggable="false"
    class="entry-reference-dialog-wrapper"
    @hide="closeEntryReferenceDialog"
  >
    <div class="entry-reference-dialog">
      <div class="field-group">
        <label class="field-label">モデル</label>
        <Select
          v-model="selectedModelId"
          :options="modelOptions"
          optionLabel="label"
          optionValue="value"
          placeholder="モデルを選択"
          :loading="modelsLoading"
          class="w-full"
        />
      </div>

      <div class="field-group">
        <label class="field-label">エントリー検索</label>
        <div class="search-controls">
          <InputText v-model="entrySearchQuery" placeholder="キーワードを入力" class="search-input" @keyup.enter="searchEntries" />
          <Button type="button" label="検索" size="small" :disabled="!selectedModelId" :loading="entriesLoading" @click="searchEntries" />
        </div>
      </div>

      <p v-if="dialogError" class="dialog-error">{{ dialogError }}</p>

      <ElTable v-if="entryResults.length > 0" :data="paginatedEntryResults" row-key="id" class="reference-results" size="small" stripe>
        <!-- @vue-generic {EntrySearchResult} -->
        <ElTableColumn width="48" align="center">
          <template #default="{ row }">
            <RadioButton :model-value="selectedEntry?.id ?? null" :value="row.id" :aria-label="row.displayTitle" @update:model-value="selectedEntry = row" />
          </template>
        </ElTableColumn>
        <ElTableColumn prop="displayTitle" label="タイトル">
          <template #default="{ row: data }">
            <div class="result-row">
              <div class="result-main">{{ data.displayTitle }}</div>
              <div class="result-meta">#{{ data.id }} · {{ data.status || "-" }}</div>
            </div>
          </template>
        </ElTableColumn>
        <ElTableColumn prop="modelId" label="モデル" width="144" />
        <ElTableColumn prop="updatedAt" label="更新日時" width="176">
          <template #default="{ row: data }">{{ formatDateTime(data.updatedAt) }}</template>
        </ElTableColumn>
        <template #empty>
          <p class="no-results">該当するエントリーが見つかりません。</p>
        </template>
      </ElTable>
      <ElPagination
        v-if="entryResults.length > 0"
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :page-sizes="[10, 20, 50]"
        :total="entryResults.length"
        layout="total, sizes, prev, pager, next"
        class="reference-pagination"
      />
      <p v-else-if="!entriesLoading" class="no-results">該当するエントリーが見つかりません。</p>
    </div>

    <template #footer>
      <div class="dialog-actions">
        <Button type="button" label="キャンセル" severity="secondary" @click="closeEntryReferenceDialog" />
        <Button type="button" label="挿入" :disabled="!selectedEntry" @click="insertSelectedEntryReference" />
      </div>
    </template>
  </Dialog>

  <MediaPickerDialog
    v-model:visible="mediaDialogVisible"
    v-model:model-value="mediaSelection"
    selection-mode="single"
    title="メディアを挿入"
    @confirm="insertSelectedMedia"
  />
</template>

<style lang="scss" scoped>
.rt-editor {
  border-radius: var(--radius-8);
  background: var(--surface-0);

  .rt-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-8);
    padding: var(--space-8);

    .left,
    .right {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-4);
    }

    .left {
      flex: 1 1 auto;
      min-inline-size: 0;
    }

    .right {
      flex: 0 0 auto;
      flex-wrap: nowrap;
    }
  }

  .rt-surface {
    margin-top: var(--space-16);
  }

  .toolbar-button {
    flex: 0 0 auto;

    .toolbar-icon {
      flex: 0 0 auto;
      width: 16px;
      height: 16px;
    }
  }

  .toolbar-button + .toolbar-button {
    margin-inline-start: 0;
  }
}

/* Basic TipTap content styles */
.tiptap-editor {
  border: 1px solid var(--surface-300);
  border-radius: var(--radius-8);
  padding: 0;
  min-height: inherit;
  :deep(.tiptap:focus) {
    outline: none;
  }
  :deep(.tiptap) {
    display: block;
    box-sizing: border-box;
    min-height: inherit;
    padding: var(--space-8);
    cursor: text;
    outline: none;
  }
  :deep(p) {
    margin: 0 0 var(--space-8);
    line-height: 1.7;
  }
  :deep(h1) {
    font-size: 1.5rem;
    margin: var(--space-12) 0 var(--space-8);
  }
  :deep(h2) {
    font-size: 1.25rem;
    margin: var(--space-12) 0 var(--space-8);
  }
  :deep(h3) {
    font-size: 1.1rem;
    margin: var(--space-12) 0 var(--space-8);
  }
  :deep(ul),
  :deep(ol) {
    padding-left: var(--space-24);
    margin: 0 0 var(--space-8);
  }
  :deep(blockquote) {
    border-left: 4px solid var(--surface-300);
    margin: var(--space-8) 0;
    padding: var(--space-8) var(--space-12);
    color: var(--surface-600);
    background: var(--surface-50);
  }
  :deep(.rt-drag-handle) {
    display: inline-flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: 3px;
    width: 16px;
    height: 28px;
    border-radius: 2px;
    border: 1px solid var(--surface-300);
    background: var(--surface-0);
    color: var(--surface-500);
    cursor: grab;
    transition:
      border-color 0.2s ease,
      box-shadow 0.2s ease,
      background-color 0.2s ease;
    z-index: 20;
  }
  :deep(.rt-drag-handle[data-visible="false"]) {
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transform: translate(-9999px, -9999px) !important;
  }
  :deep(.rt-drag-handle:focus),
  :deep(.rt-drag-handle:hover) {
    border-color: var(--primary-300);
    background: var(--primary-50);
    color: var(--primary-500);
  }
  :deep(.rt-drag-handle:active) {
    cursor: grabbing;
  }
  :deep(.rt-drag-handle__dot) {
    width: 3px;
    height: 3px;
    border-radius: 999px;
    background-color: currentColor;
    display: block;
  }

  /* Ensure inserted media never overflows the editor width */
  :deep(img),
  :deep(.rt-image) {
    max-width: 100%;
    height: auto;
    display: block;
  }
}

.entry-reference-dialog-wrapper {
  :deep(.el-dialog__body) {
    padding-top: var(--space-16);
  }
}

.entry-reference-dialog {
  display: flex;
  flex-direction: column;
  gap: var(--space-16);

  .field-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);

    .field-label {
      font-weight: 600;
      color: var(--surface-700);
    }

    .search-controls {
      display: flex;
      gap: var(--space-8);

      .search-input {
        flex: 1 1 auto;
      }
    }
  }

  .dialog-error {
    color: var(--red-500);
    font-size: var(--font-14);
  }

  .reference-results {
    width: 100%;
  }

  .reference-pagination {
    justify-content: flex-end;
  }

  .result-row {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);

    .result-main {
      font-weight: 600;
      color: var(--surface-800);
    }

    .result-meta {
      font-size: var(--font-12);
      color: var(--surface-500);
    }
  }

  .no-results {
    font-size: var(--font-14);
    color: var(--surface-500);
  }

  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-12);
  }
}
</style>
