<script lang="ts" setup>
import { encodeResourceId } from "@/utils/resourceId";
import { computed, ref, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import EntryForm from "@/components/EntryForm.vue";
import PageSectionHeader from "@/components/PageSectionHeader.vue";
import { useAuthStore } from "@/stores/auth";
import { authorizedFetch } from "@/utils/http";
import { useToast } from "@/services/feedback";
import {
  buildLocalizedEntryFieldValues,
  buildLocalizedEntryInitialValues,
  DEFAULT_CONTENT_LOCALE,
  resolveAvailableLocaleCodes,
  resolveDefaultLocaleCode,
  sortModelFieldsByPosition,
  toLocaleItem,
  toModelField,
  type LocaleItem,
  type ModelField,
} from "@/modules/entries";

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const toast = useToast();
const authStore = useAuthStore();

const modelId = route.params.modelId as string;
const resolveUrl = (path: string) => (typeof router.resolve === "function" ? router.resolve(path).href : path);

type ModelDetail = {
  id: string;
  name: string;
  description?: string;
  fields: ModelField[];
};

const model = ref<ModelDetail | null>(null);
const locales = ref<LocaleItem[]>([]);
const defaultLocaleCode = computed(() => resolveDefaultLocaleCode(locales.value, DEFAULT_CONTENT_LOCALE));
const availableLocaleCodes = computed(() => resolveAvailableLocaleCodes(locales.value, [], defaultLocaleCode.value));
const initialValues = ref<Record<string, unknown>>(
  buildLocalizedEntryInitialValues([], [], {
    status: "draft",
    defaultLocale: DEFAULT_CONTENT_LOCALE,
    localeCodes: [DEFAULT_CONTENT_LOCALE],
  }),
);
const loading = ref(true);
const submitting = ref(false);

const breadcrumbModel = computed(() => [
  { label: t("contents.create.breadcrumb_root"), to: "/contents", url: resolveUrl("/contents") },
  { label: model.value?.name ?? "", to: `/contents/${encodeResourceId(modelId)}`, url: resolveUrl(`/contents/${encodeResourceId(modelId)}`) },
  { label: t("contents.create.breadcrumb_create") },
]);

const fetchModel = async () => {
  loading.value = true;
  try {
    if (!authStore.accessToken) {
      await authStore.refresh().catch(() => undefined);
    }

    const [modelRes, fieldsRes, localesRes] = await Promise.all([
      authorizedFetch(authStore, `/api/admin/models/${encodeResourceId(modelId)}`),
      authorizedFetch(authStore, `/api/admin/models/${encodeResourceId(modelId)}/fields`),
      authorizedFetch(authStore, "/api/admin/locales"),
    ]);
    if (!modelRes.ok || !fieldsRes.ok) {
      const failing = !modelRes.ok ? modelRes : fieldsRes;
      throw new Error(await failing.text());
    }
    const modelData = await modelRes.json();
    const modelItem = modelData?.item;
    const fieldsList = await fieldsRes.json();
    const localesJson = localesRes.ok ? await localesRes.json().catch(() => ({})) : {};
    const localeItemsRaw = Array.isArray((localesJson as Record<string, unknown>).items) ? ((localesJson as Record<string, unknown>).items as unknown[]) : [];
    const parsedLocales = localeItemsRaw.map((item) => toLocaleItem(item)).filter((item): item is LocaleItem => item !== null);

    const parsedFields: ModelField[] = Array.isArray(fieldsList) ? sortModelFieldsByPosition(fieldsList.map((field) => toModelField(field))) : [];

    model.value = {
      id: String(modelItem?.id ?? modelId),
      name: typeof modelItem?.name === "string" ? modelItem.name : modelId,
      description: typeof modelItem?.description === "string" && modelItem.description.trim().length > 0 ? modelItem.description : undefined,
      fields: parsedFields,
    };

    locales.value = parsedLocales;
    const defaultLocale = resolveDefaultLocaleCode(parsedLocales, DEFAULT_CONTENT_LOCALE);
    const localeCodes = resolveAvailableLocaleCodes(parsedLocales, [], defaultLocale);

    initialValues.value = buildLocalizedEntryInitialValues(parsedFields, [], {
      status: "draft",
      defaultLocale,
      localeCodes,
    });
  } catch (error) {
    console.error("Failed to fetch model:", error);
    toast.add({
      severity: "error",
      summary: t("contents.create.error_fetch_title"),
      detail: t("contents.create.error_fetch_message"),
      life: 4000,
    });
  } finally {
    loading.value = false;
  }
};

const handleSubmit = async (values: Record<string, unknown>) => {
  if (!model.value) return;
  submitting.value = true;
  try {
    if (!authStore.accessToken) {
      await authStore.refresh().catch(() => undefined);
    }

    const status = typeof values.status === "string" ? values.status : "draft";
    const fieldsPayload = buildLocalizedEntryFieldValues(model.value.fields, values, {
      localeCodes: availableLocaleCodes.value,
      defaultLocale: defaultLocaleCode.value,
    }).map(({ fieldId, locale, value }) => ({ fieldId, locale, value }));

    const res = await authorizedFetch(authStore, `/api/admin/models/${encodeResourceId(modelId)}/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status,
        fields: fieldsPayload,
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
          const localeLabel = error.locale ?? DEFAULT_CONTENT_LOCALE;
          detail = t("contents.entries.unique_conflict", { field: fieldName, locale: localeLabel });
        }
      } catch {
        // fall through with raw detail
      }
      throw new Error(detail);
    }

    toast.add({
      severity: "success",
      summary: t("contents.create.success_title"),
      detail: t("contents.create.success_message"),
      life: 4000,
    });
    router.push(`/contents/${encodeResourceId(modelId)}`);
  } catch (error) {
    console.error("Failed to create entry:", error);
    const detail = error instanceof Error && error.message.trim().length > 0 ? error.message : t("contents.create.error_create_message");
    toast.add({
      severity: "error",
      summary: t("contents.create.error_create_title"),
      detail,
      life: 4000,
    });
  } finally {
    submitting.value = false;
  }
};

const cancel = () => {
  router.back();
};

onMounted(() => {
  fetchModel();
});
</script>

<template>
  <div class="entry-create-page">
    <PageSectionHeader
      :title="model?.name ?? t('contents.create.placeholder_model')"
      title-icon="lucide:file-plus-2"
      :description="model?.description ?? null"
      :breadcrumb-model="breadcrumbModel"
    />

    <div v-if="loading" class="loading-state">
      <p>{{ t("contents.create.loading") }}</p>
    </div>

    <div v-else class="form-container">
      <EntryForm
        v-if="model"
        mode="create"
        :model="model"
        :initial-values="initialValues"
        :loading="submitting"
        :locales="locales"
        :default-locale="defaultLocaleCode"
        @submit="handleSubmit"
        @cancel="cancel"
      />
    </div>
  </div>
</template>

<style lang="scss" scoped>
.entry-create-page {
  padding: var(--space-24);

  .loading-state {
    text-align: center;
    padding: var(--space-32) 0;

    p {
      color: var(--surface-500);
    }
  }

  .form-container {
    max-width: 64rem;
  }
}
</style>
