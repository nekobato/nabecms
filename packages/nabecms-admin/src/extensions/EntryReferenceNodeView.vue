<script lang="ts" setup>
import { encodeResourceId } from "@/utils/resourceId";
import { computed, onMounted, ref, watch } from "vue";
import { useReferenceSession } from "@/pages/contents/entry-edit/referenceSession";
import { useRouter } from "vue-router";
import { NodeViewWrapper, nodeViewProps, type NodeViewProps } from "@tiptap/vue-3";
import { loadEntryReference, getCachedEntryReference } from "@/services/entryReferences";

const props = defineProps(nodeViewProps);
const typedProps = props as NodeViewProps;

const loading = ref(false);
const errorMessage = ref<string | null>(null);
const displayTitle = ref<string>("");
const modelName = ref<string>("");
const status = ref<string>("");

const router = useRouter();
const referenceSession = useReferenceSession();

const entryId = computed(() => String(typedProps.node.attrs.entryId ?? ""));

let metadataRequest = 0;
const resolveMetadata = async () => {
  const request = ++metadataRequest;
  loading.value = false;
  errorMessage.value = null;
  const id = entryId.value;
  if (!id) {
    displayTitle.value = "(未設定)";
    modelName.value = "";
    status.value = "";
    return;
  }
  const cached = getCachedEntryReference(id);
  if (cached) {
    displayTitle.value = cached.displayTitle || cached.entryId;
    modelName.value = cached.modelName;
    status.value = cached.status || "";
    return;
  }
  loading.value = true;
  errorMessage.value = null;
  try {
    const metadata = await loadEntryReference(id);
    if (request !== metadataRequest) return;
    displayTitle.value = metadata.displayTitle || metadata.entryId;
    modelName.value = metadata.modelName;
    status.value = metadata.status || "";
  } catch (error) {
    if (request !== metadataRequest) return;
    console.error("Failed to load entry reference metadata", error);
    errorMessage.value = "エントリー情報を取得できませんでした";
    displayTitle.value = id;
    modelName.value = "";
    status.value = "";
  } finally {
    if (request === metadataRequest) loading.value = false;
  }
};

const navigateToEntry = (event: MouseEvent | KeyboardEvent) => {
  if (!entryId.value || !typedProps.editor || loading.value || errorMessage.value) return;
  event.preventDefault();
  event.stopPropagation();
  const metadata = getCachedEntryReference(entryId.value);
  const modelId = metadata?.modelId;
  if (!modelId) return;
  const path = `/contents/${encodeResourceId(modelId)}/${encodeResourceId(entryId.value)}`;
  const openInNewTab = "metaKey" in event ? event.metaKey || event.ctrlKey : false;
  if (openInNewTab) {
    window.open(router.resolve(path).href, "_blank", "noopener");
  } else if (referenceSession) {
    referenceSession.open({ entryId: entryId.value, modelId, title: metadata.displayTitle, modelName: metadata.modelName });
  } else {
    router.push(path);
  }
};

const handleClick = (event: MouseEvent) => {
  navigateToEntry(event);
};

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  navigateToEntry(event);
};

watch(entryId, () => {
  resolveMetadata();
});

watch(
  () => getCachedEntryReference(entryId.value),
  () => {
    void resolveMetadata();
  },
);

onMounted(() => {
  resolveMetadata();
});

const statusLabel = computed(() => {
  const value = status.value.trim();
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
});
</script>

<template>
  <NodeViewWrapper as="div" class="entry-reference-node" data-entry-reference :data-entry-id="entryId">
    <div
      class="entry-reference-card"
      role="button"
      :tabindex="errorMessage ? -1 : 0"
      :aria-disabled="!!errorMessage || loading"
      @click="handleClick"
      @keydown.enter.prevent="handleKeydown"
      @keydown.space.prevent="handleKeydown"
    >
      <div class="entry-reference-header">
        <span class="entry-reference-model" v-if="modelName">{{ modelName }}</span>
        <span class="entry-reference-status" v-if="statusLabel" :data-status="status.toLowerCase()">
          {{ statusLabel }}
        </span>
      </div>
      <div class="entry-reference-title">
        <span v-if="loading" class="entry-reference-loading">読み込み中…</span>
        <span v-else-if="errorMessage" class="entry-reference-error">{{ errorMessage }}</span>
        <span v-else>{{ displayTitle }}</span>
      </div>
      <div class="entry-reference-footer">
        <span class="entry-reference-id">#{{ entryId }}</span>
      </div>
    </div>
  </NodeViewWrapper>
</template>

<style scoped>
.entry-reference-node {
  display: block;
  margin: var(--space-8) 0;
}

.entry-reference-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  padding: var(--space-12) var(--space-16);
  border-radius: var(--radius-2);
  border: 1px solid var(--surface-300);
  background-color: var(--surface-50);
  border-left: 4px solid var(--primary-200);
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    background-color 0.2s ease;
}

.entry-reference-card:focus,
.entry-reference-card:hover {
  outline: none;
  border-color: var(--primary-400);
  background-color: var(--primary-50);
}

.entry-reference-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-8);
}

.entry-reference-model {
  font-size: var(--font-12);
  font-weight: 600;
  color: var(--surface-600);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.entry-reference-title {
  font-size: var(--font-16);
  font-weight: 600;
  color: var(--surface-900);
  line-height: 1.4;
  word-break: break-word;
}

.entry-reference-loading {
  color: var(--surface-500);
}

.entry-reference-error {
  color: var(--red-500);
}

.entry-reference-footer {
  display: flex;
  justify-content: flex-start;
  align-items: center;
}

.entry-reference-id {
  font-size: var(--font-12);
  color: var(--surface-500);
}

.entry-reference-status {
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  padding: 0 var(--space-8);
  height: 24px;
  border-radius: 999px;
  font-size: var(--font-12);
  font-weight: 600;
  text-transform: capitalize;
  background-color: var(--surface-200);
  color: var(--surface-700);
}

.entry-reference-status[data-status="published"] {
  background-color: var(--green-100);
  color: var(--green-700);
}

.entry-reference-status[data-status="draft"] {
  background-color: var(--amber-100);
  color: var(--amber-700);
}

.entry-reference-status[data-status="archived"] {
  background-color: var(--surface-300);
  color: var(--surface-700);
}
</style>
