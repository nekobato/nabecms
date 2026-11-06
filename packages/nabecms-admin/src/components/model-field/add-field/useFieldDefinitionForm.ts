import { computed, ref, watch, type Ref } from "vue";
import type { FieldType, FieldTypeItem, UseFieldDefinitionFormResult } from "./types";
import {
  createDateFormatOptions,
  createFieldTypeItems,
  createListItemTypeOptions,
  createMediaKindOptions,
  getVariantOptions,
  resolveFieldVariantDefault,
  toDateVariant,
} from "./fieldDefinitionCatalog";
import { buildSubmitPayload } from "./fieldDefinitionPayload";
import { createFormState, createOptionsState, deepAssign } from "./fieldDefinitionState";
import { fieldKeyPattern, generateFieldKeyFromName, hasAllowedModelSelection, isOptionalJsonValid, sanitizeFieldKey } from "./fieldDefinitionUtils";

export { createOptionsState } from "./fieldDefinitionState";

/**
 * Manages the add/edit field definition workflow and payload construction.
 */
export function useFieldDefinitionForm(t: (key: string, params?: Record<string, unknown>) => string, visibleRef: Ref<boolean>): UseFieldDefinitionFormResult {
  const step = ref<"select" | "configure">("select");
  const selectedFieldType = ref<FieldType | null>(null);
  const optionsState = createOptionsState();
  const form = createFormState();
  const optionsError = ref<string | null>(null);
  const fieldKeyAuto = ref(true);
  const fieldKeyTouched = ref(false);
  const fieldKeyError = ref<string | null>(null);

  const fieldTypes = computed<FieldTypeItem[]>(() => createFieldTypeItems(t));
  const listItemTypeOptions = computed(() => createListItemTypeOptions(t));
  const mediaKindOptions = computed(() => createMediaKindOptions(t));
  const dateFormatOptions = computed(() => createDateFormatOptions(t));
  const variantPlaceholder = computed(() => t("models.detail.add_field_dialog.variant_placeholder"));

  const variantOptions = computed(() => getVariantOptions(selectedFieldType.value, t));
  const canUseVariantSelect = computed(() => variantOptions.value.length > 0);
  const customVariantInput = computed(() => selectedFieldType.value === "custom");
  const showVariantField = computed(() => canUseVariantSelect.value || customVariantInput.value);
  const variantRequired = computed(() => variantOptions.value.length > 0);

  const resetOptionsState = (): void => {
    const defaults = createOptionsState();
    deepAssign(optionsState as unknown as Record<string, unknown>, defaults as unknown as Record<string, unknown>);
  };

  const resetFieldKeyState = (): void => {
    fieldKeyAuto.value = true;
    fieldKeyTouched.value = false;
    fieldKeyError.value = null;
  };

  const resetForm = (): void => {
    form.name = "";
    form.fieldKey = "";
    form.required = true;
    form.hasLocales = false;
    form.isUnique = false;
    form.variant = "";
    form.defaultValue = null;
    form.isPrivate = false;
    resetFieldKeyState();
  };

  const resetState = (): void => {
    step.value = "select";
    selectedFieldType.value = null;
    optionsError.value = null;
    resetForm();
    resetOptionsState();
  };

  watch(
    () => form.name,
    (value) => {
      if (!fieldKeyAuto.value) return;
      const generated = generateFieldKeyFromName(value ?? "");
      if (form.fieldKey !== generated) {
        form.fieldKey = generated;
      }
      if (generated.length === 0) {
        fieldKeyTouched.value = false;
        fieldKeyError.value = null;
      }
    },
  );

  const setDefaultVariantForType = (type: FieldType): void => {
    form.variant = resolveFieldVariantDefault(type, getVariantOptions(type, t));
  };

  const handleSelectType = (type: FieldType): void => {
    selectedFieldType.value = type;
    optionsError.value = null;
    resetOptionsState();
    form.defaultValue = null;
    form.isUnique = type === "rich_text" ? false : form.isUnique;
    setDefaultVariantForType(type);
    step.value = "configure";
  };

  const goBackToSelect = (): void => {
    step.value = "select";
    optionsError.value = null;
    resetOptionsState();
  };

  watch(visibleRef, (visible) => {
    if (!visible) {
      resetState();
    }
  });

  watch(selectedFieldType, (type) => {
    if (!type) return;
    if (type === "rich_text") {
      form.isUnique = false;
    }
    setDefaultVariantForType(type);
    if (type === "date") {
      form.variant = toDateVariant(optionsState.date.format);
    }
  });

  watch(variantOptions, (options) => {
    const type = selectedFieldType.value;
    if (!type) {
      form.variant = "";
      return;
    }
    if (options.length === 0) {
      if (type !== "date") {
        form.variant = "";
      }
      return;
    }
    if (!options.some((opt) => opt.value === form.variant)) {
      form.variant = resolveFieldVariantDefault(type, options);
    }
  });

  watch(
    () => optionsState.list.itemType,
    () => {
      optionsError.value = null;
    },
  );

  watch(
    () => optionsState.date.format,
    (format) => {
      if (selectedFieldType.value !== "date") return;
      form.variant = toDateVariant(format);
    },
  );

  const handleFieldKeyInput = (value: string | undefined): void => {
    const sanitized = sanitizeFieldKey(value ?? "");
    if (sanitized.length === 0) {
      fieldKeyAuto.value = true;
      fieldKeyTouched.value = false;
      fieldKeyError.value = null;
      form.fieldKey = "";
      return;
    }
    fieldKeyAuto.value = false;
    fieldKeyTouched.value = true;
    form.fieldKey = sanitized;
    fieldKeyError.value = fieldKeyPattern.test(sanitized) ? null : t("models.detail.add_field_dialog.field_key_invalid");
  };

  const validateFieldKey = (): boolean => {
    const sanitized = sanitizeFieldKey(form.fieldKey ?? "");
    form.fieldKey = sanitized;
    if (sanitized.length === 0) {
      fieldKeyError.value = t("models.detail.add_field_dialog.field_key_required");
      fieldKeyTouched.value = true;
      return false;
    }
    if (!fieldKeyPattern.test(sanitized)) {
      fieldKeyError.value = t("models.detail.add_field_dialog.field_key_invalid");
      fieldKeyTouched.value = true;
      return false;
    }
    fieldKeyError.value = null;
    return true;
  };

  const buildPayload = () =>
    buildSubmitPayload({
      selectedFieldType: selectedFieldType.value,
      form,
      optionsState,
      variantRequired: variantRequired.value,
      t,
      validateFieldKey,
      setOptionsError: (message) => {
        optionsError.value = message;
      },
    });

  const baseFormValid = computed(() => {
    if (!selectedFieldType.value) {
      return false;
    }
    if (form.name.trim().length === 0) {
      return false;
    }
    const sanitizedKey = sanitizeFieldKey(form.fieldKey ?? "");
    if (sanitizedKey.length === 0) {
      return false;
    }
    if (!fieldKeyPattern.test(sanitizedKey)) {
      return false;
    }
    if (variantRequired.value && form.variant.trim().length === 0) {
      return false;
    }
    return true;
  });

  const optionsValid = computed(() => {
    const type = selectedFieldType.value;
    if (!type) {
      return false;
    }

    switch (type) {
      case "relation":
        return hasAllowedModelSelection(optionsState.relation.allowedModelIds);
      case "custom":
        return isOptionalJsonValid(optionsState.custom.schemaText) && isOptionalJsonValid(optionsState.custom.configText);
      case "list":
        return true;
      default:
        return true;
    }
  });

  const isSubmitDisabled = computed(() => {
    if (step.value !== "configure") {
      return true;
    }
    if (!baseFormValid.value) {
      return true;
    }
    if (!optionsValid.value) {
      return true;
    }
    return false;
  });

  return {
    step,
    selectedFieldType,
    fieldTypes,
    listItemTypeOptions,
    mediaKindOptions,
    dateFormatOptions,
    variantOptions,
    canUseVariantSelect,
    customVariantInput,
    showVariantField,
    variantRequired,
    variantPlaceholder,
    isSubmitDisabled,
    form,
    optionsState,
    optionsError,
    fieldKeyError,
    handleSelectType,
    goBackToSelect,
    resetState,
    buildPayload,
    handleFieldKeyInput,
  };
}
