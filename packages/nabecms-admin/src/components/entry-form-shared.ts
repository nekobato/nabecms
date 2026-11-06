import type { ModelField } from "@/modules/entries";

export type EntryFormModel = {
  id: string;
  name: string;
  description?: string;
  fields: ModelField[];
};

export const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const isCodeTextField = (field: ModelField): boolean => field.type === "text" && field.variant === "code";

/** Check whether a text field should use the Markdown editor. */
export const isMarkdownTextField = (field: ModelField): boolean => field.type === "text" && field.variant === "markdown";

export const toCodeEditorValue = (value: unknown): string => (typeof value === "string" ? value : value == null ? "" : String(value));

export const toJsonEditorValue = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

export type ListItemType = "text" | "number" | "date" | "boolean";

const listItemTypes = new Set<ListItemType>(["text", "number", "date", "boolean"]);

/** Resolve whether an arbitrary string is a supported simple list item type. */
export const isListItemType = (value: string): value is ListItemType => listItemTypes.has(value as ListItemType);

/** Resolve the configured item type for a list field, with text as a legacy-safe fallback. */
export const resolveListItemType = (field: Pick<ModelField, "options">): ListItemType => {
  const options = isRecord(field.options) ? field.options : {};
  const item = isRecord(options.item) ? options.item : {};
  const type = typeof item.type === "string" ? item.type : options.itemType;
  return typeof type === "string" && isListItemType(type) ? type : "text";
};
