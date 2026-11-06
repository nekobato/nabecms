/**
 * Entry persistence and query recording for D1-backed atomic mutations.
 */
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  max,
  ne,
  notInArray,
  or,
} from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { ModelFieldOptions } from "../contracts";
import * as schema from "../database/schema";

export type EntryInsert = typeof schema.entries.$inferInsert;
export type EntryFieldInsert = typeof schema.entryFields.$inferInsert;

export type EntryRecord = {
  id: string;
  modelId: string;
  status: "draft" | "published" | "archived";
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  currentDraftRevisionId: string | null;
  publishedRevisionId: string | null;
};

export type EntryUpdate = {
  status: "draft" | "published" | "archived";
  updatedAt: string;
  publishedAt: string | null;
  updatedBy: string;
  currentDraftRevisionId?: string | null;
  publishedRevisionId?: string | null;
};

export type ModelFieldRecord = {
  id: string;
  modelId: string;
  name: string;
  type:
    | "text"
    | "rich_text"
    | "number"
    | "date"
    | "list"
    | "media"
    | "json"
    | "relation"
    | "boolean"
    | "custom";
  hasLocales: boolean;
  required: boolean;
  isPrivate: boolean;
  isUnique: boolean;
  variant: string | null;
  options?: ModelFieldOptions | null;
  defaultValue?: unknown;
};

export type ModelWithFields = {
  model: {
    id: string;
    name: string;
  };
  fields: ModelFieldRecord[];
};

export type EntryRevisionInsert = typeof schema.entryRevisions.$inferInsert;
export type EntryRevisionUpdate = {
  content?: unknown;
  status?: "draft" | "published" | "archived";
  publishedAt?: string | null;
};

export type EntryRevisionRecord = {
  id: string;
  entryId: string;
  revisionNumber: number;
  content: unknown;
  status: "draft" | "published" | "archived";
  createdBy: string;
  createdAt: string;
  publishedAt: string | null;
};

export type EntryReferenceFieldRecord = {
  id: string;
  entryId: string;
  fieldId: string;
  fieldType: ModelFieldRecord["type"];
  valueJson: unknown;
  valueRelation: unknown;
};

export type CurrentDraftRevisionRecord = {
  entryId: string;
  revisionId: string;
  content: unknown;
};

export type EntryModelReferenceRecord = {
  id: string;
  modelId: string;
};

export interface EntriesRepository {
  findModelWithFields(modelId: string): Promise<ModelWithFields | null>;
  findDefaultLocale(): Promise<string>;
  localeExists(code: string): Promise<boolean>;
  findEntryById(entryId: string): Promise<EntryRecord | null>;
  findEntriesByIds(
    entryIds: readonly string[],
  ): Promise<readonly EntryModelReferenceRecord[]>;
  insertEntry(entry: EntryInsert): Promise<void>;
  insertEntryFields(records: EntryFieldInsert[]): Promise<void>;
  updateEntry(entryId: string, update: EntryUpdate): Promise<void>;
  deleteEntryFields(entryId: string): Promise<void>;
  deleteEntryRevisions(entryId: string): Promise<void>;
  deleteEntry(entryId: string): Promise<void>;
  getNextRevisionNumber(entryId: string): Promise<number>;
  insertEntryRevision(revision: EntryRevisionInsert): Promise<void>;
  updateEntryRevision(
    revisionId: string,
    update: EntryRevisionUpdate,
  ): Promise<void>;
  findRevisionById(revisionId: string): Promise<EntryRevisionRecord | null>;
  findDraftRevision(entryId: string): Promise<EntryRevisionRecord | null>;
  listRevisions(
    entryId: string,
    limit?: number,
  ): Promise<readonly EntryRevisionRecord[]>;
  listEntryReferenceFields(): Promise<readonly EntryReferenceFieldRecord[]>;
  listCurrentDraftRevisions(): Promise<readonly CurrentDraftRevisionRecord[]>;
  updateEntryFieldReferenceValues(
    entryFieldId: string,
    update: {
      valueJson?: unknown;
      valueRelation?: unknown;
      updatedAt: string;
    },
  ): Promise<void>;
  findUniqueFieldConflict(params: {
    fieldId: string;
    locale: string;
    type: ModelFieldRecord["type"];
    value: {
      valueString?: string | null;
      valueNumber?: number | null;
      valueDate?: string | null;
      valueBoolean?: boolean | null;
      valueJson?: unknown;
      valueMedia?: string | null;
      valueRelation?: unknown;
    };
    excludeEntryId?: string | null;
    excludeEntryIds?: readonly string[] | null;
  }): Promise<{ entryId: string } | null>;
}

export type EntriesRepositoryOptions = {
  /** Record a write query instead of executing it immediately. */
  recordWrite?: (query: BatchItem<"sqlite">) => void;
};

const D1_MAX_BINDINGS = 100;
const ENTRY_FIELDS_COLUMN_COUNT = 13;
const ENTRY_FIELDS_MAX_ROWS_PER_INSERT = Math.max(
  1,
  Math.floor(D1_MAX_BINDINGS / ENTRY_FIELDS_COLUMN_COUNT),
);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** Return true when a JSON-backed unique value represents an empty input. */
const isEmptyJsonValue = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  (Array.isArray(value) && value.length === 0);

/** Return true when a relation-backed unique value represents no selection. */
const isEmptyRelationValue = (value: unknown): boolean => {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return isRecord(value) && Array.isArray(value.entryIds)
    ? value.entryIds.length === 0
    : false;
};

/**
 * Create the D1 entry repository, optionally recording writes for one batch.
 */
export function createEntriesRepository(
  db: DrizzleD1Database<typeof schema>,
  options: EntriesRepositoryOptions = {},
): EntriesRepository {
  /** Execute a write immediately or append it to an atomic batch recorder. */
  const executeWrite = async (query: BatchItem<"sqlite">): Promise<void> => {
    if (options.recordWrite) {
      options.recordWrite(query);
      return;
    }
    await query;
  };

  return {
    async findModelWithFields(modelId) {
      const [model] = await db
        .select({
          id: schema.models.id,
          name: schema.models.name,
        })
        .from(schema.models)
        .where(eq(schema.models.id, modelId))
        .limit(1);

      if (!model) return null;

      const fields = await db
        .select({
          id: schema.modelFields.id,
          modelId: schema.modelFields.modelId,
          name: schema.modelFields.name,
          type: schema.modelFields.type,
          hasLocales: schema.modelFields.hasLocales,
          required: schema.modelFields.required,
          isPrivate: schema.modelFields.isPrivate,
          isUnique: schema.modelFields.isUnique,
          variant: schema.modelFields.variant,
          options: schema.modelFields.options,
          defaultValue: schema.modelFields.defaultValue,
        })
        .from(schema.modelFields)
        .where(eq(schema.modelFields.modelId, modelId))
        .orderBy(schema.modelFields.position);

      return {
        model,
        fields: fields.map((field) => ({
          id: field.id,
          modelId: field.modelId,
          name: field.name,
          type: field.type as ModelFieldRecord["type"],
          hasLocales: Boolean(field.hasLocales),
          required: Boolean(field.required),
          isPrivate: Boolean(field.isPrivate),
          isUnique: Boolean(field.isUnique),
          variant: field.variant ?? null,
          options: field.options ?? null,
          defaultValue: field.defaultValue ?? null,
        })),
      } satisfies ModelWithFields;
    },

    async findDefaultLocale() {
      const [locale] = await db
        .select({ code: schema.locales.code })
        .from(schema.locales)
        .where(eq(schema.locales.isDefault, true))
        .limit(1);

      if (locale) return locale.code;

      const [anyLocale] = await db
        .select({ code: schema.locales.code })
        .from(schema.locales)
        .limit(1);
      return anyLocale ? anyLocale.code : "en";
    },

    async localeExists(code) {
      const [locale] = await db
        .select({ code: schema.locales.code })
        .from(schema.locales)
        .where(eq(schema.locales.code, code))
        .limit(1);
      return Boolean(locale);
    },

    async findEntryById(entryId) {
      const [entry] = await db
        .select({
          id: schema.entries.id,
          modelId: schema.entries.modelId,
          status: schema.entries.status,
          createdAt: schema.entries.createdAt,
          updatedAt: schema.entries.updatedAt,
          publishedAt: schema.entries.publishedAt,
          currentDraftRevisionId: schema.entries.currentDraftRevisionId,
          publishedRevisionId: schema.entries.publishedRevisionId,
        })
        .from(schema.entries)
        .where(eq(schema.entries.id, entryId))
        .limit(1);

      if (!entry) return null;

      return {
        id: entry.id,
        modelId: entry.modelId,
        status: entry.status as EntryRecord["status"],
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        publishedAt: entry.publishedAt ?? null,
        currentDraftRevisionId: entry.currentDraftRevisionId ?? null,
        publishedRevisionId: entry.publishedRevisionId ?? null,
      } satisfies EntryRecord;
    },

    async findEntriesByIds(entryIds) {
      const uniqueIds = Array.from(new Set(entryIds));
      if (uniqueIds.length === 0) return [];

      const rows: EntryModelReferenceRecord[] = [];
      for (let index = 0; index < uniqueIds.length; index += D1_MAX_BINDINGS) {
        const chunk = uniqueIds.slice(index, index + D1_MAX_BINDINGS);
        rows.push(
          ...(await db
            .select({
              id: schema.entries.id,
              modelId: schema.entries.modelId,
            })
            .from(schema.entries)
            .where(inArray(schema.entries.id, chunk))),
        );
      }
      return rows;
    },

    async insertEntry(entry) {
      await executeWrite(db.insert(schema.entries).values(entry));
    },

    async insertEntryFields(records) {
      if (records.length === 0) return;

      for (
        let i = 0;
        i < records.length;
        i += ENTRY_FIELDS_MAX_ROWS_PER_INSERT
      ) {
        const chunk = records.slice(i, i + ENTRY_FIELDS_MAX_ROWS_PER_INSERT);
        await executeWrite(db.insert(schema.entryFields).values(chunk));
      }
    },

    async updateEntry(entryId, update) {
      await executeWrite(
        db
          .update(schema.entries)
          .set({
            status: update.status,
            updatedAt: update.updatedAt,
            publishedAt: update.publishedAt,
            updatedBy: update.updatedBy,
            currentDraftRevisionId:
              update.currentDraftRevisionId === undefined
                ? undefined
                : update.currentDraftRevisionId,
            publishedRevisionId:
              update.publishedRevisionId === undefined
                ? undefined
                : update.publishedRevisionId,
          })
          .where(eq(schema.entries.id, entryId)),
      );
    },

    async deleteEntryFields(entryId) {
      await executeWrite(
        db
          .delete(schema.entryFields)
          .where(eq(schema.entryFields.entryId, entryId)),
      );
    },

    async deleteEntryRevisions(entryId) {
      await executeWrite(
        db
          .delete(schema.entryRevisions)
          .where(eq(schema.entryRevisions.entryId, entryId)),
      );
    },

    async deleteEntry(entryId) {
      await executeWrite(
        db.delete(schema.entries).where(eq(schema.entries.id, entryId)),
      );
    },

    async getNextRevisionNumber(entryId) {
      const [result] = await db
        .select({ maxNumber: max(schema.entryRevisions.revisionNumber) })
        .from(schema.entryRevisions)
        .where(eq(schema.entryRevisions.entryId, entryId));
      const current = result?.maxNumber ?? 0;
      return current + 1;
    },

    async insertEntryRevision(revision) {
      await executeWrite(db.insert(schema.entryRevisions).values(revision));
    },

    async updateEntryRevision(revisionId, update) {
      await executeWrite(
        db
          .update(schema.entryRevisions)
          .set({
            content: update.content === undefined ? undefined : update.content,
            status: update.status === undefined ? undefined : update.status,
            publishedAt:
              update.publishedAt === undefined ? undefined : update.publishedAt,
          })
          .where(eq(schema.entryRevisions.id, revisionId)),
      );
    },

    async findRevisionById(revisionId) {
      const [row] = await db
        .select({
          id: schema.entryRevisions.id,
          entryId: schema.entryRevisions.entryId,
          revisionNumber: schema.entryRevisions.revisionNumber,
          content: schema.entryRevisions.content,
          status: schema.entryRevisions.status,
          createdBy: schema.entryRevisions.createdBy,
          createdAt: schema.entryRevisions.createdAt,
          publishedAt: schema.entryRevisions.publishedAt,
        })
        .from(schema.entryRevisions)
        .where(eq(schema.entryRevisions.id, revisionId))
        .limit(1);

      if (!row) return null;

      return {
        id: row.id,
        entryId: row.entryId,
        revisionNumber: row.revisionNumber,
        content: row.content,
        status: row.status as EntryRevisionRecord["status"],
        createdBy: row.createdBy,
        createdAt: row.createdAt,
        publishedAt: row.publishedAt ?? null,
      } satisfies EntryRevisionRecord;
    },

    async findDraftRevision(entryId) {
      const [row] = await db
        .select({
          id: schema.entryRevisions.id,
          entryId: schema.entryRevisions.entryId,
          revisionNumber: schema.entryRevisions.revisionNumber,
          content: schema.entryRevisions.content,
          status: schema.entryRevisions.status,
          createdBy: schema.entryRevisions.createdBy,
          createdAt: schema.entryRevisions.createdAt,
          publishedAt: schema.entryRevisions.publishedAt,
        })
        .from(schema.entryRevisions)
        .where(
          and(
            eq(schema.entryRevisions.entryId, entryId),
            eq(schema.entryRevisions.status, "draft"),
          ),
        )
        .orderBy(desc(schema.entryRevisions.createdAt))
        .limit(1);

      if (!row) return null;

      return {
        id: row.id,
        entryId: row.entryId,
        revisionNumber: row.revisionNumber,
        content: row.content,
        status: "draft",
        createdBy: row.createdBy,
        createdAt: row.createdAt,
        publishedAt: row.publishedAt ?? null,
      } satisfies EntryRevisionRecord;
    },

    async listRevisions(entryId, limit = 20) {
      const rows = await db
        .select({
          id: schema.entryRevisions.id,
          entryId: schema.entryRevisions.entryId,
          revisionNumber: schema.entryRevisions.revisionNumber,
          content: schema.entryRevisions.content,
          status: schema.entryRevisions.status,
          createdBy: schema.entryRevisions.createdBy,
          createdAt: schema.entryRevisions.createdAt,
          publishedAt: schema.entryRevisions.publishedAt,
        })
        .from(schema.entryRevisions)
        .where(eq(schema.entryRevisions.entryId, entryId))
        .orderBy(desc(schema.entryRevisions.createdAt))
        .limit(limit);

      return rows.map(
        (row) =>
          ({
            id: row.id,
            entryId: row.entryId,
            revisionNumber: row.revisionNumber,
            content: row.content,
            status: row.status as EntryRevisionRecord["status"],
            createdBy: row.createdBy,
            createdAt: row.createdAt,
            publishedAt: row.publishedAt ?? null,
          }) satisfies EntryRevisionRecord,
      );
    },

    async listEntryReferenceFields() {
      return await db
        .select({
          id: schema.entryFields.id,
          entryId: schema.entryFields.entryId,
          fieldId: schema.entryFields.fieldId,
          fieldType: schema.modelFields.type,
          valueJson: schema.entryFields.valueJson,
          valueRelation: schema.entryFields.valueRelation,
        })
        .from(schema.entryFields)
        .innerJoin(
          schema.modelFields,
          eq(schema.entryFields.fieldId, schema.modelFields.id),
        )
        .where(
          or(
            isNotNull(schema.entryFields.valueRelation),
            and(
              eq(schema.modelFields.type, "rich_text"),
              isNotNull(schema.entryFields.valueJson),
            ),
          ),
        );
    },

    async listCurrentDraftRevisions() {
      return await db
        .select({
          entryId: schema.entries.id,
          revisionId: schema.entryRevisions.id,
          content: schema.entryRevisions.content,
        })
        .from(schema.entries)
        .innerJoin(
          schema.entryRevisions,
          eq(schema.entries.currentDraftRevisionId, schema.entryRevisions.id),
        )
        .where(isNotNull(schema.entries.currentDraftRevisionId));
    },

    async updateEntryFieldReferenceValues(entryFieldId, update) {
      await executeWrite(
        db
          .update(schema.entryFields)
          .set({
            valueJson: update.valueJson,
            valueRelation: update.valueRelation,
            updatedAt: update.updatedAt,
          })
          .where(eq(schema.entryFields.id, entryFieldId)),
      );
    },

    async findUniqueFieldConflict(params) {
      const value = params.value;
      const locale = params.locale;
      const baseConditions = [
        eq(schema.entryFields.fieldId, params.fieldId),
        eq(schema.entryFields.locale, locale),
      ];

      switch (params.type) {
        case "text": {
          const val = value.valueString;
          if (val == null || String(val).trim().length === 0) return null;
          baseConditions.push(eq(schema.entryFields.valueString, String(val)));
          break;
        }
        case "number": {
          const val = value.valueNumber;
          if (val === null || val === undefined) return null;
          baseConditions.push(eq(schema.entryFields.valueNumber, val));
          break;
        }
        case "date": {
          const val = value.valueDate;
          if (val == null || String(val).trim().length === 0) return null;
          baseConditions.push(eq(schema.entryFields.valueDate, String(val)));
          break;
        }
        case "boolean": {
          const val = value.valueBoolean;
          if (val === null || val === undefined) return null;
          baseConditions.push(
            eq(schema.entryFields.valueBoolean, Boolean(val)),
          );
          break;
        }
        case "media": {
          const val = value.valueMedia;
          if (val) {
            baseConditions.push(eq(schema.entryFields.valueMedia, val));
            break;
          }
          const jsonVal = value.valueJson;
          if (!Array.isArray(jsonVal) || jsonVal.length === 0) return null;
          baseConditions.push(eq(schema.entryFields.valueJson, jsonVal as any));
          break;
        }
        case "relation": {
          const val = value.valueRelation;
          if (isEmptyRelationValue(val)) return null;
          baseConditions.push(eq(schema.entryFields.valueRelation, val as any));
          break;
        }
        case "json":
        case "list":
        case "custom": {
          const val = value.valueJson;
          if (isEmptyJsonValue(val)) return null;
          baseConditions.push(eq(schema.entryFields.valueJson, val as any));
          break;
        }
        case "rich_text": {
          // rich_text is not eligible for uniqueness; nothing to check
          return null;
        }
        default:
          return null;
      }

      if (params.excludeEntryId) {
        baseConditions.push(
          ne(schema.entryFields.entryId, params.excludeEntryId),
        );
      }

      const excludeEntryIds = Array.from(
        new Set((params.excludeEntryIds ?? []).filter((id) => id.length > 0)),
      );
      if (excludeEntryIds.length > 0) {
        baseConditions.push(
          notInArray(schema.entryFields.entryId, excludeEntryIds),
        );
      }

      const [row] = await db
        .select({ entryId: schema.entryFields.entryId })
        .from(schema.entryFields)
        .where(and(...baseConditions))
        .limit(1);

      return row ? { entryId: row.entryId } : null;
    },
  } satisfies EntriesRepository;
}
