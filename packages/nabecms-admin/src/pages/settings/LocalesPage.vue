<script lang="ts" setup>
import { encodeResourceId } from "@/utils/resourceId";
import { ref, onMounted, computed } from "vue";
import { useI18n } from "vue-i18n";
import { Form, Field, type GenericObject, type SubmissionHandler } from "vee-validate";
import { useRouter } from "vue-router";
import { useToast } from "@/services/feedback";
import { useAuthStore } from "@/stores/auth";
import { authorizedFetch } from "@/utils/http";
import PageSectionHeader from "@/components/PageSectionHeader.vue";
import { formatJapaneseDateTime } from "@/utils/dateTime";

import Button from "@/components/NabeButton.vue";
import { Card } from "@/components/ui/element-plus";
import { ElTable } from "element-plus";
import { ElTableColumn } from "element-plus";
import { InputText } from "@/components/ui/element-plus";
import { Checkbox } from "@/components/ui/element-plus";
import { Dialog } from "@/components/ui/element-plus";
import { Tag } from "@/components/ui/element-plus";
const { t } = useI18n();
const toast = useToast();
const authStore = useAuthStore();
const router = useRouter();
const resolveUrl = (path: string) => (typeof router.resolve === "function" ? router.resolve(path).href : path);

type LocaleItem = {
  code: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

const locales = ref<LocaleItem[]>([]);

const showCreateDialog = ref(false);

type LocaleForm = { code: string; isDefault: boolean };
const initialValues = ref<LocaleForm>({ code: "", isDefault: false });

const commonLocales = [
  { code: "ja-JP", name: "日本語 (日本)" },
  { code: "en-US", name: "English (United States)" },
  { code: "en-GB", name: "English (United Kingdom)" },
  { code: "ko-KR", name: "한국어 (대한민국)" },
  { code: "zh-CN", name: "简体中文 (中国)" },
  { code: "zh-TW", name: "繁體中文 (台灣)" },
  { code: "fr-FR", name: "Français (France)" },
  { code: "de-DE", name: "Deutsch (Deutschland)" },
  { code: "es-ES", name: "Español (España)" },
  { code: "it-IT", name: "Italiano (Italia)" },
];

const loading = ref(false);
const submitting = ref(false);

const showToast = (severity: "success" | "error", messageKey: string) => {
  toast.add({ severity, summary: t("settings.locales.title"), detail: t(messageKey), life: 4000 });
};

const normalizeLocaleCode = (code: string) => code.trim().replace(/_/gu, "-");

const fetchLocales = async () => {
  loading.value = true;
  try {
    const res = await authorizedFetch(authStore, "/api/admin/locales");
    if (!res.ok) {
      throw new Error(`Failed to fetch locales: ${res.status}`);
    }
    const data = await res.json();
    const items: LocaleItem[] = Array.isArray(data?.items)
      ? (data.items as LocaleItem[]).map((item) => ({
          code: item.code,
          isDefault: item.isDefault,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        }))
      : [];
    locales.value = items;
  } catch (error) {
    console.error("Failed to fetch locales:", error);
    showToast("error", "settings.locales.toast_fetch_error");
  } finally {
    loading.value = false;
  }
};

function toLocaleForm(values: GenericObject): LocaleForm {
  if (typeof values.code !== "string") {
    throw new Error("Invalid locale form payload: missing code");
  }
  const normalizedCode = normalizeLocaleCode(values.code);
  if (normalizedCode.length === 0) {
    throw new Error("Invalid locale code");
  }
  const isDefault = typeof values.isDefault === "boolean" ? values.isDefault : false;
  return { code: normalizedCode, isDefault };
}

const handleCreateLocale: SubmissionHandler = async (values) => {
  let payload: LocaleForm;
  try {
    payload = toLocaleForm(values);
  } catch (error) {
    console.error("Invalid locale form:", error);
    showToast("error", "settings.locales.toast_create_error");
    return;
  }

  submitting.value = true;
  try {
    const res = await authorizedFetch(authStore, "/api/admin/locales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.status === 409) {
      showToast("error", "settings.locales.toast_create_conflict");
      return;
    }

    if (!res.ok) {
      throw new Error(`Failed to create locale: ${res.status}`);
    }

    await res.json();
    showToast("success", "settings.locales.toast_create_success");
    initialValues.value = { code: "", isDefault: false };
    showCreateDialog.value = false;
    await fetchLocales();
  } catch (error) {
    console.error("Failed to create locale:", error);
    showToast("error", "settings.locales.toast_create_error");
  } finally {
    submitting.value = false;
  }
};

const setAsDefault = async (localeCode: string) => {
  try {
    const normalized = normalizeLocaleCode(localeCode);
    const res = await authorizedFetch(authStore, `/api/admin/locales/${encodeResourceId(normalized)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isDefault: true }),
    });

    if (res.status === 404) {
      showToast("error", "settings.locales.toast_not_found");
      return;
    }

    if (!res.ok) {
      throw new Error(`Failed to set default locale: ${res.status}`);
    }

    await res.json();
    await fetchLocales();
    showToast("success", "settings.locales.toast_set_default_success");
  } catch (error) {
    console.error("Failed to update locale:", error);
    showToast("error", "settings.locales.toast_set_default_error");
  }
};

const deleteLocale = async (localeCode: string) => {
  const localeItem = locales.value.find((l) => l.code === localeCode);
  if (localeItem?.isDefault) {
    showToast("error", "settings.locales.cannot_delete_default");
    return;
  }

  if (!confirm(`${t("settings.locales.delete")}?`)) {
    return;
  }

  try {
    const normalized = normalizeLocaleCode(localeCode);
    const res = await authorizedFetch(authStore, `/api/admin/locales/${encodeResourceId(normalized)}`, {
      method: "DELETE",
    });

    if (res.status === 404) {
      showToast("error", "settings.locales.toast_not_found");
      return;
    }

    if (res.status === 400) {
      showToast("error", "settings.locales.cannot_delete_default");
      return;
    }

    if (!res.ok && res.status !== 204) {
      throw new Error(`Failed to delete locale: ${res.status}`);
    }

    await fetchLocales();
    showToast("success", "settings.locales.toast_delete_success");
  } catch (error) {
    console.error("Failed to delete locale:", error);
    showToast("error", "settings.locales.toast_delete_error");
  }
};

const formatDate = (dateString: string) => {
  return formatJapaneseDateTime(dateString);
};

const getLocaleName = (code: string) => {
  const locale = commonLocales.find((l) => l.code === code);
  return locale ? locale.name : code;
};

const breadcrumbModel = ref([{ label: t("settings.title"), to: "/settings", url: resolveUrl("/settings") }, { label: t("settings.locales.title") }]);

const localeSuggestions = computed(() =>
  commonLocales
    .filter((item) => !locales.value.some((locale) => locale.code === item.code))
    .map((item) => ({ code: item.code, display: `${item.code} - ${item.name}` })),
);

const closeCreateDialog = () => {
  showCreateDialog.value = false;
  initialValues.value = { code: "", isDefault: false };
  submitting.value = false;
};

onMounted(() => {
  fetchLocales();
});
</script>

<template>
  <div class="locales-page">
    <PageSectionHeader
      :title="t('settings.locales.title')"
      :description="t('settings.locales.description')"
      :hint="t('settings.locales.note_admin_lang')"
      :breadcrumb-model="breadcrumbModel"
    >
      <template #actions>
        <Button @click="showCreateDialog = true" severity="primary" icon="lucide:plus" :label="t('settings.locales.new')" />
      </template>
    </PageSectionHeader>

    <div v-if="loading" class="loading-state">
      <p>{{ t("settings.locales.loading") }}</p>
    </div>

    <div v-else-if="locales.length === 0" class="empty-state">
      <p>{{ t("settings.locales.empty") }}</p>
    </div>

    <Card v-else class="locales-table">
      <template #content>
        <ElTable :data="locales" :stripe="true">
          <ElTableColumn prop="code" :label="t('settings.locales.table_locale')">
            <template #default="{ row: data }">
              <div>
                <div class="locale-code">{{ data.code }}</div>
                <div class="locale-name">{{ getLocaleName(data.code) }}</div>
              </div>
            </template>
          </ElTableColumn>

          <ElTableColumn prop="isDefault" :label="t('settings.locales.table_state')">
            <template #default="{ row: data }">
              <Tag
                :value="data.isDefault ? t('settings.locales.state_default') : t('settings.locales.state_active')"
                :severity="data.isDefault ? 'success' : 'secondary'"
              />
            </template>
          </ElTableColumn>

          <ElTableColumn prop="createdAt" :label="t('settings.locales.table_created')">
            <template #default="{ row: data }">
              {{ formatDate(data.createdAt) }}
            </template>
          </ElTableColumn>

          <ElTableColumn :label="t('settings.locales.actions')">
            <template #default="{ row: data }">
              <div class="actions">
                <Button
                  v-if="!data.isDefault"
                  @click="setAsDefault(data.code)"
                  severity="primary"
                  variant="text"
                  size="small"
                  :label="t('settings.locales.set_default')"
                />
                <Button
                  v-if="!data.isDefault"
                  @click="deleteLocale(data.code)"
                  severity="danger"
                  variant="text"
                  size="small"
                  :label="t('settings.locales.delete')"
                />
                <span v-if="data.isDefault" class="default-label">{{ t("settings.locales.default") }}</span>
              </div>
            </template>
          </ElTableColumn>
        </ElTable>
      </template>
    </Card>

    <!-- Create Locale Dialog -->
    <Dialog v-model:visible="showCreateDialog" modal :draggable="false" :header="t('settings.locales.dialog_create_title')" :style="{ width: '32rem' }">
      <Form :initial-values="initialValues" @submit="handleCreateLocale" class="create-form">
        <div class="field">
          <label for="code">{{ t("settings.locales.table_locale") }} *</label>
          <Field name="code" rules="required" v-slot="{ field, errors }">
            <InputText
              id="code"
              :modelValue="field.value"
              @update:modelValue="field.onChange"
              :placeholder="t('settings.locales.dialog_code_placeholder')"
              list="locale-codes"
            />
            <small class="form-error" v-if="errors[0]">{{ errors[0] }}</small>
          </Field>
          <datalist id="locale-codes">
            <option v-for="option in localeSuggestions" :key="option.code" :value="option.code">{{ option.display }}</option>
          </datalist>
        </div>

        <div class="checkbox-field">
          <Field name="isDefault" v-slot="{ field }">
            <Checkbox id="isDefault" :modelValue="field.value" @update:modelValue="field.onChange" :binary="true" />
          </Field>
          <label for="isDefault" class="checkbox-label"> {{ t("settings.locales.dialog_set_default") }} </label>
        </div>

        <div class="form-actions" style="display: flex; gap: var(--space-8); justify-content: flex-end; margin-top: var(--space-16)">
          <Button type="button" @click="closeCreateDialog" severity="secondary" icon="lucide:x" :label="t('settings.locales.cancel')" />
          <Button
            type="submit"
            :disabled="submitting"
            :loading="submitting"
            severity="primary"
            icon="lucide:check"
            :label="submitting ? t('settings.locales.creating') : t('settings.locales.create')"
          />
        </div>
      </Form>
    </Dialog>
  </div>
</template>

<style lang="scss" scoped>
.locales-page {
  padding: var(--space-24);

  .loading-state,
  .empty-state {
    text-align: center;
    padding: var(--space-32) 0;

    p {
      color: var(--surface-500);
      font-size: var(--font-14);
    }
  }

  .locales-table {
    .locale-code {
      font-weight: 500;
      color: var(--surface-900);
      margin-bottom: var(--space-4);
    }

    .locale-name {
      font-size: var(--font-14);
      color: var(--surface-500);
    }

    .actions {
      display: flex;
      gap: var(--space-8);
      align-items: center;

      .default-label {
        font-size: var(--font-14);
        color: var(--surface-400);
      }
    }
  }
}

.create-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-16);

  .field {
    label {
      display: block;
      font-weight: 500;
      color: var(--surface-700);
      margin-bottom: var(--space-8);
      font-size: var(--font-14);
    }
  }

  .checkbox-field {
    display: flex;
    align-items: center;
    gap: var(--space-8);

    .checkbox-label {
      font-size: var(--font-14);
      color: var(--surface-900);
    }
  }
}
</style>
