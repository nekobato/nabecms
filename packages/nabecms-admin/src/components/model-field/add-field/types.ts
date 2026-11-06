import type { FieldType } from "@nekobato/nabecms-core/contracts";
import type { ComputedRef, Ref } from "vue";

export type { FieldType };

export type ListItemType = "text" | "number" | "date" | "boolean";

export type SubmitPayload = {
  type: FieldType;
  name: string;
  fieldKey: string;
  required: boolean;
  hasLocales: boolean;
  isUnique: boolean;
  variant: string | null;
  options: unknown;
  defaultValue: unknown;
  isPrivate: boolean;
};

export type ModelFieldEditPayload = SubmitPayload & {
  id: string;
  position?: number | null;
  isDisplayTitle?: boolean;
};

export type FieldTypeItem = {
  id: FieldType;
  label: string;
  desc: string;
  icon: string;
  group: "basic" | "content" | "advanced";
};

export type SelectOption = {
  label: string;
  value: string;
};

export type CheckboxOption = {
  label: string;
  value: string;
};

export type FieldFormState = {
  name: string;
  fieldKey: string;
  required: boolean;
  hasLocales: boolean;
  isUnique: boolean;
  variant: string;
  defaultValue: unknown;
  isPrivate: boolean;
};

export type TextOptionsState = Record<string, never>;

export type NumberOptionsState = Record<string, never>;

export type DateOptionsState = {
  format: "date" | "datetime" | "datetime_with_timezone";
};

export type MediaOptionsState = {
  allowedKinds: string[];
};

export type RelationOptionsState = {
  allowedModelIds: string[];
};

export type BooleanOptionsState = Record<string, never>;

export type CustomOptionsState = {
  customTypeId: string;
  version: string;
  schemaText: string;
  configText: string;
};

export type ListTextOptionsState = TextOptionsState;
export type ListNumberOptionsState = NumberOptionsState;
export type ListDateOptionsState = Record<string, never>;
export type ListBooleanOptionsState = BooleanOptionsState;
export type ListOptionsState = {
  itemType: ListItemType;
  text: ListTextOptionsState;
  number: ListNumberOptionsState;
  date: ListDateOptionsState;
  boolean: ListBooleanOptionsState;
};

export type FieldOptionsState = {
  text: TextOptionsState;
  number: NumberOptionsState;
  date: DateOptionsState;
  media: MediaOptionsState;
  relation: RelationOptionsState;
  boolean: BooleanOptionsState;
  custom: CustomOptionsState;
  list: ListOptionsState;
};

export type UseFieldDefinitionFormResult = {
  step: Ref<"select" | "configure">;
  selectedFieldType: Ref<FieldType | null>;
  fieldTypes: ComputedRef<FieldTypeItem[]>;
  listItemTypeOptions: ComputedRef<Array<{ value: ListItemType; label: string }>>;
  mediaKindOptions: ComputedRef<CheckboxOption[]>;
  dateFormatOptions: ComputedRef<SelectOption[]>;
  variantOptions: ComputedRef<SelectOption[]>;
  canUseVariantSelect: ComputedRef<boolean>;
  customVariantInput: ComputedRef<boolean>;
  showVariantField: ComputedRef<boolean>;
  variantRequired: ComputedRef<boolean>;
  variantPlaceholder: ComputedRef<string>;
  isSubmitDisabled: ComputedRef<boolean>;
  form: FieldFormState;
  optionsState: FieldOptionsState;
  optionsError: Ref<string | null>;
  fieldKeyError: Ref<string | null>;
  handleSelectType: (type: FieldType) => void;
  goBackToSelect: () => void;
  resetState: () => void;
  buildPayload: () => SubmitPayload | null;
  handleFieldKeyInput: (value: string | undefined) => void;
};
