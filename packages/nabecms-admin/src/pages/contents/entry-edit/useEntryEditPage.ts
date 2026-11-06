import { encodeResourceId } from "@/utils/resourceId";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useReferenceSession } from "./referenceSession";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { useConfirm } from "@/services/feedback";
import { useToast } from "@/services/feedback";
import { useAuthStore } from "@/stores/auth";
import {
  fetchEntryBackReferences,
  fetchEntryReferences,
  preloadEntryReferences,
  type EntryBackReference,
  type EntryBackReferenceResult,
} from "@/services/entryReferences";
import { authorizedFetch } from "@/utils/http";
import { formatJapaneseDateTime } from "@/utils/dateTime";
import {
  buildLocalizedEntryFieldValues,
  buildLocalizedEntryInitialValues,
  DEFAULT_CONTENT_LOCALE,
  normalizeEntryStatus,
  resolveAvailableLocaleCodes,
  resolveDefaultLocaleCode,
  sortModelFieldsByPosition,
  toEntryFieldValue,
  toLocaleItem,
  toModelField,
  type EntryFieldValue,
  type EntryStatus,
  type LocaleItem,
  type ModelField,
} from "@/modules/entries";

type EntryEditPageProps = {
  modelId: string;
  entryId: string;
};

type ModelDetail = {
  id: string;
  name: string;
  description?: string;
  fields: ModelField[];
};

type EntryDetail = {
  id: string;
  modelId: string;
  status: EntryStatus;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  updatedByName: string | null;
  publishedAt: string | null;
  publishedRevisionId?: string | null;
  fields: EntryFieldValue[];
};

type DraftDetail = {
  revisionId: string;
  revisionNumber: number;
  createdAt: string;
  publishedAt: string | null;
  fields: EntryFieldValue[];
};

type EntryRevisionSummary = {
  id: string;
  revisionNumber: number;
  status: "draft" | "published" | "archived" | string;
  createdAt: string;
  publishedAt: string | null;
  hasContent: boolean;
};

type EntryFormHandle = {
  triggerAction: (action: "draft" | "publish") => void;
  resetDirty: () => void;
};

type BackReferenceDialogMode = "inspect" | "delete";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** Add a non-empty entry ID to the list while preserving first-seen order. */
const addUniqueEntryId = (target: string[], value: unknown) => {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (trimmed.length === 0 || target.includes(trimmed)) return;
  target.push(trimmed);
};

/** Parse JSON strings while leaving malformed values untouched. */
const parseJsonValue = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

/** Return the TipTap document from the rich text field envelope. */
const unwrapRichTextDocument = (value: unknown): unknown => {
  const root = typeof value === "string" ? parseJsonValue(value) : value;
  return isRecord(root) && root.type === "rich_text" && "value" in root ? root.value : root;
};

/** Collect entryReference IDs from a TipTap rich text document. */
const collectRichTextEntryReferenceIds = (value: unknown, target: string[]) => {
  if (Array.isArray(value)) {
    value.forEach((item) => collectRichTextEntryReferenceIds(item, target));
    return;
  }
  if (!isRecord(value)) return;

  if (value.type === "entryReference" && isRecord(value.attrs)) {
    addUniqueEntryId(target, value.attrs.entryId);
  }
  if (Array.isArray(value.content)) {
    collectRichTextEntryReferenceIds(value.content, target);
  }
};

/** Collect relation entry IDs from the saved relation field shape. */
const collectRelationEntryIds = (value: unknown, target: string[]) => {
  if (Array.isArray(value)) {
    value.forEach((item) => addUniqueEntryId(target, item));
    return;
  }
  if (!isRecord(value) || !Array.isArray(value.entryIds)) return;
  value.entryIds.forEach((item) => addUniqueEntryId(target, item));
};

/** Return the values that will be published for the current locale scope. */
const getPublishFieldValues = (field: ModelField, values: Record<string, unknown>, localeCodes: readonly string[]): unknown[] => {
  const value = values[field.name];
  if (!field.hasLocales) return [value];
  const localizedValues = isRecord(value) ? value : {};
  return localeCodes.map((code) => localizedValues[code]);
};

/** Collect relation and rich text entry IDs from values targeted by the publish action. */
const collectPublishReferenceIds = (fields: readonly ModelField[], values: Record<string, unknown>, localeCodes: readonly string[]): string[] => {
  const result: string[] = [];
  for (const field of fields) {
    if (field.type !== "relation" && field.type !== "rich_text") continue;
    const fieldValues = getPublishFieldValues(field, values, localeCodes);
    for (const value of fieldValues) {
      if (field.type === "relation") {
        collectRelationEntryIds(value, result);
      } else {
        collectRichTextEntryReferenceIds(unwrapRichTextDocument(value), result);
      }
    }
  }
  return result;
};

function toEntryDetail(input: unknown, fallbackModelId: string): EntryDetail {
  const record = isRecord(input) ? input : {};
  const status = normalizeEntryStatus(record.status);
  const fieldsRaw = Array.isArray(record.fields) ? record.fields : [];
  const updatedByNameRaw = record.updatedByName;
  const updatedByName = typeof updatedByNameRaw === "string" && updatedByNameRaw.trim().length > 0 ? updatedByNameRaw : null;
  const publishedRevisionRaw = (record as Record<string, unknown>).publishedRevisionId;
  const publishedRevisionId = typeof publishedRevisionRaw === "string" && publishedRevisionRaw.trim().length > 0 ? publishedRevisionRaw : null;

  return {
    id: typeof record.id === "string" ? record.id : String(record.id ?? ""),
    modelId: typeof record.modelId === "string" ? record.modelId : fallbackModelId,
    status,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : "",
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : "",
    updatedBy: typeof record.updatedBy === "string" ? record.updatedBy : "",
    updatedByName,
    publishedAt: typeof record.publishedAt === "string" ? record.publishedAt : null,
    publishedRevisionId,
    fields: fieldsRaw.map((field) => toEntryFieldValue(field, { defaultLocale: DEFAULT_CONTENT_LOCALE })),
  } satisfies EntryDetail;
}

function toReferencedEntryIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const deduped: string[] = [];
  for (const value of input) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length === 0 || deduped.includes(trimmed)) continue;
    deduped.push(trimmed);
  }
  return deduped;
}

function toDraftDetail(input: unknown, entryId: string): DraftDetail | null {
  if (!isRecord(input)) return null;
  const record = input as Record<string, unknown>;
  const fieldsRaw = Array.isArray(record.fields) ? record.fields : [];
  const fields: EntryFieldValue[] = fieldsRaw.map((field) => toEntryFieldValue(field, { defaultLocale: DEFAULT_CONTENT_LOCALE }));

  const revisionIdRaw = record.revisionId;
  const revisionId = typeof revisionIdRaw === "string" && revisionIdRaw.trim().length > 0 ? revisionIdRaw : `${entryId}-draft`;

  return {
    revisionId,
    revisionNumber: Number.isFinite(Number(record.revisionNumber)) ? Number(record.revisionNumber) : 0,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : "",
    publishedAt: typeof record.publishedAt === "string" ? record.publishedAt : null,
    fields,
  } satisfies DraftDetail;
}

function debugLog(...args: unknown[]) {
  if (import.meta.env.DEV) {
    console.log(...args);
  }
}

/**
 * Encapsulate EntryEditPage state, data loading, mutations, and guards.
 */
export function useEntryEditPage(props: EntryEditPageProps) {
  const router = useRouter();
  const referenceSession = useReferenceSession();
  const { t } = useI18n();
  const confirmation = useConfirm();
  const toast = useToast();
  const authStore = useAuthStore();

  const modelId = props.modelId;
  const entryId = props.entryId;
  const resolveUrl = (path: string) => (typeof router.resolve === "function" ? router.resolve(path).href : path);

  const model = ref<ModelDetail | null>(null);
  const entry = ref<EntryDetail | null>(null);
  const draftFormValues = ref<Record<string, unknown>>({ status: "draft" });
  const publishedFormValues = ref<Record<string, unknown>>({
    status: "draft",
  });
  const formKey = ref(0);
  const loading = ref(true);
  const formSubmitting = ref(false);
  const errorMessage = ref<string | null>(null);
  const draftRevision = ref<DraftDetail | null>(null);
  const savingDraft = ref(false);
  const publishingEntry = ref(false);
  const deletingEntry = ref(false);
  const activeTab = ref<"published" | "draft">("draft");
  const localeFilter = ref<string>("all");
  const locales = ref<LocaleItem[]>([]);
  const draftFormRef = ref<EntryFormHandle | null>(null);
  const formDirty = ref(false);
  const backRefRelations = ref<EntryBackReference[]>([]);
  const backRefRichText = ref<EntryBackReference[]>([]);
  const backRefDialogVisible = ref(false);
  const backRefLoading = ref(false);
  const backRefDialogMode = ref<BackReferenceDialogMode>("inspect");
  const revisions = ref<EntryRevisionSummary[]>([]);
  const revisionsLoading = ref(false);
  const restoringRevision = ref(false);
  const selectedRevisionId = ref<string | null>(null);
  const historyDialogVisible = ref(false);
  let removeRouteGuard: (() => void) | null = null;

  const referenceTableRows = 10;
  const referenceRowsPerPageOptions = [5, 10, 20, 50];
  const hasBackReferences = computed(() => backRefRelations.value.length > 0 || backRefRichText.value.length > 0);

  const defaultLocaleCode = computed(() => resolveDefaultLocaleCode(locales.value, DEFAULT_CONTENT_LOCALE));
  const availableLocaleCodes = computed(() => {
    const codes = locales.value.map((item) => item.code);
    if (!codes.includes(defaultLocaleCode.value)) {
      codes.unshift(defaultLocaleCode.value);
    }
    return Array.from(new Set(codes));
  });
  const fetchRevisions = async () => {
    if (!entry.value) return;
    revisionsLoading.value = true;
    try {
      if (!authStore.accessToken) {
        await authStore.refresh().catch(() => undefined);
      }

      const res = await authorizedFetch(authStore, `/api/admin/models/${encodeResourceId(modelId)}/entries/${encodeResourceId(entryId)}/revisions`);
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const json = await res.json();
      const itemsRaw = Array.isArray((json as Record<string, unknown>).items) ? ((json as Record<string, unknown>).items as unknown[]) : [];
      const parsed: EntryRevisionSummary[] = itemsRaw
        .map((item) => {
          const record = isRecord(item) ? item : {};
          const id = typeof record.id === "string" ? record.id : "";
          if (!id) return null;
          return {
            id,
            revisionNumber: Number.isFinite(Number(record.revisionNumber)) ? Number(record.revisionNumber) : 0,
            status: typeof record.status === "string" ? record.status : "draft",
            createdAt: typeof record.createdAt === "string" ? record.createdAt : "",
            publishedAt: typeof record.publishedAt === "string" ? record.publishedAt : null,
            hasContent: Boolean((record as Record<string, unknown>).hasContent),
          } satisfies EntryRevisionSummary;
        })
        .filter((item): item is EntryRevisionSummary => item !== null);

      revisions.value = parsed;
      const currentId = draftRevision.value?.revisionId ?? entry.value?.publishedRevisionId ?? null;
      selectedRevisionId.value = currentId ?? parsed[0]?.id ?? null;
    } catch (error) {
      console.error("Failed to fetch revisions", error);
    } finally {
      revisionsLoading.value = false;
    }
  };

  const openHistoryDialog = async () => {
    historyDialogVisible.value = true;
    if (revisions.value.length === 0 && !revisionsLoading.value) {
      await fetchRevisions();
    }
  };

  const fetchEntry = async () => {
    loading.value = true;
    errorMessage.value = null;
    try {
      if (!authStore.accessToken) {
        await authStore.refresh().catch(() => undefined);
      }

      const previousLocaleFilter = localeFilter.value;

      const [modelRes, fieldsRes, entryRes, localesRes] = await Promise.all([
        authorizedFetch(authStore, `/api/admin/models/${encodeResourceId(modelId)}`),
        authorizedFetch(authStore, `/api/admin/models/${encodeResourceId(modelId)}/fields`),
        authorizedFetch(authStore, `/api/admin/models/${encodeResourceId(modelId)}/entries/${encodeResourceId(entryId)}`),
        authorizedFetch(authStore, "/api/admin/locales"),
      ]);

      if (!modelRes.ok || !fieldsRes.ok || !entryRes.ok) {
        const failing = !modelRes.ok ? modelRes : !fieldsRes.ok ? fieldsRes : entryRes;
        throw new Error(await failing.text());
      }

      const modelJson = await modelRes.json();
      const fieldsJson = await fieldsRes.json();
      const entryJson = await entryRes.json();
      const localesJson = localesRes.ok ? await localesRes.json().catch(() => ({})) : {};

      const modelItem = isRecord(modelJson) ? (modelJson as Record<string, unknown>).item : null;
      const entryItem = isRecord(entryJson) ? (entryJson as Record<string, unknown>).item : null;
      const draftItem = isRecord(entryJson) ? (entryJson as Record<string, unknown>).draft : null;
      const localeItemsRaw = Array.isArray((localesJson as Record<string, unknown>).items) ? ((localesJson as Record<string, unknown>).items as unknown[]) : [];
      const parsedLocales = localeItemsRaw.map((item) => toLocaleItem(item)).filter((item): item is LocaleItem => item !== null);

      if (!modelItem || !entryItem) {
        throw new Error("Invalid entry payload");
      }

      const parsedFields: ModelField[] = Array.isArray(fieldsJson) ? sortModelFieldsByPosition(fieldsJson.map((field) => toModelField(field))) : [];

      const detail: ModelDetail = {
        id: typeof (modelItem as Record<string, unknown>).id === "string" ? ((modelItem as Record<string, unknown>).id as string) : modelId,
        name: (() => {
          const nameRaw = (modelItem as Record<string, unknown>).name;
          return typeof nameRaw === "string" && nameRaw.trim().length > 0 ? nameRaw : modelId;
        })(),
        description: (() => {
          const descRaw = (modelItem as Record<string, unknown>).description;
          return typeof descRaw === "string" && descRaw.trim().length > 0 ? descRaw : undefined;
        })(),
        fields: parsedFields,
      };

      const entryDetail = toEntryDetail(entryItem, modelId);
      const draftDetail = toDraftDetail(draftItem, entryId);
      const referencedEntryIds = toReferencedEntryIds((entryJson as Record<string, unknown>).referencedEntryIds);

      if (referencedEntryIds.length > 0) {
        try {
          await preloadEntryReferences(referencedEntryIds);
        } catch (error) {
          console.error("Failed to preload entry references", error);
        }
      }

      const allLocaleCodes = resolveAvailableLocaleCodes(parsedLocales, [], resolveDefaultLocaleCode(parsedLocales, DEFAULT_CONTENT_LOCALE));
      const defaultLocale = resolveDefaultLocaleCode(parsedLocales, allLocaleCodes[0] ?? DEFAULT_CONTENT_LOCALE);

      locales.value = allLocaleCodes.map((code) => ({
        code,
        isDefault: parsedLocales.some((item) => item.code === code && item.isDefault) || code === defaultLocale,
      }));

      model.value = detail;
      entry.value = entryDetail;
      draftRevision.value = draftDetail;
      publishedFormValues.value = buildLocalizedEntryInitialValues(detail.fields, entryDetail.fields, {
        localeCodes: allLocaleCodes,
        defaultLocale,
        status: entryDetail.status,
      });
      draftFormValues.value = buildLocalizedEntryInitialValues(detail.fields, draftDetail?.fields ?? entryDetail.fields, {
        localeCodes: allLocaleCodes,
        defaultLocale,
        status: entryDetail.status,
      });
      formKey.value += 1;
      activeTab.value = draftDetail ? "draft" : "published";
      localeFilter.value = previousLocaleFilter === "all" || allLocaleCodes.includes(previousLocaleFilter) ? previousLocaleFilter : "all";

      if (referenceSession) void fetchEntryReferences([entryId]).catch(() => undefined);
      void fetchRevisions();
    } catch (error) {
      console.error("Failed to fetch entry:", error);
      errorMessage.value = t("contents.edit.error_fetch_message");
      toast.add({
        severity: "error",
        summary: t("contents.edit.error_fetch_title"),
        detail: t("contents.edit.error_fetch_message"),
        life: 4000,
      });
      model.value = null;
      entry.value = null;
      draftRevision.value = null;
      draftFormValues.value = { status: "draft" };
      publishedFormValues.value = { status: "draft" };
      locales.value = [];
      formKey.value += 1;
      activeTab.value = "published";
      localeFilter.value = "all";
    } finally {
      loading.value = false;
    }
  };

  const buildFieldsPayload = (values: Record<string, unknown>) => {
    if (!model.value)
      return [] as Array<{
        fieldId: string;
        locale: string;
        value: unknown;
      }>;

    const targetLocales = localeFilter.value === "all" ? availableLocaleCodes.value : [localeFilter.value];

    return buildLocalizedEntryFieldValues(model.value.fields, values, {
      localeCodes: targetLocales,
      defaultLocale: defaultLocaleCode.value,
    }).map(({ fieldId, locale, value }) => ({
      fieldId,
      locale,
      value,
    }));
  };

  /** Clear the unsaved-change guard after a successful draft form mutation. */
  const clearDraftDirtyState = () => {
    draftFormRef.value?.resetDirty();
    formDirty.value = false;
  };

  const saveDraft = async (values: Record<string, unknown>) => {
    if (!model.value) return;
    formSubmitting.value = true;
    savingDraft.value = true;
    try {
      debugLog("[EntryEditPage] saveDraft:start", { modelId, entryId, values });
      if (!authStore.accessToken) {
        await authStore.refresh().catch(() => undefined);
      }

      const res = await authorizedFetch(authStore, `/api/admin/models/${encodeResourceId(modelId)}/entries/${encodeResourceId(entryId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "draft",
          fields: buildFieldsPayload(values),
        }),
      });

      if (!res.ok) {
        const bodyText = await res.text();
        let detail = bodyText || res.statusText;
        try {
          const parsed = JSON.parse(bodyText);
          const error = parsed?.error;
          if (error?.code === "UNIQUE_FIELD_CONFLICT") {
            const fieldName = model.value?.fields.find((field) => field.id === error.fieldId)?.name ?? error.fieldId ?? t("contents.entries.unknown_field");
            const localeLabel = error.locale ?? defaultLocaleCode.value;
            detail = t("contents.entries.unique_conflict", {
              field: fieldName,
              locale: localeLabel,
            });
          }
        } catch {
          // keep fallback detail
        }
        throw new Error(detail);
      }

      clearDraftDirtyState();

      toast.add({
        severity: "success",
        summary: t("contents.edit.draft_save_success_title"),
        detail: t("contents.edit.draft_save_success_message"),
        life: 4000,
      });

      debugLog("[EntryEditPage] saveDraft:success");
      await fetchEntry();
    } catch (error) {
      console.error("Failed to save draft:", error);
      const detail = error instanceof Error && error.message.trim().length > 0 ? error.message : t("contents.edit.draft_save_error_message");
      toast.add({
        severity: "error",
        summary: t("contents.edit.error_update_title"),
        detail,
        life: 4000,
      });
    } finally {
      savingDraft.value = false;
      formSubmitting.value = false;
    }
  };

  const handleDraft = async (values: Record<string, unknown>) => {
    debugLog("[EntryEditPage] handleDraft", { values });
    await saveDraft(values);
  };

  /** Return true when the publish target values reference at least one draft entry. */
  const hasDraftPublishReferences = async (values: Record<string, unknown>): Promise<boolean> => {
    if (!model.value) return false;
    const localeCodes = localeFilter.value === "all" ? availableLocaleCodes.value : [localeFilter.value];
    const entryIds = collectPublishReferenceIds(model.value.fields, values, localeCodes);
    if (entryIds.length === 0) return false;

    try {
      const references = await fetchEntryReferences(entryIds);
      return references.some((reference) => reference.status.toLowerCase() === "draft");
    } catch (error) {
      console.warn("[EntryEditPage] failed to resolve publish references", error);
      return false;
    }
  };

  const publishEntry = async (values: Record<string, unknown>) => {
    if (!model.value) return;
    formSubmitting.value = true;
    publishingEntry.value = true;
    try {
      if (!authStore.accessToken) {
        await authStore.refresh().catch(() => undefined);
      }

      const res = await authorizedFetch(authStore, `/api/admin/models/${encodeResourceId(modelId)}/entries/${encodeResourceId(entryId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "published",
          fields: buildFieldsPayload(values),
        }),
      });

      if (!res.ok) {
        const message = await res.text();
        throw new Error(message || res.statusText);
      }

      clearDraftDirtyState();

      toast.add({
        severity: "success",
        summary: t("contents.edit.publish_success_title"),
        detail: t("contents.edit.publish_success_message"),
        life: 4000,
      });

      await fetchEntry();
    } catch (error) {
      console.error("Failed to publish entry:", error);
      const detail = error instanceof Error && error.message.trim().length > 0 ? error.message : t("contents.edit.error_update_message");
      toast.add({
        severity: "error",
        summary: t("contents.edit.error_update_title"),
        detail,
        life: 4000,
      });
    } finally {
      publishingEntry.value = false;
      formSubmitting.value = false;
    }
  };

  /** Ask for confirmation before publishing the validated draft values. */
  const confirmPublishEntry = async (values: Record<string, unknown>) => {
    if (!model.value) return;
    const message = (await hasDraftPublishReferences(values))
      ? `${t("contents.edit.confirm_publish_message")}\n\n${t("contents.edit.confirm_publish_draft_reference_warning")}`
      : t("contents.edit.confirm_publish_message");

    confirmation.require({
      header: t("contents.edit.confirm_publish_title"),
      message,
      icon: "lucide:upload",
      acceptLabel: t("contents.edit.publish_button"),
      rejectLabel: t("common.cancel"),
      accept: () => {
        void publishEntry(values);
      },
    });
  };

  const handleSubmit = async (values: Record<string, unknown>) => {
    await handleDraft(values);
  };

  const performDelete = async (options: { detachReferences: boolean }) => {
    if (!entry.value) return;
    deletingEntry.value = true;
    try {
      if (!authStore.accessToken) {
        await authStore.refresh().catch(() => undefined);
      }
      const suffix = options.detachReferences ? "?detachReferences=true" : "";
      const res = await authorizedFetch(authStore, `/api/admin/models/${encodeResourceId(modelId)}/entries/${encodeResourceId(entryId)}${suffix}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const raw = await res.text();
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = null;
        }
        if (isRecord(parsed) && isRecord(parsed.error) && parsed.error.code === "ENTRY_REFERENCED") {
          await loadBackReferences({ throwOnError: false });
          backRefDialogMode.value = "delete";
          backRefDialogVisible.value = true;
          return;
        }
        const message = raw;
        throw new Error(message || res.statusText);
      }
      toast.add({
        severity: "success",
        summary: t("contents.edit.delete_success_title"),
        detail: t("contents.edit.delete_success_message"),
        life: 4000,
      });
      router.push(`/contents/${encodeResourceId(modelId)}`);
    } catch (error) {
      console.error("Failed to delete entry:", error);
      const detail = error instanceof Error && error.message.trim().length > 0 ? error.message : t("contents.edit.delete_error_message");
      toast.add({
        severity: "error",
        summary: t("contents.edit.error_update_title"),
        detail,
        life: 4000,
      });
    } finally {
      deletingEntry.value = false;
    }
  };

  const deleteEntry = async () => {
    if (!entry.value) return;
    deletingEntry.value = true;
    try {
      const result = await loadBackReferences({ throwOnError: true });
      if (result.relations.length > 0 || result.richText.length > 0) {
        backRefDialogMode.value = "delete";
        backRefDialogVisible.value = true;
        return;
      }
    } catch (error) {
      console.error("Failed to check entry references before delete:", error);
      toast.add({
        severity: "error",
        summary: t("contents.edit.error_update_title"),
        detail: t("contents.edit.delete_reference_check_error"),
        life: 4000,
      });
      return;
    } finally {
      deletingEntry.value = false;
    }

    confirmation.require({
      header: t("contents.edit.confirm_delete_title"),
      message: t("contents.edit.confirm_delete"),
      icon: "lucide:trash-2",
      acceptLabel: t("contents.edit.delete"),
      rejectLabel: t("common.cancel"),
      accept: () => {
        void performDelete({ detachReferences: false });
      },
    });
  };

  const confirmDeleteWithDetachedReferences = () => {
    confirmation.require({
      header: t("contents.edit.delete_detach_confirm_title"),
      message: t("contents.edit.delete_detach_confirm_message"),
      icon: "lucide:unlink",
      acceptLabel: t("contents.edit.delete_detach_button"),
      rejectLabel: t("common.cancel"),
      accept: () => {
        void performDelete({ detachReferences: true });
      },
    });
  };

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return "-";
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return "-";
    return formatJapaneseDateTime(date);
  };

  const formatRevisionDate = (dateString: string | null | undefined) => {
    if (!dateString) return "-";
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return "-";
    return formatJapaneseDateTime(date);
  };

  const normalizeRevisionStatus = (status: string): EntryStatus => {
    const lower = String(status ?? "").toLowerCase();
    if (lower === "published") return "published";
    if (lower === "archived") return "archived";
    return "draft";
  };

  const revisionStatusSeverity = (status: string) => {
    const normalized = normalizeRevisionStatus(status);
    switch (normalized) {
      case "published":
        return "success";
      case "archived":
        return "secondary";
      default:
        return "warning";
    }
  };

  const isCurrentRevision = (revision: EntryRevisionSummary) => {
    const currentId = draftRevision.value?.revisionId ?? entry.value?.publishedRevisionId ?? null;
    if (currentId) return revision.id === currentId;
    if (revisions.value.length === 0) return false;
    return revisions.value[0]?.id === revision.id;
  };

  const selectedRevision = computed(() => revisions.value.find((revision) => revision.id === selectedRevisionId.value) ?? null);
  const canRestoreSelectedRevision = computed(() => {
    const revision = selectedRevision.value;
    return Boolean(revision && revision.hasContent && !isCurrentRevision(revision) && !restoringRevision.value && !revisionsLoading.value);
  });

  /**
   * Restore the selected historical revision as a new draft revision.
   */
  const restoreSelectedRevision = async () => {
    const revision = selectedRevision.value;
    if (!revision || !canRestoreSelectedRevision.value) return;

    restoringRevision.value = true;
    try {
      if (!authStore.accessToken) {
        await authStore.refresh().catch(() => undefined);
      }

      const res = await authorizedFetch(
        authStore,
        `/api/admin/models/${encodeResourceId(modelId)}/entries/${encodeResourceId(entryId)}/revisions/${encodeResourceId(revision.id)}/restore`,
        {
          method: "POST",
        },
      );

      if (!res.ok) {
        const message = await res.text();
        throw new Error(message || res.statusText);
      }

      toast.add({
        severity: "success",
        summary: t("contents.edit.history_restore_success_title"),
        detail: t("contents.edit.history_restore_success_message"),
        life: 4000,
      });
      historyDialogVisible.value = false;
      formDirty.value = false;
      await fetchEntry();
      activeTab.value = "draft";
    } catch (error) {
      console.error("Failed to restore entry revision:", error);
      const detail = error instanceof Error && error.message.trim().length > 0 ? error.message : t("contents.edit.history_restore_error_message");
      toast.add({
        severity: "error",
        summary: t("contents.edit.error_update_title"),
        detail,
        life: 4000,
      });
    } finally {
      restoringRevision.value = false;
    }
  };
  const hasDraftChanges = computed(() => formDirty.value);
  const draftInitialValues = computed(() => draftFormValues.value);
  const localeSuffix = computed(() => (localeFilter.value === "all" ? "" : ` (${localeFilter.value})`));
  const saveDraftLabel = computed(() => `${t("contents.edit.save_draft_button")}${localeSuffix.value}`);
  const publishLabel = computed(() => `${t("contents.edit.publish_button")}${localeSuffix.value}`);
  const breadcrumbModel = computed(() => [
    { label: t("contents.edit.breadcrumb_root"), to: "/contents", url: resolveUrl("/contents") },
    {
      label: model.value?.name ?? "",
      to: `/contents/${encodeResourceId(modelId)}`,
      url: resolveUrl(`/contents/${encodeResourceId(modelId)}`),
    },
    { label: t("contents.edit.breadcrumb_edit") },
  ]);

  const triggerDraftAction = () => {
    draftFormRef.value?.triggerAction("draft");
  };

  const triggerPublishAction = () => {
    draftFormRef.value?.triggerAction("publish");
  };

  const confirmRestoreRevision = () => {
    const revision = selectedRevision.value;
    if (!revision || !canRestoreSelectedRevision.value) return;

    confirmation.require({
      header: t("contents.edit.history_restore_confirm_title"),
      message: t("contents.edit.history_restore_confirm_message", {
        revision: revision.revisionNumber,
      }),
      icon: "lucide:history",
      acceptLabel: t("contents.edit.history_restore_button"),
      rejectLabel: t("common.no"),
      accept: () => {
        void restoreSelectedRevision();
      },
    });
  };

  const loadBackReferences = async (options: { throwOnError?: boolean } = {}): Promise<EntryBackReferenceResult> => {
    if (!entry.value) return { relations: [], richText: [] };
    backRefLoading.value = true;
    try {
      const result: EntryBackReferenceResult = await fetchEntryBackReferences(entry.value.id);
      backRefRelations.value = result.relations;
      backRefRichText.value = result.richText;
      return result;
    } catch (error) {
      console.error("Failed to load back references", error);
      if (options.throwOnError) throw error;
      return { relations: backRefRelations.value, richText: backRefRichText.value };
    } finally {
      backRefLoading.value = false;
    }
  };

  const openBackReferences = () => {
    if (!entry.value) return;
    backRefDialogMode.value = "inspect";
    backRefDialogVisible.value = true;
    void loadBackReferences();
  };

  const navigateToReference = (refEntry: EntryBackReference) => {
    if (referenceSession) referenceSession.open({ ...refEntry, title: refEntry.displayTitle });
    else router.push(`/contents/${encodeResourceId(refEntry.modelId)}/${encodeResourceId(refEntry.entryId)}`);
    backRefDialogVisible.value = false;
  };

  const handleBeforeUnload = (event: BeforeUnloadEvent) => {
    if (referenceSession || !formDirty.value) return;
    event.preventDefault();
    event.returnValue = "";
  };

  const setupRouteLeaveGuard = () => {
    if (referenceSession || typeof router.beforeEach !== "function") return;
    removeRouteGuard = router.beforeEach((to, from, next) => {
      if (!formDirty.value) {
        next();
        return;
      }
      if (window.confirm(t("contents.edit.unsaved_confirm"))) {
        next();
      } else {
        next(false);
      }
    });
  };

  onMounted(() => {
    fetchEntry();
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

  return {
    t,
    model,
    entry,
    draftFormValues,
    publishedFormValues,
    formKey,
    loading,
    formSubmitting,
    errorMessage,
    draftRevision,
    savingDraft,
    publishingEntry,
    deletingEntry,
    activeTab,
    localeFilter,
    locales,
    draftFormRef,
    formDirty,
    defaultLocaleCode,
    backRefRelations,
    backRefRichText,
    backRefDialogVisible,
    backRefLoading,
    backRefDialogMode,
    hasBackReferences,
    referenceTableRows,
    referenceRowsPerPageOptions,
    revisions,
    revisionsLoading,
    restoringRevision,
    selectedRevisionId,
    historyDialogVisible,
    canRestoreSelectedRevision,
    hasDraftChanges,
    draftInitialValues,
    saveDraftLabel,
    publishLabel,
    breadcrumbModel,
    fetchRevisions,
    openHistoryDialog,
    confirmRestoreRevision,
    handleDraft,
    confirmPublishEntry,
    handleSubmit,
    deleteEntry,
    confirmDeleteWithDetachedReferences,
    formatDate,
    formatRevisionDate,
    normalizeRevisionStatus,
    revisionStatusSeverity,
    isCurrentRevision,
    triggerDraftAction,
    triggerPublishAction,
    openBackReferences,
    navigateToReference,
  };
}
