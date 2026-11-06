<script lang="ts" setup>
import { computed, ref, toRefs, watch } from "vue";
import { Form, type FormSlotProps } from "vee-validate";
import { useI18n } from "vue-i18n";
import EntryFormFields from "@/components/EntryFormFields.vue";
import { type EntryFormModel, isCodeTextField, isRecord, resolveListItemType, toCodeEditorValue, toJsonEditorValue } from "@/components/entry-form-shared";
import { useEntryJsonValidation } from "@/composables/useEntryJsonValidation";
import type { ModelField } from "@/modules/entries";

import Button from "@/components/NabeButton.vue";
const props = withDefaults(
  defineProps<{
    mode: "create" | "edit";
    model: EntryFormModel;
    initialValues: Record<string, unknown>;
    loading?: boolean;
    hideActions?: boolean;
    enableWorkflowActions?: boolean;
    hideWorkflowActions?: boolean;
    locales?: { code: string; isDefault?: boolean }[];
    defaultLocale?: string;
    localeFilter?: string;
    readonly?: boolean;
    inputIdPrefix?: string;
  }>(),
  {
    loading: false,
    hideActions: false,
    enableWorkflowActions: false,
    hideWorkflowActions: false,
    locales: () => [],
    defaultLocale: "en",
    localeFilter: "all",
    readonly: false,
    inputIdPrefix: "",
  },
);

const {
  mode,
  model,
  initialValues,
  loading,
  hideActions,
  enableWorkflowActions,
  hideWorkflowActions,
  locales,
  defaultLocale,
  localeFilter,
  readonly,
  inputIdPrefix,
} = toRefs(props);

const emit = defineEmits<{
  (e: "submit", values: Record<string, unknown>): void;
  (e: "cancel"): void;
  (e: "save-draft", values: Record<string, unknown>): void;
  (e: "publish", values: Record<string, unknown>): void;
  (e: "update:localeFilter", value: string): void;
  (e: "dirty-change", value: boolean): void;
}>();

const { t } = useI18n();

const formInstanceKey = ref(0);
const formDirty = ref(false);
const pendingAction = ref<"submit" | "draft" | "publish">("submit");
const currentFormCtx = ref<FormSlotProps | null>(null);

const { jsonErrors, normalizeJsonValues, resetJsonErrors } = useEntryJsonValidation({
  t,
  fields: computed(() => model.value.fields),
});

const workflowEnabled = computed(() => enableWorkflowActions.value);
const localeFilterModel = computed({
  get: () => localeFilter.value ?? "all",
  set: (value: string) => emit("update:localeFilter", value),
});

const dateFormatValues = new Set(["date", "datetime", "datetime_with_timezone"]);

const resolveDateFormat = (field: ModelField): "date" | "datetime" | "datetime_with_timezone" => {
  const options = isRecord(field.options) ? field.options : {};
  const format = options.format;
  if (typeof format === "string" && dateFormatValues.has(format)) {
    return format as "date" | "datetime" | "datetime_with_timezone";
  }
  return field.variant === "datetime" ? "datetime" : "date";
};

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

const normalizeDateValues = (values: Record<string, unknown>): Record<string, unknown> => {
  const next = { ...values };
  model.value.fields.forEach((field) => {
    if (field.type !== "date") return;
    const format = resolveDateFormat(field);
    if (field.hasLocales) {
      const localized = isRecord(next[field.name]) ? { ...(next[field.name] as Record<string, unknown>) } : {};
      Object.entries(localized).forEach(([localeCode, raw]) => {
        localized[localeCode] = normalizeDateValue(format, raw);
      });
      next[field.name] = localized;
      return;
    }
    next[field.name] = normalizeDateValue(format, next[field.name]);
  });
  return next;
};

const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/u;

/** Normalize one list field value into the typed array expected by the API. */
const normalizeListValue = (field: ModelField, value: unknown): unknown[] => {
  const rows = Array.isArray(value) ? value : [];
  const itemType = resolveListItemType(field);

  switch (itemType) {
    case "text":
      return rows.map((item) => (typeof item === "string" ? item : item == null ? "" : String(item)));
    case "number":
      return rows.filter((item): item is number => typeof item === "number" && Number.isFinite(item));
    case "date":
      return rows.filter((item): item is string => typeof item === "string" && dateOnlyPattern.test(item));
    case "boolean":
      return rows.filter((item): item is boolean => typeof item === "boolean");
    default: {
      const exhaustive: never = itemType;
      return [exhaustive];
    }
  }
};

/** Normalize all list field values before the final submit payload is built. */
const normalizeListValues = (values: Record<string, unknown>): Record<string, unknown> => {
  const next = { ...values };
  model.value.fields.forEach((field) => {
    if (field.type !== "list") return;

    if (field.hasLocales) {
      const localized = isRecord(next[field.name]) ? { ...(next[field.name] as Record<string, unknown>) } : {};
      Object.entries(localized).forEach(([localeCode, raw]) => {
        localized[localeCode] = normalizeListValue(field, raw);
      });
      next[field.name] = localized;
      return;
    }

    next[field.name] = normalizeListValue(field, next[field.name]);
  });
  return next;
};

const normalizeEditorInitialValues = (fields: ModelField[], values: Record<string, unknown>): Record<string, unknown> => {
  const nextValues: Record<string, unknown> = { ...values };

  fields.forEach((field) => {
    const isJsonField = field.type === "json";
    if (!isCodeTextField(field) && !isJsonField) return;

    const normalizeValue = isJsonField ? toJsonEditorValue : toCodeEditorValue;

    if (field.hasLocales) {
      const localized = isRecord(values[field.name]) ? { ...(values[field.name] as Record<string, unknown>) } : {};
      Object.entries(localized).forEach(([localeCode, raw]) => {
        localized[localeCode] = normalizeValue(raw);
      });
      nextValues[field.name] = localized;
      return;
    }

    nextValues[field.name] = normalizeValue(values[field.name]);
  });

  return nextValues;
};

const normalizedInitialValues = computed(() => normalizeEditorInitialValues(model.value.fields, initialValues.value));

watch(initialValues, () => {
  formInstanceKey.value += 1;
  formDirty.value = false;
  resetJsonErrors();
  emit("dirty-change", false);
});

watch(
  () => currentFormCtx.value?.meta?.dirty ?? false,
  (dirty) => {
    if (dirty === formDirty.value) return;
    formDirty.value = dirty;
    emit("dirty-change", dirty);
  },
  { immediate: true },
);

const handleSubmit = (values: Record<string, unknown>) => {
  const normalized = normalizeJsonValues(values);
  if (normalized.hasErrors) {
    console.warn("[EntryForm] JSON validation failed", { errors: Array.from(jsonErrors.value.entries()) });
    return;
  }

  const normalizedValues = normalizeListValues(normalizeDateValues(normalized.values));
  if (!workflowEnabled.value) {
    emit("submit", normalizedValues);
    return;
  }

  if (pendingAction.value === "draft") {
    emit("save-draft", normalizedValues);
  } else if (pendingAction.value === "publish") {
    emit("publish", normalizedValues);
  } else {
    emit("submit", normalizedValues);
  }
  pendingAction.value = "submit";
};

const cancel = () => emit("cancel");

type FormAction = "submit" | "draft" | "publish";
type FormContextLike = Pick<FormSlotProps, "validate" | "errors" | "values" | "resetForm">;

const triggerSubmit = async (action: FormAction, ctx: FormContextLike) => {
  pendingAction.value = action;
  try {
    const validation = typeof ctx.validate === "function" ? await ctx.validate() : { valid: true };
    if (!validation.valid) {
      console.warn("[EntryForm] validation failed", { action, errors: ctx.errors });
      return;
    }
    handleSubmit((ctx.values ?? {}) as Record<string, unknown>);
  } catch (error) {
    console.error("[EntryForm] submitForm error", error);
  }
};

const attachFormCtx = (ctx: FormSlotProps) => {
  currentFormCtx.value = ctx;
  return true;
};

/** Trigger a form workflow action from a parent toolbar. */
const triggerAction = (action: FormAction) => {
  const ctx = currentFormCtx.value;
  if (!ctx) return;
  void triggerSubmit(action, ctx as FormContextLike);
};

/** Reset dirty tracking after the parent confirms the current form was persisted. */
const resetDirty = () => {
  const ctx = currentFormCtx.value;
  if (ctx) {
    ctx.resetForm({ values: (ctx.values ?? {}) as Record<string, unknown> });
  }
  resetJsonErrors();
  formDirty.value = false;
  emit("dirty-change", false);
};

defineExpose({ triggerAction, resetDirty });
</script>

<template>
  <Form :key="formInstanceKey" :initial-values="normalizedInitialValues" @submit="handleSubmit" class="form-sections" v-slot="formCtx">
    <template v-if="attachFormCtx(formCtx)">
      <EntryFormFields
        v-model:locale-filter="localeFilterModel"
        :mode="mode"
        :model="model"
        :initial-values="normalizedInitialValues"
        :loading="loading"
        :locales="locales"
        :default-locale="defaultLocale"
        :readonly="readonly"
        :input-id-prefix="inputIdPrefix"
      />

      <div class="form-actions" v-if="workflowEnabled ? !hideWorkflowActions : !hideActions || !!$slots.actions">
        <template v-if="workflowEnabled && !hideWorkflowActions">
          <Button
            type="button"
            severity="primary"
            icon="lucide:save"
            :disabled="loading || readonly"
            :loading="loading"
            :label="t('contents.edit.save_draft_button')"
            @click="triggerSubmit('draft', formCtx)"
          />
          <Button
            type="button"
            severity="success"
            icon="lucide:upload"
            :disabled="loading || readonly"
            :loading="loading"
            :label="t('contents.edit.publish_button')"
            @click="triggerSubmit('publish', formCtx)"
          />
        </template>
        <template v-else>
          <Button
            v-if="!hideActions"
            type="submit"
            :disabled="loading"
            :loading="loading"
            severity="primary"
            icon="lucide:check"
            :label="loading ? t(`contents.${mode}.submitting`) : t(`contents.${mode}.submit`)"
          />
          <slot name="actions" :submit="() => formCtx.submitForm()" :loading="loading" />
          <Button v-if="!hideActions" type="button" @click="cancel" severity="secondary" icon="lucide:x" :label="t(`contents.${mode}.cancel`)" />
        </template>
      </div>
    </template>
  </Form>
</template>

<style lang="scss" scoped>
.form-sections {
  display: flex;
  flex-direction: column;
  gap: var(--space-24);
}

.form-actions {
  display: flex;
  gap: var(--space-12);
  flex-wrap: wrap;
  justify-content: flex-end;

  :deep(.el-button + .el-button) {
    margin-inline-start: 0;
  }
}
</style>
