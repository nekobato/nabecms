/**
 * Shared model-field contract types for public API consumers.
 */
export const fieldTypes = [
  "text",
  "rich_text",
  "number",
  "date",
  "list",
  "media",
  "json",
  "relation",
  "boolean",
  "custom",
] as const;

export type FieldType = (typeof fieldTypes)[number];

export const textVariants = [
  "shortText",
  "longText",
  "markdown",
  "code",
] as const;

export type TextFieldVariant = (typeof textVariants)[number];

export type CommonFieldOption = {
  unique?: boolean;
  validate?: unknown;
};

export type TextFieldOptions = CommonFieldOption;

export const numberVariants = ["integer", "decimal"] as const;
export type NumberFieldVariant = (typeof numberVariants)[number];

export type NumberFieldOptions = CommonFieldOption;

export const dateVariants = ["date", "datetime"] as const;
export type DateFieldVariant = (typeof dateVariants)[number];

export const dateFormats = [
  "date",
  "datetime",
  "datetime_with_timezone",
] as const;
export type DateFieldFormat = (typeof dateFormats)[number];

export type DateFieldOptions = CommonFieldOption & {
  format?: DateFieldFormat;
};

export const mediaVariants = ["single", "multiple"] as const;
export type MediaFieldVariant = (typeof mediaVariants)[number];

export type MediaFieldOptions = CommonFieldOption & {
  allowedKinds?: Array<"image" | "video" | "audio" | "document" | "archive">;
};

export type JsonFieldOptions = CommonFieldOption & {
  schema?: unknown;
  stripUnknown?: boolean;
};

export const relationVariants = ["one", "many"] as const;
export type RelationFieldVariant = (typeof relationVariants)[number];

export type RelationFieldOptions = CommonFieldOption & {
  allowedModels: string[];
  filter?: Record<string, unknown>;
  onDelete?: "restrict" | "nullify" | "cascade";
};

export type BooleanFieldOptions = CommonFieldOption;

export type CustomFieldOptions = CommonFieldOption & {
  customTypeId?: string;
  schema?: unknown;
  version?: string;
  config?: Record<string, unknown>;
};

export type ListItemDefinition =
  | {
      type: "text";
    }
  | {
      type: "number";
    }
  | {
      type: "date";
    }
  | {
      type: "boolean";
    };

export type ListFieldOptions = CommonFieldOption & {
  item: ListItemDefinition;
};

export type ModelFieldOptions =
  | TextFieldOptions
  | NumberFieldOptions
  | DateFieldOptions
  | ListFieldOptions
  | MediaFieldOptions
  | JsonFieldOptions
  | RelationFieldOptions
  | BooleanFieldOptions
  | CustomFieldOptions
  | undefined;

export type FieldVariantMap = {
  text: TextFieldVariant | undefined;
  rich_text: undefined;
  number: NumberFieldVariant | undefined;
  date: DateFieldVariant | undefined;
  list: undefined;
  media: MediaFieldVariant | undefined;
  json: undefined;
  relation: RelationFieldVariant;
  boolean: undefined;
  custom: string | undefined;
};

export type FieldOptionsMap = {
  text: TextFieldOptions | undefined;
  rich_text: undefined;
  number: NumberFieldOptions | undefined;
  date: DateFieldOptions | undefined;
  list: ListFieldOptions;
  media: MediaFieldOptions | undefined;
  json: JsonFieldOptions | undefined;
  relation: RelationFieldOptions;
  boolean: BooleanFieldOptions | undefined;
  custom: CustomFieldOptions | undefined;
};
