import { and, eq, like, or } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../database/schema";

export type ApiKeyInsert = typeof schema.apiKeys.$inferInsert;
export type ApiKeyRecord = typeof schema.apiKeys.$inferSelect;

export interface ApiKeyRepository {
  list(params?: { search?: string }): Promise<ApiKeyRecord[]>;
  findById(id: string): Promise<ApiKeyRecord | null>;
  findByKeyHash(keyHash: string): Promise<ApiKeyRecord | null>;
  insert(record: ApiKeyInsert): Promise<void>;
  updateById(
    id: string,
    values: Partial<
      Pick<
        ApiKeyRecord,
        | "name"
        | "description"
        | "permissions"
        | "allowedModels"
        | "isRevoked"
        | "createdBy"
        | "revokedBy"
        | "revokedAt"
        | "key"
        | "keyHash"
        | "updatedAt"
        | "lastUsedAt"
      >
    >,
  ): Promise<void>;
  deleteById(id: string): Promise<void>;
}

export function createApiKeyRepository(
  db: DrizzleD1Database<typeof schema>,
): ApiKeyRepository {
  return {
    async list(params) {
      const where = [] as any[];
      if (params?.search) {
        const q = `%${params.search}%`;
        where.push(
          or(like(schema.apiKeys.name, q), like(schema.apiKeys.description, q)),
        );
      }

      const query = db
        .select()
        .from(schema.apiKeys)
        .orderBy(schema.apiKeys.createdAt);

      const rows = where.length
        ? await query.where(and(...where))
        : await query;
      return rows;
    },

    async findById(id) {
      const [row] = await db
        .select()
        .from(schema.apiKeys)
        .where(eq(schema.apiKeys.id, id))
        .limit(1);
      return row ?? null;
    },

    async findByKeyHash(keyHash) {
      const [row] = await db
        .select()
        .from(schema.apiKeys)
        .where(eq(schema.apiKeys.keyHash, keyHash))
        .limit(1);
      return row ?? null;
    },

    async insert(record) {
      await db.insert(schema.apiKeys).values(record);
    },

    async updateById(id, values) {
      await db
        .update(schema.apiKeys)
        .set(values)
        .where(eq(schema.apiKeys.id, id));
    },

    async deleteById(id) {
      await db.delete(schema.apiKeys).where(eq(schema.apiKeys.id, id));
    },
  } satisfies ApiKeyRepository;
}
