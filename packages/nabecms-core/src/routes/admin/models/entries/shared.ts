/** Shared Admin entry route contracts and atomic D1 service wiring. */
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import * as schema from "../../../../database/schema";
import {
  BulkUniqueFieldConflictError,
  EntryQueryBudgetExceededError,
  type EntriesServiceDeps,
  EntryFieldValidationError,
  EntryFieldNotFoundError,
  EntryLocaleNotFoundError,
  EntryModelNotFoundError,
  EntryNotFoundError,
  EntryReferencedError,
  EntryRevisionNotFoundError,
  UniqueFieldConflictError,
} from "../../../../services/entries";
import { createD1EntriesServiceDeps } from "../../../../services/entries-d1";
import {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_REPLAYED_HEADER,
  IdempotencyKeyRequiredError,
  IdempotencyKeyReusedError,
  InvalidIdempotencyKeyError,
  isIdempotencyRecordConflict,
  prepareIdempotencyRequest,
  resolveCommittedIdempotencyReplay,
  type IdempotencyReplay,
} from "../../../../services/idempotency";
import {
  requireActor as requireAdminActor,
  requirePermission as requireAdminPermission,
  type Actor as AdminActor,
} from "../../_authz";

export type StoredRevisionField = {
  fieldId: string;
  locale: string;
  type: string;
  valueString: string | null;
  valueNumber: number | null;
  valueDate: string | null;
  valueBoolean: boolean | null;
  valueJson: unknown;
  valueMedia: string | null;
  valueRelation: unknown;
};

export type StoredRevisionContent = {
  status: string;
  fields: StoredRevisionField[];
};

export type SheetMode = "draft" | "published";

export const fieldTypeValues = [
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

export type FieldType = (typeof fieldTypeValues)[number];

export type SheetEntryFieldValue = {
  fieldId: string;
  locale: string;
  type: FieldType;
  value: unknown;
};

export type SheetFieldRow = {
  entryId: string;
  fieldId: string;
  locale: string;
  fieldType: string;
  valueString: string | null;
  valueNumber: number | null;
  valueDate: string | null;
  valueBoolean: boolean | null;
  valueJson: unknown;
  valueMedia: string | null;
  valueRelation: unknown;
};

export type Actor = AdminActor;

const fieldTypes = new Set<string>(fieldTypeValues);

/**
 * Resolve the stored media value, supporting both legacy single IDs and multiple-ID JSON snapshots.
 */
export function mapMediaFieldValue(
  valueMedia: string | null,
  valueJson: unknown,
): string | string[] | null {
  if (Array.isArray(valueJson)) {
    return valueJson
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  return valueMedia ?? null;
}

/** Resolve a stored list value into the API's array shape. */
export function mapListFieldValue(valueJson: unknown): unknown[] {
  return Array.isArray(valueJson) ? valueJson : [];
}

export const createEntrySchema = z.object({
  status: z.enum(["draft", "published", "archived"]),
  fields: z
    .array(
      z.object({
        fieldId: z.string(),
        locale: z.string().optional().nullable(),
        value: z.unknown(),
      }),
    )
    .optional(),
});

export const publishSchema = z.object({
  revisionId: z.string().optional().nullable(),
});

export const bulkSchema = z.object({
  action: z.enum(["publish", "unpublish", "delete"]),
  entryIds: z.array(z.string()).min(1).max(50),
});

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * Parse a comma-separated entryIds query parameter.
 */
export const parseEntryIdsParam = (
  raw: string | null | undefined,
): string[] => {
  if (!raw) return [];
  const unique = new Set<string>();
  raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .forEach((value) => unique.add(value));
  return Array.from(unique);
};

/**
 * Convert a revision snapshot field into a plain value.
 */
export function mapSnapshotValue(field: StoredRevisionField): unknown {
  switch (field.type) {
    case "text":
      return field.valueString ?? "";
    case "number":
      return field.valueNumber ?? null;
    case "date":
      return field.valueDate ?? null;
    case "boolean":
      return field.valueBoolean ?? false;
    case "media":
      return mapMediaFieldValue(field.valueMedia, field.valueJson);
    case "relation":
      return field.valueRelation ?? null;
    case "list":
      return mapListFieldValue(field.valueJson);
    case "rich_text":
    case "json":
    case "custom":
    default:
      return field.valueJson ?? null;
  }
}

/**
 * Normalize a raw field type into a known FieldType value.
 */
export const normalizeEntryFieldType = (raw: unknown): FieldType =>
  typeof raw === "string" && fieldTypes.has(raw) ? (raw as FieldType) : "text";

/**
 * Convert a stored entry field row to a sheet-friendly value object.
 */
export const toSheetEntryFieldValue = (
  row: SheetFieldRow,
): SheetEntryFieldValue => {
  const type = normalizeEntryFieldType(row.fieldType);
  let value: unknown = null;
  switch (type) {
    case "text":
      value = row.valueString ?? "";
      break;
    case "number":
      value = row.valueNumber ?? null;
      break;
    case "date":
      value = row.valueDate ?? null;
      break;
    case "boolean":
      value = Boolean(row.valueBoolean);
      break;
    case "media":
      value = mapMediaFieldValue(row.valueMedia, row.valueJson);
      break;
    case "relation":
      value = row.valueRelation ?? null;
      break;
    case "list":
      value = mapListFieldValue(row.valueJson);
      break;
    case "rich_text":
    case "json":
    case "custom":
    default:
      value = row.valueJson ?? null;
      break;
  }
  return {
    fieldId: row.fieldId,
    locale: row.locale,
    type,
    value,
  };
};

/**
 * Map a draft revision payload into sheet-friendly field values.
 */
export const toDraftSheetFields = (
  content: StoredRevisionContent | null,
): SheetEntryFieldValue[] => {
  const fields = Array.isArray(content?.fields) ? content.fields : [];
  return fields.map((field) => ({
    fieldId: field.fieldId,
    locale: field.locale,
    type: normalizeEntryFieldType(field.type),
    value: mapSnapshotValue(field),
  }));
};

/**
 * Resolve the default locale code from locale rows.
 */
export const resolveDefaultLocaleCode = (
  locales: Array<{ code: string; isDefault?: boolean | null }>,
): string => {
  const match = locales.find((item) => item.isDefault);
  if (match?.code) return match.code;
  return locales[0]?.code ?? "en";
};

/**
 * Resolve the field value for a locale, falling back when needed.
 */
export const resolveFieldValueForLocale = (
  fields: SheetEntryFieldValue[],
  fieldId: string,
  locale: string,
): SheetEntryFieldValue | null => {
  const exact = fields.find(
    (item) => item.fieldId === fieldId && item.locale === locale,
  );
  if (exact) return exact;
  return fields.find((item) => item.fieldId === fieldId) ?? null;
};

/**
 * Render a field value into a display-friendly title string.
 */
export const toDisplayTitle = (type: FieldType, value: unknown): string => {
  if (value == null) return "";
  switch (type) {
    case "text":
      return typeof value === "string" ? value : String(value);
    case "number":
      return typeof value === "number" ? value.toString() : String(value);
    case "date":
      return typeof value === "string" ? value : String(value);
    case "boolean":
      return value ? "true" : "false";
    case "relation": {
      const record = isRecord(value) ? value : {};
      const ids = Array.isArray(record.entryIds) ? record.entryIds : [];
      return ids.length > 0 ? `Related: ${ids.join(", ")}` : "";
    }
    case "rich_text":
    case "json":
    case "list":
    case "custom": {
      const record = isRecord(value) ? value : null;
      const nestedValue = record && "value" in record ? record.value : value;
      try {
        return JSON.stringify(nestedValue);
      } catch {
        return String(nestedValue ?? "");
      }
    }
    case "media":
    default:
      return typeof value === "string" ? value : String(value);
  }
};

/**
 * Resolve an entry title from the configured title field values.
 */
export const resolveEntryDisplayTitle = ({
  entryId,
  fields,
  titleFieldId,
  defaultLocale,
}: {
  entryId: string;
  fields: SheetEntryFieldValue[];
  titleFieldId: string | null | undefined;
  defaultLocale: string;
}): string => {
  if (!titleFieldId) return entryId;

  const resolved = resolveFieldValueForLocale(
    fields,
    titleFieldId,
    defaultLocale,
  );
  if (!resolved) return entryId;

  const titleText = toDisplayTitle(resolved.type, resolved.value);
  return titleText.trim().length > 0 ? titleText : entryId;
};

/**
 * Merge draft fields with published fields by fieldId+locale.
 */
export const mergeSheetFields = (
  primary: SheetEntryFieldValue[],
  fallback: SheetEntryFieldValue[],
): SheetEntryFieldValue[] => {
  const merged = new Map<string, SheetEntryFieldValue>();
  for (const field of fallback) {
    merged.set(`${field.fieldId}:${field.locale}`, field);
  }
  for (const field of primary) {
    merged.set(`${field.fieldId}:${field.locale}`, field);
  }
  return Array.from(merged.values());
};

/**
 * Create a typed Drizzle database instance from the Hono context.
 */
export function getDrizzleDb(c: any) {
  if (!c.env || !c.env.DB) {
    throw new Error("DB binding 'DB' is not configured");
  }
  return drizzle(c.env.DB, { schema });
}

/**
 * Render a standard database binding error response.
 */
export function handleDatabaseBindingError(
  c: any,
  context: string,
  error: unknown,
): Response {
  console.error(`Database binding missing for ${context}`, error);
  return c.json(
    {
      error: {
        code: "DATABASE_BINDING_MISSING",
        message: "DB binding is not configured",
      },
    },
    500,
  );
}

/**
 * Ensure a request is authenticated as an admin actor.
 */
export async function requireActor(c: any): Promise<Response | Actor> {
  return await requireAdminActor(c);
}

/**
 * Ensure an authenticated entry actor owns one of the required permissions.
 * @param c - Hono context
 * @param actor - Authenticated actor
 * @param required - Permission or alternative permission set
 * @returns Response when forbidden, otherwise void
 */
export async function requirePermission(
  c: any,
  actor: Actor,
  required: string | readonly string[],
): Promise<Response | void> {
  return await requireAdminPermission(c, actor, required);
}

/**
 * Create service dependencies for the entries service layer.
 */
export function createDeps(c: any): EntriesServiceDeps {
  const drizzleDb = getDrizzleDb(c);
  return createD1EntriesServiceDeps(drizzleDb);
}

const renderIdempotencyResponse = (
  c: any,
  response: {
    responseStatus: number;
    responseBody: unknown;
  },
  replayed: boolean,
): Response => {
  if (replayed) {
    c.header(IDEMPOTENCY_REPLAYED_HEADER, "true");
  }
  if (response.responseStatus === 204) {
    return c.body(null, 204);
  }
  return c.json(response.responseBody, response.responseStatus);
};

const handleIdempotencyError = (c: any, error: unknown): Response | null => {
  if (error instanceof IdempotencyKeyRequiredError) {
    return c.json(
      {
        error: {
          code: "IDEMPOTENCY_KEY_REQUIRED",
          message: error.message,
        },
      },
      400,
    );
  }
  if (error instanceof InvalidIdempotencyKeyError) {
    return c.json(
      {
        error: {
          code: "INVALID_IDEMPOTENCY_KEY",
          message: error.message,
        },
      },
      400,
    );
  }
  if (error instanceof IdempotencyKeyReusedError) {
    return c.json(
      {
        error: {
          code: "IDEMPOTENCY_KEY_REUSED",
          message: error.message,
        },
      },
      409,
    );
  }
  return null;
};

const getCanonicalQuery = (url: string): Array<[string, string]> =>
  Array.from(new URL(url).searchParams.entries()).sort(
    ([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue),
  );

/**
 * Execute one Entry mutation with an atomic result record, or replay the
 * previously committed HTTP response for the same principal and key.
 */
export async function runIdempotentEntryMutation<T>(
  c: any,
  options: {
    actorId: string;
    operation: string;
    requestBody: unknown;
    responseStatus: number;
    createResponseBody: (result: T) => unknown;
    execute: (deps: EntriesServiceDeps) => Promise<T>;
    databaseContext: string;
    handleError: (error: unknown) => Response;
  },
): Promise<Response> {
  let drizzleDb;
  try {
    drizzleDb = getDrizzleDb(c);
  } catch (error) {
    return handleDatabaseBindingError(c, options.databaseContext, error);
  }

  let prepared;
  try {
    prepared = await prepareIdempotencyRequest(drizzleDb, {
      key: c.req.header(IDEMPOTENCY_KEY_HEADER),
      principalId: options.actorId,
      operation: options.operation,
      request: {
        method: c.req.method,
        path: c.req.path,
        query: getCanonicalQuery(c.req.url),
        body: options.requestBody,
      },
    });
  } catch (error) {
    return handleIdempotencyError(c, error) ?? options.handleError(error);
  }

  if (prepared.kind === "replay") {
    return renderIdempotencyResponse(c, prepared, true);
  }

  const deps = createD1EntriesServiceDeps(drizzleDb, {
    idempotency: {
      record: prepared.record,
      responseStatus: options.responseStatus,
      createResponseBody: (result) => options.createResponseBody(result as T),
    },
  });

  try {
    const result = await options.execute(deps);
    return renderIdempotencyResponse(
      c,
      {
        responseStatus: options.responseStatus,
        responseBody: options.createResponseBody(result),
      },
      false,
    );
  } catch (error) {
    if (isIdempotencyRecordConflict(error)) {
      try {
        const replay: IdempotencyReplay | null =
          await resolveCommittedIdempotencyReplay(drizzleDb, prepared.record);
        if (replay) {
          return renderIdempotencyResponse(c, replay, true);
        }
      } catch (replayError) {
        return (
          handleIdempotencyError(c, replayError) ??
          options.handleError(replayError)
        );
      }
    }
    return handleIdempotencyError(c, error) ?? options.handleError(error);
  }
}

/**
 * Convert entry service domain errors into HTTP responses.
 */
export function handleEntriesMutationError(
  c: any,
  error: unknown,
  messages: {
    fallbackCode: string;
    fallbackMessage: string;
    notFoundCode?: string;
    notFoundMessage?: string;
    includeRevisionNotFound?: boolean;
  },
): Response {
  if (error instanceof EntryModelNotFoundError) {
    return c.json(
      { error: { code: "NOT_FOUND", message: error.message } },
      404,
    );
  }
  if (error instanceof EntryFieldNotFoundError) {
    return c.json(
      { error: { code: "FIELD_NOT_FOUND", message: error.message } },
      400,
    );
  }
  if (error instanceof EntryFieldValidationError) {
    return c.json(
      {
        error: {
          code: "FIELD_VALIDATION_FAILED",
          message: error.message,
          fieldId: error.fieldId,
          reason: error.reason,
        },
      },
      400,
    );
  }
  if (error instanceof EntryLocaleNotFoundError) {
    return c.json(
      {
        error: {
          code: "LOCALE_NOT_FOUND",
          message: error.message,
          locale: error.locale,
        },
      },
      400,
    );
  }
  if (error instanceof EntryNotFoundError) {
    return c.json(
      {
        error: {
          code: messages.notFoundCode ?? "ENTRY_NOT_FOUND",
          message:
            error.message ?? messages.notFoundMessage ?? "Entry not found",
        },
      },
      404,
    );
  }
  if (
    messages.includeRevisionNotFound &&
    error instanceof EntryRevisionNotFoundError
  ) {
    return c.json(
      { error: { code: "REVISION_NOT_FOUND", message: error.message } },
      404,
    );
  }
  if (error instanceof UniqueFieldConflictError) {
    return c.json(
      {
        error: {
          code: "UNIQUE_FIELD_CONFLICT",
          message: error.message,
          fieldId: error.fieldId,
          locale: error.locale,
          conflictingEntryId: error.conflictingEntryId,
        },
      },
      409,
    );
  }
  if (error instanceof BulkUniqueFieldConflictError) {
    return c.json(
      {
        error: {
          code: "ENTRY_BULK_UNIQUE_CONFLICT",
          message: error.message,
          conflicts: error.conflicts,
        },
      },
      409,
    );
  }
  if (error instanceof EntryQueryBudgetExceededError) {
    return c.json(
      {
        error: {
          code: "ENTRY_QUERY_BUDGET_EXCEEDED",
          message: error.message,
          estimatedQueries: error.estimatedQueries,
          maxQueries: error.maxQueries,
        },
      },
      400,
    );
  }
  if (error instanceof EntryReferencedError) {
    return c.json(
      {
        error: {
          code: "ENTRY_REFERENCED",
          message: error.message,
          entryId: error.entryId,
          references: error.references,
        },
      },
      409,
    );
  }

  console.error(messages.fallbackMessage, error);
  return c.json(
    {
      error: {
        code: messages.fallbackCode,
        message: messages.fallbackMessage,
      },
    },
    500,
  );
}
