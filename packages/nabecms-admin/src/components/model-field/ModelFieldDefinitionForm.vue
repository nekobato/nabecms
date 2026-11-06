<script lang="ts" setup>
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Checkbox } from "@/components/ui/element-plus";
import { InputNumber } from "@/components/ui/element-plus";
import { InputText } from "@/components/ui/element-plus";
import { Select } from "@/components/ui/element-plus";
import { SelectButton } from "@/components/ui/element-plus";
import { Textarea } from "@/components/ui/element-plus";
import { MultiSelect } from "@/components/ui/element-plus";
import { useAuthStore } from "@/stores/auth";
import { authorizedFetch } from "@/utils/http";
import type { UseFieldDefinitionFormResult } from "./add-field/types";

const props = defineProps<{ api: UseFieldDefinitionFormResult }>();

const { t } = useI18n();
const authStore = useAuthStore();

const form = props.api.form;
const optionsState = props.api.optionsState;
const selectedFieldType = props.api.selectedFieldType;

const showVariantField = computed(() => props.api.showVariantField.value);
const variantRequired = computed(() => props.api.variantRequired.value);
const canUseVariantSelect = computed(() => props.api.canUseVariantSelect.value);
const variantOptions = computed(() => props.api.variantOptions.value);
const variantPlaceholder = computed(() => props.api.variantPlaceholder.value);
const listItemTypeOptions = computed(() => props.api.listItemTypeOptions.value);
const mediaKindOptions = computed(() => props.api.mediaKindOptions.value);

type ModelOption = { value: string; label: string };

const relationModelOptions = ref<ModelOption[]>([]);
const relationModelLoading = ref(false);
const relationModelError = ref<string | null>(null);

const relationModelsPlaceholder = computed(() => t("models.detail.add_field_dialog.allowed_models_select_placeholder"));

const uniqueOptionMap = (options: ModelOption[]) => new Map(options.map((option) => [option.value, option]));

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function toModelOption(input: unknown): ModelOption | null {
  if (!isRecord(input)) return null;
  const idRaw = input.id;
  const nameRaw = input.name;
  const id = typeof idRaw === "string" ? idRaw.trim() : String(idRaw ?? "").trim();
  if (!id) return null;
  const label = typeof nameRaw === "string" && nameRaw.trim().length > 0 ? nameRaw : id;
  return { value: id, label };
}

function ensureOptionsForSelection(selection: readonly string[]): void {
  if (!selection || selection.length === 0) return;
  const map = uniqueOptionMap(relationModelOptions.value);
  let mutated = false;
  selection.forEach((id) => {
    const trimmed = id.trim();
    if (!trimmed || map.has(trimmed)) return;
    map.set(trimmed, { value: trimmed, label: trimmed });
    mutated = true;
  });
  if (mutated) {
    relationModelOptions.value = Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }
}

const fetchRelationModels = async () => {
  relationModelLoading.value = true;
  relationModelError.value = null;
  try {
    if (!authStore.accessToken) {
      await authStore.refresh().catch(() => undefined);
    }
    const res = await authorizedFetch(authStore, "/api/admin/models");
    if (!res.ok) {
      const body = await res.text();
      throw new Error(body || `Request failed with status ${res.status}`);
    }
    const data = await res.json();
    const items: unknown[] = Array.isArray(data?.items) ? data.items : [];
    const map = new Map<string, ModelOption>();
    items.forEach((item) => {
      const option = toModelOption(item);
      if (option) {
        map.set(option.value, option);
      }
    });
    optionsState.relation.allowedModelIds.forEach((id) => {
      const trimmed = id.trim();
      if (!trimmed || map.has(trimmed)) return;
      map.set(trimmed, { value: trimmed, label: trimmed });
    });
    relationModelOptions.value = Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  } catch (error) {
    console.error("Failed to load relation models", error);
    relationModelError.value = t("models.detail.add_field_dialog.allowed_models_fetch_error");
  } finally {
    relationModelLoading.value = false;
  }
};

watch(
  () => [...optionsState.relation.allowedModelIds],
  (ids) => {
    ensureOptionsForSelection(ids);
  },
  { immediate: true },
);

onMounted(fetchRelationModels);

const optionsError = props.api.optionsError;
const fieldKeyError = props.api.fieldKeyError;

const handleFieldKeyInput = props.api.handleFieldKeyInput;

const showDefaultValueField = computed(() => {
  const type = selectedFieldType.value;
  if (!type) return false;
  return !["relation", "media", "rich_text"].includes(type);
});
const isUniqueDisabled = computed(() => selectedFieldType.value === "rich_text");

const isBooleanField = computed(() => selectedFieldType.value === "boolean");
const isNumberField = computed(() => selectedFieldType.value === "number");
const usesTextareaDefault = computed(() => {
  const type = selectedFieldType.value;
  return type === "json" || type === "custom";
});

const booleanDefaultOptions = computed(() => {
  return [
    { label: t("models.detail.add_field_dialog.boolean_default.true"), value: true },
    { label: t("models.detail.add_field_dialog.boolean_default.false"), value: false },
  ];
});

const booleanDefaultValue = computed<boolean | null>({
  get: () => (typeof form.defaultValue === "boolean" ? form.defaultValue : null),
  set: (value) => {
    form.defaultValue = value;
  },
});

const numberDefaultValue = computed<number | null>({
  get: () => (typeof form.defaultValue === "number" ? form.defaultValue : null),
  set: (value) => {
    form.defaultValue = typeof value === "number" ? value : null;
  },
});

const textDefaultValue = computed<string>({
  get: () => (typeof form.defaultValue === "string" ? form.defaultValue : ""),
  set: (value) => {
    form.defaultValue = value;
  },
});

const defaultValueInputId = "field-default";
</script>

<template>
  <div class="form-grid">
    <div class="form-row-50">
      <div class="form-field">
        <label for="field-name">{{ t("models.detail.add_field_dialog.field_name") }}</label>
        <InputText id="field-name" v-model="form.name" autocomplete="off" />
      </div>

      <div class="form-field">
        <label for="field-key">{{ t("models.detail.add_field_dialog.field_key") }}</label>
        <InputText id="field-key" v-model="form.fieldKey" autocomplete="off" @update:modelValue="handleFieldKeyInput" />
        <p v-if="fieldKeyError" class="form-error">{{ fieldKeyError }}</p>
      </div>
    </div>

    <div class="form-switches">
      <div class="switch-item">
        <Checkbox v-model="form.required" binary inputId="field-required" />
        <label for="field-required">{{ t("models.detail.add_field_dialog.required") }}</label>
      </div>
      <div class="switch-item">
        <Checkbox
          v-model="form.isUnique"
          binary
          inputId="field-unique"
          :disabled="isUniqueDisabled"
          :title="isUniqueDisabled ? t('models.detail.add_field_dialog.is_unique_disabled_hint') : undefined"
        />
        <label for="field-unique">{{ t("models.detail.add_field_dialog.is_unique") }}</label>
      </div>
      <div class="switch-item">
        <Checkbox v-model="form.hasLocales" binary inputId="field-locales" />
        <label for="field-locales">{{ t("models.detail.add_field_dialog.has_locales") }}</label>
      </div>
      <div class="switch-item">
        <Checkbox v-model="form.isPrivate" binary inputId="field-private" />
        <label for="field-private">{{ t("models.detail.add_field_dialog.is_private") }}</label>
      </div>
    </div>

    <div class="form-field" v-if="showVariantField">
      <label for="field-variant">
        {{ t("models.detail.add_field_dialog.variant") }}
        <span v-if="variantRequired" class="required">*</span>
      </label>
      <Select
        v-if="canUseVariantSelect"
        id="field-variant"
        v-model="form.variant"
        class="full-width"
        :options="variantOptions"
        optionLabel="label"
        optionValue="value"
        :showClear="!variantRequired"
        :placeholder="variantPlaceholder"
      />
      <InputText v-else id="field-variant" v-model="form.variant" :placeholder="variantPlaceholder" />
    </div>

    <div v-if="selectedFieldType === 'date'" class="form-section">
      <div class="form-field">
        <label for="date-format">{{ t("models.detail.add_field_dialog.option_labels.date_format") }}</label>
        <Select
          id="date-format"
          v-model="optionsState.date.format"
          class="full-width"
          :options="props.api.dateFormatOptions.value"
          optionLabel="label"
          optionValue="value"
        />
      </div>
    </div>

    <div v-if="selectedFieldType === 'media'" class="form-section">
      <div class="section-title">{{ t("models.detail.add_field_dialog.options_heading_media") }}</div>
      <div class="form-field">
        <label>{{ t("models.detail.add_field_dialog.option_labels.allowed_kinds") }}</label>
        <div class="checkbox-group">
          <label v-for="kind in mediaKindOptions" :key="kind.value" class="checkbox-line">
            <Checkbox v-model="optionsState.media.allowedKinds" :value="kind.value" />
            <span>{{ kind.label }}</span>
          </label>
        </div>
      </div>
    </div>

    <div v-if="selectedFieldType === 'relation'" class="form-section">
      <div class="section-title">{{ t("models.detail.add_field_dialog.options_heading_relation") }}</div>
      <div class="form-field">
        <label for="relation-models">
          {{ t("models.detail.add_field_dialog.option_labels.allowed_models") }}
          <span class="required">*</span>
        </label>
        <MultiSelect
          id="relation-models"
          v-model="optionsState.relation.allowedModelIds"
          class="full-width"
          :options="relationModelOptions"
          optionLabel="label"
          optionValue="value"
          display="chip"
          :placeholder="relationModelsPlaceholder"
          :loading="relationModelLoading"
          filter
          :emptyMessage="t('models.detail.add_field_dialog.allowed_models_empty')"
        />
        <p v-if="relationModelError" class="form-error">{{ relationModelError }}</p>
      </div>
    </div>

    <div v-if="selectedFieldType === 'list'" class="form-section">
      <div class="section-title">{{ t("models.detail.add_field_dialog.list.options_title") }}</div>

      <div class="form-subsection">
        <div class="subsection-title">{{ t("models.detail.add_field_dialog.list.item_options_title") }}</div>
        <div class="inline-grid">
          <div class="form-field">
            <label for="list-item-type">{{ t("models.detail.add_field_dialog.list.item_type") }}</label>
            <Select
              id="list-item-type"
              v-model="optionsState.list.itemType"
              class="full-width"
              :options="listItemTypeOptions"
              optionLabel="label"
              optionValue="value"
            />
          </div>
        </div>
      </div>
    </div>

    <div v-if="selectedFieldType === 'custom'" class="form-section">
      <div class="section-title">{{ t("models.detail.add_field_dialog.options_heading_custom") }}</div>
      <div class="form-field">
        <label for="custom-type">{{ t("models.detail.add_field_dialog.option_labels.custom_type_id") }}</label>
        <InputText id="custom-type" v-model="optionsState.custom.customTypeId" placeholder="geo.point" />
      </div>
      <div class="inline-grid">
        <div class="form-field">
          <label for="custom-version">{{ t("models.detail.add_field_dialog.option_labels.version") }}</label>
          <InputText id="custom-version" v-model="optionsState.custom.version" placeholder="1.0.0" />
        </div>
      </div>
      <div class="form-field">
        <label for="custom-schema">{{ t("models.detail.add_field_dialog.option_labels.schema") }}</label>
        <Textarea id="custom-schema" v-model="optionsState.custom.schemaText" rows="4" :autoResize="true" placeholder="{ 'type': 'object' }" />
      </div>
      <div class="form-field">
        <label for="custom-config">{{ t("models.detail.add_field_dialog.option_labels.config") }}</label>
        <Textarea id="custom-config" v-model="optionsState.custom.configText" rows="3" :autoResize="true" placeholder="{ 'variant': 'compact' }" />
      </div>
    </div>

    <div v-if="showDefaultValueField" class="form-field">
      <label :for="defaultValueInputId">{{ t("models.detail.add_field_dialog.default_value") }}</label>
      <SelectButton
        v-if="isBooleanField"
        :id="defaultValueInputId"
        v-model="booleanDefaultValue"
        :options="booleanDefaultOptions"
        optionLabel="label"
        optionValue="value"
        :allowEmpty="true"
      />
      <InputNumber v-else-if="isNumberField" :inputId="defaultValueInputId" v-model="numberDefaultValue" :useGrouping="false" class="full-width" />
      <Textarea v-else-if="usesTextareaDefault" :id="defaultValueInputId" v-model="textDefaultValue" rows="4" :autoResize="true" />
      <InputText v-else :id="defaultValueInputId" v-model="textDefaultValue" />
    </div>

    <p v-if="optionsError" class="form-error">{{ optionsError }}</p>
  </div>
</template>

<style scoped lang="scss">
.form-grid {
  display: flex;
  flex-direction: column;
  gap: var(--space-16);
}

.form-row-50 {
  display: flex;
  gap: var(--space-12);

  > .form-field {
    flex: 1 1 50%;
  }
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);

  label {
    font-size: var(--font-14);
    font-weight: 600;
    color: var(--surface-900);

    .required {
      color: var(--red-500);
      margin-left: var(--space-4);
    }
  }
}

.form-switches {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-12);

  .switch-item {
    display: flex;
    align-items: center;
    gap: var(--space-8);

    label {
      margin: 0;
      font-weight: 500;
    }
  }
}

.form-section {
  border: 1px solid var(--surface-200);
  border-radius: 8px;
  padding: var(--space-16);
  background: var(--surface-50);
  display: flex;
  flex-direction: column;
  gap: var(--space-12);
}

.section-title {
  font-size: var(--font-14);
  font-weight: 600;
  color: var(--surface-800);
}

.inline-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--space-12);
}

.checkbox-group {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-12);
}

.checkbox-line {
  display: flex;
  align-items: center;
  gap: var(--space-8);
}

.form-subsection {
  border-top: 1px dashed var(--surface-300);
  padding-top: var(--space-12);
  display: flex;
  flex-direction: column;
  gap: var(--space-12);
}

.subsection-title {
  font-size: var(--font-13);
  font-weight: 600;
  color: var(--surface-700);
}

.helper-text {
  margin: 0;
  font-size: var(--font-12);
  color: var(--surface-600);
}

.full-width {
  width: 100%;
}

.form-error {
  color: var(--red-500);
  font-size: var(--font-13);
}

@media (max-width: 640px) {
  .form-switches {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
