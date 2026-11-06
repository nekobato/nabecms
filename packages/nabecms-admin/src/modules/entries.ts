import { fieldTypes, type FieldType } from "@nekobato/nabecms-core/contracts";

export const FIELD_TYPE_VALUES = fieldTypes;

export type { FieldType };

const FIELD_TYPE_SET = new Set<FieldType>(FIELD_TYPE_VALUES);

export const ENTRY_STATUS_VALUES = ["draft", "published", "archived"] as const;

export type EntryStatus = (typeof ENTRY_STATUS_VALUES)[number];

const ENTRY_STATUS_SET = new Set<EntryStatus>(ENTRY_STATUS_VALUES);

export const DEFAULT_CONTENT_LOCALE = "en";

export const normalizeFieldType = (value: unknown): FieldType =>
  typeof value === "string" && FIELD_TYPE_SET.has(value as FieldType) ? (value as FieldType) : "text";

export const normalizeEntryStatus = (value: unknown): EntryStatus =>
  typeof value === "string" && ENTRY_STATUS_SET.has(value as EntryStatus) ? (value as EntryStatus) : "draft";

export type ModelField = {
  id: string;
  name: string;
  fieldKey: string;
  type: FieldType;
  required: boolean;
  hasLocales: boolean;
  isPrivate: boolean;
  isUnique: boolean;
  variant: string | null;
  options: unknown;
  defaultValue: unknown;
  position: number;
  isDisplayTitle: boolean;
};

export type LocaleItem = {
  code: string;
  isDefault: boolean;
};

export type EntryFieldValue = {
  fieldId: string;
  locale: string;
  type: FieldType;
  value: unknown;
};

export type BuildInitialValuesOptions = {
  status?: string;
  defaultLocale?: string;
  entryFields?: EntryFieldValue[];
};

export type BuildLocalizedInitialValuesOptions = {
  localeCodes: readonly string[];
  status?: string;
  defaultLocale?: string;
  fallbackToDefaultLocale?: boolean;
};

export type BuildLocalizedFieldValuesOptions = {
  localeCodes: readonly string[];
  defaultLocale?: string;
};

export type FindEntryFieldValueOptions = {
  locale?: string;
  defaultLocale?: string;
  allowFieldKeyFallback?: boolean;
  fallbackToDefaultLocale?: boolean;
  fallbackToAnyLocale?: boolean;
};

type RichTextValue = {
  type: "rich_text";
  value: Record<string, unknown>;
};

const hasOwn = (value: Record<string, unknown>, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const toStringValue = (value: unknown, fallback = ""): string => {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return fallback;
  return String(value);
};

const toOptionalNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  return value.trim().length > 0 ? value : null;
};

const toFiniteNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

const normalizeLocaleCode = (value: unknown, fallback = DEFAULT_CONTENT_LOCALE): string => {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : fallback;
};

const addLocaleCode = (result: string[], value: unknown) => {
  const normalized = toOptionalNonEmptyString(value);
  if (!normalized) return;
  if (!result.includes(normalized)) {
    result.push(normalized);
  }
};

const normalizeLocaleCodes = (localeCodes: readonly string[], fallback = DEFAULT_CONTENT_LOCALE): string[] => {
  const result: string[] = [];
  localeCodes.forEach((code) => addLocaleCode(result, code));
  if (result.length > 0) {
    return result;
  }

  addLocaleCode(result, fallback);
  return result;
};

const buildLocaleCodesWithFallback = (localeCodes: readonly string[], fallback = DEFAULT_CONTENT_LOCALE): string[] => {
  const result: string[] = [];
  addLocaleCode(result, fallback);
  localeCodes.forEach((code) => addLocaleCode(result, code));
  return result;
};

export const createEmptyRichTextValue = (): RichTextValue => ({
  type: "rich_text",
  value: { type: "doc", content: [{ type: "paragraph" }] },
});

export const resolveFieldDefaultValue = (field: Pick<ModelField, "defaultValue" | "type">): unknown => {
  if (field.defaultValue !== undefined) return field.defaultValue;
  switch (field.type) {
    case "text":
      return "";
    case "rich_text":
      return createEmptyRichTextValue();
    case "number":
    case "date":
    case "media":
    case "relation":
    case "json":
    case "custom":
      return null;
    case "list":
      return [];
    case "boolean":
      return false;
    default:
      return null;
  }
};

export const toLocaleItem = (input: unknown): LocaleItem | null => {
  if (!isRecord(input)) return null;
  const code = toOptionalNonEmptyString(input.code);
  if (!code) return null;
  return {
    code,
    isDefault: Boolean(input.isDefault),
  };
};

export const resolveDefaultLocaleCode = (items: readonly LocaleItem[], fallback = DEFAULT_CONTENT_LOCALE): string =>
  items.find((item) => item.isDefault)?.code ?? items[0]?.code ?? fallback;

export const resolveAvailableLocaleCodes = (
  localeItems: readonly LocaleItem[],
  fieldGroups: readonly (readonly EntryFieldValue[])[] = [],
  fallback = resolveDefaultLocaleCode(localeItems),
): string[] => {
  const codes = buildLocaleCodesWithFallback([], fallback);
  localeItems.forEach((item) => addLocaleCode(codes, item.code));
  fieldGroups.forEach((fields) => {
    fields.forEach((field) => addLocaleCode(codes, field.locale));
  });
  return codes;
};

export const toModelField = (input: unknown): ModelField => {
  const record = isRecord(input) ? input : {};
  const id = toStringValue(record.id);
  const fieldKey = toOptionalNonEmptyString(record.fieldKey) ?? id;
  const name = toOptionalNonEmptyString(record.name) ?? fieldKey;

  return {
    id,
    name,
    fieldKey,
    type: normalizeFieldType(record.type),
    required: Boolean(record.required),
    hasLocales: Boolean(record.hasLocales),
    isPrivate: Boolean(record.isPrivate),
    isUnique: typeof record.isUnique === "boolean" ? record.isUnique : Boolean(record.is_unique),
    variant: toOptionalNonEmptyString(record.variant),
    options: record.options ?? null,
    defaultValue: hasOwn(record, "defaultValue") ? record.defaultValue : undefined,
    position: toFiniteNumber(record.position, 0),
    isDisplayTitle: Boolean(record.isDisplayTitle),
  };
};

export const toEntryFieldValue = (input: unknown, options: { defaultLocale?: string } = {}): EntryFieldValue => {
  const record = isRecord(input) ? input : {};
  const defaultLocale = normalizeLocaleCode(options.defaultLocale);
  return {
    fieldId: toStringValue(record.fieldId),
    locale: normalizeLocaleCode(record.locale, defaultLocale),
    type: normalizeFieldType(record.type),
    value: record.value,
  };
};

export const sortModelFieldsByPosition = (fields: readonly ModelField[]): ModelField[] => [...fields].sort((a, b) => a.position - b.position);

export const findEntryFieldValue = (
  field: Pick<ModelField, "id" | "fieldKey" | "hasLocales">,
  entryFields: readonly EntryFieldValue[],
  options: FindEntryFieldValueOptions = {},
): EntryFieldValue | null => {
  const allowFieldKeyFallback = options.allowFieldKeyFallback ?? true;
  const locale = toOptionalNonEmptyString(options.locale);
  const defaultLocale = normalizeLocaleCode(options.defaultLocale);
  const fallbackToDefaultLocale = options.fallbackToDefaultLocale ?? false;
  const fallbackToAnyLocale = options.fallbackToAnyLocale ?? !field.hasLocales;

  const matches = entryFields.filter((candidate) => {
    if (candidate.fieldId === field.id) return true;
    return allowFieldKeyFallback && field.fieldKey.length > 0 && candidate.fieldId === field.fieldKey;
  });

  if (matches.length === 0) return null;

  if (field.hasLocales) {
    if (locale) {
      const localeMatch = matches.find((candidate) => candidate.locale === locale);
      if (localeMatch) return localeMatch;
    }

    if (fallbackToDefaultLocale) {
      const defaultMatch = matches.find((candidate) => candidate.locale === defaultLocale);
      if (defaultMatch) return defaultMatch;
    }

    if (fallbackToAnyLocale) {
      return matches[0] ?? null;
    }

    return null;
  }

  return matches[0] ?? null;
};

export const resolveEntryFieldValue = (
  field: Pick<ModelField, "id" | "fieldKey" | "hasLocales" | "type" | "defaultValue">,
  entryFields: readonly EntryFieldValue[],
  options: FindEntryFieldValueOptions = {},
): unknown => {
  const match = findEntryFieldValue(field, entryFields, options);
  if (match) return match.value;
  return resolveFieldDefaultValue(field);
};

export const buildEntryInitialValues = (fields: ModelField[], options: BuildInitialValuesOptions = {}): Record<string, unknown> => {
  const status = normalizeEntryStatus(options.status);
  const defaultLocale = normalizeLocaleCode(options.defaultLocale);
  const entryFields = Array.isArray(options.entryFields) ? options.entryFields : [];

  const initialValues: Record<string, unknown> = { status };

  for (const field of fields) {
    initialValues[field.name] = resolveEntryFieldValue(field, entryFields, {
      locale: defaultLocale,
      defaultLocale,
      fallbackToAnyLocale: true,
    });
  }

  return initialValues;
};

export const buildLocalizedEntryInitialValues = (
  fields: readonly ModelField[],
  entryFields: readonly EntryFieldValue[],
  options: BuildLocalizedInitialValuesOptions,
): Record<string, unknown> => {
  const status = normalizeEntryStatus(options.status);
  const defaultLocale = normalizeLocaleCode(options.defaultLocale);
  const resolvedLocaleCodes = normalizeLocaleCodes(options.localeCodes, defaultLocale);
  const initialValues: Record<string, unknown> = { status };

  for (const field of fields) {
    if (field.hasLocales) {
      const localized: Record<string, unknown> = {};
      resolvedLocaleCodes.forEach((code) => {
        localized[code] = resolveEntryFieldValue(field, entryFields, {
          locale: code,
          defaultLocale,
          fallbackToDefaultLocale: options.fallbackToDefaultLocale,
          fallbackToAnyLocale: false,
        });
      });
      initialValues[field.name] = localized;
      continue;
    }

    initialValues[field.name] = resolveEntryFieldValue(field, entryFields, {
      locale: defaultLocale,
      defaultLocale,
      fallbackToAnyLocale: true,
    });
  }

  return initialValues;
};

export const buildLocalizedEntryFieldValues = (
  fields: readonly ModelField[],
  values: Record<string, unknown>,
  options: BuildLocalizedFieldValuesOptions,
): EntryFieldValue[] => {
  const defaultLocale = normalizeLocaleCode(options.defaultLocale);
  const resolvedLocaleCodes = normalizeLocaleCodes(options.localeCodes, defaultLocale);

  return fields.flatMap((field) => {
    if (field.hasLocales) {
      const localizedValue = values[field.name];
      const localizedValues: Record<string, unknown> = isRecord(localizedValue) ? localizedValue : {};
      return resolvedLocaleCodes.map((code) => ({
        fieldId: field.id,
        locale: code,
        type: field.type,
        value: localizedValues[code] ?? resolveFieldDefaultValue(field),
      }));
    }

    return [
      {
        fieldId: field.id,
        locale: defaultLocale,
        type: field.type,
        value: values[field.name] ?? resolveFieldDefaultValue(field),
      },
    ];
  });
};

export const normalizeEntryFields = (
  fields: readonly EntryFieldValue[],
  modelFields: readonly ModelField[],
  localeCodes: readonly string[],
  defaultLocale = DEFAULT_CONTENT_LOCALE,
): EntryFieldValue[] => {
  const resolvedDefaultLocale = normalizeLocaleCode(defaultLocale);
  const resolvedLocaleCodes = normalizeLocaleCodes(localeCodes, resolvedDefaultLocale);

  return modelFields.flatMap((field) => {
    if (field.hasLocales) {
      return resolvedLocaleCodes.map((code) => ({
        fieldId: field.id,
        locale: code,
        type: field.type,
        value: resolveEntryFieldValue(field, fields, {
          locale: code,
          defaultLocale: resolvedDefaultLocale,
          fallbackToDefaultLocale: true,
        }),
      }));
    }

    return [
      {
        fieldId: field.id,
        locale: resolvedDefaultLocale,
        type: field.type,
        value: resolveEntryFieldValue(field, fields, {
          locale: resolvedDefaultLocale,
          defaultLocale: resolvedDefaultLocale,
          fallbackToAnyLocale: true,
        }),
      },
    ];
  });
};
