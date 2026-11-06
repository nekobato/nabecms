/** Media persistence helpers with D1-safe binding chunking. */
import { and, count, desc, eq, inArray, like } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../database/schema";

export type MediaInsert = typeof schema.media.$inferInsert;
export type MediaRecord = typeof schema.media.$inferSelect;

export type ListParams = {
  type?: string;
  search?: string;
  limit?: number;
  offset?: number;
};

export interface MediaRepository {
  insert(record: MediaInsert): Promise<void>;
  list(params?: ListParams): Promise<MediaRecord[]>;
  count(params?: ListParams): Promise<number>;
  findById(id: string): Promise<MediaRecord | null>;
  findByIds(ids: readonly string[]): Promise<MediaRecord[]>;
  updateById(
    id: string,
    values: Partial<
      Pick<
        MediaRecord,
        "name" | "description" | "status" | "updatedAt" | "updatedBy"
      >
    >,
  ): Promise<void>;
  deleteById(id: string): Promise<void>;
}

const D1_MAX_BINDINGS = 100;

const buildSearchFilter = (search: string) => {
  const pattern = `%${search}%`;
  return like(schema.media.name, pattern);
};

/**
 * Build the shared media list filter from query parameters.
 * @param params - Media list parameters
 * @returns Drizzle condition or undefined when no filter is needed
 */
const buildListFilter = (params: ListParams) => {
  const conditions = [] as any[];
  if (params.type) {
    conditions.push(eq(schema.media.type, params.type));
  }
  if (params.search) {
    conditions.push(buildSearchFilter(params.search));
  }

  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return and(...conditions);
};

/**
 * Create a repository wrapper for media records.
 * @param db - Drizzle database instance
 * @returns Media repository
 */
export function createMediaRepository(
  db: DrizzleD1Database<typeof schema>,
): MediaRepository {
  return {
    async insert(record) {
      await db.insert(schema.media).values(record);
    },
    async list(params = {}) {
      const filter = buildListFilter(params);
      const baseQuery = db
        .select()
        .from(schema.media)
        .orderBy(desc(schema.media.createdAt));
      const query = filter ? baseQuery.where(filter) : baseQuery;

      if (typeof params.limit === "number") {
        query.limit(params.limit);
      }
      if (typeof params.offset === "number") {
        query.offset(params.offset);
      }

      return await query;
    },
    async count(params = {}) {
      const filter = buildListFilter(params);
      const baseQuery = db
        .select({ total: count(schema.media.id).as("total") })
        .from(schema.media);
      const query = filter ? baseQuery.where(filter) : baseQuery;
      const rows = await query;
      return rows[0]?.total ?? 0;
    },
    async findById(id) {
      const rows = await db
        .select()
        .from(schema.media)
        .where(eq(schema.media.id, id))
        .limit(1);
      return rows[0] ?? null;
    },
    async findByIds(ids) {
      const uniqueIds = Array.from(new Set(ids));
      if (uniqueIds.length === 0) return [];

      const rows: MediaRecord[] = [];
      for (let index = 0; index < uniqueIds.length; index += D1_MAX_BINDINGS) {
        const chunk = uniqueIds.slice(index, index + D1_MAX_BINDINGS);
        rows.push(
          ...(await db
            .select()
            .from(schema.media)
            .where(inArray(schema.media.id, chunk))),
        );
      }
      return rows;
    },
    async updateById(id, values) {
      await db.update(schema.media).set(values).where(eq(schema.media.id, id));
    },
    async deleteById(id) {
      await db.delete(schema.media).where(eq(schema.media.id, id));
    },
  } satisfies MediaRepository;
}
