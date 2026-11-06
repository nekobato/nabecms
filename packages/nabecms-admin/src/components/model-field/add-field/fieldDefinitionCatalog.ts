import type { CheckboxOption, FieldType, FieldTypeItem, ListItemType, SelectOption } from "./types";

type Translator = (key: string, params?: Record<string, unknown>) => string;

const variantValueMap: Record<FieldType, string[]> = {
  text: ["shortText", "longText", "markdown", "code"],
  rich_text: [],
  number: ["integer", "decimal"],
  date: [],
  list: [],
  media: ["single", "multiple"],
  json: [],
  relation: ["one", "many"],
  boolean: [],
  custom: [],
};

const defaultsByType: Partial<Record<FieldType, string>> = {
  number: "integer",
  date: "date",
  relation: "one",
  media: "single",
};

export const mediaKindValues = ["image", "video", "audio", "document", "archive"] as const;

export const dateFormatValues = ["date", "datetime", "datetime_with_timezone"] as const;

export const listItemTypes: readonly ListItemType[] = ["text", "number", "date", "boolean"];

/**
 * Returns whether a raw field type is supported as a simple list item.
 */
export function isListItemType(value: string): value is ListItemType {
  return listItemTypes.includes(value as ListItemType);
}

/**
 * Returns the selectable field-type catalog for the field creation dialog.
 */
export function createFieldTypeItems(t: Translator): FieldTypeItem[] {
  return [
    {
      id: "text",
      label: t("models.detail.field_types.text"),
      desc: t("models.detail.field_types_desc.text"),
      icon: "heroicons:pencil-square-20-solid",
      group: "basic",
    },
    {
      id: "rich_text",
      label: t("models.detail.field_types.rich_text"),
      desc: t("models.detail.field_types_desc.rich_text"),
      icon: "heroicons:document-text-20-solid",
      group: "content",
    },
    {
      id: "number",
      label: t("models.detail.field_types.number"),
      desc: t("models.detail.field_types_desc.number"),
      icon: "heroicons:hashtag-20-solid",
      group: "basic",
    },
    {
      id: "date",
      label: t("models.detail.field_types.date"),
      desc: t("models.detail.field_types_desc.date"),
      icon: "heroicons:calendar-20-solid",
      group: "basic",
    },
    {
      id: "list",
      label: t("models.detail.field_types.list"),
      desc: t("models.detail.field_types_desc.list"),
      icon: "heroicons:queue-list-20-solid",
      group: "content",
    },
    {
      id: "media",
      label: t("models.detail.field_types.media"),
      desc: t("models.detail.field_types_desc.media"),
      icon: "heroicons:photo-20-solid",
      group: "content",
    },
    {
      id: "json",
      label: t("models.detail.field_types.json"),
      desc: t("models.detail.field_types_desc.json"),
      icon: "heroicons:code-bracket-20-solid",
      group: "advanced",
    },
    {
      id: "relation",
      label: t("models.detail.field_types.relation"),
      desc: t("models.detail.field_types_desc.relation"),
      icon: "heroicons:link-20-solid",
      group: "content",
    },
    {
      id: "boolean",
      label: t("models.detail.field_types.boolean"),
      desc: t("models.detail.field_types_desc.boolean"),
      icon: "heroicons:check-circle-20-solid",
      group: "basic",
    },
  ];
}

/**
 * Builds translated select options for list item types.
 */
export function createListItemTypeOptions(t: Translator): Array<{ value: ListItemType; label: string }> {
  return listItemTypes.map((value) => ({ value, label: t(`models.detail.field_types.${value}`) }));
}

/**
 * Builds translated media-kind checkbox options.
 */
export function createMediaKindOptions(t: Translator): CheckboxOption[] {
  return mediaKindValues.map((kind) => ({ value: kind, label: t(`models.detail.add_field_dialog.media_allowedKinds.${kind}`) }));
}

/**
 * Builds translated date-format options.
 */
export function createDateFormatOptions(t: Translator): SelectOption[] {
  return dateFormatValues.map((value) => ({ value, label: t(`models.detail.add_field_dialog.date_format_options.${value}`) }));
}

/**
 * Builds translated variant options for a top-level field type.
 */
export function getVariantOptions(type: FieldType | null, t: Translator): SelectOption[] {
  if (!type) return [];
  const values = variantValueMap[type] ?? [];
  return values.map((value) => ({ value, label: t(`models.detail.add_field_dialog.variant_labels.${type}.${value}`) }));
}

/**
 * Resolves the default variant for a top-level field type.
 */
export function resolveFieldVariantDefault(type: FieldType | null, options: SelectOption[]): string {
  if (!type || options.length === 0) {
    return "";
  }

  const predefined = defaultsByType[type];
  if (predefined && options.some((item) => item.value === predefined)) {
    return predefined;
  }

  if (options.length === 1) {
    const [onlyOption] = options;
    return onlyOption ? onlyOption.value : "";
  }

  return "";
}

/**
 * Normalizes date variants so the field variant follows the selected date format.
 */
export const toDateVariant = (format: string): "date" | "datetime" => (format === "date" ? "date" : "datetime");
