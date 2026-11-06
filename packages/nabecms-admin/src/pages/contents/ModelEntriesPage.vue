<script lang="ts" setup>
import { encodeResourceId } from "@/utils/resourceId";
import { ref, onMounted, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { useToast } from "@/services/feedback";
import { useConfirm } from "@/services/feedback";
import { useAuthStore } from "@/stores/auth";
import { authorizedFetch } from "@/utils/http";
import PageSectionHeader from "@/components/PageSectionHeader.vue";
import { formatAdminDateFieldValue, formatJapaneseDateTime } from "@/utils/dateTime";
import {
  DEFAULT_CONTENT_LOCALE,
  findEntryFieldValue,
  resolveDefaultLocaleCode,
  sortModelFieldsByPosition,
  toEntryFieldValue,
  toLocaleItem,
  toModelField,
  type EntryFieldValue,
  type LocaleItem,
  type ModelField,
} from "@/modules/entries";
import Button from "@/components/NabeButton.vue";
import { Card } from "@/components/ui/element-plus";
import { ElPagination, ElTable, ElTableColumn } from "element-plus";
import { Select } from "@/components/ui/element-plus";
import { MultiSelect } from "@/components/ui/element-plus";
import { Dialog } from "@/components/ui/element-plus";
import { InputText } from "@/components/ui/element-plus";
import { Tag } from "@/components/ui/element-plus";
const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const toast = useToast();
const confirm = useConfirm();
const authStore = useAuthStore();

const modelId = route.params.modelId as string;
const resolveUrl = (path: string) => (typeof router.resolve === "function" ? router.resolve(path).href : path);

type ModelDetail = {
  id: string;
  name: string;
  description: string | null;
  fieldsCount: number;
  entriesCount: number;
  titleFieldId: string | null;
  titleFieldName: string | null;
  fields: ModelField[];
};

type EntryRow = {
  id: string;
  displayTitle: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  updatedByName: string | null;
  fields: EntryFieldValue[];
};

type SystemColumnKey = "status" | "createdAt" | "updatedAt" | "updatedBy";
type FieldColumnKey = `field:${string}`;
type VisibleColumnKey = SystemColumnKey | FieldColumnKey;

type ColumnOption = {
  label: string;
  value: VisibleColumnKey;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const dateFormatValues = new Set(["date", "datetime", "datetime_with_timezone"]);

/** Resolve the configured date format for a model field. */
const resolveDateFormat = (field: Pick<ModelField, "options" | "type" | "variant">): "date" | "datetime" | "datetime_with_timezone" => {
  const options = isRecord(field.options) ? field.options : {};
  const format = options.format;
  if (typeof format === "string" && dateFormatValues.has(format)) {
    return format as "date" | "datetime" | "datetime_with_timezone";
  }
  return field.variant === "datetime" ? "datetime" : "date";
};

/** Resolve the model field label used as the primary entries column header. */
const resolveTitleFieldName = (input: unknown, fields: readonly ModelField[]): string | null => {
  const record = isRecord(input) ? input : {};
  const titleFieldIdRaw = record.titleFieldId;
  const titleFieldId = typeof titleFieldIdRaw === "string" && titleFieldIdRaw.trim().length > 0 ? titleFieldIdRaw : null;
  const titleField = (titleFieldId ? fields.find((field) => field.id === titleFieldId) : null) ?? fields.find((field) => field.isDisplayTitle) ?? null;
  return typeof titleField?.name === "string" && titleField.name.trim().length > 0 ? titleField.name.trim() : null;
};

/** Normalize the model detail payload used by the entries list page. */
const toModelDetail = (input: unknown, fields: readonly ModelField[], entriesCount: number): ModelDetail => {
  const record = isRecord(input) ? input : {};
  const idRaw = record.id;
  const nameRaw = record.name;
  const descriptionRaw = record.description;
  const fieldsCountRaw = record.fieldsCount;
  const entriesCountRaw = record.entriesCount;
  const titleFieldIdRaw = record.titleFieldId;

  return {
    id: typeof idRaw === "string" ? idRaw : String(idRaw ?? ""),
    name: typeof nameRaw === "string" ? nameRaw : String(nameRaw ?? ""),
    description: typeof descriptionRaw === "string" ? descriptionRaw : descriptionRaw == null ? null : String(descriptionRaw),
    fieldsCount: typeof fieldsCountRaw === "number" && Number.isFinite(fieldsCountRaw) ? fieldsCountRaw : fields.length,
    entriesCount: typeof entriesCountRaw === "number" && Number.isFinite(entriesCountRaw) ? entriesCountRaw : entriesCount,
    titleFieldId: typeof titleFieldIdRaw === "string" && titleFieldIdRaw.trim().length > 0 ? titleFieldIdRaw : null,
    titleFieldName: resolveTitleFieldName(record, fields),
    fields: [...fields],
  };
};

const toEntryRow = (input: unknown): EntryRow => {
  const record = isRecord(input) ? input : {};
  const idRaw = record.id;
  const displayTitleRaw = record.displayTitle;
  const statusRaw = record.status;
  const createdAtRaw = record.createdAt;
  const updatedAtRaw = record.updatedAt;
  const updatedByRaw = record.updatedBy;
  const updatedByNameRaw = record.updatedByName;
  const fieldsRaw = Array.isArray(record.fields) ? record.fields : [];

  const id = typeof idRaw === "string" ? idRaw : String(idRaw ?? "");
  const normalizedDisplayTitle = typeof displayTitleRaw === "string" && displayTitleRaw.trim().length > 0 ? displayTitleRaw.trim() : null;
  const normalizedUpdatedByName = typeof updatedByNameRaw === "string" && updatedByNameRaw.trim().length > 0 ? updatedByNameRaw.trim() : null;
  const normalizedUpdatedBy = typeof updatedByRaw === "string" ? updatedByRaw : String(updatedByRaw ?? "");

  return {
    id,
    displayTitle: normalizedDisplayTitle ?? id,
    status: typeof statusRaw === "string" ? statusRaw : String(statusRaw ?? ""),
    createdAt: typeof createdAtRaw === "string" ? createdAtRaw : String(createdAtRaw ?? ""),
    updatedAt: typeof updatedAtRaw === "string" ? updatedAtRaw : String(updatedAtRaw ?? ""),
    updatedBy: normalizedUpdatedByName ?? normalizedUpdatedBy,
    updatedByName: normalizedUpdatedByName,
    fields: fieldsRaw.map((field) => toEntryFieldValue(field, { defaultLocale: DEFAULT_CONTENT_LOCALE })),
  };
};

const model = ref<ModelDetail | null>(null);
const locales = ref<LocaleItem[]>([]);
const entries = ref<EntryRow[]>([]);
const loading = ref(true);
const bulkLoading = ref(false);
const errorMessage = ref<string | null>(null);
const selectedEntries = ref<EntryRow[]>([]);
const entriesPage = ref(1);
const entriesPageSize = ref(20);
const bulkResultDialogVisible = ref(false);
const bulkResultAction = ref<BulkAction | null>(null);
const bulkResultItems = ref<Array<{ id: string; status: number; error?: string }>>([]);
const searchDialogVisible = ref(false);
const searchQuery = ref("");
const searchDraft = ref("");
const selectedColumnKeys = ref<VisibleColumnKey[]>([]);
const columnSelectionInitialized = ref(false);

const statusOptions = computed(() => [
  { value: "", label: t("contents.entries.status_all") },
  { value: "draft", label: t("contents.entries.status_draft") },
  { value: "published", label: t("contents.entries.status_published") },
  { value: "archived", label: t("contents.entries.status_archived") },
]);

const selectedStatus = ref("");

const filteredEntries = computed(() => {
  if (!selectedStatus.value) return entries.value;
  return entries.value.filter((entry) => entry.status === selectedStatus.value);
});
const paginatedEntries = computed(() => {
  const start = (entriesPage.value - 1) * entriesPageSize.value;
  return filteredEntries.value.slice(start, start + entriesPageSize.value);
});

const defaultLocaleCode = computed(() => resolveDefaultLocaleCode(locales.value, DEFAULT_CONTENT_LOCALE));
const hasSelectedEntries = computed(() => selectedEntries.value.length > 0);
const hasSearchQuery = computed(() => searchQuery.value.trim().length > 0);
const fieldColumnOptions = computed<ColumnOption[]>(() => (model.value?.fields ?? []).map((field) => ({ label: field.name, value: `field:${field.id}` })));
const systemColumnOptions = computed<ColumnOption[]>(() => [
  { label: t("contents.entries.table_status"), value: "status" },
  { label: t("contents.entries.table_created"), value: "createdAt" },
  { label: t("contents.entries.table_updated"), value: "updatedAt" },
  { label: t("contents.entries.table_updated_by"), value: "updatedBy" },
]);
const visibleColumnOptions = computed<ColumnOption[]>(() => [...fieldColumnOptions.value, ...systemColumnOptions.value]);
const visibleFieldColumns = computed(() => {
  const selected = new Set(selectedColumnKeys.value);
  return (model.value?.fields ?? []).filter((field) => selected.has(`field:${field.id}`));
});
const columnsSelectedLabel = computed(() => t("contents.entries.columns_selected", { count: selectedColumnKeys.value.length }));

/** Build the entries request URL with the active server-side search query. */
const buildEntriesRequestPath = () => {
  const params = new URLSearchParams();
  params.set("mode", "draft");
  params.set("locale", defaultLocaleCode.value);
  const query = searchQuery.value.trim();
  if (query.length > 0) {
    params.set("q", query);
  }
  return `/api/admin/models/${encodeResourceId(modelId)}/entries/sheet?${params.toString()}`;
};

/** Resolve default visible columns for the entries table. */
const resolveDefaultColumnKeys = (fields: readonly ModelField[]): VisibleColumnKey[] => {
  const titleField = fields.find((field) => field.isDisplayTitle) ?? fields[0] ?? null;
  const fieldKeys: FieldColumnKey[] = titleField ? [`field:${titleField.id}`] : [];
  return [...fieldKeys, "status", "createdAt", "updatedAt", "updatedBy"];
};

/** Keep selected columns aligned with the current model fields. */
const syncVisibleColumns = (fields: readonly ModelField[]) => {
  const validKeys = new Set<VisibleColumnKey>([...fields.map((field): FieldColumnKey => `field:${field.id}`), "status", "createdAt", "updatedAt", "updatedBy"]);

  if (!columnSelectionInitialized.value) {
    selectedColumnKeys.value = resolveDefaultColumnKeys(fields).filter((key) => validKeys.has(key));
    columnSelectionInitialized.value = true;
    return;
  }

  selectedColumnKeys.value = selectedColumnKeys.value.filter((key) => validKeys.has(key));
};

/** Resolve whether a system column is currently visible. */
const isSystemColumnVisible = (key: SystemColumnKey) => selectedColumnKeys.value.includes(key);

/** Resolve whether a model field column is the configured display title. */
const isTitleField = (field: ModelField) => field.id === model.value?.titleFieldId || field.isDisplayTitle;

/** Format entry field values for table display. */
const formatFieldValue = (field: Pick<ModelField, "options" | "type" | "variant">, value: unknown): string => {
  if (value == null) return "-";
  if (Array.isArray(value)) {
    return value.length > 0 ? value.map((item) => (typeof item === "string" ? item : JSON.stringify(item))).join(", ") : "-";
  }
  if (isRecord(value)) {
    return JSON.stringify(value);
  }

  switch (field.type) {
    case "boolean":
      return value ? t("common.yes") : t("common.no");
    case "date":
      return formatAdminDateFieldValue(value, resolveDateFormat(field));
    case "number":
      return typeof value === "number" ? value.toString() : String(value);
    default:
      return typeof value === "string" ? value : String(value);
  }
};

/** Resolve the display value for a selected model field column. */
const resolveFieldColumnValue = (entry: EntryRow, field: ModelField): string => {
  if (isTitleField(field)) {
    return entry.displayTitle;
  }

  const resolved = findEntryFieldValue(field, entry.fields, {
    locale: defaultLocaleCode.value,
    defaultLocale: defaultLocaleCode.value,
    fallbackToDefaultLocale: true,
  });
  return formatFieldValue(field, resolved?.value);
};

const fetchModelAndEntries = async () => {
  loading.value = true;
  errorMessage.value = null;
  try {
    if (!authStore.accessToken) {
      await authStore.refresh().catch(() => undefined);
    }

    const entriesRes = await authorizedFetch(authStore, buildEntriesRequestPath());
    if (!entriesRes.ok) {
      const body = await entriesRes.text();
      throw new Error(body || `Request failed with status ${entriesRes.status}`);
    }
    const entriesData = await entriesRes.json();
    if (!isRecord(entriesData) || !isRecord(entriesData.model) || !Array.isArray(entriesData.items)) {
      throw new Error("Invalid model payload");
    }
    const modelRaw = entriesData.model;
    const fieldsRaw = Array.isArray(modelRaw.fields) ? modelRaw.fields : [];
    const fields = sortModelFieldsByPosition(fieldsRaw.map((field) => toModelField(field)));
    const localesRaw = Array.isArray(entriesData.locales) ? entriesData.locales : [];
    const parsedLocales = localesRaw.map((item) => toLocaleItem(item)).filter((item): item is LocaleItem => item !== null);
    const items: unknown[] = entriesData.items;

    locales.value = parsedLocales;
    model.value = toModelDetail(modelRaw, fields, items.length);
    syncVisibleColumns(fields);
    entries.value = items.map((item) => toEntryRow(item));
  } catch (error) {
    console.error("Failed to fetch model entries:", error);
    errorMessage.value = t("contents.entries.error");
    entries.value = [];
  } finally {
    loading.value = false;
  }
};

const isCreateDisabled = computed(() => (model.value?.fieldsCount ?? 0) === 0);

const createEntry = () => {
  if (isCreateDisabled.value) return;
  router.push(`/contents/${encodeResourceId(modelId)}/create`);
};

/** Open the entries search dialog with the currently applied query. */
const openSearchDialog = () => {
  searchDraft.value = searchQuery.value;
  searchDialogVisible.value = true;
};

/** Apply the dialog query to the entries list. */
const applySearch = async () => {
  const nextQuery = searchDraft.value.trim();
  if (nextQuery === searchQuery.value) {
    searchDialogVisible.value = false;
    return;
  }

  searchQuery.value = nextQuery;
  searchDialogVisible.value = false;
  selectedEntries.value = [];
  await fetchModelAndEntries();
};

/** Clear the active entries search query. */
const clearSearch = async () => {
  searchDraft.value = "";
  if (!hasSearchQuery.value) {
    return;
  }

  searchQuery.value = "";
  searchDialogVisible.value = false;
  selectedEntries.value = [];
  await fetchModelAndEntries();
};

/** Navigate to the entry sheet view for the model. */
const openEntrySheet = () => {
  router.push(`/contents/${encodeResourceId(modelId)}/sheet`);
};

const editEntry = (entryId: string) => {
  router.push(`/contents/${encodeResourceId(modelId)}/${encodeResourceId(entryId)}`);
};

type BulkAction = "publish" | "unpublish" | "delete";

type BulkUniqueConflict = {
  entryId: string;
  fieldId: string;
  locale: string;
  conflictingEntryId: string | null;
  scope: string;
};

type BulkErrorPayload = {
  error?: {
    code?: string;
    message?: string;
    conflicts?: unknown;
  };
};

/** Parse the structured bulk error response when the API returns one. */
const readBulkErrorPayload = async (response: Response): Promise<BulkErrorPayload | null> => {
  try {
    const payload = (await response.clone().json()) as unknown;
    return isRecord(payload) ? (payload as BulkErrorPayload) : null;
  } catch {
    return null;
  }
};

/** Normalize bulk unique conflict details from the API payload. */
const toBulkUniqueConflicts = (value: unknown): BulkUniqueConflict[] =>
  Array.isArray(value)
    ? value
        .filter(isRecord)
        .map((item) => ({
          entryId: typeof item.entryId === "string" ? item.entryId : "",
          fieldId: typeof item.fieldId === "string" ? item.fieldId : "",
          locale: typeof item.locale === "string" ? item.locale : "",
          conflictingEntryId: typeof item.conflictingEntryId === "string" ? item.conflictingEntryId : null,
          scope: typeof item.scope === "string" ? item.scope : "published",
        }))
        .filter((item) => item.entryId.length > 0 && item.fieldId.length > 0)
    : [];

const runBulkAction = async (action: BulkAction) => {
  if (selectedEntries.value.length === 0) {
    toast.add({
      severity: "warn",
      summary: t("contents.entries.bulk.none_selected_title"),
      detail: t("contents.entries.bulk.none_selected_message"),
      life: 2200,
    });
    return;
  }

  bulkLoading.value = true;
  try {
    const res = await authorizedFetch(authStore, `/api/admin/models/${encodeResourceId(modelId)}/entries/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        entryIds: selectedEntries.value.map((e) => e.id),
      }),
    });

    if (!res.ok) {
      const errorPayload = await readBulkErrorPayload(res);
      if (action === "publish" && res.status === 409 && errorPayload?.error?.code === "ENTRY_BULK_UNIQUE_CONFLICT") {
        const conflicts = toBulkUniqueConflicts(errorPayload.error.conflicts);
        bulkResultDialogVisible.value = false;
        bulkResultAction.value = null;
        bulkResultItems.value = [];
        toast.add({
          severity: "error",
          summary: t("contents.entries.bulk.unique_conflict_title"),
          detail: t("contents.entries.bulk.unique_conflict_message", {
            count: conflicts.length || selectedEntries.value.length,
          }),
          life: 5200,
        });
        return;
      }
      throw new Error(`bulk failed ${res.status}`);
    }

    const data = (await res.json()) as {
      results?: { id: string; status: number; error?: string }[];
    };
    const results = Array.isArray(data.results) ? data.results : [];
    const failed = results.filter((r) => r.status !== 200);

    bulkResultAction.value = action;
    bulkResultItems.value = results;
    bulkResultDialogVisible.value = true;

    if (failed.length === 0) {
      toast.add({
        severity: "success",
        summary: t("contents.entries.bulk.success_title"),
        detail: t("contents.entries.bulk.success_message", {
          count: results.length || selectedEntries.value.length,
        }),
        life: 2400,
      });
    } else if (failed.length === results.length) {
      toast.add({
        severity: "error",
        summary: t("contents.entries.bulk.error_title"),
        detail: t("contents.entries.bulk.error_message"),
        life: 3200,
      });
    } else {
      toast.add({
        severity: "warn",
        summary: t("contents.entries.bulk.partial_title"),
        detail: t("contents.entries.bulk.partial_message", {
          success: results.length - failed.length,
          failed: failed.length,
        }),
        life: 3200,
      });
    }

    await fetchModelAndEntries();
    selectedEntries.value = [];
  } catch (error) {
    console.error("Failed to run bulk action", error);
    toast.add({
      severity: "error",
      summary: t("contents.entries.bulk.error_title"),
      detail: t("contents.entries.bulk.error_message"),
      life: 3400,
    });
  } finally {
    bulkLoading.value = false;
  }
};

const confirmBulkAction = (action: BulkAction) => {
  if (selectedEntries.value.length === 0) {
    toast.add({
      severity: "warn",
      summary: t("contents.entries.bulk.none_selected_title"),
      detail: t("contents.entries.bulk.none_selected_message"),
      life: 2200,
    });
    return;
  }

  const count = selectedEntries.value.length;
  const configByAction: Record<BulkAction, { header: string; message: string; icon: string }> = {
    publish: {
      header: t("contents.entries.bulk.confirm_publish_title"),
      message: t("contents.entries.bulk.confirm_publish_message", { count }),
      icon: "lucide:send",
    },
    unpublish: {
      header: t("contents.entries.bulk.confirm_unpublish_title"),
      message: t("contents.entries.bulk.confirm_unpublish_message", { count }),
      icon: "lucide:eye-off",
    },
    delete: {
      header: t("contents.entries.bulk.confirm_delete_title"),
      message: t("contents.entries.bulk.confirm_delete", { count }),
      icon: "lucide:trash-2",
    },
  };

  const config = configByAction[action];

  confirm.require({
    header: config.header,
    message: config.message,
    icon: config.icon,
    acceptLabel: t("common.yes"),
    rejectLabel: t("common.no"),
    accept: () => runBulkAction(action),
  });
};

const actionLabel = (action: BulkAction | null) => {
  if (!action) return "";
  switch (action) {
    case "publish":
      return t("contents.entries.bulk.publish");
    case "unpublish":
      return t("contents.entries.bulk.unpublish");
    case "delete":
      return t("contents.entries.bulk.delete");
    default:
      return "";
  }
};

const breadcrumbItems = computed(() => [
  { label: t("contents.create.breadcrumb_root"), to: "/contents", url: resolveUrl("/contents") },
  {
    label: model.value?.name ?? t("contents.entries.title_suffix"),
    to: `/contents/${encodeResourceId(modelId)}`,
    url: resolveUrl(`/contents/${encodeResourceId(modelId)}`),
  },
]);

const headingTitle = computed(() => {
  const suffix = t("contents.entries.title_suffix");
  return model.value?.name ?? suffix;
});

const headingDescription = computed(() => model.value?.description ?? "");

const getStatusSeverity = (status: string) => {
  switch (status) {
    case "published":
      return "success";
    case "draft":
      return "warning";
    case "archived":
      return "secondary";
    default:
      return "secondary";
  }
};

const getStatusLabel = (status: string) => {
  switch (status) {
    case "published":
      return t("dashboard.status_published");
    case "draft":
      return t("dashboard.status_draft");
    case "archived":
      return t("dashboard.status_archived");
    default:
      return status;
  }
};

const formatDate = (value: string | null | undefined) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return formatJapaneseDateTime(date);
};

onMounted(() => {
  fetchModelAndEntries();
});
</script>

<template>
  <div class="model-entries-page">
    <Dialog
      v-model:visible="bulkResultDialogVisible"
      modal
      :header="t('contents.entries.bulk.result_title')"
      :style="{ width: '520px' }"
      class="bulk-result-dialog"
    >
      <p class="bulk-result-summary">
        {{ t("contents.entries.bulk.result_summary", { count: bulkResultItems.length, action: actionLabel(bulkResultAction) }) }}
      </p>
      <div class="bulk-result-list" v-if="bulkResultItems.length > 0">
        <details v-for="item in bulkResultItems" :key="item.id" class="result-panel">
          <summary class="result-panel-toggler">
            <div class="result-row">
              <span class="result-id">{{ item.id }}</span>
              <Tag
                :value="item.status === 200 ? t('contents.entries.bulk.result_success') : t('contents.entries.bulk.result_failed')"
                :severity="item.status === 200 ? 'success' : 'danger'"
              />
            </div>
          </summary>
          <div v-if="item.error" class="result-error">{{ item.error }}</div>
          <div v-else class="result-success-placeholder">{{ t("contents.entries.bulk.result_success_detail") }}</div>
        </details>
      </div>
    </Dialog>

    <Dialog
      v-model:visible="searchDialogVisible"
      modal
      :header="t('contents.entries.search_dialog_title')"
      :style="{ width: '34rem', maxWidth: 'calc(100vw - var(--space-32))' }"
      class="search-dialog"
    >
      <form class="search-dialog__form" @submit.prevent="applySearch">
        <div class="search-dialog__field field">
          <label for="entry-search-query">{{ t("contents.entries.search_query_label") }}</label>
          <InputText
            id="entry-search-query"
            v-model="searchDraft"
            name="q"
            class="search-dialog__input"
            :placeholder="t('contents.entries.search_query_placeholder')"
            autocomplete="off"
          />
        </div>
        <div class="search-dialog__actions">
          <Button
            type="button"
            severity="secondary"
            variant="text"
            icon="lucide:x"
            :label="t('contents.entries.search_clear')"
            class="search-dialog__clear"
            :disabled="!hasSearchQuery && searchDraft.trim().length === 0"
            @click="clearSearch"
          />
          <Button type="button" severity="secondary" icon="lucide:x" :label="t('common.cancel')" @click="searchDialogVisible = false" />
          <Button type="submit" severity="primary" icon="lucide:search" :label="t('contents.entries.search_button')" class="search-dialog__apply" />
        </div>
      </form>
    </Dialog>
    <PageSectionHeader :title="headingTitle" :description="headingDescription" :breadcrumb-model="breadcrumbItems">
      <template #actions>
        <div class="title-actions">
          <Button
            @click="openSearchDialog"
            :severity="hasSearchQuery ? 'primary' : 'secondary'"
            icon="lucide:search"
            :label="t('contents.entries.search_button')"
            class="search-action-button"
          />
          <Button @click="openEntrySheet" severity="secondary" icon="lucide:table-2" :label="t('contents.sheet.button')" />
          <Button @click="createEntry" severity="primary" icon="lucide:plus" :label="t('contents.entries.new')" :disabled="isCreateDisabled" />
        </div>
      </template>
      <template #bottom>
        <div v-if="entries.length > 0" class="bulk-actions" :class="{ 'bulk-actions--hidden': !hasSelectedEntries }" :aria-hidden="!hasSelectedEntries">
          <Button
            severity="success"
            icon="lucide:send"
            :label="t('contents.entries.bulk.publish')"
            size="small"
            :disabled="bulkLoading || selectedEntries.length === 0"
            @click="confirmBulkAction('publish')"
          />
          <Button
            severity="secondary"
            icon="lucide:eye-off"
            :label="t('contents.entries.bulk.unpublish')"
            size="small"
            :disabled="bulkLoading || selectedEntries.length === 0"
            @click="confirmBulkAction('unpublish')"
          />
          <Button
            severity="danger"
            icon="lucide:trash-2"
            :label="t('contents.entries.bulk.delete')"
            size="small"
            :disabled="bulkLoading || selectedEntries.length === 0"
            @click="confirmBulkAction('delete')"
          />
          <span class="selection-hint">
            {{ t("contents.entries.bulk.selected", { count: selectedEntries.length }) }}
          </span>
        </div>
      </template>
    </PageSectionHeader>

    <Card class="filter-section">
      <template #content>
        <div class="filter-grid">
          <div class="field">
            <label for="status">{{ t("contents.entries.filter_status") }}</label>
            <Select
              id="status"
              v-model="selectedStatus"
              :options="statusOptions"
              optionLabel="label"
              optionValue="value"
              :placeholder="t('contents.entries.filter_status_placeholder')"
            />
          </div>
          <div class="field field--columns">
            <label for="entry-visible-columns">{{ t("contents.entries.columns_label") }}</label>
            <MultiSelect
              id="entry-visible-columns"
              v-model="selectedColumnKeys"
              :options="visibleColumnOptions"
              optionLabel="label"
              optionValue="value"
              display="chip"
              :maxSelectedLabels="2"
              :selectedItemsLabel="columnsSelectedLabel"
              :placeholder="t('contents.entries.columns_placeholder')"
              overlayClass="entries-columns-multiselect-overlay"
              class="columns-multiselect"
            />
          </div>
        </div>
      </template>
    </Card>

    <div v-if="loading" class="loading-state">
      <p>{{ t("contents.entries.loading") }}</p>
    </div>

    <div v-else-if="errorMessage" class="empty-state">
      <p>{{ errorMessage }}</p>
    </div>

    <div v-else-if="filteredEntries.length === 0" class="empty-state">
      <p>{{ t("contents.entries.empty") }}</p>
    </div>

    <Card v-else class="entries-table">
      <template #content>
        <ElTable :data="paginatedEntries" row-key="id" :stripe="true" @selection-change="selectedEntries = $event">
          <ElTableColumn type="selection" :width="48" reserve-selection />
          <!-- @vue-generic {EntryRow} -->
          <ElTableColumn
            v-for="field in visibleFieldColumns"
            :key="field.id"
            :prop="`field:${field.id}`"
            :label="field.name"
            :sortable="isTitleField(field)"
            :sort-by="isTitleField(field) ? 'displayTitle' : undefined"
            :min-width="isTitleField(field) ? 240 : 200"
          >
            <template #default="{ row: data }">
              <Button
                v-if="isTitleField(field)"
                @click="editEntry(data.id)"
                :label="resolveFieldColumnValue(data, field)"
                :title="resolveFieldColumnValue(data, field)"
                variant="link"
                class="entry-title-link"
              />
              <span v-else class="entry-cell-text" :title="resolveFieldColumnValue(data, field)">{{ resolveFieldColumnValue(data, field) }}</span>
            </template>
          </ElTableColumn>

          <!-- @vue-generic {EntryRow} -->
          <ElTableColumn v-if="isSystemColumnVisible('status')" prop="status" :label="t('contents.entries.table_status')" :sortable="true" :width="172">
            <template #default="{ row: data }">
              <div class="entry-status-cell">
                <Tag class="entry-status-tag" :value="getStatusLabel(data.status)" :severity="getStatusSeverity(data.status)" />
              </div>
            </template>
          </ElTableColumn>

          <ElTableColumn v-if="isSystemColumnVisible('createdAt')" prop="createdAt" :label="t('contents.entries.table_created')" :sortable="true" :width="180">
            <template #default="{ row: data }">
              {{ formatDate(data.createdAt) }}
            </template>
          </ElTableColumn>

          <ElTableColumn v-if="isSystemColumnVisible('updatedAt')" prop="updatedAt" :label="t('contents.entries.table_updated')" :sortable="true" :width="180">
            <template #default="{ row: data }">
              {{ formatDate(data.updatedAt) }}
            </template>
          </ElTableColumn>

          <ElTableColumn
            v-if="isSystemColumnVisible('updatedBy')"
            prop="updatedBy"
            :label="t('contents.entries.table_updated_by')"
            :sortable="true"
            :width="160"
          >
            <template #default="{ row: data }">
              {{ data.updatedByName ?? data.updatedBy ?? "-" }}
            </template>
          </ElTableColumn>

          <ElTableColumn :label="t('contents.entries.table_actions')" :width="100">
            <template #default="{ row: data }">
              <Button @click="editEntry(data.id)" severity="secondary" variant="text" size="small" icon="lucide:pencil" />
            </template>
          </ElTableColumn>
        </ElTable>
        <ElPagination
          v-model:current-page="entriesPage"
          v-model:page-size="entriesPageSize"
          :page-sizes="[10, 20, 50, 100]"
          :total="filteredEntries.length"
          layout="total, sizes, prev, pager, next"
          class="entries-pagination"
        />
      </template>
    </Card>
  </div>
</template>

<style lang="scss" scoped>
.model-entries-page {
  padding: var(--space-24);

  .title-actions {
    display: flex;
    gap: var(--space-8);
    flex-wrap: wrap;
  }

  .bulk-actions {
    display: flex;
    align-items: center;
    gap: var(--space-8);
    flex-wrap: wrap;
    min-height: 2.5rem;

    &--hidden {
      visibility: hidden;
      pointer-events: none;
    }

    .selection-hint {
      color: var(--surface-600);
      font-size: var(--font-14);
    }
  }

  .filter-section {
    margin-bottom: var(--space-16);

    .filter-grid {
      display: grid;
      gap: var(--space-16);
      grid-template-columns: minmax(180px, 220px) minmax(0, 1fr);
      align-items: end;
      justify-content: stretch;

      .field {
        min-inline-size: 0;

        label {
          display: block;
          font-weight: 500;
          color: var(--surface-700);
          margin-bottom: var(--space-8);
          font-size: var(--font-14);
        }
      }

      .field--columns {
        justify-self: stretch;
        width: 100%;
      }

      .columns-multiselect {
        width: 100%;
      }
    }

    @media (max-width: 480px) {
      .filter-grid {
        grid-template-columns: 1fr;
      }
    }
  }

  .loading-state,
  .empty-state {
    text-align: center;
    padding: var(--space-32) 0;

    p {
      color: var(--surface-500);
      font-size: var(--font-14);
    }
  }

  .entries-table {
    .entry-cell-text {
      display: block;
      inline-size: 100%;
      max-inline-size: 32rem;
      min-inline-size: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      text-wrap: nowrap;
    }

    .entry-title-link {
      inline-size: 100%;
      max-inline-size: 32rem;
      min-inline-size: 0;
      overflow: hidden;
      text-align: left;
      justify-content: flex-start;
      font-weight: 500;

      &:hover {
        color: var(--primary-600);
      }
    }

    .entry-status-cell {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--space-8);
      min-inline-size: 0;
    }

    .entry-status-tag {
      white-space: nowrap;
    }

    :deep(.entry-title-link > span) {
      display: block;
      min-inline-size: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      text-wrap: nowrap;
    }

    :deep(.el-table__header th.el-table__cell) {
      background: var(--surface-50);
      color: var(--surface-700);
      font-weight: 600;
      padding: var(--space-16);
      font-size: var(--font-14);
      border-bottom: 1px solid var(--surface-200);
    }

    :deep(.el-table__body td.el-table__cell) {
      padding: var(--space-16);
      font-size: var(--font-14);
      border-bottom: 1px solid var(--surface-100);
    }

    :deep(.el-table__body tr:hover > td.el-table__cell) {
      background: var(--surface-50);
    }

    :deep(.entries-pagination) {
      justify-content: flex-end;
      padding: var(--space-16);
      color: var(--surface-600);
    }
  }
}

.bulk-result-dialog {
  .bulk-result-summary {
    margin-bottom: var(--space-12);
    color: var(--surface-700);
  }

  .bulk-result-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
  }

  .result-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-8);
    width: 100%;
  }

  .result-id {
    font-weight: 600;
    color: var(--surface-800);
    word-break: break-all;
  }

  .result-error {
    color: var(--red-600);
    font-size: var(--font-14);
    line-height: 1.5;
    white-space: pre-wrap;
  }

  .result-success-placeholder {
    color: var(--surface-500);
    font-size: var(--font-14);
  }
}

.search-dialog {
  &__form {
    display: grid;
    gap: var(--space-24);
  }

  &__field {
    display: grid;
    gap: var(--space-8);

    label {
      color: var(--surface-700);
      font-size: var(--font-14);
      font-weight: 600;
      line-height: 1.4;
    }
  }

  &__input {
    width: 100%;
  }

  &__actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-12);
    flex-wrap: wrap;
    padding-block-start: var(--space-4);

    :deep(.el-button + .el-button) {
      margin-inline-start: 0;
    }
  }

  &__clear {
    margin-inline-end: auto;
  }
}

:global(.search-dialog .el-dialog__header) {
  gap: var(--space-16);
  padding: var(--space-24) var(--space-28) var(--space-12);
}

:global(.search-dialog .el-dialog__title) {
  line-height: 1.4;
  text-wrap: balance;
}

:global(.search-dialog .el-dialog__body) {
  overscroll-behavior: contain;
  padding: var(--space-8) var(--space-28) var(--space-28);
}

:global(.search-dialog .el-dialog__footer) {
  padding-inline: var(--space-28);
}

:global(.entries-columns-multiselect-overlay .el-select-dropdown__list) {
  margin-block-start: var(--space-8);
}
</style>
