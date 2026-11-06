<script lang="ts" setup>
import { encodeResourceId } from "@/utils/resourceId";
import { ref, onMounted, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { Form, Field, type GenericObject, type SubmissionHandler } from "vee-validate";
import { useToast } from "@/services/feedback";
import { useAuthStore } from "../../stores/auth";
import PageSectionHeader from "../../components/PageSectionHeader.vue";
import { formatJapaneseDateTime } from "@/utils/dateTime";

import Button from "@/components/NabeButton.vue";
import { Card } from "@/components/ui/element-plus";
import { ElTable } from "element-plus";
import { ElTableColumn } from "element-plus";
import { InputText } from "@/components/ui/element-plus";
import { Textarea } from "@/components/ui/element-plus";
import { Select } from "@/components/ui/element-plus";
import { Tag } from "@/components/ui/element-plus";
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
};

type RawMediaItem = Omit<MediaItem, "updatedBy"> & { updatedBy: unknown };

type MediaVariantStatus = "pending" | "processing" | "succeeded" | "failed";

type MediaVariantProvider = "frontend" | "cloudflare";

type MediaVariant = {
  id: string;
  mediaId: string;
  templateKey: string;
  url: string | null;
  width: number | null;
  height: number | null;
  size: number | null;
  mimeType: string | null;
  format: string | null;
  status: MediaVariantStatus;
  provider: MediaVariantProvider;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

type MediaResponse = {
  item: RawMediaItem;
};

type MediaVariantsResponse = {
  items: MediaVariant[];
};

type MediaForm = { name: string; description?: string; status: string };

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const toast = useToast();
const authStore = useAuthStore();

const mediaId = route.params.mediaId as string;
const resolveUrl = (path: string) => (typeof router.resolve === "function" ? router.resolve(path).href : path);

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

const normalizeMediaItem = (item: RawMediaItem): MediaItem => ({
  ...item,
  updatedBy: normalizeUserSummary(item.updatedBy),
});

const getUpdatedByLabel = (user: UserSummary | undefined) => user?.name?.trim() || user?.id || "-";

const media = ref<MediaItem | null>(null);
const initialValues = ref<MediaForm>({ name: "", description: "", status: "published" });
const loading = ref(false);
const editing = ref(false);
const errorMessage = ref<string | null>(null);
const variants = ref<MediaVariant[]>([]);
const variantsLoading = ref(false);
const variantsError = ref<string | null>(null);

/**
 * Resolve API media paths into browser-accessible absolute URLs.
 * @param url - URL or path returned by the API
 * @returns Absolute URL when the browser origin is available
 */
const resolveAccessibleUrl = (url: string) => {
  if (typeof window === "undefined" || !window.location.origin) {
    return url;
  }
  try {
    return new URL(url, window.location.origin).href;
  } catch {
    return url;
  }
};

const breadcrumbModel = computed(() => [
  { label: t("media.detail.breadcrumb_root"), to: "/media", url: resolveUrl("/media") },
  { label: media.value?.id ?? mediaId ?? t("media.detail.breadcrumb_detail") },
]);

const mediaAccessibleUrl = computed(() => (media.value ? resolveAccessibleUrl(media.value.url) : ""));

const statusOptions = computed(() => [
  { label: t("media.detail.status_published"), value: "published" },
  { label: t("media.detail.status_draft"), value: "draft" },
]);

const ensureAccessToken = async () => {
  if (!authStore.accessToken) {
    await authStore.refresh().catch(() => undefined);
  }
};

const toMediaForm = (values: GenericObject): MediaForm => {
  if (typeof values.name !== "string" || typeof values.status !== "string") {
    throw new Error("Invalid media form payload");
  }
  const description = typeof values.description === "string" ? values.description : undefined;
  return { name: values.name, description, status: values.status };
};

const fetchMedia = async () => {
  loading.value = true;
  errorMessage.value = null;
  try {
    await ensureAccessToken();
    if (!mediaId) {
      throw new Error("Missing media id");
    }

    const headers: Record<string, string> = {};
    if (authStore.accessToken) {
      headers.Authorization = `Bearer ${authStore.accessToken}`;
    }

    const url = `/api/admin/media/${encodeResourceId(mediaId)}`;
    const runRequest = () => fetch(url, { headers });

    let res = await runRequest();
    if (res.status === 401) {
      const refreshed = await authStore.refresh();
      if (refreshed && authStore.accessToken) {
        headers.Authorization = `Bearer ${authStore.accessToken}`;
        res = await runRequest();
      }
    }

    if (res.status === 404) {
      errorMessage.value = t("media.detail.error_fetch");
      toast.add({
        severity: "warn",
        summary: t("media.detail.title"),
        detail: errorMessage.value,
        life: 4000,
      });
      await router.push("/media");
      return;
    }

    if (!res.ok) {
      const bodyText = await res.text();
      throw new Error(bodyText || `Failed to fetch media: ${res.status}`);
    }

    const data = (await res.json()) as MediaResponse;
    if (!data?.item) {
      throw new Error("Invalid media response");
    }

    const normalizedItem = normalizeMediaItem(data.item);
    media.value = normalizedItem;
    initialValues.value = {
      name: normalizedItem.name,
      description: normalizedItem.description ?? "",
      status: normalizedItem.status ?? "published",
    };
  } catch (error) {
    console.error("Failed to fetch media:", error);
    media.value = null;
    if (!errorMessage.value) {
      errorMessage.value = t("media.detail.error_fetch");
    }
    toast.add({
      severity: "error",
      summary: t("media.detail.title"),
      detail: errorMessage.value,
      life: 4000,
    });
  } finally {
    loading.value = false;
  }
};

/**
 * Fetch generated variants for the current media item.
 */
const fetchVariants = async () => {
  variantsLoading.value = true;
  variantsError.value = null;
  try {
    await ensureAccessToken();
    if (!mediaId) {
      throw new Error("Missing media id");
    }

    const headers: Record<string, string> = {};
    if (authStore.accessToken) {
      headers.Authorization = `Bearer ${authStore.accessToken}`;
    }

    const url = `/api/admin/media/${encodeResourceId(mediaId)}/variants`;
    const runRequest = () => fetch(url, { headers });

    let res = await runRequest();
    if (res.status === 401) {
      const refreshed = await authStore.refresh();
      if (refreshed && authStore.accessToken) {
        headers.Authorization = `Bearer ${authStore.accessToken}`;
        res = await runRequest();
      }
    }

    if (!res.ok) {
      const bodyText = await res.text();
      throw new Error(bodyText || `Failed to fetch variants: ${res.status}`);
    }

    const data = (await res.json()) as MediaVariantsResponse;
    const items = Array.isArray(data.items) ? data.items : [];
    variants.value = [...items].sort((a, b) => a.templateKey.localeCompare(b.templateKey));
  } catch (error) {
    console.error("Failed to fetch media variants:", error);
    variants.value = [];
    variantsError.value = t("media.detail.variants_error");
  } finally {
    variantsLoading.value = false;
  }
};

const handleUpdate: SubmissionHandler = async (values) => {
  const payload = toMediaForm(values);
  loading.value = true;
  try {
    await ensureAccessToken();
    const headers = new Headers({ "Content-Type": "application/json" });
    if (authStore.accessToken) {
      headers.set("Authorization", `Bearer ${authStore.accessToken}`);
    }

    const url = `/api/admin/media/${encodeResourceId(mediaId)}`;
    const runRequest = () =>
      fetch(url, {
        method: "PUT",
        headers,
        body: JSON.stringify(payload),
      });

    let res = await runRequest();
    if (res.status === 401) {
      const refreshed = await authStore.refresh();
      if (refreshed && authStore.accessToken) {
        headers.set("Authorization", `Bearer ${authStore.accessToken}`);
        res = await runRequest();
      }
    }

    if (!res.ok) {
      const bodyText = await res.text();
      throw new Error(bodyText || `Failed to update media: ${res.status}`);
    }

    const data = (await res.json()) as MediaResponse;
    const normalizedItem = normalizeMediaItem(data.item);
    media.value = normalizedItem;
    initialValues.value = {
      name: normalizedItem.name,
      description: normalizedItem.description ?? "",
      status: normalizedItem.status ?? "published",
    };

    toast.add({
      severity: "success",
      summary: t("media.detail.title"),
      detail: t("media.detail.success_update"),
      life: 4000,
    });
    editing.value = false;
  } catch (error) {
    console.error("Failed to update media:", error);
    toast.add({
      severity: "error",
      summary: t("media.detail.title"),
      detail: t("media.detail.error_update"),
      life: 4000,
    });
  } finally {
    loading.value = false;
  }
};

const deleteMedia = async () => {
  if (!media.value) return;
  if (!confirm(t("media.detail.confirm_delete"))) {
    return;
  }

  loading.value = true;
  try {
    await ensureAccessToken();
    const headers = new Headers();
    if (authStore.accessToken) {
      headers.set("Authorization", `Bearer ${authStore.accessToken}`);
    }

    const url = `/api/admin/media/${encodeResourceId(mediaId)}`;
    const runRequest = () =>
      fetch(url, {
        method: "DELETE",
        headers,
      });

    let res = await runRequest();
    if (res.status === 401) {
      const refreshed = await authStore.refresh();
      if (refreshed && authStore.accessToken) {
        headers.set("Authorization", `Bearer ${authStore.accessToken}`);
        res = await runRequest();
      }
    }

    if (res.status !== 204) {
      const bodyText = await res.text();
      throw new Error(bodyText || `Failed to delete media: ${res.status}`);
    }

    toast.add({
      severity: "success",
      summary: t("media.detail.title"),
      detail: t("media.detail.success_delete"),
      life: 4000,
    });
    media.value = null;
    await router.push("/media");
  } catch (error) {
    console.error("Failed to delete media:", error);
    toast.add({
      severity: "error",
      summary: t("media.detail.title"),
      detail: t("media.detail.error_delete"),
      life: 4000,
    });
  } finally {
    loading.value = false;
  }
};

const copyUrl = async () => {
  if (!media.value) return;
  try {
    await navigator.clipboard.writeText(mediaAccessibleUrl.value);
    toast.add({
      severity: "success",
      summary: t("media.detail.title"),
      detail: t("media.detail.url_copied"),
      life: 4000,
    });
  } catch (error) {
    console.error("Failed to copy media URL:", error);
    toast.add({
      severity: "error",
      summary: t("media.detail.title"),
      detail: t("media.detail.error_copy_url"),
      life: 4000,
    });
  }
};

const downloadFile = () => {
  if (!media.value) return;
  window.open(mediaAccessibleUrl.value, "_blank");
};

const formatFileSize = (bytes: number) => {
  const sizes = ["Bytes", "KB", "MB", "GB"];
  if (!bytes) return "0 Bytes";
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${Math.round((bytes / Math.pow(1024, i)) * 100) / 100} ${sizes[i]}`;
};

const formatDate = (dateString: string) => {
  return formatJapaneseDateTime(dateString);
};

/**
 * Format a variant resolution label.
 * @param variant - Variant record
 * @returns Resolution label
 */
const formatVariantResolution = (variant: MediaVariant) => {
  if (variant.width && variant.height) {
    return `${variant.width} × ${variant.height}px`;
  }
  return "-";
};

/**
 * Format a variant file size label.
 * @param variant - Variant record
 * @returns Size label
 */
const formatVariantSize = (variant: MediaVariant) => {
  if (variant.size) {
    return formatFileSize(variant.size);
  }
  return "-";
};

/**
 * Format a variant format label.
 * @param variant - Variant record
 * @returns Format label
 */
const formatVariantFormat = (variant: MediaVariant) => {
  if (variant.format) return variant.format.toUpperCase();
  if (variant.mimeType) return variant.mimeType;
  return "-";
};

/**
 * Resolve label for variant status.
 * @param status - Variant status
 * @returns Status label
 */
const getVariantStatusLabel = (status: MediaVariantStatus) => t(`media.detail.variant_status_${status}`);

/**
 * Resolve severity for variant status.
 * @param status - Variant status
 * @returns Tag severity
 */
const getVariantStatusSeverity = (status: MediaVariantStatus) => {
  if (status === "succeeded") return "success";
  if (status === "failed") return "danger";
  if (status === "processing") return "info";
  return "secondary";
};

/**
 * Resolve label for variant provider.
 * @param provider - Variant provider
 * @returns Provider label
 */
const getVariantProviderLabel = (provider: MediaVariantProvider) =>
  provider === "cloudflare" ? t("media.detail.variant_provider_cloudflare") : t("media.detail.variant_provider_frontend");

/**
 * Open a variant URL in a new tab.
 * @param variant - Variant record
 */
const openVariant = (variant: MediaVariant) => {
  if (!variant.url) return;
  window.open(resolveAccessibleUrl(variant.url), "_blank");
};

const getFileIcon = (mimeType: string) => {
  if (mimeType.startsWith("image/")) return "🖼️";
  if (mimeType === "application/pdf") return "📄";
  if (mimeType.startsWith("video/")) return "🎥";
  if (mimeType.startsWith("audio/")) return "🎵";
  return "📁";
};

const cancelEdit = () => {
  editing.value = false;
  if (media.value) {
    initialValues.value = {
      name: media.value.name,
      description: media.value.description ?? "",
      status: media.value.status ?? "published",
    };
  }
};

onMounted(() => {
  fetchMedia();
  fetchVariants();
});
</script>

<template>
  <div class="media-detail-page">
    <PageSectionHeader :title="t('media.detail.title')" :breadcrumb-model="breadcrumbModel">
      <template #actions>
        <div class="actions">
          <Button
            v-if="!editing"
            @click="editing = true"
            severity="success"
            icon="lucide:pencil"
            :label="t('media.detail.edit')"
            :disabled="loading || !media"
          />
          <Button @click="deleteMedia" severity="danger" icon="lucide:trash-2" :label="t('media.detail.delete')" :disabled="loading || !media" />
        </div>
      </template>
    </PageSectionHeader>

    <div v-if="loading && !media" class="loading-state">
      <p>{{ t("media.detail.loading") }}</p>
    </div>

    <div v-else-if="errorMessage" class="error-state">
      <p>{{ errorMessage }}</p>
    </div>

    <div v-else-if="media" class="content-grid">
      <div class="preview-section">
        <Card>
          <template #header>
            <h2>{{ t("media.detail.preview") }}</h2>
          </template>
          <template #content>
            <div v-if="media.type === 'image'" class="image-preview">
              <img :src="mediaAccessibleUrl" :alt="media.name" class="preview-image" />
            </div>

            <div v-else class="file-preview">
              <span class="file-icon">{{ getFileIcon(media.mimeType) }}</span>
              <p class="file-type">{{ media.mimeType }}</p>
            </div>

            <div class="action-buttons">
              <Button @click="copyUrl" severity="secondary" icon="lucide:copy" size="small" :label="t('media.detail.copy_url')" />
              <Button @click="downloadFile" severity="primary" icon="lucide:download" size="small" :label="t('media.detail.download')" />
            </div>
          </template>
        </Card>
      </div>

      <div class="details-section">
        <Card class="file-info-card">
          <template #header>
            <h2>{{ editing ? t("media.detail.edit_file_info") : t("media.detail.file_info") }}</h2>
          </template>
          <template #content>
            <div class="file-info-content">
              <Form v-if="editing" :initial-values="initialValues" @submit="handleUpdate" class="edit-form">
                <div class="field-grid">
                  <div class="field">
                    <label for="name">{{ t("media.detail.file_name") }} *</label>
                    <Field name="name" rules="required|min:2" v-slot="{ field, errors }">
                      <InputText id="name" v-bind="field" :invalid="!!errors.length" fluid />
                      <small class="form-error" v-if="errors[0]">{{ errors[0] }}</small>
                    </Field>
                  </div>

                  <div class="field">
                    <label for="description">{{ t("media.detail.desc") }}</label>
                    <Field name="description" v-slot="{ field }">
                      <Textarea id="description" v-bind="field" :rows="3" :autoResize="true" fluid />
                    </Field>
                  </div>

                  <div class="field">
                    <label for="status">{{ t("media.detail.status") }}</label>
                    <Field name="status" v-slot="{ field }">
                      <Select
                        id="status"
                        :modelValue="field.value"
                        @update:modelValue="field.onChange"
                        :options="statusOptions"
                        optionLabel="label"
                        optionValue="value"
                      />
                    </Field>
                  </div>
                </div>

                <div class="form-actions">
                  <Button
                    type="submit"
                    :disabled="loading"
                    :loading="loading"
                    severity="primary"
                    icon="lucide:check"
                    :label="loading ? t('common.updating') : t('common.update')"
                  />
                  <Button type="button" @click="cancelEdit" severity="secondary" icon="lucide:x" :label="t('common.cancel')" />
                </div>
              </Form>

              <div v-else class="info-section">
                <div class="info-grid">
                  <div class="info-item">
                    <dt>{{ t("media.detail.file_name") }}</dt>
                    <dd>{{ media.name }}</dd>
                  </div>

                  <div v-if="media.description" class="info-item">
                    <dt>{{ t("media.detail.desc") }}</dt>
                    <dd>{{ media.description }}</dd>
                  </div>

                  <div class="info-item">
                    <dt>{{ t("media.detail.status") }}</dt>
                    <dd>
                      <Tag
                        :value="media.status === 'published' ? t('media.detail.status_published') : t('media.detail.status_draft')"
                        :severity="media.status === 'published' ? 'success' : 'secondary'"
                      />
                    </dd>
                  </div>

                  <div class="info-item">
                    <dt>{{ t("media.detail.file_size") }}</dt>
                    <dd>{{ formatFileSize(media.size) }}</dd>
                  </div>

                  <div class="info-item">
                    <dt>{{ t("media.detail.mime_type") }}</dt>
                    <dd>{{ media.mimeType }}</dd>
                  </div>

                  <div v-if="media.width && media.height" class="info-item">
                    <dt>{{ t("media.detail.resolution") }}</dt>
                    <dd>{{ media.width }} × {{ media.height }}px</dd>
                  </div>
                </div>
              </div>

              <div class="info-section">
                <h3 class="info-heading">{{ t("media.detail.metadata") }}</h3>
                <div class="info-grid">
                  <div class="info-item">
                    <dt>{{ t("media.detail.url") }}</dt>
                    <dd class="url-text">{{ mediaAccessibleUrl }}</dd>
                  </div>

                  <div class="info-item">
                    <dt>{{ t("media.detail.created_at") }}</dt>
                    <dd>{{ formatDate(media.createdAt) }}</dd>
                  </div>

                  <div class="info-item">
                    <dt>{{ t("media.detail.updated_at") }}</dt>
                    <dd>{{ formatDate(media.updatedAt) }}</dd>
                  </div>

                  <div class="info-item">
                    <dt>{{ t("media.detail.updated_by") }}</dt>
                    <dd>{{ getUpdatedByLabel(media.updatedBy) }}</dd>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </Card>
      </div>

      <div class="variants-section">
        <Card class="variants-card">
          <template #header>
            <h2>{{ t("media.detail.variants_title") }}</h2>
          </template>
          <template #content>
            <div v-if="media.type !== 'image'" class="variants-empty">
              {{ t("media.detail.variants_non_image") }}
            </div>
            <div v-else-if="variantsLoading" class="variants-loading">
              {{ t("media.detail.variants_loading") }}
            </div>
            <div v-else-if="variantsError" class="variants-error">
              {{ variantsError }}
            </div>
            <div v-else-if="variants.length === 0" class="variants-empty">
              {{ t("media.detail.variants_empty") }}
            </div>
            <ElTable v-else :data="variants" row-key="id" size="small" class="variants-table">
              <ElTableColumn :label="t('media.detail.variant_preview')">
                <template #default="slotProps">
                  <div class="variant-thumb">
                    <img
                      v-if="slotProps.row.url && (slotProps.row.mimeType?.startsWith('image/') || media.type === 'image')"
                      :src="slotProps.row.url"
                      :alt="slotProps.row.templateKey"
                    />
                    <span v-else class="variant-thumb-placeholder">
                      {{ getFileIcon(slotProps.row.mimeType || media.mimeType) }}
                    </span>
                  </div>
                </template>
              </ElTableColumn>
              <ElTableColumn prop="templateKey" :label="t('media.detail.variant_template')" />
              <!-- @vue-generic {MediaVariant} -->
              <ElTableColumn :label="t('media.detail.variant_format')">
                <template #default="slotProps">
                  {{ formatVariantFormat(slotProps.row) }}
                </template>
              </ElTableColumn>
              <!-- @vue-generic {MediaVariant} -->
              <ElTableColumn :label="t('media.detail.variant_resolution')">
                <template #default="slotProps">
                  {{ formatVariantResolution(slotProps.row) }}
                </template>
              </ElTableColumn>
              <!-- @vue-generic {MediaVariant} -->
              <ElTableColumn :label="t('media.detail.variant_size')">
                <template #default="slotProps">
                  {{ formatVariantSize(slotProps.row) }}
                </template>
              </ElTableColumn>
              <ElTableColumn :label="t('media.detail.variant_status')">
                <template #default="slotProps">
                  <Tag :value="getVariantStatusLabel(slotProps.row.status)" :severity="getVariantStatusSeverity(slotProps.row.status)" />
                </template>
              </ElTableColumn>
              <ElTableColumn :label="t('media.detail.variant_provider')">
                <template #default="slotProps">
                  {{ getVariantProviderLabel(slotProps.row.provider) }}
                </template>
              </ElTableColumn>
              <ElTableColumn :label="t('media.detail.variant_updated_at')">
                <template #default="slotProps">
                  {{ formatDate(slotProps.row.updatedAt) }}
                </template>
              </ElTableColumn>
              <!-- @vue-generic {MediaVariant} -->
              <ElTableColumn :label="t('media.detail.variant_actions')">
                <template #default="slotProps">
                  <Button
                    size="small"
                    text
                    icon="lucide:external-link"
                    :label="t('media.detail.variant_open')"
                    :disabled="!slotProps.row.url"
                    @click="openVariant(slotProps.row)"
                  />
                </template>
              </ElTableColumn>
            </ElTable>
          </template>
        </Card>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.media-detail-page {
  padding: var(--space-24);

  :deep(.el-card .el-card__header) {
    padding: var(--space-20) var(--space-20) 0;
  }

  .actions {
    display: flex;
    gap: var(--space-8);
  }

  @media (max-width: 768px) {
    .actions {
      width: 100%;
      justify-content: flex-end;
    }
  }

  .loading-state,
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

  .content-grid {
    display: grid;
    gap: var(--space-32);
    grid-template-columns: 1fr;

    @media (min-width: 1024px) {
      grid-template-columns: 1fr 1fr;
    }

    .preview-section {
      h2 {
        font-size: var(--font-18);
        font-weight: 500;
        color: var(--surface-900);
        margin: 0;
      }

      .image-preview {
        display: flex;
        justify-content: center;
        align-items: center;
        background: var(--surface-100);
        border-radius: var(--border-radius);
        padding: var(--space-16);

        .preview-image {
          max-width: 100%;
          max-height: 400px;
          object-fit: contain;
        }
      }

      .file-preview {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--space-8);
        background: var(--surface-100);
        border-radius: var(--border-radius);
        padding: var(--space-24);

        .file-icon {
          font-size: var(--font-48);
        }

        .file-type {
          font-size: var(--font-12);
          color: var(--surface-600);
        }
      }

      .action-buttons {
        display: flex;
        gap: var(--space-8);
        margin-top: var(--space-16);
      }
    }

    .details-section {
      display: flex;
      flex-direction: column;
      gap: var(--space-24);
    }

    .variants-section {
      grid-column: 1 / -1;
    }

    .details-section,
    .variants-section {
      h2 {
        font-size: var(--font-18);
        font-weight: 500;
        color: var(--surface-900);
        margin: 0;
      }
    }

    .file-info-content {
      display: flex;
      flex-direction: column;
      gap: var(--space-24);
    }

    .info-section {
      display: flex;
      flex-direction: column;
      gap: var(--space-12);
    }

    .info-heading {
      font-size: var(--font-14);
      font-weight: 600;
      color: var(--surface-700);
      margin: 0;
    }

    .info-grid {
      display: grid;
      gap: var(--space-16);
    }

    .info-item {
      dt {
        font-size: var(--font-12);
        color: var(--surface-500);
        margin-bottom: var(--space-4);
      }

      dd {
        margin: 0;
        font-size: var(--font-14);
        color: var(--surface-900);
      }
    }

    .url-text {
      word-break: break-all;
    }

    .edit-form {
      display: flex;
      flex-direction: column;
      gap: var(--space-24);

      .field-grid {
        display: grid;
        gap: var(--space-16);
      }

      .field {
        label {
          display: block;
          font-weight: 500;
          color: var(--surface-700);
          margin-bottom: var(--space-8);
        }
      }

      .form-actions {
        display: flex;
        gap: var(--space-12);
      }
    }

    .variants-card {
      .variants-loading,
      .variants-empty {
        color: var(--surface-500);
      }

      .variants-error {
        color: var(--red-500);
      }

      .variants-table {
        :deep(.el-table__inner-wrapper) {
          overflow-x: auto;
        }

        :deep(.el-table__body) {
          min-width: 900px;
        }
      }

      .variant-thumb {
        width: 56px;
        height: 56px;
        border-radius: var(--border-radius);
        background: var(--surface-100);
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
      }

      .variant-thumb img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .variant-thumb-placeholder {
        font-size: var(--font-20);
        color: var(--surface-500);
      }
    }
  }
}
</style>
