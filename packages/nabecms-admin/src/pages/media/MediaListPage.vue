<script lang="ts" setup>
import { encodeResourceId } from "@/utils/resourceId";
import { ref, onMounted, onUnmounted, computed, watch } from "vue";
import { ElPagination, ElUpload, type UploadFile, type UploadFiles, type UploadInstance } from "element-plus";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { useToast } from "@/services/feedback";
import { useAuthStore } from "../../stores/auth";
import MediaSettingsDialog from "../../components/MediaSettingsDialog.vue";
import FailedVariantsDialog from "../../components/FailedVariantsDialog.vue";
import PageSectionHeader from "../../components/PageSectionHeader.vue";
import { fetchFailedVariants, fetchMediaSettings, type FailedMediaVariant, type MediaSettings } from "../../services/mediaSettings";
import { buildVariantFileName, inferFormatFromMime, resizeImageToTemplate, type MediaVariantTemplate } from "../../utils/imageVariants";
import { formatJapaneseDateTime } from "@/utils/dateTime";

import Button from "@/components/NabeButton.vue";
import NabeIcon from "@/components/NabeIcon.vue";
import { Card } from "@/components/ui/element-plus";
import { Select } from "@/components/ui/element-plus";
import { Dialog } from "@/components/ui/element-plus";
import { Tag } from "@/components/ui/element-plus";
import { Message } from "@/components/ui/element-plus";
import { MultiSelect } from "@/components/ui/element-plus";
const router = useRouter();
const { t } = useI18n();
const toast = useToast();
const authStore = useAuthStore();

type UserSummary = {
  id: string;
  name: string | null;
};

type MediaItem = {
  id: string;
  groupId: string;
  url: string;
  type: string;
  mimeType: string;
  name: string;
  description: string | null;
  width: number | null;
  height: number | null;
  size: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: UserSummary;
  variantCount: number | null;
};

type RawMediaItem = Omit<MediaItem, "updatedBy" | "variantCount"> & { updatedBy: unknown; variantCount?: unknown };

type MediaListResponse = {
  items: RawMediaItem[];
  total?: unknown;
  limit?: unknown;
  offset?: unknown;
};

type VariantMetaPayload = {
  sourceIndex: number;
  templateKey: string;
  width: number;
  height: number;
  format: string;
  mimeType: string;
  size: number;
};

type VariantUploadPayload = {
  file: File;
  meta: VariantMetaPayload;
};

/**
 * Normalize user summary payloads from API responses.
 * @param value - Raw updatedBy value
 * @returns Normalized user summary
 */
const normalizeUserSummary = (value: unknown): UserSummary => {
  if (typeof value === "object" && value !== null && "id" in value) {
    const raw = value as { id?: unknown; name?: unknown };
    const id = typeof raw.id === "string" ? raw.id : String(raw.id ?? "-");
    const name = typeof raw.name === "string" && raw.name.trim().length > 0 ? raw.name : null;
    return { id: id || "-", name };
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return { id: value, name: null };
  }
  return { id: "-", name: null };
};

/**
 * Normalize a media record from the API response.
 * @param item - Raw media item
 * @returns Normalized media item
 */
const normalizeMediaItem = (item: RawMediaItem): MediaItem => ({
  ...item,
  updatedBy: normalizeUserSummary(item.updatedBy),
  variantCount: typeof item.variantCount === "number" ? item.variantCount : null,
});

/**
 * Build a display label for updatedBy values.
 * @param user - User summary
 * @returns Display label
 */
const getUpdatedByLabel = (user: UserSummary | undefined) => user?.name?.trim() || user?.id || "-";

const mediaFiles = ref<MediaItem[]>([]);
const maxMediaFileSizeBytes = 50 * 1024 * 1024;
const acceptedMediaMimeTypes = [
  "application/pdf",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/x-m4a",
  "audio/x-wav",
  "image/gif",
  "image/jpeg",
  "image/png",
  "video/mp4",
  "video/quicktime",
  "video/webm",
].join(",");
const defaultMediaPageRows = 12;
const mediaPageSizeOptions = [defaultMediaPageRows, 24, 48];
const mediaPageFirst = ref(0);
const mediaPageRows = ref(defaultMediaPageRows);
const totalMediaFiles = ref(0);

const loading = ref(false);
const uploading = ref(false);
const errorMessage = ref<string | null>(null);
const selectedType = ref("");

const uploadDialogOpen = ref(false);
const selectedFiles = ref<File[]>([]);
const previewImages = ref<{ url: string; name: string; size: number }[]>([]);
const fileUploadRef = ref<UploadInstance | null>(null);
const canStartUpload = computed(() => selectedFiles.value.length > 0 && !uploading.value);
const mediaSettingsDialogOpen = ref(false);
const mediaSettings = ref<MediaSettings | null>(null);
const mediaSettingsLoading = ref(false);
const selectedTemplateKeys = ref<string[]>([]);
const noVariantTemplateValue = "__no_variant_templates__";
const hasImageSelection = computed(() => selectedFiles.value.some((file) => file.type?.startsWith("image/")));
const failedVariantsDialogOpen = ref(false);
const failedVariants = ref<FailedMediaVariant[]>([]);
const failedVariantsLoading = ref(false);
const hasFailedVariants = computed(() => failedVariants.value.length > 0 && !failedVariantsLoading.value);

/**
 * Revoke preview object URLs to avoid memory leaks.
 */
const revokePreviews = () => {
  // Revoke existing object URLs to avoid memory leaks
  for (const p of previewImages.value) {
    URL.revokeObjectURL(p.url);
  }
  previewImages.value = [];
};

const typeOptions = computed(() => [
  { value: "", label: t("media.list.type_all") },
  { value: "image", label: t("media.list.type_image") },
  { value: "document", label: t("media.list.type_document") },
  { value: "video", label: t("media.list.type_video") },
  { value: "audio", label: t("media.list.type_audio") },
]);

type VariantTemplateOption = {
  value: string;
  label: string;
};

const availableVariantTemplateOptions = computed<VariantTemplateOption[]>(() => {
  const templates = mediaSettings.value?.templates ?? [];
  return templates
    .map((template) => {
      const key = template.key?.trim();
      if (!key) return null;
      const label = template.label?.trim() || key;
      return { value: key, label };
    })
    .filter((opt): opt is { value: string; label: string } => Boolean(opt));
});

const hasVariantTemplateOptions = computed(() => availableVariantTemplateOptions.value.length > 0);
const variantTemplateOptions = computed<VariantTemplateOption[]>(() =>
  hasVariantTemplateOptions.value
    ? availableVariantTemplateOptions.value
    : [
        {
          value: noVariantTemplateValue,
          label: t("media.list.variant_templates_none"),
        },
      ],
);
const validSelectedTemplateKeys = computed(() => {
  const availableKeys = new Set(availableVariantTemplateOptions.value.map((option) => option.value));
  return selectedTemplateKeys.value.filter((key) => availableKeys.has(key));
});
const variantTemplateSelection = computed<string[]>({
  get: () => (hasVariantTemplateOptions.value ? validSelectedTemplateKeys.value : [noVariantTemplateValue]),
  set: (keys) => {
    const availableKeys = new Set(availableVariantTemplateOptions.value.map((option) => option.value));
    selectedTemplateKeys.value = keys.filter((key) => availableKeys.has(key));
  },
});

/**
 * Normalize media totals returned by the API.
 * @param value - Raw total value
 * @param fallback - Fallback count
 * @returns Normalized total
 */
const normalizeMediaTotal = (value: unknown, fallback: number) => {
  const total = typeof value === "number" ? value : Number(value);
  return Number.isFinite(total) && total >= 0 ? total : fallback;
};

/**
 * Reset media pagination to the first page.
 */
const resetMediaPagination = () => {
  mediaPageFirst.value = 0;
};

/**
 * Fetch media files after a pagination page change.
 * @param page - One-based page number
 */
const handleMediaPageChange = (page: number) => {
  mediaPageFirst.value = (page - 1) * mediaPageRows.value;
  void fetchMediaFiles();
};

/** Fetch media files after changing the page size. */
const handleMediaPageSizeChange = (rows: number) => {
  mediaPageRows.value = rows;
  mediaPageFirst.value = 0;
  void fetchMediaFiles();
};

/**
 * Fetch media files from the API and normalize the results.
 */
const fetchMediaFiles = async () => {
  loading.value = true;
  errorMessage.value = null;
  try {
    const headers: Record<string, string> = {};
    if (authStore.accessToken) {
      headers.Authorization = `Bearer ${authStore.accessToken}`;
    }
    const params = new URLSearchParams();
    if (selectedType.value) {
      params.set("type", selectedType.value);
    }
    params.set("limit", String(mediaPageRows.value));
    params.set("offset", String(mediaPageFirst.value));
    const query = params.toString();
    const url = query ? `/api/admin/media?${query}` : "/api/admin/media";

    const runRequest = () =>
      fetch(url, {
        headers,
      });

    let res = await runRequest();
    if (res.status === 401) {
      const refreshed = await authStore.refresh();
      if (refreshed && authStore.accessToken) {
        headers.Authorization = `Bearer ${authStore.accessToken}`;
        res = await runRequest();
      }
    }
    if (!res.ok) {
      throw new Error(`Failed to load media: ${res.status}`);
    }
    const data = (await res.json()) as MediaListResponse;
    const items = Array.isArray(data.items) ? data.items : [];
    totalMediaFiles.value = normalizeMediaTotal(data.total, items.length);
    if (items.length === 0 && totalMediaFiles.value > 0 && mediaPageFirst.value > 0) {
      const lastPageFirst = Math.floor((totalMediaFiles.value - 1) / mediaPageRows.value) * mediaPageRows.value;
      mediaPageFirst.value = Math.max(0, lastPageFirst);
      await fetchMediaFiles();
      return;
    }
    mediaFiles.value = items.map(normalizeMediaItem);
  } catch (error) {
    console.error("Failed to fetch media files:", error);
    errorMessage.value = t("media.list.error_fetch");
    toast.add({
      severity: "error",
      summary: t("media.list.title"),
      detail: errorMessage.value,
      life: 4000,
    });
  } finally {
    loading.value = false;
  }
};

/**
 * Fetch failed media variants for the alert banner.
 */
const loadFailedVariants = async () => {
  if (failedVariantsLoading.value) return;
  failedVariantsLoading.value = true;
  try {
    failedVariants.value = await fetchFailedVariants(authStore);
  } catch (error) {
    console.error("Failed to fetch failed variants:", error);
    failedVariants.value = [];
  } finally {
    failedVariantsLoading.value = false;
  }
};

/**
 * Open the failed variants dialog.
 */
const openFailedVariantsDialog = () => {
  failedVariantsDialogOpen.value = true;
};

/**
 * Sync failed variants list after dialog updates.
 * @param items - Failed variants list
 */
const handleFailedVariantsUpdated = (items: FailedMediaVariant[]) => {
  failedVariants.value = items;
};

/**
 * Handle keyboard activation for the failed variants alert.
 * @param event - Keyboard event
 */
const handleFailedVariantsMessageKeydown = (event: KeyboardEvent) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    openFailedVariantsDialog();
  }
};

watch(selectedType, () => {
  resetMediaPagination();
  fetchMediaFiles();
});

/**
 * Navigate to the media detail page.
 * @param mediaId - Media identifier
 */
const viewMedia = (mediaId: string) => {
  router.push(`/media/${encodeResourceId(mediaId)}`);
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

/**
 * Format a date string using the current locale.
 * @param dateString - ISO date string
 * @returns Formatted date
 */
const formatDate = (dateString: string) => {
  return formatJapaneseDateTime(dateString);
};

/**
 * Resolve selected templates for upload.
 * @param templates - All available templates
 * @param keys - Selected template keys
 * @returns Selected templates
 */
const resolveSelectedTemplates = (templates: MediaVariantTemplate[], keys: string[]): MediaVariantTemplate[] => {
  if (!Array.isArray(templates) || templates.length === 0) return [];
  if (keys.length === 0) return templates;
  const keySet = new Set(keys);
  return templates.filter((template) => keySet.has(template.key));
};

/**
 * Resolve an emoji icon for media types.
 * @param mimeType - MIME type
 * @returns Emoji icon
 */
const getFileIcon = (mimeType: string) => {
  if (mimeType.startsWith("image/")) return "🖼️";
  if (mimeType === "application/pdf") return "📄";
  if (mimeType.startsWith("video/")) return "🎥";
  if (mimeType.startsWith("audio/")) return "🎵";
  return "📁";
};

/**
 * Open the upload dialog and reset selection.
 */
const openUploadDialog = async () => {
  // Reset selection each time dialog opens
  revokePreviews();
  selectedFiles.value = [];
  fileUploadRef.value?.clearFiles();
  await ensureMediaSettings();
  selectedTemplateKeys.value = [];
  uploadDialogOpen.value = true;
};

/**
 * Close the upload dialog and clear previews.
 */
const closeUploadDialog = () => {
  revokePreviews();
  selectedFiles.value = [];
  fileUploadRef.value?.clearFiles();
  uploadDialogOpen.value = false;
};

/**
 * Handle file selection events from Element Plus upload.
 * @param _uploadFile - Most recently changed upload file
 * @param uploadFiles - Current Element Plus file list
 */
const onFileSelect = (_uploadFile: UploadFile, uploadFiles: UploadFiles) => {
  // Generate previews only for image files
  revokePreviews();
  const files = uploadFiles
    .map((item) => item.raw)
    .filter((file): file is NonNullable<typeof file> => file instanceof File && file.size <= maxMediaFileSizeBytes);
  selectedFiles.value = files;
  if (!files.some((file) => file.type?.startsWith("image/"))) {
    selectedTemplateKeys.value = [];
  }
  for (const f of files) {
    if (f.type?.startsWith("image/")) {
      const url = URL.createObjectURL(f);
      previewImages.value.push({ url, name: f.name, size: f.size });
    }
  }
};

/**
 * Build frontend-resized variant uploads for selected files.
 * @param files - Selected files
 * @param templates - Variant templates
 * @returns Variant upload payloads
 */
const buildVariantUploads = async (files: File[], templates: MediaVariantTemplate[]): Promise<VariantUploadPayload[]> => {
  const uploads: VariantUploadPayload[] = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (!file) continue;
    if (!file.type?.startsWith("image/")) continue;
    for (const template of templates) {
      if (!template.key) continue;
      try {
        const resized = await resizeImageToTemplate(file, template);
        const format = template.format ?? inferFormatFromMime(file.type) ?? "jpg";
        const variantFile = new File([resized.blob], buildVariantFileName(file.name, template.key, format), { type: resized.blob.type });
        uploads.push({
          file: variantFile,
          meta: {
            sourceIndex: index,
            templateKey: template.key,
            width: resized.width,
            height: resized.height,
            format,
            mimeType: resized.blob.type,
            size: resized.blob.size,
          },
        });
      } catch (error) {
        console.warn("Failed to build variant upload", error);
      }
    }
  }
  return uploads;
};

/**
 * Build the multipart payload for one source file and its generated variants.
 * @param file - Source file
 * @param templateKeys - Selected variant template keys
 * @param templates - Resolved variant templates
 * @param transformMode - Active transform provider
 * @returns Single-source multipart payload
 */
const buildMediaUploadFormData = async (
  file: File,
  templateKeys: string[],
  templates: MediaVariantTemplate[],
  transformMode: MediaSettings["transformMode"] | undefined,
): Promise<FormData> => {
  const formData = new FormData();
  for (const key of templateKeys) {
    formData.append("templateKeys[]", key);
  }
  formData.append("files[]", file);

  if (transformMode === "frontend" && templates.length > 0) {
    const variantUploads = await buildVariantUploads([file], templates);
    for (const upload of variantUploads) {
      formData.append("variants[]", upload.file);
      formData.append("variantMeta[]", JSON.stringify(upload.meta));
    }
  }
  return formData;
};

/**
 * Convert an unsuccessful media response into a user-facing error.
 * @param response - Failed upload response
 * @returns Upload error
 */
const createMediaUploadError = async (response: Response): Promise<Error> => {
  let message = `Upload failed: ${response.status}`;
  try {
    const bodyText = await response.text();
    if (bodyText) {
      const data = JSON.parse(bodyText);
      const serverMessage = data?.error?.message;
      message = serverMessage ? `${message} - ${serverMessage}` : `${message} - ${bodyText}`;
    }
  } catch {
    // Retain the status-only error when the response body is not readable JSON.
  }
  return new Error(message);
};

/**
 * Upload one multipart payload, retrying once after an access-token refresh.
 * @param formData - Single-source multipart payload
 */
const uploadMediaFormData = async (formData: FormData): Promise<void> => {
  const headers = new Headers();
  if (authStore.accessToken) {
    headers.set("Authorization", `Bearer ${authStore.accessToken}`);
  }
  const runRequest = () =>
    fetch("/api/admin/media", {
      method: "POST",
      body: formData,
      headers,
    });

  let response = await runRequest();
  if (response.status === 401) {
    const refreshed = await authStore.refresh();
    if (refreshed && authStore.accessToken) {
      headers.set("Authorization", `Bearer ${authStore.accessToken}`);
      response = await runRequest();
    }
  }
  if (!response.ok) {
    throw await createMediaUploadError(response);
  }
};

/**
 * Handle file upload submission with optional frontend variants.
 * @param files - Selected source files
 */
const handleFileUpload = async (files: File[]) => {
  if (files.length === 0) return;

  const selectedUploadTemplateKeys = validSelectedTemplateKeys.value;
  uploading.value = true;
  try {
    const settings = await ensureMediaSettings();
    const templates = settings ? resolveSelectedTemplates(settings.templates, selectedUploadTemplateKeys) : [];
    for (const file of files) {
      const formData = await buildMediaUploadFormData(file, selectedUploadTemplateKeys, templates, settings?.transformMode);
      await uploadMediaFormData(formData);
    }

    fileUploadRef.value?.clearFiles();
    toast.add({
      severity: "success",
      summary: t("media.list.title"),
      detail: t("media.list.success_upload"),
      life: 4000,
    });
    closeUploadDialog();
    resetMediaPagination();
    await fetchMediaFiles();
    await loadFailedVariants();
  } catch (error) {
    console.error("Failed to upload media:", error);
    const message = error instanceof Error ? `${t("media.list.error_upload")}: ${error.message}` : t("media.list.error_upload");
    toast.add({
      severity: "error",
      summary: t("media.list.title"),
      detail: message,
      life: 4000,
    });
  } finally {
    uploading.value = false;
  }
};

/**
 * Start uploading the current Element Plus file selection.
 */
const startUpload = () => {
  if (!canStartUpload.value) return;
  void handleFileUpload(selectedFiles.value);
};

/**
 * Hide images that fail to load.
 * @param event - Image error event
 */
const handleImageError = (event: Event) => {
  const target = event.target instanceof HTMLImageElement ? event.target : null;
  if (target) {
    target.style.display = "none";
  }
};

/**
 * Load media settings from the API.
 */
const loadMediaSettings = async () => {
  if (mediaSettingsLoading.value) return;
  mediaSettingsLoading.value = true;
  try {
    mediaSettings.value = await fetchMediaSettings(authStore);
  } catch (error) {
    console.error("Failed to fetch media settings", error);
    mediaSettings.value = null;
  } finally {
    mediaSettingsLoading.value = false;
  }
};

/**
 * Ensure media settings are loaded before upload.
 * @returns Media settings or null
 */
const ensureMediaSettings = async () => {
  if (!mediaSettings.value) {
    await loadMediaSettings();
  }
  return mediaSettings.value;
};

/**
 * Open the Media Settings dialog.
 */
const openMediaSettings = () => {
  mediaSettingsDialogOpen.value = true;
};

/**
 * Update local state after Media Settings save.
 * @param next - Updated settings
 */
const handleMediaSettingsSaved = (next: MediaSettings) => {
  mediaSettings.value = next;
};

onMounted(async () => {
  if (!authStore.accessToken) {
    await authStore.refresh().catch(() => undefined);
  }
  await fetchMediaFiles();
  await loadFailedVariants();
  await loadMediaSettings();
});

onUnmounted(() => {
  revokePreviews();
});
</script>

<template>
  <div class="media-list-page">
    <PageSectionHeader class="media-list-header" :title="t('media.list.title')">
      <template #actions>
        <div class="header-actions">
          <Button class="media-settings-button" @click="openMediaSettings" severity="secondary" icon="lucide:settings" :label="t('media.list.settings')" />
          <Button class="media-upload-button" @click="openUploadDialog" severity="primary" icon="lucide:plus" :label="t('media.list.upload')" />
        </div>
      </template>
    </PageSectionHeader>

    <Message
      v-if="hasFailedVariants"
      severity="error"
      :closable="false"
      class="failed-variants-message"
      role="button"
      tabindex="0"
      @click="openFailedVariantsDialog"
      @keydown="handleFailedVariantsMessageKeydown"
    >
      {{ t("media.list.failed_variants_alert", { count: failedVariants.length }) }}
    </Message>

    <Card class="filter-section">
      <template #content>
        <div class="filter-grid">
          <div class="field">
            <label for="type">{{ t("media.list.filter_type") }}</label>
            <Select id="type" v-model="selectedType" :options="typeOptions" optionLabel="label" optionValue="value" :placeholder="t('media.list.type_all')" />
          </div>
        </div>
      </template>
    </Card>

    <div v-if="errorMessage" class="error-state">
      <p>{{ errorMessage }}</p>
    </div>

    <div v-else-if="loading" class="loading-state">
      <p>{{ t("media.list.loading") }}</p>
    </div>

    <div v-else-if="mediaFiles.length === 0" class="empty-state">
      <p>{{ t("media.list.empty") }}</p>
    </div>

    <div v-else class="media-results">
      <div class="media-grid">
        <Card v-for="media in mediaFiles" :key="media.id" @click="viewMedia(media.id)" class="media-card">
          <template #content>
            <!-- Image preview -->
            <div v-if="media.type === 'image'" class="media-preview">
              <img :src="media.url" :alt="media.name" class="preview-image" @error="handleImageError" />
            </div>

            <!-- File icon for non-images -->
            <div v-else class="media-preview file-preview">
              <span class="file-icon">{{ getFileIcon(media.mimeType) }}</span>
            </div>

            <div class="media-info">
              <h3 class="media-name">{{ media.name }}</h3>
              <p v-if="media.description" class="media-description">
                {{ media.description }}
              </p>

              <div class="media-meta">
                <span>{{ formatFileSize(media.size) }}</span>
                <span v-if="media.width && media.height"> {{ media.width }}×{{ media.height }} </span>
              </div>

              <div v-if="media.variantCount && media.variantCount > 0" class="variant-count">
                <Tag severity="info" :value="t('media.list.variant_count', { count: media.variantCount })" />
              </div>

              <div class="media-timestamps">
                <span class="media-timestamps__text">{{ getUpdatedByLabel(media.updatedBy) }}, {{ formatDate(media.createdAt) }}</span>
              </div>
            </div>
          </template>
        </Card>
      </div>

      <ElPagination
        v-if="totalMediaFiles > mediaPageRows"
        :current-page="Math.floor(mediaPageFirst / mediaPageRows) + 1"
        :page-size="mediaPageRows"
        :total="totalMediaFiles"
        :page-sizes="mediaPageSizeOptions"
        layout="total, sizes, prev, pager, next"
        class="media-paginator"
        @current-change="handleMediaPageChange"
        @size-change="handleMediaPageSizeChange"
      />
    </div>

    <!-- Upload Dialog -->
    <Dialog v-model:visible="uploadDialogOpen" modal :draggable="false" :header="t('media.list.upload')" :style="{ width: '36rem' }">
      <div class="upload-dialog-content">
        <div class="field">
          <ElUpload
            name="files[]"
            multiple
            drag
            :accept="acceptedMediaMimeTypes"
            :disabled="uploading"
            ref="fileUploadRef"
            :auto-upload="false"
            :on-change="onFileSelect"
            class="file-upload"
          >
            <div class="file-upload-droparea">
              <NabeIcon icon="lucide:upload" class="file-upload-droparea__icon" aria-hidden="true" />
              <p>{{ t("media.list.drop_files") }}</p>
              <span>{{ t("media.list.choose_files") }}</span>
            </div>
            <template #tip>
              <span v-if="selectedFiles.length > 0" class="file-upload-picker__status">
                {{ t("media.list.selected_file_count", { count: selectedFiles.length }) }}
              </span>
            </template>
          </ElUpload>
        </div>
        <div v-if="hasImageSelection" class="field">
          <label for="variant-templates">{{ t("media.list.variant_templates") }}</label>
          <MultiSelect
            id="variant-templates"
            v-model="variantTemplateSelection"
            :options="variantTemplateOptions"
            optionLabel="label"
            optionValue="value"
            display="chip"
            :placeholder="t('media.list.variant_templates_placeholder')"
            :disabled="!hasVariantTemplateOptions"
            class="full-width"
          />
        </div>

        <!-- Selected image previews -->
        <div v-if="previewImages.length > 0" class="preview-section">
          <h3>{{ t("media.detail.preview") }}</h3>
          <div class="preview-grid">
            <div v-for="p in previewImages" :key="p.url" class="preview-item">
              <img :src="p.url" :alt="p.name" />
              <div class="meta">
                <span class="name">{{ p.name }}</span>
                <span class="size">{{ formatFileSize(p.size) }}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="upload-info">
          <p>{{ t("media.list.supported_formats") }}</p>
          <p>{{ t("media.list.max_file_size") }}</p>
        </div>
      </div>

      <template #footer>
        <Button
          @click="startUpload"
          severity="primary"
          icon="lucide:upload"
          :label="t('media.list.start_upload')"
          :disabled="!canStartUpload"
          :loading="uploading"
        />
        <Button @click="closeUploadDialog" severity="secondary" icon="lucide:x" :label="t('media.list.cancel')" :disabled="uploading" />
      </template>
    </Dialog>

    <MediaSettingsDialog v-model:visible="mediaSettingsDialogOpen" @saved="handleMediaSettingsSaved" />
    <FailedVariantsDialog v-model:visible="failedVariantsDialogOpen" @updated="handleFailedVariantsUpdated" />
  </div>
</template>

<style lang="scss" scoped>
.media-list-page {
  padding: var(--space-24);

  .header-actions {
    display: flex;
    gap: var(--space-12);
    align-items: center;
  }

  @media (max-width: 768px) {
    .media-list-header {
      :deep(.page-section-header__main) {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
      }

      :deep(.page-section-header__lead) {
        grid-column: 1;
      }

      :deep(.page-section-header__actions) {
        display: contents;
      }
    }

    .header-actions {
      display: contents;
    }

    .media-settings-button {
      grid-column: 2;
      justify-self: end;
      white-space: nowrap;
    }

    .media-upload-button {
      grid-column: 1 / -1;
      justify-self: stretch;
      width: 100%;
      margin-top: var(--space-12);
    }
  }

  .filter-section {
    margin-bottom: var(--space-16);

    .filter-grid {
      display: grid;
      gap: var(--space-16);
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));

      .field {
        label {
          display: block;
          font-weight: 500;
          color: var(--surface-700);
          margin-bottom: var(--space-8);
        }
      }
    }
  }

  .failed-variants-message {
    margin-bottom: var(--space-16);
    cursor: pointer;
  }

  .failed-variants-message:focus-visible {
    outline: 2px solid var(--red-500);
    outline-offset: 2px;
  }

  .loading-state,
  .empty-state,
  .error-state {
    text-align: center;
    padding: var(--space-32) 0;

    p {
      color: var(--surface-500);
    }
  }

  .error-state p {
    color: var(--red-500);
  }

  .media-results {
    display: flex;
    flex-direction: column;
    gap: var(--space-24);

    .media-grid {
      display: grid;
      gap: var(--space-16);
      grid-template-columns: repeat(4, minmax(0, 1fr));

      @media (max-width: 1279px) {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      @media (max-width: 767px) {
        grid-template-columns: minmax(0, 1fr);
      }

      .media-card {
        cursor: pointer;
        transition: border-color 0.2s ease;
        display: flex;
        flex-direction: column;
        height: 100%;

        &:hover {
          border-color: var(--card-border-hover);
        }

        .media-preview {
          aspect-ratio: 16/9;
          background-color: var(--surface-100);
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: var(--space-16);
          border-radius: var(--border-radius);
          overflow: hidden;

          .preview-image {
            max-width: 100%;
            max-height: 100%;
            object-fit: contain;
          }

          &.file-preview {
            .file-icon {
              font-size: var(--font-48);
            }
          }
        }

        .media-info {
          .media-name {
            font-size: var(--font-14);
            font-weight: 500;
            color: var(--surface-900);
            margin-bottom: var(--space-4);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          .media-description {
            font-size: var(--font-12);
            color: var(--surface-600);
            margin-bottom: var(--space-8);
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
          }

          .media-meta {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: var(--font-12);
            color: var(--surface-500);
            margin-bottom: var(--space-8);
          }

          .variant-count {
            margin-bottom: var(--space-8);
          }

          .media-timestamps {
            display: flex;
            justify-content: flex-end;
            min-width: 0;
            font-size: var(--font-12);
            color: var(--surface-400);
            text-align: right;

            .media-timestamps__text {
              min-width: 0;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            }
          }
        }
      }
    }

    .media-paginator {
      align-self: center;
      width: 100%;
      border: 1px solid var(--card-border);
      border-radius: var(--radius-8);
      background: var(--surface-0);
    }
  }
}

.upload-dialog-content {
  .field {
    margin-bottom: var(--space-16);

    label {
      display: block;
      font-weight: 500;
      color: var(--surface-700);
      margin-bottom: var(--space-8);
    }
  }

  .upload-info {
    font-size: var(--font-14);
    color: var(--surface-500);

    p {
      margin-bottom: var(--space-4);
    }
  }

  .help-text {
    display: block;
    margin-top: var(--space-4);
    font-size: var(--font-12);
    color: var(--surface-500);
  }

  .full-width {
    width: 100%;
  }

  .file-upload {
    width: 100%;
    border: 0;
    background: transparent;

    :deep(.el-upload) {
      padding: 0;
      border: 0;
      background: transparent;
    }

    :deep(.el-upload-dragger) {
      margin-top: var(--space-8);
      padding: var(--space-24);
      border: 1px dashed var(--card-border);
      border-radius: var(--radius-8);
      background: var(--surface-50);
    }
  }

  .file-upload-picker {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-12);
    width: 100%;
    min-width: 0;
  }

  .file-upload-picker__button {
    flex: 0 0 auto;
  }

  .file-upload-picker__status {
    flex: 1 1 12rem;
    min-width: 0;
    color: var(--surface-500);
    font-size: var(--font-14);
    line-height: 1.4;
    overflow-wrap: anywhere;
  }

  .file-upload-droparea {
    display: flex;
    min-height: 9rem;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-8);
    text-align: center;
    color: var(--surface-600);

    p {
      margin: 0;
      color: var(--surface-800);
      font-size: var(--font-16);
      font-weight: 600;
    }
  }

  .file-upload-droparea__icon {
    width: 3rem;
    height: 3rem;
    color: var(--surface-600);
    font-size: var(--font-24);
    overflow: visible;
  }
}

.preview-section {
  margin-bottom: var(--space-16);

  h3 {
    font-size: var(--font-16);
    font-weight: 600;
    color: var(--surface-700);
    margin-bottom: var(--space-8);
  }

  .preview-grid {
    display: grid;
    gap: var(--space-12);
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  }

  .preview-item {
    background: var(--surface-100);
    border-radius: var(--border-radius);
    padding: var(--space-8);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-8);

    img {
      display: block;
      max-width: 100%;
      height: auto;
      max-height: 320px; // safety cap to avoid extremely tall previews
      object-fit: contain;
      border-radius: var(--border-radius);
      background: var(--surface-0);
    }

    .meta {
      width: 100%;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--space-4);
      font-size: var(--font-12);
      color: var(--surface-600);

      .name {
        width: 100%;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    }
  }
}
</style>
