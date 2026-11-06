<script lang="ts" setup>
import { encodeResourceId } from "@/utils/resourceId";
import { computed, defineAsyncComponent, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useAuthStore } from "@/stores/auth";
import { authorizedFetch } from "@/utils/http";
import {
  buildLocalizedEntryFieldValues,
  buildLocalizedEntryInitialValues,
  DEFAULT_CONTENT_LOCALE,
  resolveAvailableLocaleCodes,
  resolveDefaultLocaleCode,
  sortModelFieldsByPosition,
  toModelField,
  type LocaleItem,
  type ModelField,
} from "@/modules/entries";
import { Dialog } from "@/components/ui/element-plus";

const EntryForm = defineAsyncComponent(() => import("@/components/EntryForm.vue").then((module) => module.default));

type EntryCreateModel = {
  id: string;
  name: string;
  fields: ModelField[];
};

type RelationEntryCreatedPayload = {
  id: string;
  modelId: string;
  status: string;
  updatedAt: string | null;
};

type LocaleOption = {
  code: string;
  isDefault?: boolean;
};

const props = withDefaults(
  defineProps<{
    modelId: string | null;
    modelName?: string | null;
    locales?: LocaleOption[];
    defaultLocale?: string;
    localeFilter?: string;
  }>(),
  {
    modelName: null,
    locales: () => [],
    defaultLocale: DEFAULT_CONTENT_LOCALE,
    localeFilter: "all",
  },
);

const visible = defineModel<boolean>("visible", { default: false });

const emit = defineEmits<{
  created: [entry: RelationEntryCreatedPayload];
}>();

const { t } = useI18n();
const authStore = useAuthStore();

const model = ref<EntryCreateModel | null>(null);
const initialValues = ref<Record<string, unknown>>({ status: "draft" });
const loading = ref(false);
const submitting = ref(false);
const errorMessage = ref<string | null>(null);
const formLocaleFilter = ref("all");

const dialogHeader = computed(() => t("contents.fields.relation.create_dialog_title", { model: props.modelName ?? props.modelId ?? "" }));

const localeItems = computed<LocaleItem[]>(() => {
  const items = props.locales
    .map((item) => ({
      code: item.code.trim(),
      isDefault: Boolean(item.isDefault),
    }))
    .filter((item) => item.code.length > 0);
  if (items.length > 0) return items;
  return [{ code: props.defaultLocale.trim() || DEFAULT_CONTENT_LOCALE, isDefault: true }];
});

const defaultLocaleCode = computed(() => resolveDefaultLocaleCode(localeItems.value, props.defaultLocale.trim() || DEFAULT_CONTENT_LOCALE));

const availableLocaleCodes = computed(() => resolveAvailableLocaleCodes(localeItems.value, [], defaultLocaleCode.value));

const targetLocaleCodes = computed(() => {
  if (formLocaleFilter.value !== "all" && availableLocaleCodes.value.includes(formLocaleFilter.value)) {
    return [formLocaleFilter.value];
  }
  return availableLocaleCodes.value;
});

/** Returns a locale filter that is valid for the current configured locale set. */
const normalizeLocaleFilter = (value: string | undefined): string => {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (normalized.length > 0 && normalized !== "all" && availableLocaleCodes.value.includes(normalized)) {
    return normalized;
  }
  return "all";
};

let fetchToken = 0;

/** Ensures an access token is available before issuing Admin API requests. */
const ensureAuth = async (): Promise<void> => {
  if (!authStore.accessToken) {
    await authStore.refresh().catch(() => undefined);
  }
};

/** Converts an Admin API model response and field list into an entry form model. */
const buildEntryCreateModel = (modelItem: unknown, fieldsList: unknown, fallbackModelId: string): EntryCreateModel => {
  const item = modelItem && typeof modelItem === "object" ? (modelItem as Record<string, unknown>) : {};
  const fields = Array.isArray(fieldsList) ? sortModelFieldsByPosition(fieldsList.map((field) => toModelField(field))) : [];
  return {
    id: String(item.id ?? fallbackModelId),
    name: typeof item.name === "string" && item.name.trim().length > 0 ? item.name : (props.modelName ?? fallbackModelId),
    fields,
  };
};

/** Loads the target model definition required to render the nested entry form. */
const fetchModelDefinition = async (): Promise<void> => {
  const targetModelId = props.modelId;
  if (!targetModelId) {
    model.value = null;
    initialValues.value = { status: "draft" };
    errorMessage.value = t("contents.fields.relation.create_select_model");
    return;
  }

  const token = ++fetchToken;
  loading.value = true;
  errorMessage.value = null;
  try {
    await ensureAuth();
    const [modelRes, fieldsRes] = await Promise.all([
      authorizedFetch(authStore, `/api/admin/models/${encodeResourceId(targetModelId)}`),
      authorizedFetch(authStore, `/api/admin/models/${encodeResourceId(targetModelId)}/fields`),
    ]);

    if (!modelRes.ok) throw new Error((await modelRes.text()) || modelRes.statusText);
    if (!fieldsRes.ok) throw new Error((await fieldsRes.text()) || fieldsRes.statusText);

    const modelData = await modelRes.json();
    const fieldsList = await fieldsRes.json();
    const nextModel = buildEntryCreateModel(modelData?.item, fieldsList, targetModelId);
    if (token !== fetchToken) return;

    model.value = nextModel;
    initialValues.value = buildLocalizedEntryInitialValues(nextModel.fields, [], {
      localeCodes: availableLocaleCodes.value,
      defaultLocale: defaultLocaleCode.value,
      status: "draft",
    });
  } catch (error) {
    console.error("Failed to load relation target model:", error);
    if (token === fetchToken) {
      model.value = null;
      initialValues.value = { status: "draft" };
      errorMessage.value = t("contents.fields.relation.create_model_error");
    }
  } finally {
    if (token === fetchToken) {
      loading.value = false;
    }
  }
};

/** Builds the Admin API create payload from the nested entry form values. */
const buildFieldsPayload = (values: Record<string, unknown>): Array<{ fieldId: string; locale: string; value: unknown }> => {
  if (!model.value) return [];
  return buildLocalizedEntryFieldValues(model.value.fields, values, {
    localeCodes: targetLocaleCodes.value,
    defaultLocale: defaultLocaleCode.value,
  }).map(({ fieldId, locale, value }) => ({ fieldId, locale, value }));
};

/** Returns the most helpful create error message from an Admin API response body. */
const resolveCreateErrorDetail = (bodyText: string): string => {
  if (!bodyText.trim()) return t("contents.fields.relation.create_error");
  try {
    const parsed = JSON.parse(bodyText);
    const error = parsed?.error;
    if (error?.code === "UNIQUE_FIELD_CONFLICT") {
      const fieldName = model.value?.fields.find((field) => field.id === error.fieldId)?.name ?? error.fieldId ?? t("contents.entries.unknown_field");
      const localeLabel = error.locale ?? defaultLocaleCode.value;
      return t("contents.entries.unique_conflict", { field: fieldName, locale: localeLabel });
    }
  } catch {
    // Keep the raw response body below.
  }
  return bodyText;
};

/** Creates the related entry and notifies the parent relation selector. */
const submitEntry = async (values: Record<string, unknown>): Promise<void> => {
  if (!model.value || !props.modelId) return;
  submitting.value = true;
  errorMessage.value = null;
  try {
    await ensureAuth();
    const status = typeof values.status === "string" ? values.status : "draft";
    const res = await authorizedFetch(authStore, `/api/admin/models/${encodeResourceId(props.modelId)}/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status,
        fields: buildFieldsPayload(values),
      }),
    });

    if (!res.ok) {
      throw new Error(resolveCreateErrorDetail(await res.text()));
    }

    const data = await res.json();
    const item = data?.item && typeof data.item === "object" ? (data.item as Record<string, unknown>) : {};
    const id = typeof item.id === "string" && item.id.trim().length > 0 ? item.id : "";
    if (!id) throw new Error(t("contents.fields.relation.create_error"));

    emit("created", {
      id,
      modelId: typeof item.modelId === "string" && item.modelId.trim().length > 0 ? item.modelId : props.modelId,
      status: typeof item.status === "string" && item.status.trim().length > 0 ? item.status : status,
      updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : null,
    });
    visible.value = false;
  } catch (error) {
    console.error("Failed to create relation target entry:", error);
    errorMessage.value = error instanceof Error && error.message.trim().length > 0 ? error.message : t("contents.fields.relation.create_error");
  } finally {
    submitting.value = false;
  }
};

/** Closes the dialog and clears transient submit errors. */
const closeDialog = (): void => {
  visible.value = false;
  errorMessage.value = null;
};

watch(
  [visible, () => props.modelId],
  ([isVisible]) => {
    if (!isVisible) return;
    formLocaleFilter.value = normalizeLocaleFilter(props.localeFilter);
    void fetchModelDefinition();
  },
  { immediate: true },
);

watch(
  [() => props.localeFilter, availableLocaleCodes],
  () => {
    if (!visible.value) return;
    formLocaleFilter.value = normalizeLocaleFilter(props.localeFilter);
  },
  { deep: true },
);
</script>

<template>
  <Dialog
    v-model:visible="visible"
    modal
    :header="dialogHeader"
    :draggable="false"
    class="relation-entry-create-dialog"
    :style="{ width: '48rem' }"
    :breakpoints="{ '1200px': '44rem', '768px': '90vw', '576px': '95vw' }"
    @hide="closeDialog"
  >
    <div class="relation-entry-create-dialog__body">
      <p v-if="loading" class="dialog-state">{{ t("common.loading") }}</p>
      <p v-else-if="errorMessage && !model" class="dialog-error">{{ errorMessage }}</p>
      <template v-else-if="model">
        <p v-if="errorMessage" class="dialog-error">{{ errorMessage }}</p>
        <EntryForm
          mode="create"
          :model="model"
          :initial-values="initialValues"
          :loading="submitting"
          :locales="localeItems"
          :default-locale="defaultLocaleCode"
          v-model:locale-filter="formLocaleFilter"
          @submit="submitEntry"
          @cancel="closeDialog"
        />
      </template>
    </div>
  </Dialog>
</template>

<style lang="scss" scoped>
.relation-entry-create-dialog {
  :deep(.el-dialog__body) {
    padding-top: var(--space-16);
  }

  &__body {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
  }
}

.dialog-state {
  color: var(--surface-600);
  font-size: var(--font-14);
}

.dialog-error {
  color: var(--red-500);
  font-size: var(--font-13);
}
</style>
