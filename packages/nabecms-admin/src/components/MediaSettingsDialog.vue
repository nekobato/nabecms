<script lang="ts" setup>
import { ref, computed, watch, onBeforeUnmount } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "@/services/feedback";
import { useAuthStore } from "@/stores/auth";
import { fetchMediaSettings, updateMediaSettings, type MediaSettings } from "@/services/mediaSettings";
import { resizeImageToTemplate, type MediaVariantTemplate } from "@/utils/imageVariants";

import Button from "@/components/NabeButton.vue";
import { InputText } from "@/components/ui/element-plus";
import { Select } from "@/components/ui/element-plus";
import { Checkbox } from "@/components/ui/element-plus";
import { Dialog } from "@/components/ui/element-plus";
import { InputNumber } from "@/components/ui/element-plus";
const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{ (e: "update:visible", value: boolean): void; (e: "saved", value: MediaSettings): void }>();

const { t } = useI18n();
const toast = useToast();
const authStore = useAuthStore();

const loading = ref(false);
const saving = ref(false);
const errorMessage = ref<string | null>(null);

/**
 * Normalize dialog settings so unsupported transform modes are not selectable.
 * @param input - Media settings payload
 * @returns Dialog-safe settings
 */
const normalizeDialogSettings = (input: MediaSettings): MediaSettings => {
  const cloudflareEnabled = input.cloudflare?.enabled === true;
  return {
    transformMode: cloudflareEnabled && input.transformMode === "cloudflare" ? "cloudflare" : "frontend",
    templates: [...input.templates],
    cloudflare: { enabled: cloudflareEnabled },
  };
};

const settings = ref<MediaSettings>(
  normalizeDialogSettings({
    transformMode: "frontend",
    templates: [],
    cloudflare: { enabled: false },
  }),
);

const previewFile = ref<File | null>(null);
const previewItems = ref<Record<string, { url: string; size: number; width: number; height: number }>>({});

const dialogVisible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit("update:visible", value),
});

const transformModeOptions = computed(() => [
  { value: "frontend", label: t("media.settings.mode_frontend"), disabled: false },
  { value: "cloudflare", label: t("media.settings.mode_cloudflare"), disabled: !settings.value.cloudflare.enabled },
]);

const fitOptions = computed(() => [
  { value: "cover", label: "cover" },
  { value: "contain", label: "contain" },
]);

const formatOptions = computed(() => [
  { value: "jpg", label: "jpg" },
  { value: "png", label: "png" },
  { value: "webp", label: "webp" },
  { value: "avif", label: "avif" },
]);

/**
 * Revoke and clear preview object URLs.
 */
const clearPreviews = () => {
  Object.values(previewItems.value).forEach((item) => URL.revokeObjectURL(item.url));
  previewItems.value = {};
};

/**
 * Load media settings when the dialog opens.
 */
const loadData = async () => {
  loading.value = true;
  errorMessage.value = null;
  try {
    const loadedSettings = await fetchMediaSettings(authStore);
    settings.value = normalizeDialogSettings({
      transformMode: loadedSettings.transformMode,
      templates: [...loadedSettings.templates],
      cloudflare: loadedSettings.cloudflare ?? { enabled: false },
    });
  } catch (error) {
    errorMessage.value = t("media.settings.error_fetch");
    console.error(error);
  } finally {
    loading.value = false;
  }
};

/**
 * Add a new template draft to the settings form.
 */
const addTemplate = () => {
  settings.value.templates.push({
    key: "",
    label: "",
    width: undefined,
    height: undefined,
    fit: "cover",
    format: "webp",
    quality: 80,
    upscale: false,
  } satisfies MediaVariantTemplate);
};

/**
 * Remove a template draft by index.
 * @param index - Template index
 */
const removeTemplate = (index: number) => {
  settings.value.templates.splice(index, 1);
};

/**
 * Persist current media settings to the API.
 */
const handleSave = async () => {
  saving.value = true;
  try {
    const updated = await updateMediaSettings(authStore, normalizeDialogSettings(settings.value));
    settings.value = normalizeDialogSettings(updated);
    emit("saved", settings.value);
    toast.add({
      severity: "success",
      summary: t("media.settings.title"),
      detail: t("media.settings.success_save"),
      life: 3000,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : t("media.settings.error_save");
    toast.add({
      severity: "error",
      summary: t("media.settings.title"),
      detail: message,
      life: 4000,
    });
  } finally {
    saving.value = false;
  }
};

/**
 * Handle sample image selection for preview generation.
 * @param event - Input change event
 */
const handlePreviewFileSelect = async (event: Event) => {
  const target = event.target as HTMLInputElement | null;
  const file = target?.files?.[0] ?? null;
  previewFile.value = file;
  clearPreviews();
  if (!file) return;
  await generatePreviews();
};

/**
 * Generate preview images for current templates.
 */
const generatePreviews = async () => {
  if (!previewFile.value) return;
  clearPreviews();
  const file = previewFile.value;
  const next: Record<string, { url: string; size: number; width: number; height: number }> = {};
  for (const template of settings.value.templates) {
    if (!template.key) continue;
    try {
      const result = await resizeImageToTemplate(file, template);
      const url = URL.createObjectURL(result.blob);
      next[template.key] = {
        url,
        size: result.blob.size,
        width: result.width,
        height: result.height,
      };
    } catch (error) {
      console.warn("Failed to generate preview", error);
    }
  }
  previewItems.value = next;
};

/**
 * Format bytes into human-readable units.
 * @param bytes - Byte size
 * @returns Human-readable string
 */
const formatFileSize = (bytes: number) => {
  const sizes = ["Bytes", "KB", "MB", "GB"];
  if (bytes === 0) return "0 Bytes";
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + " " + sizes[i];
};

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      loadData();
      return;
    }
    clearPreviews();
    previewFile.value = null;
    errorMessage.value = null;
  },
);

onBeforeUnmount(() => {
  clearPreviews();
});
</script>

<template>
  <Dialog
    v-model:visible="dialogVisible"
    modal
    :draggable="false"
    :header="t('media.settings.title')"
    :style="{ width: '64rem' }"
    class="media-settings-dialog"
  >
    <div class="dialog-body">
      <div v-if="loading" class="loading">{{ t("media.settings.loading") }}</div>
      <div v-else-if="errorMessage" class="error">{{ errorMessage }}</div>

      <div v-else class="settings-grid">
        <section class="settings-section">
          <h3>{{ t("media.settings.transform_mode") }}</h3>
          <Select
            v-model="settings.transformMode"
            :options="transformModeOptions"
            optionLabel="label"
            optionValue="value"
            optionDisabled="disabled"
            class="full-width"
          />
        </section>

        <section class="settings-section">
          <div class="section-header">
            <h3>{{ t("media.settings.templates_title") }}</h3>
            <Button severity="secondary" icon="lucide:plus" :label="t('media.settings.add_template')" @click="addTemplate" />
          </div>

          <div v-if="settings.templates.length === 0" class="empty">{{ t("media.settings.templates_empty") }}</div>
          <div v-else class="template-list">
            <div v-for="(template, index) in settings.templates" :key="`template-${index}`" class="template-card">
              <div class="template-main">
                <div class="template-header">
                  <span class="template-index">#{{ index + 1 }}</span>
                  <div class="template-actions">
                    <Button severity="danger" text icon="lucide:trash-2" :label="t('media.settings.remove_template')" @click="removeTemplate(index)" />
                  </div>
                </div>
                <div class="template-fields">
                  <div class="field field--span-2">
                    <label>{{ t("media.settings.template_key") }}</label>
                    <InputText v-model="template.key" />
                  </div>
                  <div class="field field--span-2">
                    <label>{{ t("media.settings.template_label") }}</label>
                    <InputText v-model="template.label" />
                  </div>
                  <div class="field">
                    <label>{{ t("media.settings.template_width") }}</label>
                    <InputNumber v-model="template.width" :useGrouping="false" :min="0" />
                  </div>
                  <div class="field">
                    <label>{{ t("media.settings.template_height") }}</label>
                    <InputNumber v-model="template.height" :useGrouping="false" :min="0" />
                  </div>
                  <div class="field field--span-2">
                    <label>{{ t("media.settings.template_fit") }}</label>
                    <Select v-model="template.fit" :options="fitOptions" optionLabel="label" optionValue="value" />
                  </div>
                  <div class="field field--span-2">
                    <label>{{ t("media.settings.template_format") }}</label>
                    <Select v-model="template.format" :options="formatOptions" optionLabel="label" optionValue="value" />
                  </div>
                  <div class="field">
                    <label>{{ t("media.settings.template_quality") }}</label>
                    <InputNumber v-model="template.quality" :useGrouping="false" :min="1" :max="100" />
                  </div>
                  <div class="field field--toggle">
                    <label>{{ t("media.settings.template_upscale") }}</label>
                    <Checkbox v-model="template.upscale" :binary="true" />
                  </div>
                </div>
              </div>

              <div v-if="previewItems[template.key]" class="template-preview">
                <img :src="previewItems[template.key]?.url" :alt="template.key" />
                <div class="preview-meta">
                  <span>{{ previewItems[template.key]?.width }}×{{ previewItems[template.key]?.height }}</span>
                  <span>{{ formatFileSize(previewItems[template.key]?.size ?? 0) }}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="settings-section">
          <h3>{{ t("media.settings.preview_title") }}</h3>
          <p class="hint">{{ t("media.settings.preview_hint") }}</p>
          <input type="file" accept="image/*" @change="handlePreviewFileSelect" />
        </section>
      </div>
    </div>

    <template #footer>
      <Button severity="primary" icon="lucide:save" :label="t('media.settings.save')" :loading="saving" @click="handleSave" />
      <Button severity="secondary" icon="lucide:x" :label="t('media.settings.close')" @click="emit('update:visible', false)" />
    </template>
  </Dialog>
</template>

<style scoped lang="scss">
.media-settings-dialog {
  .dialog-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-16);
  }

  .description {
    color: var(--surface-600);
  }

  .note {
    background: var(--surface-100);
    border-radius: var(--border-radius);
    padding: var(--space-12);
    color: var(--surface-700);
  }

  .loading,
  .error,
  .empty {
    color: var(--surface-500);
    padding: var(--space-12) 0;
  }

  .settings-grid {
    display: flex;
    flex-direction: column;
    gap: var(--space-20);
  }

  .settings-section {
    border: 1px solid var(--surface-200);
    border-radius: var(--border-radius);
    padding: var(--space-16);
    display: flex;
    flex-direction: column;
    gap: var(--space-12);

    > h3,
    .section-header h3 {
      margin: 0;
      color: var(--surface-800);
      font-size: var(--font-16);
      font-weight: 600;
      line-height: 1.4;
    }

    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: var(--space-12);
      flex-wrap: wrap;
    }

    .template-list {
      display: grid;
      gap: var(--space-12);
    }

    .template-card {
      border: 1px solid var(--surface-200);
      border-radius: calc(var(--border-radius) + 2px);
      padding: var(--space-16);
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--space-16);
      background: linear-gradient(180deg, var(--surface-0) 0%, var(--surface-100) 100%);
      box-shadow: none;
    }

    .template-main {
      display: flex;
      flex-direction: column;
      gap: var(--space-12);
    }

    .template-header {
      display: flex;
      align-items: center;
      gap: var(--space-8);
      justify-content: space-between;
    }

    .template-index {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 32px;
      height: 32px;
      border-radius: 999px;
      background: var(--surface-100);
      color: var(--surface-600);
      font-weight: 600;
      font-size: var(--font-13);
    }

    .template-fields {
      display: grid;
      gap: var(--space-12);
      grid-template-columns: repeat(6, minmax(0, 1fr));

      .field {
        display: flex;
        flex-direction: column;
        gap: var(--space-8);

        label {
          font-weight: 500;
          color: var(--surface-700);
          font-size: var(--font-14);
        }
      }

      .field--span-2 {
        grid-column: span 2;
      }

      .field--toggle {
        flex-direction: row;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-8);
      }
    }

    .template-actions {
      display: flex;
      justify-content: flex-end;
    }

    .template-preview {
      display: flex;
      gap: var(--space-12);
      align-items: center;
      align-self: start;
      justify-self: end;
      padding: var(--space-12);
      border-radius: calc(var(--border-radius) + 4px);
      background: var(--surface-0);
      border: 1px solid var(--surface-200);

      img {
        width: 96px;
        height: 96px;
        object-fit: cover;
        border-radius: var(--border-radius);
        border: 1px solid var(--surface-200);
      }

      .preview-meta {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
        color: var(--surface-600);
      }
    }

    .hint {
      margin: 0;
      color: var(--surface-500);
    }

    .template-card :deep(.el-input),
    .template-card :deep(.el-input-number),
    .template-card :deep(.el-select) {
      width: 100%;
    }

    @media (max-width: 1024px) {
      .template-card {
        grid-template-columns: minmax(0, 1fr);
      }

      .template-fields {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .template-preview {
        justify-self: start;
      }
    }

    @media (max-width: 640px) {
      .template-fields {
        grid-template-columns: minmax(0, 1fr);
      }

      .template-fields .field--span-2 {
        grid-column: span 1;
      }
    }
  }
}
</style>
