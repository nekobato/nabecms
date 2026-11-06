<script lang="ts" setup>
import { computed, onMounted, ref, watch } from "vue";
import { NodeViewWrapper, nodeViewProps, type NodeViewProps } from "@tiptap/vue-3";
import { loadMediaReference, getCachedMediaReference } from "@/services/mediaReferences";

import Button from "@/components/NabeButton.vue";
import NabeIcon from "@/components/NabeIcon.vue";
import { Dialog } from "@/components/ui/element-plus";
const props = defineProps(nodeViewProps);
const typedProps = props as NodeViewProps;

const loading = ref(false);
const errorMessage = ref<string | null>(null);
const mediaName = ref("");
const mediaUrl = ref("");
const mediaMime = ref("");
const mediaDescription = ref<string | null>(null);
const mediaSize = ref<number | null>(null);
const mediaWidth = ref<number | null>(null);
const mediaHeight = ref<number | null>(null);
const mediaUpdatedAt = ref<string | null>(null);
const mediaId = computed(() => String(typedProps.node.attrs.mediaId ?? ""));
const detailDialogVisible = ref(false);

const resolveMetadata = async () => {
  const id = mediaId.value;
  if (!id) {
    mediaName.value = "(media not set)";
    mediaUrl.value = "";
    mediaMime.value = "";
    mediaDescription.value = null;
    mediaSize.value = null;
    mediaWidth.value = null;
    mediaHeight.value = null;
    mediaUpdatedAt.value = null;
    return;
  }
  const cached = getCachedMediaReference(id);
  if (cached) {
    mediaName.value = cached.name || id;
    mediaUrl.value = cached.url || "";
    mediaMime.value = cached.mimeType || "";
    mediaDescription.value = cached.description ?? null;
    mediaSize.value = cached.size ?? null;
    mediaWidth.value = cached.width ?? null;
    mediaHeight.value = cached.height ?? null;
    mediaUpdatedAt.value = cached.updatedAt ?? null;
    return;
  }
  loading.value = true;
  errorMessage.value = null;
  try {
    const meta = await loadMediaReference(id);
    mediaName.value = meta.name || id;
    mediaUrl.value = meta.url || "";
    mediaMime.value = meta.mimeType || "";
    mediaDescription.value = meta.description ?? null;
    mediaSize.value = meta.size ?? null;
    mediaWidth.value = meta.width ?? null;
    mediaHeight.value = meta.height ?? null;
    mediaUpdatedAt.value = meta.updatedAt ?? null;
  } catch (error) {
    console.error("Failed to load media reference metadata", error);
    errorMessage.value = "メディア情報を取得できませんでした";
    mediaName.value = id;
    mediaUrl.value = "";
    mediaMime.value = "";
    mediaDescription.value = null;
    mediaSize.value = null;
    mediaWidth.value = null;
    mediaHeight.value = null;
    mediaUpdatedAt.value = null;
  } finally {
    loading.value = false;
  }
};

const openDetail = (event: MouseEvent | KeyboardEvent) => {
  event.preventDefault();
  event.stopPropagation();
  detailDialogVisible.value = true;
};

const openMediaInNewTab = () => {
  if (mediaUrl.value) {
    window.open(mediaUrl.value, "_blank");
  }
};

watch(mediaId, () => {
  resolveMetadata();
});

onMounted(() => {
  resolveMetadata();
});
</script>

<template>
  <NodeViewWrapper as="div" class="media-reference-node" data-media-reference :data-media-id="mediaId">
    <figure class="media-reference-card" role="button" tabindex="0" @click="openDetail" @keydown.enter.prevent="openDetail" @keydown.space.prevent="openDetail">
      <div class="media-reference-frame" :class="{ placeholder: !mediaUrl }">
        <img
          v-if="mediaUrl"
          :src="mediaUrl"
          :alt="mediaName"
          :width="mediaWidth ?? undefined"
          :height="mediaHeight ?? undefined"
          loading="lazy"
          decoding="async"
        />
        <NabeIcon v-else class="placeholder-icon" icon="lucide:image" />
      </div>
      <figcaption class="media-reference-caption">
        <span class="media-reference-title">{{ loading ? "読み込み中…" : mediaName }}</span>
        <span v-if="errorMessage" class="media-reference-error">{{ errorMessage }}</span>
        <span v-else class="media-reference-details">
          <span v-if="mediaMime">{{ mediaMime }}</span>
          <span>#{{ mediaId }}</span>
        </span>
      </figcaption>
    </figure>

    <Dialog v-model:visible="detailDialogVisible" modal :header="mediaName || 'メディア詳細'" :draggable="false" class="media-detail-dialog">
      <div class="media-detail">
        <div class="preview" :class="{ placeholder: !mediaUrl }">
          <img v-if="mediaUrl" :src="mediaUrl" :alt="mediaName" loading="lazy" />
          <span v-else class="placeholder-icon">🖼️</span>
        </div>
        <div class="info">
          <div class="row">
            <span class="label">ID</span>
            <span class="value">#{{ mediaId }}</span>
          </div>
          <div class="row" v-if="mediaMime">
            <span class="label">MIME</span>
            <span class="value">{{ mediaMime }}</span>
          </div>
          <div class="row" v-if="mediaSize !== null">
            <span class="label">Size</span>
            <span class="value">{{ mediaSize }} bytes</span>
          </div>
          <div class="row" v-if="mediaWidth !== null && mediaHeight !== null">
            <span class="label">Dimensions</span>
            <span class="value">{{ mediaWidth }} × {{ mediaHeight }}</span>
          </div>
          <div class="row" v-if="mediaUpdatedAt">
            <span class="label">Updated</span>
            <span class="value">{{ mediaUpdatedAt }}</span>
          </div>
          <div class="row" v-if="mediaDescription">
            <span class="label">Description</span>
            <span class="value">{{ mediaDescription }}</span>
          </div>
          <div class="row" v-if="mediaUrl">
            <span class="label">URL</span>
            <a class="value link" :href="mediaUrl" target="_blank" rel="noreferrer">{{ mediaUrl }}</a>
          </div>
        </div>
      </div>
      <template #footer>
        <Button type="button" severity="secondary" label="閉じる" @click="detailDialogVisible = false" />
        <Button type="button" severity="primary" icon="lucide:external-link" label="新しいタブで開く" :disabled="!mediaUrl" @click="openMediaInNewTab" />
      </template>
    </Dialog>
  </NodeViewWrapper>
</template>

<style scoped>
.media-reference-node {
  display: block;
  container-type: inline-size;
  margin: var(--space-16) 0;
}

.media-reference-card {
  display: block;
  margin: 0;
  overflow: clip;
  border: 1px solid var(--surface-200);
  border-radius: var(--radius-2);
  background: var(--surface-0);
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    background-color 0.2s ease,
    box-shadow 0.2s ease;
}

.media-reference-card:hover,
.media-reference-card:focus {
  outline: none;
  border-color: var(--primary-300);
  background: var(--surface-0);
  box-shadow: 0 0 0 2px var(--primary-100);
}

.media-reference-frame {
  display: grid;
  place-items: center;
  min-block-size: 160px;
  overflow: hidden;
  background: var(--surface-100);
}

.media-reference-frame img {
  display: block;
  inline-size: auto;
  max-inline-size: 100%;
  block-size: auto;
  max-block-size: min(70cqi, 480px);
  object-fit: contain;
}

.media-reference-frame.placeholder {
  min-block-size: 220px;
  color: var(--surface-400);
}

.media-reference-frame.placeholder .placeholder-icon {
  font-size: var(--font-32);
}

.media-reference-caption {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-10) var(--space-12);
  color: var(--surface-600);
  text-align: center;
}

.media-reference-title {
  font-weight: 600;
  line-height: 1.4;
  color: var(--surface-800);
  overflow-wrap: anywhere;
}

.media-reference-details {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--space-8);
  font-size: var(--font-12);
  color: var(--surface-600);
  word-break: break-all;
}

.media-reference-error {
  font-size: var(--font-12);
  color: var(--red-500);
}

@container (max-width: 420px) {
  .media-reference-frame {
    min-block-size: 128px;
  }

  .media-reference-caption {
    text-align: start;
  }

  .media-reference-details {
    justify-content: flex-start;
  }
}

.media-detail-dialog :deep(.el-dialog__body) {
  padding-top: var(--space-12);
}

.media-detail {
  display: flex;
  gap: var(--space-16);
  flex-wrap: wrap;
}

.media-detail .preview {
  width: 180px;
  height: 180px;
  border-radius: var(--radius-2);
  background: var(--surface-200);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.media-detail .preview img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.media-detail .preview.placeholder .placeholder-icon {
  font-size: 2rem;
}

.media-detail .info {
  flex: 1 1 220px;
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}

.media-detail .row {
  display: grid;
  grid-template-columns: 110px 1fr;
  gap: var(--space-8);
  align-items: baseline;
}

.media-detail .label {
  font-weight: 600;
  color: var(--surface-700);
}

.media-detail .value {
  color: var(--surface-900);
  word-break: break-all;
}

.media-detail .value.link {
  color: var(--primary-600);
  text-decoration: underline;
}
</style>
