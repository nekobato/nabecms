/**
 * Entry validation and atomic lifecycle orchestration.
 */
import { sanitizeAuditSnapshot, type AuditLogSnapshot } from "../lib/audit-log";
import type {
  EntriesRepository,
  ModelFieldRecord,
  EntryRecord,
  EntryFieldInsert,
  EntryUpdate,
  EntryRevisionRecord,
  ModelWithFields,
} from "../repositories/entries";
import type {
  DateFieldFormat,
  ListFieldOptions,
  MediaFieldOptions,
  RelationFieldOptions,
  RelationFieldVariant,
} from "../contracts";
import { validateJsonFieldValue } from "../contracts/json-schema";
import type { MediaRepository } from "../repositories/media";
import {
  collectEntryReferenceIds,
  removeEntryReferences,
} from "../utils/entry-reference";

export type EntriesWriteRepository = Pick<
  EntriesRepository,
  | "insertEntry"
  | "insertEntryFields"
  | "updateEntry"
  | "deleteEntryFields"
  | "deleteEntryRevisions"
  | "deleteEntry"
  | "insertEntryRevision"
  | "updateEntryRevision"
  | "updateEntryFieldReferenceValues"
>;

export type EntriesAtomicWriteContext = {
  repo: EntriesWriteRepository;
  logAuditEvent: (entry: AuditLogEntry) => Promise<void>;
};

export type EntriesServiceDeps = {
  repo: EntriesRepository;
  mediaRepo: Pick<MediaRepository, "findByIds">;
  generateId: (prefix: "entry" | "entry_field" | "entry_revision") => string;
  now: () => Date;
  runAtomicWrite: <T>(
    work: (context: EntriesAtomicWriteContext) => Promise<T>,
  ) => Promise<T>;
};

export type AuditLogEntry = {
  actorId: string;
  action: string;
  targetTable: string;
  targetId: string;
  before: AuditLogSnapshot | null;
  after: AuditLogSnapshot | null;
};

export type CreateEntryFieldInput = {
  fieldId: string;
  locale?: string | null;
  value: unknown;
};

export type CreateEntryParams = {
  actorId: string;
  modelId: string;
  status: "draft" | "published" | "archived";
  fields?: CreateEntryFieldInput[];
};

export type UpdateEntryParams = {
  actorId: string;
  entryId: string;
  modelId: string;
  status: "draft" | "published" | "archived";
  fields?: CreateEntryFieldInput[];
};

export type CreatedEntry = {
  id: string;
  modelId: string;
  status: "draft" | "published" | "archived";
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
};

export type UpdatedEntry = {
  id: string;
  modelId: string;
  status: "draft" | "published" | "archived";
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
};

export type PublishEntryRevisionParams = {
  actorId: string;
  entryId: string;
  modelId: string;
  revisionId?: string | null;
};

export type BulkPublishEntriesParams = {
  actorId: string;
  modelId: string;
  entryIds: string[];
};

export type RestoreEntryRevisionParams = {
  actorId: string;
  entryId: string;
  modelId: string;
  revisionId: string;
};

export type UnpublishEntryParams = {
  actorId: string;
  entryId: string;
  modelId: string;
};

export type DeleteEntryParams = {
  actorId: string;
  entryId: string;
  modelId: string;
  referenceAction?: "restrict" | "detach";
};

export type EntryReferenceUsage = {
  kind: "relation" | "rich_text";
  source: "entry_field" | "draft_revision";
  entryId: string;
  fieldId: string;
  entryFieldId?: string;
  revisionId?: string;
};

/** Raised when an entry mutation targets a model that does not exist. */
export class EntryModelNotFoundError extends Error {
  constructor(public readonly modelId: string) {
    super(`Model ${modelId} not found`);
  }
}

/** Raised when an entry mutation targets a field that does not exist. */
export class EntryFieldNotFoundError extends Error {
  constructor(public readonly fieldId: string) {
    super(`Field ${fieldId} not found`);
  }
}

/** Raised when an entry field value does not match its model field definition. */
export class EntryFieldValidationError extends Error {
  constructor(
    public readonly fieldId: string,
    public readonly reason: string,
  ) {
    super(`Field ${fieldId} is invalid: ${reason}`);
  }
}

/** Raised when an entry field references a locale that is not configured. */
export class EntryLocaleNotFoundError extends Error {
  constructor(public readonly locale: string) {
    super(`Locale ${locale} not found`);
  }
}

/** Raised when an entry mutation targets an entry that does not exist. */
export class EntryNotFoundError extends Error {
  constructor(public readonly entryId: string) {
    super(`Entry ${entryId} not found`);
  }
}

/** Raised when an entry mutation targets a revision that does not exist. */
export class EntryRevisionNotFoundError extends Error {
  constructor(public readonly revisionId: string) {
    super(`Entry revision ${revisionId} not found`);
  }
}

/** Raised when one published field conflicts with an existing unique value. */
export class UniqueFieldConflictError extends Error {
  constructor(
    public readonly fieldId: string,
    public readonly locale: string,
    public readonly conflictingEntryId: string | null,
  ) {
    super(
      `Unique constraint violated for field ${fieldId} (${locale})` +
        (conflictingEntryId ? ` conflicting entry ${conflictingEntryId}` : ""),
    );
  }
}

export type BulkUniqueFieldConflict = {
  entryId: string;
  fieldId: string;
  locale: string;
  conflictingEntryId: string | null;
  scope: "selection" | "published";
};

/** Raised when a bulk publish preflight finds unique field conflicts. */
export class BulkUniqueFieldConflictError extends Error {
  constructor(public readonly conflicts: BulkUniqueFieldConflict[]) {
    super("Bulk publish has unique field conflicts");
  }
}

/**
 * Maximum bulk-publish service query estimate accepted per request.
 *
 * Workers Paid permits 1,000 D1 queries per invocation. The remaining 200
 * queries are reserved for authentication, authorization, and route wiring.
 */
export const ENTRY_D1_QUERY_BUDGET = 800;

/** Raised before an entry mutation can exceed its reserved D1 query budget. */
export class EntryQueryBudgetExceededError extends Error {
  constructor(
    public readonly estimatedQueries: number,
    public readonly maxQueries: number,
  ) {
    super(
      `Entry mutation requires an estimated ${estimatedQueries} D1 queries; maximum is ${maxQueries}`,
    );
  }
}

/** Raised when an entry cannot be deleted while references still exist. */
export class EntryReferencedError extends Error {
  constructor(
    public readonly entryId: string,
    public readonly references: EntryReferenceUsage[],
  ) {
    super(`Entry ${entryId} is referenced by other entries`);
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * Validate and normalize a JSON entry value without mutating caller-owned data.
 */
function normalizeJsonFieldValue(
  field: ModelFieldRecord,
  value: unknown,
): unknown {
  const options: Record<string, unknown> = isRecord(field.options)
    ? field.options
    : {};
  const result = validateJsonFieldValue(
    options.schema,
    options.stripUnknown === true,
    value,
  );
  if (result.valid) return result.value;
  throw new EntryFieldValidationError(field.id, result.error);
}

function getRichTextDocument(value: unknown): unknown {
  return isRecord(value) && value.type === "rich_text" && "value" in value
    ? value.value
    : value;
}

function getRevisionFields(content: unknown): RevisionFieldSnapshot[] {
  if (!isRecord(content) || !Array.isArray(content.fields)) return [];
  return content.fields.filter((field): field is RevisionFieldSnapshot =>
    isRecord(field),
  );
}

function getRelationEntryIds(value: unknown): string[] {
  if (!value) return [];
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }

  if (Array.isArray(parsed)) {
    return parsed
      .map((id) => (typeof id === "string" ? id : ""))
      .filter((id) => id.length > 0);
  }

  if (isRecord(parsed) && Array.isArray(parsed.entryIds)) {
    return parsed.entryIds
      .map((id) => (typeof id === "string" ? id : ""))
      .filter((id) => id.length > 0);
  }

  return [];
}

function removeRelationEntryId(value: unknown, targetEntryId: string): unknown {
  if (!value) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return JSON.stringify(removeRelationEntryId(parsed, targetEntryId));
    } catch {
      return value;
    }
  }

  if (Array.isArray(value)) {
    return value.filter((id) => id !== targetEntryId);
  }

  if (isRecord(value) && Array.isArray(value.entryIds)) {
    return {
      ...value,
      entryIds: value.entryIds.filter((id) => id !== targetEntryId),
    };
  }

  return value;
}

type ListItemType = ListFieldOptions["item"]["type"];

const listItemTypes = new Set<ListItemType>([
  "text",
  "number",
  "date",
  "boolean",
]);

const relationVariants = new Set<RelationFieldVariant>(["one", "many"]);
const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/u;
const decimalNumberLiteralPattern =
  /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/u;
const dateTimeLocalPattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/u;
const dateTimeWithTimezonePattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/u;
const dateFieldFormats = new Set<DateFieldFormat>([
  "date",
  "datetime",
  "datetime_with_timezone",
]);

type DateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/** Parse a fixed-width decimal date/time part. */
function parseDateTimePart(value: string | undefined): number {
  return Number.parseInt(value ?? "0", 10);
}

/** Return whether date/time parts describe a real UTC calendar instant. */
function isValidDateTimeParts(parts: DateTimeParts): boolean {
  const parsed = new Date(0);
  parsed.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  parsed.setUTCHours(parts.hour, parts.minute, parts.second, 0);

  return (
    parsed.getUTCFullYear() === parts.year &&
    parsed.getUTCMonth() === parts.month - 1 &&
    parsed.getUTCDate() === parts.day &&
    parsed.getUTCHours() === parts.hour &&
    parsed.getUTCMinutes() === parts.minute &&
    parsed.getUTCSeconds() === parts.second
  );
}

/** Build date/time parts from regex captures. */
function getDateTimeParts(match: RegExpMatchArray): DateTimeParts {
  return {
    year: parseDateTimePart(match[1]),
    month: parseDateTimePart(match[2]),
    day: parseDateTimePart(match[3]),
    hour: parseDateTimePart(match[4]),
    minute: parseDateTimePart(match[5]),
    second: parseDateTimePart(match[6]),
  };
}

/** Resolve the configured date field format with legacy variant fallback. */
function resolveDateFormat(field: ModelFieldRecord): DateFieldFormat {
  const options: Record<string, unknown> = isRecord(field.options)
    ? field.options
    : {};
  const format = options.format;
  if (
    typeof format === "string" &&
    dateFieldFormats.has(format as DateFieldFormat)
  ) {
    return format as DateFieldFormat;
  }
  return field.variant === "datetime" ? "datetime" : "date";
}

/** Validate a timezone offset capture from an ISO date-time string. */
function isValidTimezoneOffset(value: string): boolean {
  if (value === "Z") return true;
  const hour = Number.parseInt(value.slice(1, 3), 10);
  const minute = Number.parseInt(value.slice(4, 6), 10);
  return hour <= 23 && minute <= 59;
}

/** Normalize a date-only field value to YYYY-MM-DD. */
function normalizeDateOnlyFieldValue(
  field: ModelFieldRecord,
  value: string,
): string {
  if (!dateOnlyPattern.test(value)) {
    throw new EntryFieldValidationError(
      field.id,
      "date values must use YYYY-MM-DD strings",
    );
  }

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!match) {
    throw new EntryFieldValidationError(
      field.id,
      "date values must use YYYY-MM-DD strings",
    );
  }

  const parts = {
    ...getDateTimeParts(match),
    hour: 0,
    minute: 0,
    second: 0,
  };
  if (!isValidDateTimeParts(parts)) {
    throw new EntryFieldValidationError(
      field.id,
      "date values must be valid calendar dates",
    );
  }

  return value;
}

/** Normalize a timezone-less datetime field value to seconds precision. */
function normalizeDateTimeFieldValue(
  field: ModelFieldRecord,
  value: string,
): string {
  const match = value.match(dateTimeLocalPattern);
  if (!match) {
    throw new EntryFieldValidationError(
      field.id,
      "datetime values must use timezone-less ISO strings",
    );
  }

  const parts = getDateTimeParts(match);
  if (!isValidDateTimeParts(parts)) {
    throw new EntryFieldValidationError(
      field.id,
      "datetime values must be valid calendar date-times",
    );
  }

  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${String(
    parts.second,
  ).padStart(2, "0")}`;
}

/** Normalize a timezone-aware datetime field value to UTC ISO. */
function normalizeTimezoneDateTimeFieldValue(
  field: ModelFieldRecord,
  value: string,
): string {
  const match = value.match(dateTimeWithTimezonePattern);
  if (!match || !isValidTimezoneOffset(match[7] ?? "")) {
    throw new EntryFieldValidationError(
      field.id,
      "datetime_with_timezone values must include a timezone offset",
    );
  }

  const parts = getDateTimeParts(match);
  if (!isValidDateTimeParts(parts)) {
    throw new EntryFieldValidationError(
      field.id,
      "datetime_with_timezone values must be valid calendar date-times",
    );
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new EntryFieldValidationError(
      field.id,
      "datetime_with_timezone values must be valid ISO date-times",
    );
  }

  return parsed.toISOString();
}

/** Validate and normalize a date field value according to its configured format. */
function normalizeDateFieldValue(
  field: ModelFieldRecord,
  value: unknown,
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new EntryFieldValidationError(
      field.id,
      "date values must be strings",
    );
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  const format = resolveDateFormat(field);
  switch (format) {
    case "date":
      return normalizeDateOnlyFieldValue(field, trimmed);
    case "datetime":
      return normalizeDateTimeFieldValue(field, trimmed);
    case "datetime_with_timezone":
      return normalizeTimezoneDateTimeFieldValue(field, trimmed);
    default: {
      const exhaustive: never = format;
      throw new EntryFieldValidationError(
        field.id,
        `unsupported date format ${exhaustive}`,
      );
    }
  }
}

/** Resolve the simple item type configured for a list field. */
function resolveListItemType(field: ModelFieldRecord): ListItemType {
  const options: Record<string, unknown> = isRecord(field.options)
    ? field.options
    : {};
  const item: Record<string, unknown> = isRecord(options.item)
    ? options.item
    : {};
  const type = typeof item.type === "string" ? item.type : options.itemType;

  return typeof type === "string" && listItemTypes.has(type as ListItemType)
    ? (type as ListItemType)
    : "text";
}

/** Validate and normalize a date-only list item. */
function normalizeListDateItem(
  field: ModelFieldRecord,
  value: unknown,
): string {
  if (typeof value !== "string" || !dateOnlyPattern.test(value)) {
    throw new EntryFieldValidationError(
      field.id,
      "list date items must use YYYY-MM-DD strings",
    );
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new EntryFieldValidationError(
      field.id,
      "list date items must be valid calendar dates",
    );
  }

  return value;
}

/** Validate and normalize one list item according to the configured item type. */
function normalizeListItem(
  field: ModelFieldRecord,
  itemType: ListItemType,
  value: unknown,
): string | number | boolean {
  switch (itemType) {
    case "text": {
      if (typeof value !== "string") {
        throw new EntryFieldValidationError(
          field.id,
          "list text items must be strings",
        );
      }
      return value;
    }
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new EntryFieldValidationError(
          field.id,
          "list number items must be finite numbers",
        );
      }
      return value;
    }
    case "date": {
      return normalizeListDateItem(field, value);
    }
    case "boolean": {
      if (typeof value !== "boolean") {
        throw new EntryFieldValidationError(
          field.id,
          "list boolean items must be booleans",
        );
      }
      return value;
    }
    default: {
      const exhaustive: never = itemType;
      throw new EntryFieldValidationError(
        field.id,
        `unsupported list item type ${exhaustive}`,
      );
    }
  }
}

/** Validate and normalize a list field value into a typed array. */
function normalizeListValue(
  field: ModelFieldRecord,
  value: unknown,
): Array<string | number | boolean> {
  if (value == null) return [];

  if (!Array.isArray(value)) {
    throw new EntryFieldValidationError(
      field.id,
      "list value must be an array",
    );
  }

  const itemType = resolveListItemType(field);
  return value.map((item) => normalizeListItem(field, itemType, item));
}

/** Parse entry number inputs while rejecting non-decimal string coercions. */
function parseNumberInput(
  field: ModelFieldRecord,
  value: unknown,
): number | null {
  if (value == null) return null;

  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
    throw new EntryFieldValidationError(
      field.id,
      "number values must be finite numbers",
    );
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    if (!decimalNumberLiteralPattern.test(trimmed)) {
      throw new EntryFieldValidationError(
        field.id,
        "number strings must be decimal numeric literals",
      );
    }

    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) return parsed;
    throw new EntryFieldValidationError(
      field.id,
      "number values must be finite numbers",
    );
  }

  throw new EntryFieldValidationError(
    field.id,
    "number values must be numbers or decimal numeric strings",
  );
}

/** Normalize a number field value according to its configured variant. */
function normalizeNumberValue(
  field: ModelFieldRecord,
  value: unknown,
): number | null {
  const parsed = parseNumberInput(field, value);
  if (parsed === null) return null;

  if (field.variant === "integer" && !Number.isSafeInteger(parsed)) {
    throw new EntryFieldValidationError(
      field.id,
      "integer number fields must be safe integers",
    );
  }

  return parsed;
}

type RelationValue = {
  type: RelationFieldVariant;
  entryIds: string[];
};

type RelationCheckCandidate = {
  field: ModelFieldRecord;
  value: unknown;
};

type MediaKind = NonNullable<MediaFieldOptions["allowedKinds"]>[number];

type MediaCheckCandidate = {
  field: ModelFieldRecord;
  mediaIds: readonly string[];
};

const mediaKinds = new Set<MediaKind>([
  "image",
  "video",
  "audio",
  "document",
  "archive",
]);

/** Resolve the allowed media kinds configured on a field. */
function resolveAllowedMediaKinds(field: ModelFieldRecord): Set<string> | null {
  const options: Record<string, unknown> = isRecord(field.options)
    ? field.options
    : {};
  const rawKinds = Array.isArray(options.allowedKinds)
    ? options.allowedKinds
    : [];
  const kinds = rawKinds
    .map((kind) => (typeof kind === "string" ? kind.trim() : ""))
    .filter((kind): kind is MediaKind => mediaKinds.has(kind as MediaKind));

  return kinds.length > 0 ? new Set(kinds) : null;
}

/** Extract normalized media IDs from persisted field columns. */
function getMediaIdsFromValues(
  field: ModelFieldRecord,
  values: ReturnType<typeof mapFieldValue>,
): string[] {
  if (field.type !== "media") return [];
  if (field.variant === "multiple") {
    return normalizeMediaIdList(values.valueJson);
  }
  return normalizeMediaIdList(values.valueMedia ?? values.valueJson);
}

/** Ensure referenced media records exist and match field kind constraints. */
async function ensureMediaConstraints(
  deps: EntriesServiceDeps,
  candidates: readonly MediaCheckCandidate[],
): Promise<void> {
  const activeCandidates = candidates.filter(
    (candidate) => candidate.mediaIds.length > 0,
  );
  if (activeCandidates.length === 0) return;

  const referencedMediaIds = Array.from(
    new Set(activeCandidates.flatMap((candidate) => candidate.mediaIds)),
  );
  const mediaRecords = await deps.mediaRepo.findByIds(referencedMediaIds);
  const mediaById = new Map(mediaRecords.map((media) => [media.id, media]));

  for (const candidate of activeCandidates) {
    const allowedKinds = resolveAllowedMediaKinds(candidate.field);
    for (const mediaId of candidate.mediaIds) {
      const media = mediaById.get(mediaId);
      if (!media) {
        throw new EntryFieldValidationError(
          candidate.field.id,
          `media '${mediaId}' does not exist`,
        );
      }
      if (allowedKinds && !allowedKinds.has(media.type)) {
        throw new EntryFieldValidationError(
          candidate.field.id,
          `media '${mediaId}' type '${media.type}' is not allowed`,
        );
      }
    }
  }
}

/** Resolve and validate the relation variant configured on a model field. */
function resolveRelationVariant(field: ModelFieldRecord): RelationFieldVariant {
  if (relationVariants.has(field.variant as RelationFieldVariant)) {
    return field.variant as RelationFieldVariant;
  }

  throw new EntryFieldValidationError(
    field.id,
    "relation fields require variant 'one' or 'many'",
  );
}

/** Resolve the allowed relation target models configured on a field. */
function resolveRelationOptions(field: ModelFieldRecord): RelationFieldOptions {
  const options: Record<string, unknown> = isRecord(field.options)
    ? field.options
    : {};
  const allowedModels = Array.isArray(options.allowedModels)
    ? options.allowedModels
        .map((id) => (typeof id === "string" ? id.trim() : ""))
        .filter((id) => id.length > 0)
    : [];

  if (allowedModels.length === 0) {
    throw new EntryFieldValidationError(
      field.id,
      "relation fields require options.allowedModels",
    );
  }

  return {
    ...(typeof options.unique === "boolean" ? { unique: options.unique } : {}),
    ...("validate" in options ? { validate: options.validate } : {}),
    allowedModels,
    ...(isRecord(options.filter) ? { filter: options.filter } : {}),
    ...(options.onDelete === "restrict" ||
    options.onDelete === "nullify" ||
    options.onDelete === "cascade"
      ? { onDelete: options.onDelete }
      : {}),
  };
}

/** Normalize relation entry IDs while rejecting malformed payloads. */
function normalizeRelationEntryIds(
  field: ModelFieldRecord,
  rawEntryIds: unknown,
): string[] {
  if (!Array.isArray(rawEntryIds)) {
    throw new EntryFieldValidationError(
      field.id,
      "relation value requires entryIds array",
    );
  }

  const ids: string[] = [];
  for (const entryId of rawEntryIds) {
    if (typeof entryId !== "string") {
      throw new EntryFieldValidationError(
        field.id,
        "relation entryIds must be strings",
      );
    }
    const trimmed = entryId.trim();
    if (trimmed.length > 0 && !ids.includes(trimmed)) {
      ids.push(trimmed);
    }
  }

  return ids;
}

/** Normalize a relation field value into the persisted relation shape. */
function normalizeRelationValue(
  field: ModelFieldRecord,
  value: unknown,
): RelationValue | null {
  const variant = resolveRelationVariant(field);
  if (value == null) return null;

  const entryIds = Array.isArray(value)
    ? normalizeRelationEntryIds(field, value)
    : isRecord(value)
      ? normalizeRelationEntryIds(field, value.entryIds)
      : (() => {
          throw new EntryFieldValidationError(
            field.id,
            "relation value must be an object with entryIds",
          );
        })();

  if (isRecord(value) && typeof value.type === "string") {
    if (!relationVariants.has(value.type as RelationFieldVariant)) {
      throw new EntryFieldValidationError(
        field.id,
        "relation value type must be 'one' or 'many'",
      );
    }
    if (value.type !== variant) {
      throw new EntryFieldValidationError(
        field.id,
        "relation value type must match the field variant",
      );
    }
  }

  if (variant === "one" && entryIds.length > 1) {
    throw new EntryFieldValidationError(
      field.id,
      "relation 'one' fields can reference at most one entry",
    );
  }

  return entryIds.length > 0 ? { type: variant, entryIds } : null;
}

/** Ensure each referenced relation target exists and belongs to an allowed model. */
async function ensureRelationConstraints(
  deps: EntriesServiceDeps,
  candidates: readonly RelationCheckCandidate[],
): Promise<void> {
  const activeCandidates = candidates
    .map((candidate) => ({
      ...candidate,
      entryIds: getRelationEntryIds(candidate.value),
    }))
    .filter((candidate) => candidate.entryIds.length > 0);

  if (activeCandidates.length === 0) return;

  const referencedEntryIds = Array.from(
    new Set(activeCandidates.flatMap((candidate) => candidate.entryIds)),
  );
  const targetEntries = await deps.repo.findEntriesByIds(referencedEntryIds);
  const targetById = new Map(
    targetEntries.map((entry) => [entry.id, entry] as const),
  );

  for (const candidate of activeCandidates) {
    const options = resolveRelationOptions(candidate.field);
    const allowedModels = new Set(options.allowedModels);
    for (const entryId of candidate.entryIds) {
      const target = targetById.get(entryId);
      if (!target) {
        throw new EntryFieldValidationError(
          candidate.field.id,
          `relation target entry '${entryId}' does not exist`,
        );
      }
      if (!allowedModels.has(target.modelId)) {
        throw new EntryFieldValidationError(
          candidate.field.id,
          `relation target entry '${entryId}' belongs to disallowed model '${target.modelId}'`,
        );
      }
    }
  }
}

/**
 * Find current entry fields and draft revisions that reference an entry.
 */
export async function findEntryReferences(
  deps: EntriesServiceDeps,
  targetEntryId: string,
): Promise<EntryReferenceUsage[]> {
  const references: EntryReferenceUsage[] = [];

  const fieldRows = await deps.repo.listEntryReferenceFields();
  for (const row of fieldRows) {
    if (row.entryId === targetEntryId) continue;

    if (
      row.fieldType === "relation" &&
      getRelationEntryIds(row.valueRelation).includes(targetEntryId)
    ) {
      references.push({
        kind: "relation",
        source: "entry_field",
        entryId: row.entryId,
        fieldId: row.fieldId,
        entryFieldId: row.id,
      });
    }

    if (
      row.fieldType === "rich_text" &&
      collectEntryReferenceIds(getRichTextDocument(row.valueJson)).includes(
        targetEntryId,
      )
    ) {
      references.push({
        kind: "rich_text",
        source: "entry_field",
        entryId: row.entryId,
        fieldId: row.fieldId,
        entryFieldId: row.id,
      });
    }
  }

  const draftRevisions = await deps.repo.listCurrentDraftRevisions();
  for (const revision of draftRevisions) {
    if (revision.entryId === targetEntryId) continue;

    for (const field of getRevisionFields(revision.content)) {
      if (
        field.type === "relation" &&
        getRelationEntryIds(field.valueRelation).includes(targetEntryId)
      ) {
        references.push({
          kind: "relation",
          source: "draft_revision",
          entryId: revision.entryId,
          fieldId: field.fieldId,
          revisionId: revision.revisionId,
        });
      }

      if (
        field.type === "rich_text" &&
        collectEntryReferenceIds(getRichTextDocument(field.valueJson)).includes(
          targetEntryId,
        )
      ) {
        references.push({
          kind: "rich_text",
          source: "draft_revision",
          entryId: revision.entryId,
          fieldId: field.fieldId,
          revisionId: revision.revisionId,
        });
      }
    }
  }

  return references;
}

type EntryReferenceDetachPlan = {
  detached: EntryReferenceUsage[];
  fieldUpdates: Array<{
    entryFieldId: string;
    valueJson: unknown;
    valueRelation: unknown;
  }>;
  revisionUpdates: Array<{ revisionId: string; content: unknown }>;
  touchedEntries: EntryRecord[];
};

/** Read and normalize every reference detachment before any write is queued. */
async function prepareEntryReferenceDetach(
  deps: EntriesServiceDeps,
  targetEntryId: string,
): Promise<EntryReferenceDetachPlan> {
  const detached: EntryReferenceUsage[] = [];
  const fieldUpdates: EntryReferenceDetachPlan["fieldUpdates"] = [];
  const revisionUpdates: EntryReferenceDetachPlan["revisionUpdates"] = [];
  const touchedEntryIds = new Set<string>();

  const fieldRows = await deps.repo.listEntryReferenceFields();
  for (const row of fieldRows) {
    if (row.entryId === targetEntryId) continue;

    let changed = false;
    let valueRelation = row.valueRelation;
    let valueJson = row.valueJson;

    if (
      row.fieldType === "relation" &&
      getRelationEntryIds(valueRelation).includes(targetEntryId)
    ) {
      valueRelation = removeRelationEntryId(valueRelation, targetEntryId);
      changed = true;
      detached.push({
        kind: "relation",
        source: "entry_field",
        entryId: row.entryId,
        fieldId: row.fieldId,
        entryFieldId: row.id,
      });
      touchedEntryIds.add(row.entryId);
    }

    if (row.fieldType === "rich_text") {
      const result = removeEntryReferences(valueJson, targetEntryId);
      if (result.removed) {
        valueJson = result.value;
        changed = true;
        detached.push({
          kind: "rich_text",
          source: "entry_field",
          entryId: row.entryId,
          fieldId: row.fieldId,
          entryFieldId: row.id,
        });
        touchedEntryIds.add(row.entryId);
      }
    }

    if (changed) {
      fieldUpdates.push({
        entryFieldId: row.id,
        valueJson,
        valueRelation,
      });
    }
  }

  const draftRevisions = await deps.repo.listCurrentDraftRevisions();
  for (const revision of draftRevisions) {
    if (revision.entryId === targetEntryId) continue;
    const fields = getRevisionFields(revision.content);
    if (fields.length === 0) continue;

    let changed = false;
    const nextFields = fields.map((field) => {
      if (field.type === "relation") {
        const ids = getRelationEntryIds(field.valueRelation);
        if (ids.includes(targetEntryId)) {
          changed = true;
          detached.push({
            kind: "relation",
            source: "draft_revision",
            entryId: revision.entryId,
            fieldId: field.fieldId,
            revisionId: revision.revisionId,
          });
          touchedEntryIds.add(revision.entryId);
          return {
            ...field,
            valueRelation: removeRelationEntryId(
              field.valueRelation,
              targetEntryId,
            ),
          };
        }
      }

      if (field.type === "rich_text") {
        const result = removeEntryReferences(field.valueJson, targetEntryId);
        if (result.removed) {
          changed = true;
          detached.push({
            kind: "rich_text",
            source: "draft_revision",
            entryId: revision.entryId,
            fieldId: field.fieldId,
            revisionId: revision.revisionId,
          });
          touchedEntryIds.add(revision.entryId);
          return { ...field, valueJson: result.value };
        }
      }

      return field;
    });

    if (changed) {
      revisionUpdates.push({
        revisionId: revision.revisionId,
        content: {
          ...(isRecord(revision.content) ? revision.content : {}),
          fields: nextFields,
        },
      });
    }
  }

  const touchedEntries: EntryRecord[] = [];
  for (const touchedEntryId of touchedEntryIds) {
    const touched = await deps.repo.findEntryById(touchedEntryId);
    if (touched) touchedEntries.push(touched);
  }

  return { detached, fieldUpdates, revisionUpdates, touchedEntries };
}

/** Delete an entry and optionally detach its references in one atomic write. */
export async function deleteEntry(
  deps: EntriesServiceDeps,
  params: DeleteEntryParams,
): Promise<EntryRecord> {
  const entry = await deps.repo.findEntryById(params.entryId);
  if (!entry || entry.modelId !== params.modelId) {
    throw new EntryNotFoundError(params.entryId);
  }

  const now = deps.now().toISOString();
  const references = await findEntryReferences(deps, params.entryId);
  if (references.length > 0 && params.referenceAction !== "detach") {
    throw new EntryReferencedError(params.entryId, references);
  }

  const detachPlan =
    params.referenceAction === "detach"
      ? await prepareEntryReferenceDetach(deps, params.entryId)
      : ({
          detached: [],
          fieldUpdates: [],
          revisionUpdates: [],
          touchedEntries: [],
        } satisfies EntryReferenceDetachPlan);

  return await deps.runAtomicWrite(async (writer) => {
    for (const update of detachPlan.fieldUpdates) {
      await writer.repo.updateEntryFieldReferenceValues(update.entryFieldId, {
        valueJson: update.valueJson,
        valueRelation: update.valueRelation,
        updatedAt: now,
      });
    }
    for (const update of detachPlan.revisionUpdates) {
      await writer.repo.updateEntryRevision(update.revisionId, {
        content: update.content,
      });
    }
    for (const touched of detachPlan.touchedEntries) {
      await writer.repo.updateEntry(touched.id, {
        status: touched.status,
        updatedAt: now,
        publishedAt: touched.publishedAt,
        updatedBy: params.actorId,
        currentDraftRevisionId: touched.currentDraftRevisionId,
        publishedRevisionId: touched.publishedRevisionId,
      });
    }

    await writer.repo.deleteEntryFields(params.entryId);
    await writer.repo.deleteEntryRevisions(params.entryId);
    await writer.repo.deleteEntry(params.entryId);
    await writer.logAuditEvent({
      actorId: params.actorId,
      action: "delete",
      targetTable: "entries",
      targetId: params.entryId,
      before: sanitizeAuditSnapshot(entry),
      after: null,
    });
    return entry;
  });
}

function mapFieldValue(field: ModelFieldRecord, value: unknown) {
  const result: {
    valueString?: string | null;
    valueNumber?: number | null;
    valueDate?: string | null;
    valueBoolean?: boolean | null;
    valueJson?: unknown;
    valueMedia?: string | null;
    valueRelation?: unknown;
  } = {};

  switch (field.type) {
    case "text": {
      if (typeof value === "string") {
        result.valueString = value;
      } else if (value == null) {
        result.valueString = null;
      } else {
        result.valueString = String(value);
      }
      break;
    }
    case "number": {
      result.valueNumber = normalizeNumberValue(field, value);
      break;
    }
    case "date": {
      result.valueDate = normalizeDateFieldValue(field, value);
      break;
    }
    case "boolean": {
      if (typeof value === "boolean") {
        result.valueBoolean = value;
      } else if (value == null) {
        result.valueBoolean = null;
      } else {
        result.valueBoolean = Boolean(value);
      }
      break;
    }
    case "media": {
      const mediaIds = normalizeMediaIdList(value);
      if (field.variant === "multiple") {
        result.valueJson = mediaIds;
        result.valueMedia = null;
        break;
      }
      result.valueMedia = mediaIds[0] ?? null;
      result.valueJson = null;
      break;
    }
    case "relation": {
      result.valueRelation = normalizeRelationValue(field, value);
      break;
    }
    case "list": {
      result.valueJson = normalizeListValue(field, value);
      break;
    }
    case "json": {
      result.valueJson = normalizeJsonFieldValue(field, value);
      break;
    }
    case "rich_text":
    case "custom":
    default: {
      result.valueJson = value;
      break;
    }
  }

  return result;
}

/** Re-validate stored revision snapshots before they are published. */
function normalizeRevisionSnapshot(
  field: ModelFieldRecord,
  snapshot: RevisionFieldSnapshot,
  locale: string,
): RevisionFieldSnapshot {
  if (field.type === "number") {
    return {
      ...snapshot,
      locale,
      valueNumber: normalizeNumberValue(field, snapshot.valueNumber),
    };
  }

  if (field.type === "date") {
    return {
      ...snapshot,
      locale,
      valueDate: normalizeDateFieldValue(field, snapshot.valueDate),
    };
  }

  if (field.type === "list") {
    return {
      ...snapshot,
      locale,
      valueJson: normalizeListValue(field, snapshot.valueJson),
    };
  }

  if (field.type === "json") {
    return {
      ...snapshot,
      locale,
      valueJson: normalizeJsonFieldValue(field, snapshot.valueJson),
    };
  }

  if (field.type === "relation") {
    return {
      ...snapshot,
      locale,
      valueRelation: normalizeRelationValue(field, snapshot.valueRelation),
    };
  }

  if (field.type === "media") {
    const mediaIds = normalizeMediaIdList(
      field.variant === "multiple"
        ? snapshot.valueJson
        : (snapshot.valueMedia ?? snapshot.valueJson),
    );
    if (field.variant === "multiple") {
      return {
        ...snapshot,
        locale,
        valueJson: mediaIds,
        valueMedia: null,
      };
    }
    return {
      ...snapshot,
      locale,
      valueJson: null,
      valueMedia: mediaIds[0] ?? null,
    };
  }

  return { ...snapshot, locale };
}

/**
 * Normalize a media field input into an ordered list of media IDs.
 */
function normalizeMediaIdList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  if (typeof value === "string") {
    return value
      .split(/\r?\n|,/u)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  return [];
}

type FieldType = ModelFieldRecord["type"];

type RevisionFieldSnapshot = {
  fieldId: string;
  locale: string;
  type: FieldType;
  valueString: string | null;
  valueNumber: number | null;
  valueDate: string | null;
  valueBoolean: boolean | null;
  valueJson: unknown;
  valueMedia: string | null;
  valueRelation: unknown;
};

type RevisionContent = {
  status: "draft" | "published" | "archived";
  fields: RevisionFieldSnapshot[];
};

type UniqueCheckCandidate = {
  field: ModelFieldRecord;
  locale: string;
  values: ReturnType<typeof mapFieldValue>;
};

type NormalizedEntryFieldSnapshot = {
  field: ModelFieldRecord;
  locale: string;
  values: ReturnType<typeof mapFieldValue>;
  snapshot: RevisionFieldSnapshot;
};

const defaultableFieldTypes = new Set<ModelFieldRecord["type"]>([
  "text",
  "number",
  "date",
  "list",
  "json",
  "boolean",
  "custom",
]);

/** Return whether the field type can apply a model-level default value. */
function supportsEntryDefault(field: ModelFieldRecord): boolean {
  return defaultableFieldTypes.has(field.type);
}

/** Return whether a model field has a non-null default value to apply. */
function hasEntryDefault(field: ModelFieldRecord): boolean {
  return (
    supportsEntryDefault(field) &&
    field.defaultValue !== null &&
    field.defaultValue !== undefined
  );
}

/** Build the de-duplication key for one normalized field locale. */
function fieldLocaleKey(fieldId: string, locale: string): string {
  return `${fieldId}:${locale}`;
}

/** Resolve the locale used for storing one field snapshot. */
function normalizeStorageLocale(
  field: ModelFieldRecord,
  locale: string,
  defaultLocale: string,
  seenNonLocalizedFields: Set<string>,
): string {
  if (field.hasLocales) return locale;

  if (seenNonLocalizedFields.has(field.id)) {
    throw new EntryFieldValidationError(
      field.id,
      "non-localized fields cannot contain multiple locale values",
    );
  }
  seenNonLocalizedFields.add(field.id);
  return defaultLocale;
}

/** Convert mapped storage columns into a revision field snapshot. */
function createRevisionSnapshot(
  field: ModelFieldRecord,
  locale: string,
  values: ReturnType<typeof mapFieldValue>,
): RevisionFieldSnapshot {
  return {
    fieldId: field.id,
    locale,
    type: field.type,
    valueString: values.valueString ?? null,
    valueNumber: values.valueNumber ?? null,
    valueDate: values.valueDate ?? null,
    valueBoolean: values.valueBoolean ?? null,
    valueJson: values.valueJson ?? null,
    valueMedia: values.valueMedia ?? null,
    valueRelation: values.valueRelation ?? null,
  };
}

/** Convert a revision snapshot into a value object usable by unique checks. */
function getSnapshotValues(
  snapshot: RevisionFieldSnapshot,
): ReturnType<typeof mapFieldValue> {
  return {
    valueString: snapshot.valueString,
    valueNumber: snapshot.valueNumber,
    valueDate: snapshot.valueDate,
    valueBoolean: snapshot.valueBoolean,
    valueJson: snapshot.valueJson,
    valueMedia: snapshot.valueMedia,
    valueRelation: snapshot.valueRelation,
  };
}

/** Recursively check whether a rich text document has non-empty text. */
function hasRichTextContent(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value))
    return value.some((item) => hasRichTextContent(item));
  if (!isRecord(value)) return false;

  if (typeof value.text === "string" && value.text.trim().length > 0) {
    return true;
  }
  if ("value" in value && hasRichTextContent(value.value)) {
    return true;
  }
  if (Array.isArray(value.content) && hasRichTextContent(value.content)) {
    return true;
  }
  if (Array.isArray(value.marks) && hasRichTextContent(value.marks)) {
    return true;
  }

  return false;
}

/** Return whether a JSON-like field value should satisfy required validation. */
function hasJsonRequiredValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

/** Return whether normalized storage columns satisfy a required field. */
function hasRequiredFieldValue(
  field: ModelFieldRecord,
  values: ReturnType<typeof mapFieldValue>,
): boolean {
  switch (field.type) {
    case "text":
      return (
        typeof values.valueString === "string" &&
        values.valueString.trim().length > 0
      );
    case "number":
      return values.valueNumber !== null && values.valueNumber !== undefined;
    case "date":
      return (
        typeof values.valueDate === "string" &&
        values.valueDate.trim().length > 0
      );
    case "boolean":
      return values.valueBoolean !== null && values.valueBoolean !== undefined;
    case "media":
      if (field.variant === "multiple") {
        return Array.isArray(values.valueJson) && values.valueJson.length > 0;
      }
      return (
        typeof values.valueMedia === "string" &&
        values.valueMedia.trim().length > 0
      );
    case "relation":
      return getRelationEntryIds(values.valueRelation).length > 0;
    case "list":
      return Array.isArray(values.valueJson) && values.valueJson.length > 0;
    case "rich_text":
      return hasRichTextContent(values.valueJson);
    case "json":
    case "custom":
    default:
      return hasJsonRequiredValue(values.valueJson);
  }
}

/** Find the normalized snapshot that should satisfy one required field locale. */
function findRequiredFieldSnapshot(
  normalizedFields: readonly NormalizedEntryFieldSnapshot[],
  field: ModelFieldRecord,
  locale: string,
): NormalizedEntryFieldSnapshot | null {
  const matches = normalizedFields.filter((item) => item.field.id === field.id);
  if (field.hasLocales) {
    return matches.find((item) => item.locale === locale) ?? null;
  }
  return matches.find((item) => item.locale === locale) ?? matches[0] ?? null;
}

/** Validate required model fields against the normalized snapshot to be stored. */
function ensureRequiredFields(
  modelFields: readonly ModelFieldRecord[],
  normalizedFields: readonly NormalizedEntryFieldSnapshot[],
  defaultLocale: string,
): void {
  const localeSet = new Set<string>([defaultLocale]);
  for (const item of normalizedFields) {
    localeSet.add(item.locale);
  }

  for (const field of modelFields) {
    if (!field.required) continue;
    const locales = field.hasLocales ? Array.from(localeSet) : [defaultLocale];

    for (const locale of locales) {
      const item = findRequiredFieldSnapshot(normalizedFields, field, locale);
      if (!item || !hasRequiredFieldValue(field, item.values)) {
        throw new EntryFieldValidationError(
          field.id,
          field.hasLocales
            ? `required field is empty for locale '${locale}'`
            : "required field is empty",
        );
      }
    }
  }
}

/** Append default snapshots for model fields that were omitted from input. */
async function appendDefaultFieldSnapshots(
  deps: EntriesServiceDeps,
  params: {
    modelFields: readonly ModelFieldRecord[];
    normalizedFields: NormalizedEntryFieldSnapshot[];
    providedKeys: Set<string>;
    localeSet: Set<string>;
    defaultLocale: string;
    knownLocales: Set<string>;
  },
): Promise<NormalizedEntryFieldSnapshot[]> {
  const result = [...params.normalizedFields];

  for (const field of params.modelFields) {
    if (!hasEntryDefault(field)) continue;

    const locales = field.hasLocales
      ? Array.from(params.localeSet)
      : [params.defaultLocale];

    for (const locale of locales) {
      const key = fieldLocaleKey(field.id, locale);
      if (params.providedKeys.has(key)) continue;

      await ensureConfiguredLocale(deps, locale, params.knownLocales);
      const values = mapFieldValue(field, field.defaultValue);
      const snapshot = createRevisionSnapshot(field, locale, values);
      result.push({ field, locale, values, snapshot });
      params.providedKeys.add(key);
    }
  }

  return result;
}

/** Normalize only the entry field inputs explicitly provided by a write request. */
async function normalizeProvidedEntryFieldInputs(
  deps: EntriesServiceDeps,
  modelFields: readonly ModelFieldRecord[],
  fieldInputs: readonly CreateEntryFieldInput[],
  defaultLocale: string,
  knownLocales: Set<string>,
): Promise<NormalizedEntryFieldSnapshot[]> {
  const fieldsMap = new Map(
    modelFields.map((field) => [field.id, field] as const),
  );
  const localeSet = new Set<string>([defaultLocale]);
  const providedKeys = new Set<string>();
  const seenNonLocalizedFields = new Set<string>();
  const normalizedFields: NormalizedEntryFieldSnapshot[] = [];

  for (const input of fieldInputs) {
    const field = fieldsMap.get(input.fieldId);
    if (!field) {
      throw new EntryFieldNotFoundError(input.fieldId);
    }
    const locale = resolveEntryLocale(input.locale, defaultLocale);
    await ensureConfiguredLocale(deps, locale, knownLocales);
    const storageLocale = normalizeStorageLocale(
      field,
      locale,
      defaultLocale,
      seenNonLocalizedFields,
    );
    const values = mapFieldValue(field, input.value);
    const snapshot = createRevisionSnapshot(field, storageLocale, values);

    localeSet.add(storageLocale);
    providedKeys.add(fieldLocaleKey(field.id, storageLocale));
    normalizedFields.push({ field, locale: storageLocale, values, snapshot });
  }

  return normalizedFields;
}

/** Normalize entry field inputs and fill omitted fields from model defaults. */
async function normalizeEntryFieldInputs(
  deps: EntriesServiceDeps,
  modelFields: readonly ModelFieldRecord[],
  fieldInputs: readonly CreateEntryFieldInput[],
  defaultLocale: string,
  knownLocales: Set<string>,
): Promise<NormalizedEntryFieldSnapshot[]> {
  const normalizedFields = await normalizeProvidedEntryFieldInputs(
    deps,
    modelFields,
    fieldInputs,
    defaultLocale,
    knownLocales,
  );
  const localeSet = new Set<string>([defaultLocale]);
  const providedKeys = new Set<string>();
  for (const item of normalizedFields) {
    localeSet.add(item.locale);
    providedKeys.add(fieldLocaleKey(item.field.id, item.locale));
  }

  return appendDefaultFieldSnapshots(deps, {
    modelFields,
    normalizedFields,
    providedKeys,
    localeSet,
    defaultLocale,
    knownLocales,
  });
}

/** Normalize stored revision snapshots without applying model defaults. */
async function normalizeRevisionSnapshots(
  deps: EntriesServiceDeps,
  modelFields: readonly ModelFieldRecord[],
  fieldSnapshots: readonly RevisionFieldSnapshot[],
  defaultLocale: string,
  knownLocales: Set<string>,
): Promise<NormalizedEntryFieldSnapshot[]> {
  const fieldById = new Map(modelFields.map((field) => [field.id, field]));
  const localeSet = new Set<string>([defaultLocale]);
  const providedKeys = new Set<string>();
  const seenNonLocalizedFields = new Set<string>();
  const normalizedFields: NormalizedEntryFieldSnapshot[] = [];

  for (const snapshot of fieldSnapshots) {
    const locale = resolveEntryLocale(snapshot.locale, defaultLocale);
    await ensureConfiguredLocale(deps, locale, knownLocales);
    const field = fieldById.get(snapshot.fieldId);
    if (!field) {
      throw new EntryFieldNotFoundError(snapshot.fieldId);
    }
    const normalizedSnapshot = normalizeRevisionSnapshot(
      field,
      snapshot,
      normalizeStorageLocale(
        field,
        locale,
        defaultLocale,
        seenNonLocalizedFields,
      ),
    );

    localeSet.add(normalizedSnapshot.locale);
    providedKeys.add(fieldLocaleKey(field.id, normalizedSnapshot.locale));
    normalizedFields.push({
      field,
      locale: normalizedSnapshot.locale,
      values: getSnapshotValues(normalizedSnapshot),
      snapshot: normalizedSnapshot,
    });
  }

  return normalizedFields;
}

/** Normalize stored revision snapshots and fill omitted fields from defaults. */
async function normalizeRevisionSnapshotsWithDefaults(
  deps: EntriesServiceDeps,
  modelFields: readonly ModelFieldRecord[],
  fieldSnapshots: readonly RevisionFieldSnapshot[],
  defaultLocale: string,
  knownLocales: Set<string>,
): Promise<NormalizedEntryFieldSnapshot[]> {
  const normalizedFields = await normalizeRevisionSnapshots(
    deps,
    modelFields,
    fieldSnapshots,
    defaultLocale,
    knownLocales,
  );
  const localeSet = new Set<string>([defaultLocale]);
  const providedKeys = new Set<string>();
  for (const item of normalizedFields) {
    localeSet.add(item.locale);
    providedKeys.add(fieldLocaleKey(item.field.id, item.locale));
  }

  return appendDefaultFieldSnapshots(deps, {
    modelFields,
    normalizedFields,
    providedKeys,
    localeSet,
    defaultLocale,
    knownLocales,
  });
}

/** Merge stored snapshots with provided request fields, then apply defaults. */
async function normalizeEntryFieldInputsWithBase(
  deps: EntriesServiceDeps,
  modelFields: readonly ModelFieldRecord[],
  baseSnapshots: readonly RevisionFieldSnapshot[],
  fieldInputs: readonly CreateEntryFieldInput[],
  defaultLocale: string,
  knownLocales: Set<string>,
): Promise<NormalizedEntryFieldSnapshot[]> {
  const baseFields = await normalizeRevisionSnapshots(
    deps,
    modelFields,
    baseSnapshots,
    defaultLocale,
    knownLocales,
  );
  const providedFields = await normalizeProvidedEntryFieldInputs(
    deps,
    modelFields,
    fieldInputs,
    defaultLocale,
    knownLocales,
  );
  const mergedByKey = new Map<string, NormalizedEntryFieldSnapshot>();

  for (const item of baseFields) {
    mergedByKey.set(fieldLocaleKey(item.field.id, item.locale), item);
  }
  for (const item of providedFields) {
    mergedByKey.set(fieldLocaleKey(item.field.id, item.locale), item);
  }

  const normalizedFields = Array.from(mergedByKey.values());
  const localeSet = new Set<string>([defaultLocale]);
  const providedKeys = new Set<string>();
  for (const item of normalizedFields) {
    localeSet.add(item.locale);
    providedKeys.add(fieldLocaleKey(item.field.id, item.locale));
  }

  return appendDefaultFieldSnapshots(deps, {
    modelFields,
    normalizedFields,
    providedKeys,
    localeSet,
    defaultLocale,
    knownLocales,
  });
}

/** Load revision field snapshots for an entry, returning an empty set when none exists. */
async function loadEntryRevisionSnapshots(
  deps: EntriesServiceDeps,
  entryId: string,
  revisionId: string | null | undefined,
): Promise<RevisionFieldSnapshot[]> {
  if (!revisionId) return [];
  const revision = await deps.repo.findRevisionById(revisionId);
  if (!revision || revision.entryId !== entryId) return [];
  const content = (revision.content ?? null) as RevisionContent | null;
  return Array.isArray(content?.fields)
    ? (content!.fields as RevisionFieldSnapshot[])
    : [];
}

/** Convert a normalized snapshot into a row insert for published fields. */
function createEntryFieldInsertFromSnapshot(
  generateId: EntriesServiceDeps["generateId"],
  entryId: string,
  now: string,
  snapshot: RevisionFieldSnapshot,
): EntryFieldInsert {
  return {
    id: generateId("entry_field"),
    entryId,
    fieldId: snapshot.fieldId,
    locale: snapshot.locale,
    valueString: snapshot.valueString ?? null,
    valueNumber: snapshot.valueNumber ?? null,
    valueDate: snapshot.valueDate ?? null,
    valueBoolean: snapshot.valueBoolean ?? null,
    valueJson: snapshot.valueJson ?? null,
    valueMedia: snapshot.valueMedia ?? null,
    valueRelation: snapshot.valueRelation ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

/** Build unique constraint candidates from normalized snapshots. */
function createUniqueCheckCandidates(
  normalizedFields: readonly NormalizedEntryFieldSnapshot[],
): UniqueCheckCandidate[] {
  return normalizedFields
    .filter((item) => item.field.isUnique)
    .map((item) => ({
      field: item.field,
      locale: item.locale,
      values: item.values,
    }));
}

/** Build relation constraint candidates from normalized snapshots. */
function createRelationCheckCandidates(
  normalizedFields: readonly NormalizedEntryFieldSnapshot[],
): RelationCheckCandidate[] {
  return normalizedFields
    .filter((item) => item.field.type === "relation")
    .map((item) => ({
      field: item.field,
      value: item.values.valueRelation,
    }));
}

/** Build media constraint candidates from normalized snapshots. */
function createMediaCheckCandidates(
  normalizedFields: readonly NormalizedEntryFieldSnapshot[],
): MediaCheckCandidate[] {
  return normalizedFields
    .filter((item) => item.field.type === "media")
    .map((item) => ({
      field: item.field,
      mediaIds: getMediaIdsFromValues(item.field, item.values),
    }));
}

type PublishUniqueCheckCandidate = UniqueCheckCandidate & {
  entryId: string;
};

type PublishEntryPreparation = {
  entry: EntryRecord;
  revision: EntryRevisionRecord;
  normalizedFieldSnapshots: RevisionFieldSnapshot[];
  uniqueChecks: PublishUniqueCheckCandidate[];
  mediaChecks: MediaCheckCandidate[];
  relationChecks: RelationCheckCandidate[];
};

const D1_MAX_BOUND_PARAMETERS = 100;
const ENTRY_FIELD_ROWS_PER_INSERT = 7;
const BULK_FIXED_READ_QUERY_UPPER_BOUND = 4;

/** Return the number of D1 queries required to process fixed-size chunks. */
function countD1Chunks(itemCount: number): number {
  return itemCount === 0 ? 0 : Math.ceil(itemCount / D1_MAX_BOUND_PARAMETERS);
}

/** Estimate all entry-service reads and writes for one bulk publish request. */
function estimateBulkPublishQueries(
  preparedEntries: readonly PublishEntryPreparation[],
  checkedLocaleCount: number,
): number {
  const mediaIds = new Set(
    preparedEntries.flatMap((prepared) =>
      prepared.mediaChecks.flatMap((candidate) => candidate.mediaIds),
    ),
  );
  const relationIds = new Set(
    preparedEntries.flatMap((prepared) =>
      prepared.relationChecks.flatMap((candidate) =>
        getRelationEntryIds(candidate.value),
      ),
    ),
  );
  const uniqueValueQueries = preparedEntries
    .flatMap((prepared) => prepared.uniqueChecks)
    .filter((candidate) => getUniqueValueKey(candidate) !== null).length;
  const entryAndRevisionReads = preparedEntries.length * 2;
  const validationReads =
    checkedLocaleCount +
    countD1Chunks(mediaIds.size) +
    countD1Chunks(relationIds.size) +
    uniqueValueQueries;
  const mutationWrites = preparedEntries.reduce(
    (total, prepared) =>
      total +
      4 +
      Math.ceil(
        prepared.normalizedFieldSnapshots.length / ENTRY_FIELD_ROWS_PER_INSERT,
      ),
    0,
  );

  return (
    BULK_FIXED_READ_QUERY_UPPER_BOUND +
    entryAndRevisionReads +
    validationReads +
    mutationWrites
  );
}

/** Normalize an entry field locale, falling back to the configured default. */
function resolveEntryLocale(
  value: string | null | undefined,
  defaultLocale: string,
): string {
  const normalized =
    typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : defaultLocale;
  return normalized;
}

/** Validate that a locale exists, caching successful checks per request. */
async function ensureConfiguredLocale(
  deps: EntriesServiceDeps,
  locale: string,
  knownLocales: Set<string>,
): Promise<void> {
  if (knownLocales.has(locale)) return;
  const exists = await deps.repo.localeExists(locale);
  if (!exists) {
    throw new EntryLocaleNotFoundError(locale);
  }
  knownLocales.add(locale);
}

async function ensureUniqueConstraints(
  deps: EntriesServiceDeps,
  candidates: readonly UniqueCheckCandidate[],
  options: { excludeEntryId?: string | null },
): Promise<void> {
  for (const candidate of candidates) {
    if (!candidate.field.isUnique) continue;
    const conflict = await deps.repo.findUniqueFieldConflict({
      fieldId: candidate.field.id,
      locale: candidate.locale,
      type: candidate.field.type,
      value: candidate.values,
      excludeEntryId: options.excludeEntryId ?? null,
    });
    if (conflict) {
      throw new UniqueFieldConflictError(
        candidate.field.id,
        candidate.locale,
        conflict.entryId ?? null,
      );
    }
  }
}

/** Return true when a JSON-backed unique value represents an empty input. */
function isEmptyJsonUniqueValue(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** Return true when a relation-backed unique value represents no selection. */
function isEmptyRelationUniqueValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return isRecord(value) && Array.isArray(value.entryIds)
    ? value.entryIds.length === 0
    : false;
}

/** Serialize a unique field value using exact stored-value equality. */
function serializeUniqueJsonValue(
  field: ModelFieldRecord,
  value: unknown,
): string {
  try {
    return JSON.stringify(value);
  } catch {
    throw new EntryFieldValidationError(
      field.id,
      "unique field value must be JSON serializable",
    );
  }
}

/** Build the comparison key used by bulk publish preflight checks. */
function getUniqueValueKey(candidate: UniqueCheckCandidate): string | null {
  const { field, values } = candidate;
  switch (field.type) {
    case "text": {
      const val = values.valueString;
      if (val == null || String(val).trim().length === 0) return null;
      return `text:${JSON.stringify(String(val))}`;
    }
    case "number": {
      const val = values.valueNumber;
      if (val === null || val === undefined) return null;
      return `number:${val}`;
    }
    case "date": {
      const val = values.valueDate;
      if (val == null || String(val).trim().length === 0) return null;
      return `date:${JSON.stringify(String(val))}`;
    }
    case "boolean": {
      const val = values.valueBoolean;
      if (val === null || val === undefined) return null;
      return `boolean:${val ? "true" : "false"}`;
    }
    case "media": {
      const val = values.valueMedia;
      if (val) return `media:${JSON.stringify(val)}`;
      const jsonVal = values.valueJson;
      if (isEmptyJsonUniqueValue(jsonVal)) return null;
      return `media-json:${serializeUniqueJsonValue(field, jsonVal)}`;
    }
    case "relation": {
      const val = values.valueRelation;
      if (isEmptyRelationUniqueValue(val)) return null;
      return `relation:${serializeUniqueJsonValue(field, val)}`;
    }
    case "json":
    case "list":
    case "custom": {
      const val = values.valueJson;
      if (isEmptyJsonUniqueValue(val)) return null;
      return `${field.type}:${serializeUniqueJsonValue(field, val)}`;
    }
    case "rich_text":
    default:
      return null;
  }
}

/** Prepare one entry revision for publishing without mutating stored data. */
async function preparePublishEntryRevision(
  deps: EntriesServiceDeps,
  params: PublishEntryRevisionParams,
  context?: {
    model?: ModelWithFields;
    defaultLocale?: string;
    knownLocales?: Set<string>;
  },
): Promise<PublishEntryPreparation> {
  const entry = await deps.repo.findEntryById(params.entryId);
  if (!entry || entry.modelId !== params.modelId) {
    throw new EntryNotFoundError(params.entryId);
  }

  const revisionIdToPublish =
    params.revisionId ??
    entry.currentDraftRevisionId ??
    entry.publishedRevisionId ??
    null;

  if (!revisionIdToPublish) {
    throw new EntryRevisionNotFoundError("draft_or_published");
  }

  const revision = await deps.repo.findRevisionById(revisionIdToPublish);
  if (!revision || revision.entryId !== params.entryId) {
    throw new EntryRevisionNotFoundError(revisionIdToPublish);
  }

  const model =
    context?.model ?? (await deps.repo.findModelWithFields(entry.modelId));
  if (!model) {
    throw new EntryModelNotFoundError(entry.modelId);
  }

  const content = (revision.content ?? null) as RevisionContent | null;
  const fieldSnapshots = Array.isArray(content?.fields)
    ? (content!.fields as RevisionFieldSnapshot[])
    : [];
  const defaultLocale =
    context?.defaultLocale ?? (await deps.repo.findDefaultLocale());
  const knownLocales = context?.knownLocales ?? new Set<string>();
  const normalizedFields = await normalizeRevisionSnapshotsWithDefaults(
    deps,
    model.fields,
    fieldSnapshots,
    defaultLocale,
    knownLocales,
  );
  ensureRequiredFields(model.fields, normalizedFields, defaultLocale);
  const normalizedFieldSnapshots = normalizedFields.map(
    (item) => item.snapshot,
  );
  const uniqueChecks: PublishUniqueCheckCandidate[] = normalizedFields
    .filter((item) => item.field.isUnique)
    .map((item) => ({
      entryId: entry.id,
      field: item.field,
      locale: item.locale,
      values: item.values,
    }));
  const mediaChecks = createMediaCheckCandidates(normalizedFields);
  const relationChecks = createRelationCheckCandidates(normalizedFields);

  return {
    entry,
    revision,
    normalizedFieldSnapshots,
    uniqueChecks,
    mediaChecks,
    relationChecks,
  };
}

/** Persist a prepared publish revision after validation has already passed. */
async function applyPreparedPublishEntryRevision(
  deps: EntriesServiceDeps,
  writer: EntriesAtomicWriteContext,
  prepared: PublishEntryPreparation,
  params: { actorId: string; now: string },
): Promise<UpdatedEntry> {
  await writer.repo.deleteEntryFields(prepared.entry.id);

  if (prepared.normalizedFieldSnapshots.length > 0) {
    const publishedFieldInserts = prepared.normalizedFieldSnapshots.map(
      (snapshot) =>
        createEntryFieldInsertFromSnapshot(
          deps.generateId,
          prepared.entry.id,
          params.now,
          snapshot,
        ),
    );

    await writer.repo.insertEntryFields(publishedFieldInserts);
  }

  await writer.repo.updateEntry(prepared.entry.id, {
    status: "published",
    updatedAt: params.now,
    publishedAt: params.now,
    updatedBy: params.actorId,
    currentDraftRevisionId: null,
    publishedRevisionId: prepared.revision.id,
  });

  await writer.repo.updateEntryRevision(prepared.revision.id, {
    content: {
      ...(isRecord(prepared.revision.content) ? prepared.revision.content : {}),
      status: "published",
      fields: prepared.normalizedFieldSnapshots,
    },
    status: "published",
    publishedAt: params.now,
  });

  const updated: UpdatedEntry = {
    id: prepared.entry.id,
    modelId: prepared.entry.modelId,
    status: "published",
    createdAt: prepared.entry.createdAt,
    updatedAt: params.now,
    publishedAt: params.now,
  };

  await writer.logAuditEvent({
    actorId: params.actorId,
    action: "publish",
    targetTable: "entries",
    targetId: prepared.entry.id,
    before: sanitizeAuditSnapshot(prepared.entry),
    after: sanitizeAuditSnapshot({
      status: "published",
      currentDraftRevisionId: null,
      publishedRevisionId: prepared.revision.id,
    }),
  });

  return updated;
}

/** Collect conflicts between selected entries and already published values. */
async function findBulkUniqueFieldConflicts(
  deps: EntriesServiceDeps,
  preparedEntries: readonly PublishEntryPreparation[],
  excludeEntryIds: readonly string[],
): Promise<BulkUniqueFieldConflict[]> {
  const conflicts: BulkUniqueFieldConflict[] = [];
  const selectedValues = new Map<
    string,
    { entryId: string; fieldId: string; locale: string }
  >();
  const candidates = preparedEntries.flatMap((prepared) =>
    prepared.uniqueChecks.map((candidate) => ({
      ...candidate,
      key: getUniqueValueKey(candidate),
    })),
  );

  for (const candidate of candidates) {
    if (!candidate.key) continue;
    const selectionKey = `${candidate.field.id}\u0000${candidate.locale}\u0000${candidate.key}`;
    const previous = selectedValues.get(selectionKey);
    if (previous && previous.entryId !== candidate.entryId) {
      conflicts.push({
        entryId: candidate.entryId,
        fieldId: candidate.field.id,
        locale: candidate.locale,
        conflictingEntryId: previous.entryId,
        scope: "selection",
      });
      continue;
    }
    selectedValues.set(selectionKey, {
      entryId: candidate.entryId,
      fieldId: candidate.field.id,
      locale: candidate.locale,
    });
  }

  for (const candidate of candidates) {
    if (!candidate.key) continue;
    const conflict = await deps.repo.findUniqueFieldConflict({
      fieldId: candidate.field.id,
      locale: candidate.locale,
      type: candidate.field.type,
      value: candidate.values,
      excludeEntryIds,
    });
    if (conflict) {
      conflicts.push({
        entryId: candidate.entryId,
        fieldId: candidate.field.id,
        locale: candidate.locale,
        conflictingEntryId: conflict.entryId ?? null,
        scope: "published",
      });
    }
  }

  return conflicts;
}

/** Validate and create an entry, its first revision, projection, and audit. */
export async function createEntry(
  deps: EntriesServiceDeps,
  params: CreateEntryParams,
): Promise<CreatedEntry> {
  const model = await deps.repo.findModelWithFields(params.modelId);
  if (!model) {
    throw new EntryModelNotFoundError(params.modelId);
  }

  const now = deps.now().toISOString();
  const entryId = deps.generateId("entry");
  const revisionId = deps.generateId("entry_revision");
  const isPublished = params.status === "published";
  const isDraft = params.status === "draft";

  const defaultLocale = await deps.repo.findDefaultLocale();
  const knownLocales = new Set<string>();
  const normalizedFields = await normalizeEntryFieldInputs(
    deps,
    model.fields,
    params.fields ?? [],
    defaultLocale,
    knownLocales,
  );
  if (params.status !== "archived") {
    ensureRequiredFields(model.fields, normalizedFields, defaultLocale);
  }
  const revisionFields = normalizedFields.map((item) => item.snapshot);
  const publishedFieldRecords = isPublished
    ? normalizedFields.map((item) =>
        createEntryFieldInsertFromSnapshot(
          deps.generateId,
          entryId,
          now,
          item.snapshot,
        ),
      )
    : [];
  const uniqueChecks = createUniqueCheckCandidates(normalizedFields);
  const mediaChecks = createMediaCheckCandidates(normalizedFields);
  const relationChecks = createRelationCheckCandidates(normalizedFields);

  const publishedAt = isPublished ? now : null;

  await ensureMediaConstraints(deps, mediaChecks);
  await ensureRelationConstraints(deps, relationChecks);

  if (isPublished && uniqueChecks.length > 0) {
    await ensureUniqueConstraints(deps, uniqueChecks, { excludeEntryId: null });
  }

  const revisionContent: RevisionContent = {
    status: params.status,
    fields: revisionFields,
  };

  const entryRevisionUpdate = {
    status: params.status,
    updatedAt: now,
    publishedAt,
    updatedBy: params.actorId,
    currentDraftRevisionId: isDraft ? revisionId : null,
    publishedRevisionId: isPublished ? revisionId : null,
  } satisfies EntryUpdate;

  const created: CreatedEntry = {
    id: entryId,
    modelId: params.modelId,
    status: params.status,
    createdAt: now,
    updatedAt: now,
    publishedAt,
  };

  return await deps.runAtomicWrite(async (writer) => {
    await writer.repo.insertEntry({
      id: entryId,
      modelId: params.modelId,
      status: params.status,
      createdAt: now,
      updatedAt: now,
      publishedAt,
      updatedBy: params.actorId,
      currentDraftRevisionId: null,
      publishedRevisionId: null,
    });
    await writer.repo.insertEntryRevision({
      id: revisionId,
      entryId,
      revisionNumber: 1,
      content: revisionContent,
      status: params.status,
      createdBy: params.actorId,
      createdAt: now,
      publishedAt,
    });
    await writer.repo.updateEntry(entryId, entryRevisionUpdate);
    if (publishedFieldRecords.length > 0) {
      await writer.repo.insertEntryFields(publishedFieldRecords);
    }
    await writer.logAuditEvent({
      actorId: params.actorId,
      action: "create",
      targetTable: "entries",
      targetId: entryId,
      before: null,
      after: sanitizeAuditSnapshot(entryRevisionUpdate),
    });
    return created;
  });
}

/** Validate and update an entry with a new immutable revision snapshot. */
export async function updateEntry(
  deps: EntriesServiceDeps,
  params: UpdateEntryParams,
): Promise<UpdatedEntry> {
  const model = await deps.repo.findModelWithFields(params.modelId);
  if (!model) {
    throw new EntryModelNotFoundError(params.modelId);
  }

  const existing = await deps.repo.findEntryById(params.entryId);
  if (!existing || existing.modelId !== params.modelId) {
    throw new EntryNotFoundError(params.entryId);
  }

  const now = deps.now().toISOString();
  const hasFieldPayload = params.fields !== undefined;
  const fieldInputs = params.fields ?? [];
  const defaultLocale = await deps.repo.findDefaultLocale();
  const knownLocales = new Set<string>();
  const baseRevisionId =
    existing.currentDraftRevisionId ?? existing.publishedRevisionId ?? null;
  const baseSnapshots = await loadEntryRevisionSnapshots(
    deps,
    existing.id,
    baseRevisionId,
  );
  const normalizedFields = hasFieldPayload
    ? await normalizeEntryFieldInputsWithBase(
        deps,
        model.fields,
        baseSnapshots,
        fieldInputs,
        defaultLocale,
        knownLocales,
      )
    : await normalizeRevisionSnapshotsWithDefaults(
        deps,
        model.fields,
        baseSnapshots,
        defaultLocale,
        knownLocales,
      );
  if (params.status !== "archived") {
    ensureRequiredFields(model.fields, normalizedFields, defaultLocale);
  }
  const revisionFields = normalizedFields.map((item) => item.snapshot);
  const publishedFieldInserts =
    params.status === "published"
      ? normalizedFields.map((item) =>
          createEntryFieldInsertFromSnapshot(
            deps.generateId,
            params.entryId,
            now,
            item.snapshot,
          ),
        )
      : [];
  const uniqueChecks = createUniqueCheckCandidates(normalizedFields);
  const mediaChecks = createMediaCheckCandidates(normalizedFields);
  const relationChecks = createRelationCheckCandidates(normalizedFields);

  await ensureMediaConstraints(deps, mediaChecks);
  await ensureRelationConstraints(deps, relationChecks);
  if (params.status === "published" && uniqueChecks.length > 0) {
    await ensureUniqueConstraints(deps, uniqueChecks, {
      excludeEntryId: params.entryId,
    });
  }

  const archiveCurrentDraft =
    params.status === "draft" &&
    existing.currentDraftRevisionId &&
    existing.currentDraftRevisionId.length > 0;

  const revisionId = deps.generateId("entry_revision");
  const revisionNumber = await deps.repo.getNextRevisionNumber(params.entryId);
  const revisionContent: RevisionContent = {
    status: params.status,
    fields: revisionFields,
  };
  const revisionPublishedAt = params.status === "published" ? now : null;

  let statusToPersist: UpdatedEntry["status"] = params.status;
  let publishedAt: string | null = existing.publishedAt;
  let currentDraftRevisionId: string | null = existing.currentDraftRevisionId;
  let publishedRevisionId: string | null = existing.publishedRevisionId;

  const savingDraftWhilePublished =
    existing.status === "published" && params.status === "draft";

  if (params.status === "published") {
    publishedAt = existing.publishedAt ?? now;
    publishedRevisionId = revisionId;
    currentDraftRevisionId = null;
  } else if (params.status === "draft") {
    if (savingDraftWhilePublished) {
      publishedAt = existing.publishedAt;
      publishedRevisionId = existing.publishedRevisionId;
      currentDraftRevisionId = revisionId;
      statusToPersist = existing.status;
    } else {
      publishedAt = null;
      publishedRevisionId = null;
      currentDraftRevisionId = revisionId;
      statusToPersist = "draft";
    }
  } else if (params.status === "archived") {
    publishedAt = existing.publishedAt;
    publishedRevisionId = null;
    currentDraftRevisionId = null;
  }

  const updated: UpdatedEntry = {
    id: params.entryId,
    modelId: params.modelId,
    status: statusToPersist,
    createdAt: existing.createdAt,
    updatedAt: now,
    publishedAt,
  };

  return await deps.runAtomicWrite(async (writer) => {
    if (archiveCurrentDraft) {
      await writer.repo.updateEntryRevision(existing.currentDraftRevisionId!, {
        status: "archived",
      });
    }
    await writer.repo.insertEntryRevision({
      id: revisionId,
      entryId: params.entryId,
      revisionNumber,
      content: revisionContent,
      status: params.status,
      createdBy: params.actorId,
      createdAt: now,
      publishedAt: revisionPublishedAt,
    });

    if (params.status === "published") {
      await writer.repo.deleteEntryFields(params.entryId);
      if (publishedFieldInserts.length > 0) {
        await writer.repo.insertEntryFields(publishedFieldInserts);
      }
    } else if (
      params.status === "archived" ||
      (params.status === "draft" && !savingDraftWhilePublished)
    ) {
      await writer.repo.deleteEntryFields(params.entryId);
    }

    await writer.repo.updateEntry(params.entryId, {
      status: statusToPersist,
      updatedAt: now,
      publishedAt,
      updatedBy: params.actorId,
      currentDraftRevisionId,
      publishedRevisionId,
    });
    await writer.logAuditEvent({
      actorId: params.actorId,
      action: "update",
      targetTable: "entries",
      targetId: params.entryId,
      before: sanitizeAuditSnapshot(existing),
      after: sanitizeAuditSnapshot({
        status: statusToPersist,
        currentDraftRevisionId,
        publishedRevisionId,
      }),
    });
    return updated;
  });
}

/**
 * Restore a historical revision as the current draft without publishing it.
 */
export async function restoreEntryRevision(
  deps: EntriesServiceDeps,
  params: RestoreEntryRevisionParams,
): Promise<UpdatedEntry> {
  const entry = await deps.repo.findEntryById(params.entryId);
  if (!entry || entry.modelId !== params.modelId) {
    throw new EntryNotFoundError(params.entryId);
  }

  const revision = await deps.repo.findRevisionById(params.revisionId);
  if (!revision || revision.entryId !== params.entryId) {
    throw new EntryRevisionNotFoundError(params.revisionId);
  }

  const model = await deps.repo.findModelWithFields(params.modelId);
  if (!model) {
    throw new EntryModelNotFoundError(params.modelId);
  }

  const content = (revision.content ?? null) as RevisionContent | null;
  const fieldSnapshots = Array.isArray(content?.fields)
    ? (content!.fields as RevisionFieldSnapshot[])
    : [];
  const defaultLocale = await deps.repo.findDefaultLocale();
  const knownLocales = new Set<string>();
  const normalizedFields = await normalizeRevisionSnapshots(
    deps,
    model.fields,
    fieldSnapshots,
    defaultLocale,
    knownLocales,
  );
  const normalizedFieldSnapshots = normalizedFields.map(
    (item) => item.snapshot,
  );
  const now = deps.now().toISOString();

  const restoredRevisionId = deps.generateId("entry_revision");
  const revisionNumber = await deps.repo.getNextRevisionNumber(params.entryId);
  const restoredContent: RevisionContent = {
    status: "draft",
    fields: normalizedFieldSnapshots,
  };

  const isPublishedEntry = entry.status === "published";
  const statusToPersist: UpdatedEntry["status"] = isPublishedEntry
    ? "published"
    : "draft";
  const publishedAt = isPublishedEntry ? entry.publishedAt : null;
  const publishedRevisionId = isPublishedEntry
    ? entry.publishedRevisionId
    : null;

  const updated: UpdatedEntry = {
    id: entry.id,
    modelId: entry.modelId,
    status: statusToPersist,
    createdAt: entry.createdAt,
    updatedAt: now,
    publishedAt,
  };

  return await deps.runAtomicWrite(async (writer) => {
    if (entry.currentDraftRevisionId) {
      await writer.repo.updateEntryRevision(entry.currentDraftRevisionId, {
        status: "archived",
      });
    }
    await writer.repo.insertEntryRevision({
      id: restoredRevisionId,
      entryId: params.entryId,
      revisionNumber,
      content: restoredContent,
      status: "draft",
      createdBy: params.actorId,
      createdAt: now,
      publishedAt: null,
    });
    if (!isPublishedEntry) {
      await writer.repo.deleteEntryFields(params.entryId);
    }
    await writer.repo.updateEntry(params.entryId, {
      status: statusToPersist,
      updatedAt: now,
      publishedAt,
      updatedBy: params.actorId,
      currentDraftRevisionId: restoredRevisionId,
      publishedRevisionId,
    });
    await writer.logAuditEvent({
      actorId: params.actorId,
      action: "restore_revision",
      targetTable: "entries",
      targetId: entry.id,
      before: sanitizeAuditSnapshot(entry),
      after: sanitizeAuditSnapshot({
        status: statusToPersist,
        sourceRevisionId: revision.id,
        currentDraftRevisionId: restoredRevisionId,
        publishedRevisionId,
      }),
    });
    return updated;
  });
}

/** Publish one prepared revision and rebuild its public field projection. */
export async function publishEntryRevision(
  deps: EntriesServiceDeps,
  params: PublishEntryRevisionParams,
): Promise<UpdatedEntry> {
  const prepared = await preparePublishEntryRevision(deps, params);
  const now = deps.now().toISOString();
  await ensureMediaConstraints(deps, prepared.mediaChecks);
  await ensureRelationConstraints(deps, prepared.relationChecks);
  if (prepared.uniqueChecks.length > 0) {
    await ensureUniqueConstraints(deps, prepared.uniqueChecks, {
      excludeEntryId: params.entryId,
    });
  }
  return await deps.runAtomicWrite(
    async (writer) =>
      await applyPreparedPublishEntryRevision(deps, writer, prepared, {
        actorId: params.actorId,
        now,
      }),
  );
}

/**
 * Publish multiple entries only after the whole selection passes unique checks.
 */
export async function bulkPublishEntries(
  deps: EntriesServiceDeps,
  params: BulkPublishEntriesParams,
): Promise<UpdatedEntry[]> {
  const entryIds = Array.from(
    new Set(params.entryIds.map((entryId) => entryId.trim())),
  ).filter((entryId) => entryId.length > 0);
  if (entryIds.length === 0) return [];

  const model = await deps.repo.findModelWithFields(params.modelId);
  if (!model) {
    throw new EntryModelNotFoundError(params.modelId);
  }

  const defaultLocale = await deps.repo.findDefaultLocale();
  const knownLocales = new Set<string>();
  const preparedEntries: PublishEntryPreparation[] = [];

  for (const entryId of entryIds) {
    preparedEntries.push(
      await preparePublishEntryRevision(
        deps,
        {
          actorId: params.actorId,
          entryId,
          modelId: params.modelId,
          revisionId: null,
        },
        { model, defaultLocale, knownLocales },
      ),
    );
  }

  const estimatedQueries = estimateBulkPublishQueries(
    preparedEntries,
    knownLocales.size,
  );
  if (estimatedQueries > ENTRY_D1_QUERY_BUDGET) {
    throw new EntryQueryBudgetExceededError(
      estimatedQueries,
      ENTRY_D1_QUERY_BUDGET,
    );
  }

  await ensureMediaConstraints(
    deps,
    preparedEntries.flatMap((prepared) => prepared.mediaChecks),
  );

  await ensureRelationConstraints(
    deps,
    preparedEntries.flatMap((prepared) => prepared.relationChecks),
  );

  const conflicts = await findBulkUniqueFieldConflicts(
    deps,
    preparedEntries,
    entryIds,
  );
  if (conflicts.length > 0) {
    throw new BulkUniqueFieldConflictError(conflicts);
  }

  const now = deps.now().toISOString();
  return await deps.runAtomicWrite(async (writer) => {
    const updated: UpdatedEntry[] = [];
    for (const prepared of preparedEntries) {
      updated.push(
        await applyPreparedPublishEntryRevision(deps, writer, prepared, {
          actorId: params.actorId,
          now,
        }),
      );
    }
    return updated;
  });
}

/** Unpublish one entry and remove its public field projection atomically. */
export async function unpublishEntry(
  deps: EntriesServiceDeps,
  params: UnpublishEntryParams,
): Promise<UpdatedEntry> {
  const entry = await deps.repo.findEntryById(params.entryId);
  if (!entry || entry.modelId !== params.modelId) {
    throw new EntryNotFoundError(params.entryId);
  }

  const now = deps.now().toISOString();

  const publishedRevisionId = entry.publishedRevisionId ?? null;

  const updatedDraftRevisionId =
    entry.currentDraftRevisionId ?? publishedRevisionId ?? null;

  const updated: UpdatedEntry = {
    id: entry.id,
    modelId: entry.modelId,
    status: "draft",
    createdAt: entry.createdAt,
    updatedAt: now,
    publishedAt: null,
  };

  return await deps.runAtomicWrite(async (writer) => {
    if (publishedRevisionId) {
      await writer.repo.updateEntryRevision(publishedRevisionId, {
        status: "draft",
      });
    }
    await writer.repo.deleteEntryFields(params.entryId);
    await writer.repo.updateEntry(params.entryId, {
      status: "draft",
      updatedAt: now,
      publishedAt: null,
      updatedBy: params.actorId,
      currentDraftRevisionId: updatedDraftRevisionId,
      publishedRevisionId: null,
    });
    await writer.logAuditEvent({
      actorId: params.actorId,
      action: "unpublish",
      targetTable: "entries",
      targetId: entry.id,
      before: sanitizeAuditSnapshot(entry),
      after: sanitizeAuditSnapshot({
        status: "draft",
        currentDraftRevisionId: updatedDraftRevisionId,
        publishedRevisionId: null,
      }),
    });
    return updated;
  });
}
