<script lang="ts" setup>
import { computed, nextTick, ref, toRef, watch } from "vue";
import { Dialog } from "@/components/ui/element-plus";
import Button from "@/components/NabeButton.vue";
import { Tag } from "@/components/ui/element-plus";
import { useI18n } from "vue-i18n";
import { useFieldDefinitionForm } from "./model-field/add-field/useFieldDefinitionForm";
import ModelFieldDefinitionForm from "./model-field/ModelFieldDefinitionForm.vue";
import { isListItemType } from "./model-field/add-field/fieldDefinitionCatalog";
import type { FieldType, ModelFieldEditPayload } from "./model-field/add-field/types";

const props = defineProps<{
  visible: boolean;
  field: ModelFieldEditPayload | null;
}>();

const emit = defineEmits<{
  (e: "update:visible", value: boolean): void;
  (e: "update-field", payload: ModelFieldEditPayload): void;
}>();

const { t } = useI18n();
const visibleRef = toRef(props, "visible");

const formApi = useFieldDefinitionForm(t, visibleRef);

const { step, selectedFieldType, isSubmitDisabled, buildPayload, handleSelectType, resetState, optionsError, fieldKeyError, form, optionsState } = formApi;

const currentFieldId = ref<string | null>(null);

const dialogVisible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit("update:visible", value),
});

const dialogTitle = computed(() => t("models.edit.edit_field_dialog.title"));

function closeDialog() {
  emit("update:visible", false);
}

function sanitizeFieldKey(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/_{2,}/gu, "_")
    .replace(/^_+|_+$/gu, "");
  return normalized.length > 0 ? normalized : value;
}

const toOptionalString = (value: unknown): string => (typeof value === "string" ? value : "");

const toArrayOfStrings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

const stringifyJson = (value: unknown): string => {
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    console.warn("Failed to stringify JSON for field options", error);
    return "";
  }
};

const dateFormatValues = new Set(["date", "datetime", "datetime_with_timezone"]);

const resolveDateFormat = (variant: string | null | undefined, options: Record<string, unknown>): "date" | "datetime" | "datetime_with_timezone" => {
  const raw = options.format;
  if (typeof raw === "string" && dateFormatValues.has(raw)) {
    return raw as "date" | "datetime" | "datetime_with_timezone";
  }
  const hasLegacyTimezone = typeof options.timezone === "string" && options.timezone.trim().length > 0;
  if (variant === "datetime") {
    return hasLegacyTimezone ? "datetime_with_timezone" : "datetime";
  }
  return "date";
};

function populateOptions(type: FieldType, options: unknown) {
  if (typeof options !== "object" || options === null) return;

  if (type === "date") {
    const record = options as Record<string, unknown>;
    optionsState.date.format = resolveDateFormat(form.variant, record);
    return;
  }

  if (type === "media") {
    const record = options as Record<string, unknown>;
    optionsState.media.allowedKinds = toArrayOfStrings(record.allowedKinds);
    return;
  }

  if (type === "relation") {
    const record = options as Record<string, unknown>;
    const allowedModels = toArrayOfStrings(record.allowedModels);
    optionsState.relation.allowedModelIds = [...allowedModels];
    return;
  }

  if (type === "custom") {
    const record = options as Record<string, unknown>;
    optionsState.custom.customTypeId = toOptionalString(record.customTypeId);
    optionsState.custom.version = toOptionalString(record.version);
    optionsState.custom.schemaText = stringifyJson(record.schema ?? null);
    optionsState.custom.configText = stringifyJson(record.config ?? null);
    return;
  }

  if (type === "list") {
    const record = options as Record<string, unknown>;
    if (typeof record.item === "object" && record.item !== null) {
      const item = record.item as Record<string, unknown>;
      if (typeof item.type === "string" && isListItemType(item.type)) {
        optionsState.list.itemType = item.type;
      }
    }
  }
}

const normalizeDefaultValue = (type: FieldType, value: unknown) => {
  switch (type) {
    case "boolean":
      return typeof value === "boolean" ? value : null;
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    case "json":
    case "custom":
    case "list":
      return typeof value === "string" ? value : stringifyJson(value ?? null);
    case "date":
    case "text":
    case "rich_text":
      return typeof value === "string" ? value : value != null ? String(value) : "";
    default:
      return null;
  }
};

async function applyInitialField(field: ModelFieldEditPayload) {
  currentFieldId.value = field.id;
  optionsError.value = null;
  fieldKeyError.value = null;
  resetState();
  handleSelectType(field.type);
  await nextTick();

  step.value = "configure";

  form.name = field.name;
  form.fieldKey = sanitizeFieldKey(field.fieldKey);
  form.required = field.required;
  form.hasLocales = field.hasLocales;
  form.isPrivate = field.isPrivate;
  form.isUnique = field.isUnique ?? false;
  form.variant = field.variant ?? "";
  form.defaultValue = normalizeDefaultValue(field.type, field.defaultValue);

  populateOptions(field.type, field.options ?? null);
}

watch(
  () => props.visible,
  async (visible) => {
    if (!visible) {
      currentFieldId.value = null;
      return;
    }
    if (!props.field) {
      return;
    }
    await applyInitialField(props.field);
  },
);

watch(
  () => props.field,
  async (field) => {
    if (!field || !props.visible) {
      return;
    }
    if (currentFieldId.value === field.id) {
      return;
    }
    await applyInitialField(field);
  },
);

function handleConfirm() {
  if (!currentFieldId.value) return;
  const payload = buildPayload();
  if (!payload) return;
  emit("update-field", {
    ...payload,
    id: currentFieldId.value,
    position: props.field?.position ?? null,
    isDisplayTitle: props.field?.isDisplayTitle ?? false,
  });
  closeDialog();
}
</script>

<template>
  <Dialog v-model:visible="dialogVisible" modal :draggable="false" class="edit-field-dialog" :style="{ width: '720px', maxWidth: '95vw' }">
    <template #header>
      <div class="efd-header">
        <h3 class="efd-title">{{ dialogTitle }}</h3>
        <Tag v-if="selectedFieldType" severity="secondary">{{ selectedFieldType }}</Tag>
      </div>
    </template>

    <ModelFieldDefinitionForm :api="formApi" />

    <template #footer>
      <div class="efd-footer">
        <Button size="small" severity="secondary" :label="t('common.cancel')" @click="closeDialog" />
        <Button size="small" severity="primary" :disabled="isSubmitDisabled" :label="t('models.edit.edit_field_dialog.save')" @click="handleConfirm" />
      </div>
    </template>
  </Dialog>
</template>

<style scoped lang="scss">
.edit-field-dialog :deep(.el-dialog__header) {
  border-bottom: 1px solid var(--surface-200);
}

.efd-header {
  display: flex;
  align-items: center;
  gap: var(--space-12);

  .efd-title {
    margin: 0;
    font-size: var(--font-18);
    font-weight: 700;
    color: var(--surface-900);
  }
}

.efd-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-8);
}
</style>
