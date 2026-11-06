<script lang="ts" setup>
import { encodeResourceId } from "@/utils/resourceId";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { useToast } from "@/services/feedback";
import { useConfirm } from "@/services/feedback";
import EntryForm from "@/components/EntryForm.vue";
import PageSectionHeader from "@/components/PageSectionHeader.vue";
import { useAuthStore } from "@/stores/auth";
import { authorizedFetch } from "@/utils/http";
import { formatAdminDateFieldValue, formatJapaneseDateTime } from "@/utils/dateTime";
import NabeIcon from "@/components/NabeIcon.vue";
import { ICONS } from "@/utils/icons";
import {
  buildLocalizedEntryFieldValues,
  buildLocalizedEntryInitialValues,
  DEFAULT_CONTENT_LOCALE,
  findEntryFieldValue,
  normalizeEntryFields,
  resolveAvailableLocaleCodes,
  resolveDefaultLocaleCode,
  sortModelFieldsByPosition,
  toEntryFieldValue,
  toLocaleItem,
  toModelField,
  type LocaleItem,
  type ModelField,
  type EntryFieldValue,
} from "@/modules/entries";
import {
  buildEntrySheetRequestPath,
  hasEntrySheetUnsavedChanges,
  isLocalizedFieldSort,
  toggleSheetSort,
  type SheetMode,
  type SheetSortBy,
  type SheetSortState,
} from "./entry-sheet-view";

import Button from "@/components/NabeButton.vue";
import { Card } from "@/components/ui/element-plus";
import { ElPagination, ElTable, ElTableColumn, ElTabPane, ElTabs } from "element-plus";
import { InputText } from "@/components/ui/element-plus";
import { Select } from "@/components/ui/element-plus";
import { DatePicker } from "@/components/ui/element-plus";
import { Dialog } from "@/components/ui/element-plus";
import { Badge } from "@/components/ui/element-plus";
import { Tag } from "@/components/ui/element-plus";
import { InputNumber } from "@/components/ui/element-plus";
import { ToggleSwitch } from "@/components/ui/element-plus";
const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const toast = useToast();
const confirm = useConfirm();
const authStore = useAuthStore();

const modelId = route.params.modelId as string;
/** Resolve router links for breadcrumb items. */
const resolveUrl = (path: string) => (typeof router.resolve === "function" ? router.resolve(path).href : path);

type ModelDetail = {
  id: string;
  name: string;
  description?: string;
  titleFieldId?: string | null;
  fields: ModelField[];
};

type EntrySheetRow = {
  id: string;
  modelId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  updatedByName: string | null;
  publishedAt: string | null;
  displayTitle: string;
  hasDraft: boolean;
  fields: EntryFieldValue[];
};

/** Narrow unknown values to a plain record. */
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const dateFormatValues = new Set(["date", "datetime", "datetime_with_timezone"]);

/** Resolve the configured date format for a field. */
const resolveDateFormat = (field: Pick<ModelField, "options" | "type" | "variant">): "date" | "datetime" | "datetime_with_timezone" => {
  const options = isRecord(field.options) ? field.options : {};
  const format = options.format;
  if (typeof format === "string" && dateFormatValues.has(format)) {
    return format as "date" | "datetime" | "datetime_with_timezone";
  }
  return field.variant === "datetime" ? "datetime" : "date";
};

/** Normalize a date-like value into a string that matches the field format. */
const normalizeDateValue = (format: "date" | "datetime" | "datetime_with_timezone", value: unknown): unknown => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const iso = value.toISOString();
    if (format === "date") return iso.slice(0, 10);
    if (format === "datetime") return iso.slice(0, 19);
    return iso;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    return value;
  }

  if (format === "date") {
    return value.slice(0, 10);
  }

  if (format === "datetime") {
    const match = value.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u);
    return match ? match[1] : value;
  }

  const hasTimezone = /Z|[+-]\d{2}:\d{2}$/u.test(value);
  if (hasTimezone) return value;
  const match = value.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?$/u);
  return match ? `${match[1]}Z` : value;
};

/** Parse entry sheet row payload. */
const toEntrySheetRow = (input: unknown): EntrySheetRow | null => {
  if (!isRecord(input)) return null;
  const record = input as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : "";
  if (!id) return null;

  const fieldsRaw = Array.isArray(record.fields) ? record.fields : [];
  const displayTitleRaw = record.displayTitle;
  const updatedByNameRaw = record.updatedByName;

  return {
    id,
    modelId: typeof record.modelId === "string" ? record.modelId : modelId,
    status: typeof record.status === "string" ? record.status : "",
    createdAt: typeof record.createdAt === "string" ? record.createdAt : "",
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : "",
    updatedBy: typeof record.updatedBy === "string" ? record.updatedBy : "",
    updatedByName: typeof updatedByNameRaw === "string" && updatedByNameRaw.trim().length > 0 ? updatedByNameRaw : null,
    publishedAt: typeof record.publishedAt === "string" ? record.publishedAt : null,
    displayTitle: typeof displayTitleRaw === "string" && displayTitleRaw.trim().length > 0 ? displayTitleRaw : id,
    hasDraft: Boolean(record.hasDraft),
    fields: fieldsRaw.map((field) => toEntryFieldValue(field, { defaultLocale: DEFAULT_CONTENT_LOCALE })),
  } satisfies EntrySheetRow;
};

/** Format entry field value for display in a cell. */
const formatFieldValue = (field: Pick<ModelField, "options" | "type" | "variant">, value: unknown): string => {
  if (value == null) return "-";
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

/** Determine whether a field can be edited inline. */
const isInlineEditableField = (field: ModelField): boolean => ["text", "number", "date", "boolean"].includes(field.type);

/** Determine whether a field should open the detail editor instead of inline editing. */
const isComplexField = (field: ModelField): boolean => !isInlineEditableField(field);

const model = ref<ModelDetail | null>(null);
const locales = ref<LocaleItem[]>([]);
const entries = ref<EntrySheetRow[]>([]);
const sheetPage = ref(1);
const sheetPageSize = ref(20);
const activeMode = ref<SheetMode>("draft");
const activeLocale = ref<string>(DEFAULT_CONTENT_LOCALE);
const loading = ref(true);
const errorMessage = ref<string | null>(null);
const selectedEntries = ref<EntrySheetRow[]>([]);
const bulkLoading = ref(false);
const rowSavingIds = ref<Set<string>>(new Set());
const dirtyEntryIds = ref<Set<string>>(new Set());
const rowErrors = ref<Record<string, string>>({});
const sortState = ref<SheetSortState | null>(null);
const bypassRouteLeaveGuard = ref(false);

const entryDialogVisible = ref(false);
const entryDialogEntry = ref<EntrySheetRow | null>(null);
const entryDialogValues = ref<Record<string, unknown>>({});
const entryDialogLocaleFilter = ref("all");
const entryDialogKey = ref(0);
const entryDialogLoading = ref(false);
const entryDialogDirty = ref(false);

let removeRouteGuard: null | (() => void) = null;

const isDraftMode = computed(() => activeMode.value === "draft");
const paginatedEntries = computed(() => {
  const start = (sheetPage.value - 1) * sheetPageSize.value;
  return entries.value.slice(start, start + sheetPageSize.value);
});
const defaultLocaleCode = computed(() => resolveDefaultLocaleCode(locales.value));
const availableLocaleCodes = computed(() => {
  const codes = locales.value.map((item) => item.code);
  if (!codes.includes(defaultLocaleCode.value)) codes.unshift(defaultLocaleCode.value);
  return Array.from(new Set(codes));
});

const orderedFields = computed(() => sortModelFieldsByPosition(model.value?.fields ?? []));

const titleFieldId = computed(() => model.value?.titleFieldId ?? null);
const tableFields = computed(() => orderedFields.value.filter((field) => field.id !== titleFieldId.value));
const hasUnsavedChanges = computed(() => hasEntrySheetUnsavedChanges(dirtyEntryIds.value, entryDialogDirty.value));
const hasLocalizedSort = computed(() => isLocalizedFieldSort(sortState.value, model.value?.fields ?? []));

const breadcrumbItems = computed(() => [
  { label: t("contents.create.breadcrumb_root"), to: "/contents", url: resolveUrl("/contents") },
  {
    label: model.value?.name ?? t("contents.entries.title_suffix"),
    to: `/contents/${encodeResourceId(modelId)}`,
    url: resolveUrl(`/contents/${encodeResourceId(modelId)}`),
  },
  {
    label: t("contents.sheet.breadcrumb"),
    to: `/contents/${encodeResourceId(modelId)}/sheet`,
    url: resolveUrl(`/contents/${encodeResourceId(modelId)}/sheet`),
  },
]);

const headingTitle = computed(() => {
  const suffix = t("contents.sheet.title_suffix");
  const name = model.value?.name;
  return name ? `${name} ${suffix}` : suffix;
});

const headingDescription = computed(() => model.value?.description ?? t("contents.sheet.description"));

const localeOptions = computed(() => locales.value.map((item) => ({ value: item.code, label: item.code })));

/** Mark a row as dirty. */
const markEntryDirty = (entryId: string) => {
  const next = new Set(dirtyEntryIds.value);
  next.add(entryId);
  dirtyEntryIds.value = next;
};

/** Clear the dirty flag for a row. */
const clearEntryDirty = (entryId: string) => {
  const next = new Set(dirtyEntryIds.value);
  next.delete(entryId);
  dirtyEntryIds.value = next;
};

/** Set row saving state. */
const setRowSaving = (entryId: string, saving: boolean) => {
  const next = new Set(rowSavingIds.value);
  if (saving) {
    next.add(entryId);
  } else {
    next.delete(entryId);
  }
  rowSavingIds.value = next;
};

/** Update row-level error message. */
const setRowError = (entryId: string, message: string | null) => {
  rowErrors.value = {
    ...rowErrors.value,
    [entryId]: message ?? "",
  };
};

/** Refresh display title based on the configured title field. */
const refreshDisplayTitle = (entry: EntrySheetRow) => {
  const titleId = titleFieldId.value;
  if (!titleId || !model.value) return;
  const titleField = model.value.fields.find((item) => item.id === titleId);
  if (!titleField) return;
  const resolved = findEntryFieldValue(titleField, entry.fields, {
    locale: defaultLocaleCode.value,
    defaultLocale: defaultLocaleCode.value,
    fallbackToDefaultLocale: true,
  });
  if (!resolved) return;
  const nextTitle = formatFieldValue(titleField, resolved.value);
  if (nextTitle !== "-") {
    entry.displayTitle = nextTitle;
  }
};

/** Update an entry field value for the active locale. */
const updateEntryFieldValue = (entry: EntrySheetRow, field: ModelField, value: unknown) => {
  const localeCode = field.hasLocales ? activeLocale.value : defaultLocaleCode.value;
  const normalizedValue = field.type === "date" ? normalizeDateValue(resolveDateFormat(field), value) : value;
  const target = entry.fields.find((item) => item.fieldId === field.id && item.locale === localeCode);
  if (target) {
    target.value = normalizedValue;
  } else {
    entry.fields.push({
      fieldId: field.id,
      locale: localeCode,
      type: field.type,
      value: normalizedValue,
    });
  }
  if (field.id === titleFieldId.value) {
    refreshDisplayTitle(entry);
  }
  markEntryDirty(entry.id);
};

/** Build API payload for entry fields. */
const buildFieldsPayload = (entry: EntrySheetRow): Array<{ fieldId: string; locale: string; value: unknown }> =>
  entry.fields.map((field) => ({ fieldId: field.fieldId, locale: field.locale, value: field.value }));

/** Resolve entry field value for display. */
const resolveDisplayValue = (entry: EntrySheetRow, field: ModelField): EntryFieldValue | null =>
  findEntryFieldValue(field, entry.fields, {
    locale: activeLocale.value,
    defaultLocale: defaultLocaleCode.value,
    fallbackToDefaultLocale: true,
  });

/** Resolve a text field value for inline editing. */
const resolveTextValue = (entry: EntrySheetRow, field: ModelField): string => {
  const value = resolveDisplayValue(entry, field)?.value;
  if (typeof value === "string") return value;
  if (value == null) return "";
  return String(value);
};

/** Resolve a number field value for inline editing. */
const resolveNumberValue = (entry: EntrySheetRow, field: ModelField): number | null => {
  const value = resolveDisplayValue(entry, field)?.value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

/** Resolve a date field value for inline editing. */
const resolveDateValue = (entry: EntrySheetRow, field: ModelField): Date | null => {
  const value = resolveDisplayValue(entry, field)?.value;
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};

/** Resolve the current sort indicator icon for a header. */
const resolveSortIcon = (sortBy: SheetSortBy): string => {
  if (sortState.value?.sortBy !== sortBy) {
    return ICONS.sort;
  }

  return sortState.value.sortOrder === "asc" ? ICONS.sortAsc : ICONS.sortDesc;
};

/** Reset the detail dialog state without persisting pending edits. */
const resetEntryDialogState = () => {
  entryDialogVisible.value = false;
  entryDialogEntry.value = null;
  entryDialogValues.value = {};
  entryDialogLocaleFilter.value = "all";
  entryDialogLoading.value = false;
  entryDialogDirty.value = false;
};

/** Ask whether unsaved changes should be discarded. */
const requestDiscardUnsavedChanges = async (): Promise<boolean> => {
  if (!hasUnsavedChanges.value) return true;

  return await new Promise<boolean>((resolve) => {
    let settled = false;
    const settle = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    confirm.require({
      header: t("contents.sheet.unsaved_confirm_title"),
      message: t("contents.sheet.unsaved_confirm_message"),
      icon: "lucide:triangle-alert",
      acceptLabel: t("contents.sheet.unsaved_continue"),
      rejectLabel: t("common.cancel"),
      accept: () => settle(true),
      reject: () => settle(false),
      onHide: () => settle(false),
    });
  });
};

/** Run a same-page transition that may discard unsaved changes. */
const runSheetTransition = async (action: () => Promise<void> | void): Promise<boolean> => {
  if (hasUnsavedChanges.value) {
    const accepted = await requestDiscardUnsavedChanges();
    if (!accepted) return false;
    resetEntryDialogState();
  }

  await action();
  return true;
};

/** Run a route navigation while avoiding a duplicate leave prompt. */
const runRouteNavigation = async (action: () => Promise<unknown> | unknown): Promise<void> => {
  if (hasUnsavedChanges.value) {
    const accepted = await requestDiscardUnsavedChanges();
    if (!accepted) return;
  }

  bypassRouteLeaveGuard.value = true;
  try {
    await action();
  } finally {
    bypassRouteLeaveGuard.value = false;
  }
};

/** Handle browser tab close / reload with unsaved changes. */
const handleBeforeUnload = (event: BeforeUnloadEvent) => {
  if (!hasUnsavedChanges.value) return;
  event.preventDefault();
  event.returnValue = "";
};

/** Install a route leave guard for unsaved changes. */
const setupRouteLeaveGuard = () => {
  if (typeof router.beforeEach !== "function") return;

  removeRouteGuard = router.beforeEach(async () => {
    if (bypassRouteLeaveGuard.value || !hasUnsavedChanges.value) {
      return true;
    }

    return await requestDiscardUnsavedChanges();
  });
};

/** Handle mode changes with unsaved-change protection. */
const handleModeChange = async (value: string | number) => {
  const nextMode: SheetMode = value === "published" ? "published" : "draft";
  if (nextMode === activeMode.value) return;

  await runSheetTransition(async () => {
    activeMode.value = nextMode;
    await fetchSheetData();
  });
};

/** Handle locale changes while preserving locale-aware server sorting. */
const handleLocaleChange = async (value: string) => {
  if (!value || value === activeLocale.value) return;

  if (!hasLocalizedSort.value) {
    activeLocale.value = value;
    return;
  }

  const previous = activeLocale.value;
  const transitioned = await runSheetTransition(async () => {
    activeLocale.value = value;
    await fetchSheetData();
  });

  if (!transitioned) {
    activeLocale.value = previous;
  }
};

/** Handle server-driven sorting from a header interaction. */
const handleSortChange = async (sortBy: SheetSortBy) => {
  const previous = sortState.value;
  const next = toggleSheetSort(sortState.value, sortBy);

  const transitioned = await runSheetTransition(async () => {
    sortState.value = next;
    await fetchSheetData();
  });

  if (!transitioned) {
    sortState.value = previous;
  }
};

/** Navigate back to the entries list. */
const navigateBackToList = async () => {
  await runRouteNavigation(() => router.push(`/contents/${encodeResourceId(modelId)}`));
};

/** Fetch sheet data for the active mode. */
const fetchSheetData = async () => {
  loading.value = true;
  errorMessage.value = null;
  try {
    if (!authStore.accessToken) {
      await authStore.refresh().catch(() => undefined);
    }

    const res = await authorizedFetch(
      authStore,
      buildEntrySheetRequestPath({
        modelId,
        mode: activeMode.value,
        locale: activeLocale.value,
        sort: sortState.value,
      }),
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(body || `Request failed with status ${res.status}`);
    }

    const payload = (await res.json()) as Record<string, unknown>;
    const modelRaw = isRecord(payload.model) ? payload.model : null;
    const fieldsRaw = isRecord(modelRaw) && Array.isArray(modelRaw.fields) ? (modelRaw.fields as unknown[]) : [];
    const localesRaw = Array.isArray(payload.locales) ? payload.locales : [];
    const itemsRaw = Array.isArray(payload.items) ? payload.items : [];

    const parsedFields = sortModelFieldsByPosition(fieldsRaw.map((field) => toModelField(field)));

    const detail: ModelDetail | null = modelRaw
      ? {
          id: typeof (modelRaw as Record<string, unknown>).id === "string" ? ((modelRaw as Record<string, unknown>).id as string) : modelId,
          name: (() => {
            const nameRaw = (modelRaw as Record<string, unknown>).name;
            return typeof nameRaw === "string" && nameRaw.trim().length > 0 ? nameRaw : modelId;
          })(),
          description: (() => {
            const descRaw = (modelRaw as Record<string, unknown>).description;
            return typeof descRaw === "string" && descRaw.trim().length > 0 ? descRaw : undefined;
          })(),
          titleFieldId:
            typeof (modelRaw as Record<string, unknown>).titleFieldId === "string" ? ((modelRaw as Record<string, unknown>).titleFieldId as string) : null,
          fields: parsedFields,
        }
      : null;

    const parsedLocales = localesRaw.map((item) => toLocaleItem(item)).filter((item): item is LocaleItem => item !== null);
    const fallbackLocale = resolveDefaultLocaleCode(parsedLocales, DEFAULT_CONTENT_LOCALE);
    const localeCodes = resolveAvailableLocaleCodes(parsedLocales, [], fallbackLocale);

    if (!activeLocale.value || !localeCodes.includes(activeLocale.value)) {
      activeLocale.value = fallbackLocale;
    }

    const parsedEntries = itemsRaw
      .map((item) => toEntrySheetRow(item))
      .filter((item): item is EntrySheetRow => item !== null)
      .map((entry) => ({
        ...entry,
        fields: normalizeEntryFields(entry.fields, parsedFields, localeCodes, fallbackLocale),
      }));

    model.value = detail;
    locales.value = parsedLocales;
    entries.value = parsedEntries;
    sheetPage.value = 1;
    selectedEntries.value = [];
    dirtyEntryIds.value = new Set();
    rowErrors.value = {};
  } catch (error) {
    console.error("Failed to fetch sheet entries:", error);
    errorMessage.value = t("contents.sheet.error");
    model.value = null;
    entries.value = [];
  } finally {
    loading.value = false;
  }
};

/** Resolve entry field label for error messages. */
const resolveFieldName = (fieldId: string): string => {
  const field = model.value?.fields.find((item) => item.id === fieldId);
  return field?.name ?? t("contents.entries.unknown_field");
};

/** Parse API error payload into a user-facing message. */
const resolveErrorMessage = async (res: Response): Promise<string> => {
  try {
    const data = (await res.json()) as Record<string, unknown>;
    const error = isRecord(data.error) ? (data.error as Record<string, unknown>) : null;
    const code = typeof error?.code === "string" ? error.code : "";
    if (code === "UNIQUE_FIELD_CONFLICT") {
      const localeValue = typeof error?.locale === "string" ? error.locale : "";
      const fieldId = typeof error?.fieldId === "string" ? error.fieldId : "";
      return t("contents.entries.unique_conflict", {
        locale: localeValue || "-",
        field: resolveFieldName(fieldId),
      });
    }
    const message = typeof error?.message === "string" ? error.message : "";
    if (message) return message;
  } catch (err) {
    console.error("Failed to parse error payload", err);
  }
  return t("contents.sheet.error");
};

/** Save draft for a single entry row. */
const saveEntryDraft = async (entry: EntrySheetRow, showToast = true): Promise<boolean> => {
  setRowSaving(entry.id, true);
  setRowError(entry.id, null);
  try {
    if (!authStore.accessToken) {
      await authStore.refresh().catch(() => undefined);
    }

    const res = await authorizedFetch(authStore, `/api/admin/models/${encodeResourceId(modelId)}/entries/${encodeResourceId(entry.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "draft",
        fields: buildFieldsPayload(entry),
      }),
    });

    if (!res.ok) {
      const message = await resolveErrorMessage(res);
      setRowError(entry.id, message);
      if (showToast) {
        toast.add({
          severity: "error",
          summary: t("contents.sheet.toast.save_failed"),
          detail: message,
          life: 3600,
        });
      }
      return false;
    }

    const data = (await res.json()) as Record<string, unknown>;
    const item = isRecord(data.item) ? (data.item as Record<string, unknown>) : null;
    if (item) {
      entry.updatedAt = typeof item.updatedAt === "string" ? item.updatedAt : entry.updatedAt;
      entry.status = typeof item.status === "string" ? item.status : entry.status;
      entry.publishedAt = typeof item.publishedAt === "string" ? item.publishedAt : entry.publishedAt;
      entry.hasDraft = true;
    }
    clearEntryDirty(entry.id);
    if (showToast) {
      toast.add({
        severity: "success",
        summary: t("contents.sheet.toast.save_success"),
        detail: entry.displayTitle,
        life: 2400,
      });
    }
    return true;
  } catch (error) {
    console.error("Failed to save draft", error);
    if (showToast) {
      toast.add({
        severity: "error",
        summary: t("contents.sheet.toast.save_failed"),
        detail: t("contents.sheet.error"),
        life: 3600,
      });
    }
    return false;
  } finally {
    setRowSaving(entry.id, false);
  }
};

/** Publish a single entry row. */
const publishEntry = async (entry: EntrySheetRow, showToast = true): Promise<boolean> => {
  setRowSaving(entry.id, true);
  setRowError(entry.id, null);
  try {
    if (!authStore.accessToken) {
      await authStore.refresh().catch(() => undefined);
    }

    const res = await authorizedFetch(authStore, `/api/admin/models/${encodeResourceId(modelId)}/entries/${encodeResourceId(entry.id)}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (!res.ok) {
      const message = await resolveErrorMessage(res);
      setRowError(entry.id, message);
      if (showToast) {
        toast.add({
          severity: "error",
          summary: t("contents.sheet.toast.publish_failed"),
          detail: message,
          life: 3600,
        });
      }
      return false;
    }

    const data = (await res.json()) as Record<string, unknown>;
    const item = isRecord(data.item) ? (data.item as Record<string, unknown>) : null;
    if (item) {
      entry.updatedAt = typeof item.updatedAt === "string" ? item.updatedAt : entry.updatedAt;
      entry.status = typeof item.status === "string" ? item.status : entry.status;
      entry.publishedAt = typeof item.publishedAt === "string" ? item.publishedAt : entry.publishedAt;
      entry.hasDraft = false;
    }
    clearEntryDirty(entry.id);
    if (showToast) {
      toast.add({
        severity: "success",
        summary: t("contents.sheet.toast.publish_success"),
        detail: entry.displayTitle,
        life: 2400,
      });
    }
    return true;
  } catch (error) {
    console.error("Failed to publish entry", error);
    if (showToast) {
      toast.add({
        severity: "error",
        summary: t("contents.sheet.toast.publish_failed"),
        detail: t("contents.sheet.error"),
        life: 3600,
      });
    }
    return false;
  } finally {
    setRowSaving(entry.id, false);
  }
};

/** Save draft and optionally publish depending on current dirty state. */
const saveAndMaybePublish = async (entry: EntrySheetRow): Promise<void> => {
  if (!isDraftMode.value) return;
  const needsDraftSave = dirtyEntryIds.value.has(entry.id);
  if (needsDraftSave) {
    const ok = await saveEntryDraft(entry, false);
    if (!ok) return;
  }
  await publishEntry(entry);
};

/** Execute bulk action for selected entries. */
const runBulkAction = async (action: "draft" | "publish") => {
  if (!isDraftMode.value) return;
  if (selectedEntries.value.length === 0) {
    toast.add({
      severity: "warn",
      summary: t("contents.sheet.bulk.none_selected_title"),
      detail: t("contents.sheet.bulk.none_selected_message"),
      life: 2400,
    });
    return;
  }

  bulkLoading.value = true;
  let successCount = 0;
  let failureCount = 0;

  for (const entry of selectedEntries.value) {
    try {
      if (action === "draft") {
        const ok = await saveEntryDraft(entry, false);
        if (ok) successCount += 1;
        else failureCount += 1;
        continue;
      }

      const needsDraftSave = dirtyEntryIds.value.has(entry.id);
      if (needsDraftSave) {
        const draftOk = await saveEntryDraft(entry, false);
        if (!draftOk) {
          failureCount += 1;
          continue;
        }
      }

      const publishOk = await publishEntry(entry, false);
      if (publishOk) successCount += 1;
      else failureCount += 1;
    } catch (error) {
      console.error("Bulk action failed", error);
      failureCount += 1;
    }
  }

  if (failureCount === 0) {
    toast.add({
      severity: "success",
      summary: t("contents.sheet.bulk.success_title"),
      detail: t("contents.sheet.bulk.success_message", { count: successCount }),
      life: 2600,
    });
  } else if (successCount === 0) {
    toast.add({
      severity: "error",
      summary: t("contents.sheet.bulk.error_title"),
      detail: t("contents.sheet.bulk.error_message"),
      life: 3200,
    });
  } else {
    toast.add({
      severity: "warn",
      summary: t("contents.sheet.bulk.partial_title"),
      detail: t("contents.sheet.bulk.partial_message", { success: successCount, failed: failureCount }),
      life: 3200,
    });
  }

  selectedEntries.value = [];
  bulkLoading.value = false;
};

/** Open entry detail dialog for complex editing. */
const openEntryDialog = (entry: EntrySheetRow) => {
  if (!model.value) return;
  entryDialogEntry.value = entry;
  entryDialogLocaleFilter.value = "all";
  entryDialogDirty.value = false;
  entryDialogValues.value = buildLocalizedEntryInitialValues(model.value.fields, entry.fields, {
    localeCodes: availableLocaleCodes.value,
    defaultLocale: defaultLocaleCode.value,
    status: entry.status,
  });
  entryDialogKey.value += 1;
  entryDialogVisible.value = true;
};

/** Close the entry detail dialog. */
const closeEntryDialog = () => {
  resetEntryDialogState();
};

/** Close the dialog, guarding against unsaved dialog edits. */
const requestEntryDialogClose = async () => {
  if (entryDialogDirty.value) {
    const accepted = await requestDiscardUnsavedChanges();
    if (!accepted) {
      entryDialogVisible.value = true;
      return;
    }
  }

  closeEntryDialog();
};

/** Handle visibility updates from the dialog component. */
const handleEntryDialogVisibilityChange = async (visible: boolean) => {
  if (visible) {
    entryDialogVisible.value = true;
    return;
  }

  await requestEntryDialogClose();
};

/** Track form dirtiness inside the detail dialog. */
const handleEntryDialogDirtyChange = (dirty: boolean) => {
  entryDialogDirty.value = dirty;
};

/** Apply form values from the dialog into the entry fields. */
const applyDialogValuesToEntry = (entry: EntrySheetRow, values: Record<string, unknown>) => {
  if (!model.value) return;
  entry.fields = buildLocalizedEntryFieldValues(model.value.fields, values, {
    localeCodes: availableLocaleCodes.value,
    defaultLocale: defaultLocaleCode.value,
  });
  refreshDisplayTitle(entry);
  markEntryDirty(entry.id);
};

/** Save draft from the dialog form. */
const handleDialogSaveDraft = async (values: Record<string, unknown>) => {
  const entry = entryDialogEntry.value;
  if (!entry || !isDraftMode.value) return;
  entryDialogLoading.value = true;
  applyDialogValuesToEntry(entry, values);
  const ok = await saveEntryDraft(entry);
  entryDialogLoading.value = false;
  if (ok) closeEntryDialog();
};

/** Publish from the dialog form. */
const handleDialogPublish = async (values: Record<string, unknown>) => {
  const entry = entryDialogEntry.value;
  if (!entry || !isDraftMode.value) return;
  entryDialogLoading.value = true;
  applyDialogValuesToEntry(entry, values);
  const saved = await saveEntryDraft(entry, false);
  if (saved) {
    await publishEntry(entry);
    closeEntryDialog();
  }
  entryDialogLoading.value = false;
};

/** Format date for display. */
const formatDate = (value: string | null | undefined) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return formatJapaneseDateTime(date);
};

onMounted(() => {
  void fetchSheetData();
  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", handleBeforeUnload);
  }
  setupRouteLeaveGuard();
});

onBeforeUnmount(() => {
  if (typeof window !== "undefined") {
    window.removeEventListener("beforeunload", handleBeforeUnload);
  }
  if (typeof removeRouteGuard === "function") {
    removeRouteGuard();
    removeRouteGuard = null;
  }
});
</script>

<template>
  <div class="entry-sheet-page">
    <Dialog
      :visible="entryDialogVisible"
      modal
      :header="t('contents.sheet.dialog.title')"
      :style="{ width: '860px' }"
      class="entry-sheet-dialog"
      @update:visible="handleEntryDialogVisibilityChange"
    >
      <div v-if="entryDialogEntry && model" class="entry-sheet-dialog__content">
        <EntryForm
          :key="entryDialogKey"
          mode="edit"
          :model="model"
          :initial-values="entryDialogValues"
          :locales="locales"
          :default-locale="defaultLocaleCode"
          v-model:localeFilter="entryDialogLocaleFilter"
          :loading="entryDialogLoading"
          :enable-workflow-actions="isDraftMode"
          :hide-actions="!isDraftMode"
          :hide-workflow-actions="!isDraftMode"
          :readonly="!isDraftMode"
          @save-draft="handleDialogSaveDraft"
          @publish="handleDialogPublish"
          @cancel="requestEntryDialogClose"
          @dirty-change="handleEntryDialogDirtyChange"
        />
      </div>
    </Dialog>

    <PageSectionHeader :title="headingTitle" :description="headingDescription" :breadcrumb-model="breadcrumbItems">
      <template #actions>
        <div class="title-actions">
          <Button severity="secondary" icon="lucide:arrow-left" :label="t('contents.sheet.back_to_list')" @click="navigateBackToList" />
        </div>
      </template>
      <template #bottom>
        <div class="toolbar">
          <ElTabs :model-value="activeMode" class="sheet-tabs" @update:model-value="handleModeChange">
            <ElTabPane :label="t('contents.sheet.tab_draft')" name="draft" />
            <ElTabPane :label="t('contents.sheet.tab_published')" name="published" />
          </ElTabs>

          <div class="toolbar-actions">
            <div v-if="localeOptions.length > 1" class="locale-select">
              <label for="sheet-locale">{{ t("contents.sheet.locale") }}</label>
              <Select
                id="sheet-locale"
                :modelValue="activeLocale"
                :options="localeOptions"
                optionLabel="label"
                optionValue="value"
                @update:modelValue="(value: string) => handleLocaleChange(value)"
              />
            </div>

            <div class="bulk-actions">
              <Button
                severity="primary"
                icon="lucide:save"
                size="small"
                :label="t('contents.sheet.bulk.save_draft')"
                :disabled="!isDraftMode || bulkLoading || selectedEntries.length === 0"
                @click="runBulkAction('draft')"
              />
              <Button
                severity="success"
                icon="lucide:upload"
                size="small"
                :label="t('contents.sheet.bulk.publish')"
                :disabled="!isDraftMode || bulkLoading || selectedEntries.length === 0"
                @click="runBulkAction('publish')"
              />
              <span class="selection-hint">{{ t("contents.sheet.bulk.selected", { count: selectedEntries.length }) }}</span>
            </div>
          </div>
        </div>
      </template>
    </PageSectionHeader>

    <div v-if="loading" class="loading-state">
      <p>{{ t("contents.sheet.loading") }}</p>
    </div>

    <div v-else-if="errorMessage" class="empty-state">
      <p>{{ errorMessage }}</p>
    </div>

    <div v-else-if="entries.length === 0" class="empty-state">
      <p>{{ t("contents.sheet.empty") }}</p>
    </div>

    <Card v-else class="sheet-table">
      <template #content>
        <ElTable :data="paginatedEntries" row-key="id" :stripe="true" max-height="60vh" @selection-change="selectedEntries = $event">
          <ElTableColumn type="selection" width="48" fixed reserve-selection />

          <!-- @vue-generic {EntrySheetRow} -->
          <ElTableColumn prop="displayTitle" style="min-width: 240px" fixed>
            <template #header>
              <button type="button" class="sort-header-button" @click="handleSortChange('displayTitle')">
                <span>{{ t("contents.sheet.table.display_title") }}</span>
                <NabeIcon :icon="resolveSortIcon('displayTitle')" />
              </button>
            </template>
            <template #default="{ row: data }">
              <Button variant="link" class="entry-title-link" @click="openEntryDialog(data)">
                {{ data.displayTitle }}
              </Button>
              <Badge v-if="data.hasDraft" class="draft-badge" :value="t('contents.sheet.draft_badge')" />
            </template>
          </ElTableColumn>

          <!-- @vue-generic {EntrySheetRow} -->
          <ElTableColumn prop="status" style="width: 120px">
            <template #header>
              <button type="button" class="sort-header-button" @click="handleSortChange('status')">
                <span>{{ t("contents.sheet.table.status") }}</span>
                <NabeIcon :icon="resolveSortIcon('status')" />
              </button>
            </template>
            <template #default="{ row: data }">
              <Tag :value="data.status" :severity="data.status === 'published' ? 'success' : data.status === 'draft' ? 'warning' : 'secondary'" />
            </template>
          </ElTableColumn>

          <!-- @vue-generic {EntrySheetRow} -->
          <ElTableColumn prop="updatedAt" style="width: 180px">
            <template #header>
              <button type="button" class="sort-header-button" @click="handleSortChange('updatedAt')">
                <span>{{ t("contents.sheet.table.updated_at") }}</span>
                <NabeIcon :icon="resolveSortIcon('updatedAt')" />
              </button>
            </template>
            <template #default="{ row: data }">{{ formatDate(data.updatedAt) }}</template>
          </ElTableColumn>

          <!-- @vue-generic {EntrySheetRow} -->
          <ElTableColumn prop="updatedBy" style="width: 140px">
            <template #header>
              <button type="button" class="sort-header-button" @click="handleSortChange('updatedBy')">
                <span>{{ t("contents.sheet.table.updated_by") }}</span>
                <NabeIcon :icon="resolveSortIcon('updatedBy')" />
              </button>
            </template>
            <template #default="{ row: data }">{{ data.updatedByName ?? data.updatedBy ?? "-" }}</template>
          </ElTableColumn>

          <!-- @vue-generic {EntrySheetRow} -->
          <ElTableColumn v-for="field in tableFields" :key="field.id" :style="{ minWidth: '200px' }">
            <template #header>
              <button type="button" class="sort-header-button" @click="handleSortChange(`field:${field.id}`)">
                <span>{{ field.name }}</span>
                <NabeIcon :icon="resolveSortIcon(`field:${field.id}`)" />
              </button>
            </template>
            <template #default="{ row: data }">
              <InputText
                v-if="isDraftMode && field.type === 'text'"
                :modelValue="resolveTextValue(data, field)"
                @update:modelValue="(val: string | undefined) => updateEntryFieldValue(data, field, val ?? '')"
              />
              <InputNumber
                v-else-if="isDraftMode && field.type === 'number'"
                :modelValue="resolveNumberValue(data, field)"
                @update:modelValue="(val: number | null) => updateEntryFieldValue(data, field, val)"
              />
              <DatePicker
                v-else-if="isDraftMode && field.type === 'date'"
                :modelValue="resolveDateValue(data, field)"
                @update:modelValue="(val: Date | (Date | null)[] | Date[] | null | undefined) => updateEntryFieldValue(data, field, val ?? null)"
              />
              <ToggleSwitch
                v-else-if="isDraftMode && field.type === 'boolean'"
                :modelValue="Boolean(resolveDisplayValue(data, field)?.value)"
                @update:modelValue="(val: boolean) => updateEntryFieldValue(data, field, val)"
              />
              <div v-else class="cell-value" :class="{ compact: isComplexField(field) }">
                <template v-if="isComplexField(field)">
                  <Button variant="link" class="cell-editor-link" @click.stop="openEntryDialog(data)">
                    {{ t("contents.sheet.cell.open_editor") }}
                  </Button>
                </template>
                <template v-else>
                  {{ formatFieldValue(field, resolveDisplayValue(data, field)?.value) }}
                </template>
              </div>
            </template>
          </ElTableColumn>

          <!-- @vue-generic {EntrySheetRow} -->
          <ElTableColumn :label="t('contents.sheet.table.actions')" style="width: 200px" fixed="right">
            <template #default="{ row: data }">
              <div class="row-actions">
                <Button v-if="isDraftMode" size="small" icon="lucide:save" :disabled="rowSavingIds.has(data.id)" @click="saveEntryDraft(data)" />
                <Button
                  v-if="isDraftMode"
                  severity="success"
                  size="small"
                  icon="lucide:upload"
                  :disabled="rowSavingIds.has(data.id)"
                  @click="saveAndMaybePublish(data)"
                />
                <Button v-if="!isDraftMode" severity="secondary" size="small" icon="lucide:eye" @click="openEntryDialog(data)" />
              </div>
              <small v-if="rowErrors[data.id]" class="row-error">{{ rowErrors[data.id] }}</small>
            </template>
          </ElTableColumn>
        </ElTable>
        <ElPagination
          v-model:current-page="sheetPage"
          v-model:page-size="sheetPageSize"
          :page-sizes="[10, 20, 50, 100]"
          :total="entries.length"
          layout="total, sizes, prev, pager, next"
          class="sheet-pagination"
        />
      </template>
    </Card>
  </div>
</template>

<style lang="scss" scoped>
.entry-sheet-page {
  padding: var(--space-24);

  .title-actions {
    display: flex;
    gap: var(--space-8);
  }

  .toolbar {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);

    .sheet-tabs {
      width: fit-content;
    }

    .toolbar-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-16);
    }

    .locale-select {
      display: flex;
      align-items: center;
      gap: var(--space-8);
      label {
        color: var(--surface-600);
      }
    }

    .bulk-actions {
      display: flex;
      align-items: center;
      gap: var(--space-8);
      flex-wrap: wrap;

      .selection-hint {
        color: var(--surface-600);
        font-size: var(--font-14);
      }
    }
  }

  .sheet-table {
    .sort-header-button {
      display: inline-flex;
      align-items: center;
      gap: var(--space-8);
      width: 100%;
      padding: 0;
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;

      i {
        color: var(--surface-500);
        font-size: var(--font-12);
      }
    }

    .entry-title-link {
      font-weight: 600;
      padding: 0;
    }

    .draft-badge {
      margin-left: var(--space-8);
    }

    .cell-value {
      display: flex;
      align-items: center;
      min-height: 2rem;

      &.compact {
        color: var(--surface-600);
      }
    }

    .cell-editor-link {
      padding: 0;
      font-size: var(--font-14);
    }

    .row-actions {
      display: flex;
      align-items: center;
      gap: var(--space-8);
    }

    .row-error {
      display: block;
      margin-top: var(--space-4);
      color: var(--red-600);
      font-size: var(--font-12);
    }
  }
}
</style>
