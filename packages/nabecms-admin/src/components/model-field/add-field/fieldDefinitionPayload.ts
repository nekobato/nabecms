import type { CustomOptionsState, FieldFormState, FieldOptionsState, FieldType, RelationOptionsState, SubmitPayload } from "./types";
import { cleanString, normalizeRelationIds, parseOptionalJson, pruneObject } from "./fieldDefinitionUtils";

type Translator = (key: string, params?: Record<string, unknown>) => string;
type SetOptionsError = (message: string | null) => void;

type BuildFieldOptionsInput = {
  selectedFieldType: FieldType;
  optionsState: FieldOptionsState;
  t: Translator;
  setOptionsError: SetOptionsError;
};

type BuildSubmitPayloadInput = Omit<BuildFieldOptionsInput, "selectedFieldType"> & {
  selectedFieldType: FieldType | null;
  form: FieldFormState;
  variantRequired: boolean;
  validateFieldKey: () => boolean;
};

const buildRelationOptions = (
  state: RelationOptionsState,
  errorKey: string,
  t: Translator,
  setOptionsError: SetOptionsError,
): Record<string, unknown> | undefined => {
  const allowedModels = normalizeRelationIds(state.allowedModelIds);
  if (allowedModels.length === 0) {
    setOptionsError(t(errorKey));
    return undefined;
  }

  return { allowedModels };
};

const buildDateOptions = (optionsState: FieldOptionsState) => {
  const { format } = optionsState.date;
  return pruneObject({
    format,
  });
};

const buildMediaOptions = (optionsState: FieldOptionsState) => {
  const media = optionsState.media;
  return pruneObject({
    allowedKinds: media.allowedKinds,
  });
};

const buildCustomOptions = (customState: CustomOptionsState, t: Translator, setOptionsError: SetOptionsError) => {
  const schema = parseOptionalJson(customState.schemaText);
  if (!schema.ok) {
    setOptionsError(t("models.detail.add_field_dialog.options_invalid_json"));
    return undefined;
  }

  const config = parseOptionalJson(customState.configText);
  if (!config.ok) {
    setOptionsError(t("models.detail.add_field_dialog.options_invalid_json"));
    return undefined;
  }

  return pruneObject({
    customTypeId: cleanString(customState.customTypeId),
    version: cleanString(customState.version),
    schema: schema.value,
    config: config.value,
  });
};

/**
 * Builds the normalized options payload for the currently selected field type.
 */
export function buildFieldOptions({ selectedFieldType, optionsState, t, setOptionsError }: BuildFieldOptionsInput): unknown | null | undefined {
  switch (selectedFieldType) {
    case "text":
      return null;
    case "number":
      return null;
    case "date":
      return buildDateOptions(optionsState);
    case "media":
      return buildMediaOptions(optionsState);
    case "relation":
      return buildRelationOptions(optionsState.relation, "models.detail.add_field_dialog.options_relation_models_required", t, setOptionsError);
    case "boolean":
      return null;
    case "json":
      return null;
    case "custom":
      return buildCustomOptions(optionsState.custom, t, setOptionsError);
    case "list": {
      return { item: { type: optionsState.list.itemType } };
    }
    case "rich_text":
      return null;
  }
}

/**
 * Builds the default value payload for the currently selected field type.
 */
export function buildDefaultValue(selectedFieldType: FieldType, defaultValue: unknown): unknown {
  switch (selectedFieldType) {
    case "relation":
    case "media":
    case "rich_text":
      return null;
    case "boolean":
      return typeof defaultValue === "boolean" ? defaultValue : null;
    case "number":
      return typeof defaultValue === "number" ? defaultValue : null;
    case "custom":
    case "json":
    case "list":
    case "date":
    case "text":
      if (typeof defaultValue !== "string") {
        return null;
      }
      return defaultValue.trim().length > 0 ? defaultValue : null;
  }
}

/**
 * Builds the final submit payload while centralizing field-specific validation.
 */
export function buildSubmitPayload({
  selectedFieldType,
  form,
  optionsState,
  variantRequired,
  t,
  validateFieldKey,
  setOptionsError,
}: BuildSubmitPayloadInput): SubmitPayload | null {
  if (!selectedFieldType) return null;

  setOptionsError(null);

  const trimmedName = form.name.trim();
  if (!trimmedName) {
    setOptionsError(t("models.detail.add_field_dialog.name_required"));
    return null;
  }

  if (!validateFieldKey()) {
    return null;
  }

  if (variantRequired && !form.variant.trim()) {
    setOptionsError(t("models.detail.add_field_dialog.variant_required"));
    return null;
  }

  const options = buildFieldOptions({
    selectedFieldType,
    optionsState,
    t,
    setOptionsError,
  });
  if (options === undefined) {
    return null;
  }

  return {
    type: selectedFieldType,
    name: trimmedName,
    fieldKey: form.fieldKey,
    required: form.required,
    hasLocales: form.hasLocales,
    isUnique: selectedFieldType === "rich_text" ? false : form.isUnique,
    variant: form.variant.trim() ? form.variant.trim() : null,
    options,
    defaultValue: buildDefaultValue(selectedFieldType, form.defaultValue),
    isPrivate: form.isPrivate,
  };
}
