/**
 * Field keys must be snake_case and begin with a letter.
 */
export const fieldKeyPattern = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u;

type ParseOptionalJsonResult =
  | {
      ok: true;
      value: unknown | null;
    }
  | {
      ok: false;
    };

const toSnakeCase = (input: string): string => {
  const normalized = input.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "");
  return normalized
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/_{2,}/gu, "_")
    .replace(/^_+|_+$/gu, "");
};

/**
 * Sanitizes free-form user input into a valid field-key candidate.
 */
export const sanitizeFieldKey = (value: string): string => toSnakeCase(value);

/**
 * Generates a field key from the current field name.
 */
export const generateFieldKeyFromName = (value: string): string => toSnakeCase(value);

/**
 * Trims strings and returns undefined when they are empty.
 */
export function cleanString(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Normalizes relation target ids while removing empties and duplicates.
 */
export function normalizeRelationIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  ids.forEach((id) => {
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    normalized.push(trimmed);
  });

  return normalized;
}

/**
 * Returns whether at least one relation target is selected.
 */
export const hasAllowedModelSelection = (ids: readonly string[]): boolean => normalizeRelationIds(ids).length > 0;

/**
 * Removes empty branches from nested payload objects.
 */
export function pruneObject<T extends Record<string, unknown>>(object: T): T | null {
  const result: Record<string, unknown> = {};

  Object.entries(object).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;

    if (Array.isArray(value)) {
      if (value.length > 0) {
        result[key] = value;
      }
      return;
    }

    if (typeof value === "object") {
      const nested = pruneObject(value as Record<string, unknown>);
      if (nested && Object.keys(nested).length > 0) {
        result[key] = nested;
      }
      return;
    }

    result[key] = value;
  });

  return Object.keys(result).length > 0 ? (result as T) : null;
}

/**
 * Parses optional JSON input, treating empty text as null.
 */
export function parseOptionalJson(input: string): ParseOptionalJsonResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: true, value: null };
  }

  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    return { ok: false };
  }
}

/**
 * Returns whether an optional JSON text value is syntactically valid.
 */
export const isOptionalJsonValid = (text: string): boolean => parseOptionalJson(text).ok;
