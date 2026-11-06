import type { SheetEntryFieldValue } from "./shared";

/**
 * Supported sort directions for the entry sheet API.
 */
export type SheetSortOrder = "asc" | "desc";

/**
 * Supported system columns for the entry sheet API.
 */
export type SheetSystemSortKey =
  "displayTitle" | "status" | "updatedAt" | "updatedBy";

/**
 * Full sort key surface for the entry sheet API.
 */
export type SheetSortBy = SheetSystemSortKey | `field:${string}`;

/**
 * Parsed sort request for the entry sheet API.
 */
export type SheetSortState = {
  sortBy: SheetSortBy;
  sortOrder: SheetSortOrder;
};

type SortableModelField = {
  id: string;
  type: string;
  hasLocales: boolean;
};

type SortableSheetItem = {
  id: string;
  displayTitle: string;
  status: string;
  updatedAt: string;
  updatedBy: string;
  updatedByName: string | null;
  fields: SheetEntryFieldValue[];
};

type SortToken =
  | { empty: true; kind: "string"; value: "" }
  | { empty: false; kind: "number"; value: number }
  | { empty: false; kind: "string"; value: string };

const systemSortKeys = new Set<SheetSystemSortKey>([
  "displayTitle",
  "status",
  "updatedAt",
  "updatedBy",
]);

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

/**
 * Parse query values into a validated entry sheet sort state.
 */
export const parseSheetSort = (
  rawSortBy: string | null | undefined,
  rawSortOrder: string | null | undefined,
): SheetSortState | null => {
  if (!rawSortBy) return null;

  const sortBy = rawSortBy.trim();
  if (!sortBy) return null;

  const sortOrder: SheetSortOrder = rawSortOrder === "desc" ? "desc" : "asc";

  if (systemSortKeys.has(sortBy as SheetSystemSortKey)) {
    return {
      sortBy: sortBy as SheetSystemSortKey,
      sortOrder,
    };
  }

  if (sortBy.startsWith("field:") && sortBy.slice("field:".length).length > 0) {
    return {
      sortBy: sortBy as SheetSortBy,
      sortOrder,
    };
  }

  return null;
};

/**
 * Sort sheet items for the admin entry sheet response.
 */
export const sortSheetItems = <T extends SortableSheetItem>(
  items: readonly T[],
  params: {
    sort: SheetSortState | null;
    locale: string;
    defaultLocale: string;
    modelFields: readonly SortableModelField[];
  },
): T[] => {
  const { sort } = params;
  if (!sort) return [...items];

  if (sort.sortBy.startsWith("field:")) {
    const fieldId = sort.sortBy.slice("field:".length);
    const field = params.modelFields.find((item) => item.id === fieldId);
    if (!field) return [...items];

    return [...items].sort(
      (left, right) =>
        compareSortTokens(
          resolveFieldToken(left, field, params.locale, params.defaultLocale),
          resolveFieldToken(right, field, params.locale, params.defaultLocale),
          sort.sortOrder,
        ) || collator.compare(left.id, right.id),
    );
  }

  const systemSortBy = sort.sortBy as SheetSystemSortKey;

  return [...items].sort(
    (left, right) =>
      compareSortTokens(
        resolveSystemToken(left, systemSortBy),
        resolveSystemToken(right, systemSortBy),
        sort.sortOrder,
      ) || collator.compare(left.id, right.id),
  );
};

/**
 * Resolve the field value to compare for a localized sheet sort.
 */
const resolveFieldToken = (
  item: SortableSheetItem,
  field: SortableModelField,
  locale: string,
  defaultLocale: string,
): SortToken => {
  const value = resolveFieldValue(item.fields, field, locale, defaultLocale);
  return toSortToken(field.type, value);
};

/**
 * Resolve the system column value to compare.
 */
const resolveSystemToken = (
  item: SortableSheetItem,
  sortBy: SheetSystemSortKey,
): SortToken => {
  switch (sortBy) {
    case "displayTitle":
      return toStringToken(item.displayTitle);
    case "status":
      return toStringToken(item.status);
    case "updatedAt":
      return toDateToken(item.updatedAt);
    case "updatedBy":
      return toStringToken(item.updatedByName ?? item.updatedBy);
    default:
      return toStringToken(item.id);
  }
};

/**
 * Resolve the most appropriate field value for sorting.
 */
const resolveFieldValue = (
  fields: readonly SheetEntryFieldValue[],
  field: SortableModelField,
  locale: string,
  defaultLocale: string,
): unknown => {
  if (!field.hasLocales) {
    return fields.find((item) => item.fieldId === field.id)?.value ?? null;
  }

  return (
    fields.find((item) => item.fieldId === field.id && item.locale === locale)
      ?.value ??
    fields.find(
      (item) => item.fieldId === field.id && item.locale === defaultLocale,
    )?.value ??
    fields.find((item) => item.fieldId === field.id)?.value ??
    null
  );
};

/**
 * Convert a raw field value into a comparable token.
 */
const toSortToken = (fieldType: string, value: unknown): SortToken => {
  if (value == null) return { empty: true, kind: "string", value: "" };

  switch (fieldType) {
    case "number":
      return toNumberToken(value);
    case "boolean":
      return typeof value === "boolean"
        ? { empty: false, kind: "number", value: value ? 1 : 0 }
        : toNumberToken(value);
    case "date":
      return toDateToken(value);
    case "text":
    case "rich_text":
    case "list":
    case "media":
    case "json":
    case "relation":
    case "custom":
    default:
      return toStringToken(value);
  }
};

/**
 * Convert a raw value into a numeric sort token.
 */
const toNumberToken = (value: unknown): SortToken => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return { empty: false, kind: "number", value };
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return { empty: false, kind: "number", value: parsed };
    }
  }

  return { empty: true, kind: "string", value: "" };
};

/**
 * Convert a raw value into a date-aware sort token.
 */
const toDateToken = (value: unknown): SortToken => {
  if (typeof value === "string" && value.trim().length > 0) {
    const timestamp = Date.parse(value);
    if (!Number.isNaN(timestamp)) {
      return { empty: false, kind: "number", value: timestamp };
    }
  }

  return toStringToken(value);
};

/**
 * Convert a raw value into a string sort token.
 */
const toStringToken = (value: unknown): SortToken => {
  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized) return { empty: true, kind: "string", value: "" };
    return { empty: false, kind: "string", value: normalized };
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return { empty: false, kind: "number", value };
  }

  if (typeof value === "boolean") {
    return { empty: false, kind: "number", value: value ? 1 : 0 };
  }

  if (Array.isArray(value) || typeof value === "object") {
    const serialized = JSON.stringify(value);
    if (!serialized || serialized === "{}" || serialized === "[]") {
      return { empty: true, kind: "string", value: "" };
    }
    return { empty: false, kind: "string", value: serialized };
  }

  return { empty: true, kind: "string", value: "" };
};

/**
 * Compare two sort tokens with stable empty-last semantics.
 */
const compareSortTokens = (
  left: SortToken,
  right: SortToken,
  sortOrder: SheetSortOrder,
): number => {
  if (left.empty && right.empty) return 0;
  if (left.empty) return 1;
  if (right.empty) return -1;

  let result = 0;
  if (left.kind === "number" && right.kind === "number") {
    result = left.value - right.value;
  } else {
    result = collator.compare(String(left.value), String(right.value));
  }

  return sortOrder === "desc" ? result * -1 : result;
};
