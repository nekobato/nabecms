import { desc, eq, inArray } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { count } from "drizzle-orm";
import * as schema from "../database/schema";
import type { ModelFieldOptions } from "../contracts";

export type ModelInsert = typeof schema.models.$inferInsert;
export type ModelRecord = typeof schema.models.$inferSelect;

export type ModelFieldDependencyCandidate = {
  field: {
    id: string;
    modelId: string;
    name: string;
    type: string;
    variant?: string | null;
    options?: ModelFieldOptions | null;
  };
  model: {
    id: string;
    name: string;
  };
};

type ModelUpdatePayload = {
  name: string;
  description: string | null;
  isPrivate: boolean;
  titleFieldId: string | null;
  updatedAt: string;
};

export interface ModelRepository {
  insert(record: ModelInsert): Promise<void>;
  list(): Promise<ModelRecord[]>;
  findById(id: string): Promise<ModelRecord | null>;
  updateById(id: string, update: ModelUpdatePayload): Promise<void>;
  findFieldById(id: string): Promise<{ id: string; modelId: string } | null>;
  countFieldsByModelIds(ids: readonly string[]): Promise<Map<string, number>>;
  countEntriesByModelIds(ids: readonly string[]): Promise<Map<string, number>>;
  deleteById(id: string): Promise<void>;
  listFieldsForDependencyCheck(): Promise<ModelFieldDependencyCandidate[]>;
}

export function createModelRepository(
  db: DrizzleD1Database<typeof schema>,
): ModelRepository {
  return {
    async insert(record) {
      await db.insert(schema.models).values(record);
    },
    async list() {
      return await db
        .select()
        .from(schema.models)
        .orderBy(desc(schema.models.updatedAt));
    },
    async findById(id) {
      const [row] = await db
        .select()
        .from(schema.models)
        .where(eq(schema.models.id, id))
        .limit(1);
      return row ?? null;
    },
    async updateById(id, update) {
      await db
        .update(schema.models)
        .set({
          name: update.name,
          description: update.description,
          isPrivate: update.isPrivate,
          titleFieldId: update.titleFieldId,
          updatedAt: update.updatedAt,
        })
        .where(eq(schema.models.id, id));
    },
    async findFieldById(id) {
      const [row] = await db
        .select({
          id: schema.modelFields.id,
          modelId: schema.modelFields.modelId,
        })
        .from(schema.modelFields)
        .where(eq(schema.modelFields.id, id))
        .limit(1);
      return row ?? null;
    },
    async countFieldsByModelIds(ids) {
      if (!ids.length) return new Map<string, number>();
      const rows = await db
        .select({
          modelId: schema.modelFields.modelId,
          total: count(schema.modelFields.id).as("total"),
        })
        .from(schema.modelFields)
        .where(inArray(schema.modelFields.modelId, ids as string[]))
        .groupBy(schema.modelFields.modelId);

      const result = new Map<string, number>();
      for (const row of rows) {
        result.set(row.modelId, row.total ?? 0);
      }
      for (const id of ids) {
        if (!result.has(id)) result.set(id, 0);
      }
      return result;
    },
    async countEntriesByModelIds(ids) {
      if (!ids.length) return new Map<string, number>();
      const rows = await db
        .select({
          modelId: schema.entries.modelId,
          total: count(schema.entries.id).as("total"),
        })
        .from(schema.entries)
        .where(inArray(schema.entries.modelId, ids as string[]))
        .groupBy(schema.entries.modelId);

      const result = new Map<string, number>();
      for (const row of rows) {
        result.set(row.modelId, row.total ?? 0);
      }
      for (const id of ids) {
        if (!result.has(id)) result.set(id, 0);
      }
      return result;
    },
    async deleteById(id) {
      await db.delete(schema.models).where(eq(schema.models.id, id));
    },
    async listFieldsForDependencyCheck() {
      const rows = await db
        .select({
          field: {
            id: schema.modelFields.id,
            modelId: schema.modelFields.modelId,
            name: schema.modelFields.name,
            type: schema.modelFields.type,
            variant: schema.modelFields.variant,
            options: schema.modelFields.options,
          },
          model: {
            id: schema.models.id,
            name: schema.models.name,
          },
        })
        .from(schema.modelFields)
        .innerJoin(
          schema.models,
          eq(schema.modelFields.modelId, schema.models.id),
        );

      return rows.map((row) => ({
        field: {
          id: row.field.id,
          modelId: row.field.modelId,
          name: row.field.name,
          type: row.field.type,
          variant: row.field.variant ?? null,
          options: (row.field.options ?? null) as ModelFieldOptions | null,
        },
        model: row.model,
      }));
    },
  } satisfies ModelRepository;
}
