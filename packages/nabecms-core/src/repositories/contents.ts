import { and, eq, inArray, gte } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../database/schema";
import type {
  ApiKeyRecord,
  ContentsRepository,
  EntryFieldRecord,
  EntryRecord,
  MediaRecord,
  ModelFieldRecord,
  ModelRecord,
} from "../services/contents-delivery";

type Db = DrizzleD1Database<typeof schema>;

type EntryStatus = EntryRecord["status"];

type ListEntryOptions = {
  statuses: EntryStatus[];
  since?: string | null;
};

type FieldOptions = {
  fieldKeys?: string[];
  locales?: string[];
};

function mapApiKey(row: typeof schema.apiKeys.$inferSelect): ApiKeyRecord {
  const allowedModels = Array.isArray(row.allowedModels)
    ? (row.allowedModels as any[] as string[])
    : null;
  const permissions = Array.isArray(row.permissions)
    ? (row.permissions as any[] as string[])
    : [];
  return {
    id: row.id,
    permissions,
    allowedModels,
    isRevoked: Boolean(row.isRevoked),
    keyHash: (row as any).keyHash ?? null,
    lastUsedAt: row.lastUsedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  } satisfies ApiKeyRecord;
}

function mapModel(
  row: typeof schema.models.$inferSelect,
): Omit<ModelRecord, "fields"> {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    isPrivate: Boolean(row.isPrivate),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapField(
  row: typeof schema.modelFields.$inferSelect,
): ModelFieldRecord {
  return {
    id: row.id,
    modelId: row.modelId,
    name: row.name,
    fieldKey: row.fieldKey,
    type: row.type as ModelFieldRecord["type"],
    hasLocales: Boolean(row.hasLocales),
    isPrivate: Boolean(row.isPrivate),
    variant: row.variant ?? null,
    options: row.options ?? undefined,
  };
}

function mapEntry(row: typeof schema.entries.$inferSelect): EntryRecord {
  return {
    id: row.id,
    modelId: row.modelId,
    status: row.status as EntryStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    publishedAt: row.publishedAt ?? null,
  };
}

function mapFieldValue(row: any): EntryFieldRecord {
  return {
    entryId: row.entryId,
    fieldId: row.fieldId,
    fieldKey: row.fieldKey,
    type: row.fieldType as EntryFieldRecord["type"],
    variant: row.fieldVariant ?? null,
    hasLocales: Boolean(row.hasLocales),
    isPrivate: Boolean(row.isPrivate),
    locale: row.locale,
    valueString: row.valueString ?? null,
    valueNumber: row.valueNumber ?? null,
    valueDate: row.valueDate ?? null,
    valueBoolean: row.valueBoolean ?? null,
    valueJson: row.valueJson ?? null,
    valueMedia: row.valueMedia ?? null,
    valueRelation: row.valueRelation ?? null,
  };
}

function mapMedia(row: typeof schema.media.$inferSelect): MediaRecord {
  return {
    id: row.id,
    url: row.url,
    mimeType: row.mimeType,
    type: row.type,
    width: row.width ?? null,
    height: row.height ?? null,
    size: row.size,
    description: row.description ?? null,
  };
}

export function createContentsRepository(db: Db): ContentsRepository {
  return {
    async findApiKeyByToken(
      tokenHash: string,
      _tokenPlain: string,
    ): Promise<ApiKeyRecord | null> {
      const rows = await db
        .select()
        .from(schema.apiKeys)
        .where(eq(schema.apiKeys.keyHash, tokenHash))
        .limit(1);

      const row = rows[0];
      if (!row) return null;
      return mapApiKey(row as any);
    },

    async markApiKeyUsed(id: string, at: string): Promise<void> {
      await db
        .update(schema.apiKeys)
        .set({ lastUsedAt: at, updatedAt: at })
        .where(eq(schema.apiKeys.id, id));
    },

    async findDefaultLocale(): Promise<string | null> {
      const [primary] = await db
        .select({ code: schema.locales.code })
        .from(schema.locales)
        .where(eq(schema.locales.isDefault, true))
        .limit(1);
      if (primary) return primary.code;
      const [fallback] = await db
        .select({ code: schema.locales.code })
        .from(schema.locales)
        .limit(1);
      return fallback ? fallback.code : null;
    },

    async listPublicModels(): Promise<ModelRecord[]> {
      const models = await db
        .select()
        .from(schema.models)
        .where(eq(schema.models.isPrivate, false))
        .orderBy(schema.models.updatedAt);

      if (models.length === 0) return [];

      const ids = models.map((model) => model.id);
      const fields = await db
        .select()
        .from(schema.modelFields)
        .where(
          and(
            inArray(schema.modelFields.modelId, ids),
            eq(schema.modelFields.isPrivate, false),
          ),
        )
        .orderBy(schema.modelFields.position);

      const fieldMap = new Map<string, ModelFieldRecord[]>();
      for (const field of fields) {
        const mapped = mapField(field);
        const list = fieldMap.get(mapped.modelId) ?? [];
        list.push(mapped);
        fieldMap.set(mapped.modelId, list);
      }

      return models.map((model) => ({
        ...mapModel(model),
        fields: fieldMap.get(model.id) ?? [],
      }));
    },

    async findModelById(id: string): Promise<ModelRecord | null> {
      const [row] = await db
        .select()
        .from(schema.models)
        .where(eq(schema.models.id, id))
        .limit(1);
      if (!row) return null;

      const fields = await db
        .select()
        .from(schema.modelFields)
        .where(eq(schema.modelFields.modelId, id))
        .orderBy(schema.modelFields.position);

      return {
        ...mapModel(row),
        fields: fields.map(mapField),
      } satisfies ModelRecord;
    },

    async listEntriesByModel(
      modelId: string,
      options: ListEntryOptions,
    ): Promise<EntryRecord[]> {
      const conditions = [eq(schema.entries.modelId, modelId)];
      if (options.statuses?.length) {
        conditions.push(
          inArray(schema.entries.status, options.statuses as any),
        );
      }
      if (options.since) {
        conditions.push(gte(schema.entries.updatedAt, options.since));
      }

      const rows = await db
        .select()
        .from(schema.entries)
        .where(and(...conditions));

      return rows.map(mapEntry);
    },

    async listEntriesByIds(
      ids: string[],
      options: { statuses: EntryStatus[] },
    ): Promise<EntryRecord[]> {
      if (!ids.length) return [];

      const conditions = [
        inArray(schema.entries.id, ids),
        eq(schema.models.isPrivate, false),
      ];
      if (options.statuses?.length) {
        conditions.push(
          inArray(schema.entries.status, options.statuses as any),
        );
      }

      const rows = await db
        .select({ entry: schema.entries })
        .from(schema.entries)
        .innerJoin(schema.models, eq(schema.entries.modelId, schema.models.id))
        .where(and(...conditions));

      return rows.map(({ entry }) => mapEntry(entry));
    },

    async findEntryById(
      modelId: string,
      entryId: string,
    ): Promise<EntryRecord | null> {
      const [row] = await db
        .select()
        .from(schema.entries)
        .where(
          and(
            eq(schema.entries.id, entryId),
            eq(schema.entries.modelId, modelId),
          ),
        )
        .limit(1);
      return row ? mapEntry(row) : null;
    },

    async listEntryFields(
      entryIds: string[],
      options: FieldOptions,
    ): Promise<EntryFieldRecord[]> {
      if (!entryIds.length) return [];

      const conditions: any[] = [inArray(schema.entryFields.entryId, entryIds)];
      if (options.locales && options.locales.length > 0) {
        conditions.push(inArray(schema.entryFields.locale, options.locales));
      }
      const fieldKeyFilter = options.fieldKeys && options.fieldKeys.length > 0;

      const rows = await db
        .select({
          entryId: schema.entryFields.entryId,
          fieldId: schema.entryFields.fieldId,
          locale: schema.entryFields.locale,
          valueString: schema.entryFields.valueString,
          valueNumber: schema.entryFields.valueNumber,
          valueDate: schema.entryFields.valueDate,
          valueBoolean: schema.entryFields.valueBoolean,
          valueJson: schema.entryFields.valueJson,
          valueMedia: schema.entryFields.valueMedia,
          valueRelation: schema.entryFields.valueRelation,
          fieldKey: schema.modelFields.fieldKey,
          fieldType: schema.modelFields.type,
          fieldVariant: schema.modelFields.variant,
          hasLocales: schema.modelFields.hasLocales,
          isPrivate: schema.modelFields.isPrivate,
        })
        .from(schema.entryFields)
        .innerJoin(
          schema.modelFields,
          eq(schema.entryFields.fieldId, schema.modelFields.id),
        )
        .where(and(...conditions));

      const filtered = fieldKeyFilter
        ? rows.filter((row) => options.fieldKeys!.includes(row.fieldKey))
        : rows;

      return filtered.map(mapFieldValue);
    },

    async listMediaByIds(ids: string[]): Promise<MediaRecord[]> {
      if (!ids.length) return [];
      const rows = await db
        .select()
        .from(schema.media)
        .where(
          and(
            inArray(schema.media.id, ids),
            eq(schema.media.status, "published"),
          ),
        );
      return rows.map(mapMedia);
    },
  } satisfies ContentsRepository;
}

export type { ContentsRepository } from "../services/contents-delivery";
