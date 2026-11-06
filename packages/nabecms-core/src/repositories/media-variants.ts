import { and, desc, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../database/schema";

export type MediaVariantRecord = typeof schema.mediaVariants.$inferSelect;
export type MediaVariantInsert = typeof schema.mediaVariants.$inferInsert;

export type ListVariantParams = {
  mediaId?: string;
  status?: MediaVariantRecord["status"];
  limit?: number;
  offset?: number;
};

export interface MediaVariantRepository {
  insert(record: MediaVariantInsert): Promise<void>;
  insertMany(records: MediaVariantInsert[]): Promise<void>;
  findById(id: string): Promise<MediaVariantRecord | null>;
  findByMediaIdAndTemplateKey(
    mediaId: string,
    templateKey: string,
  ): Promise<MediaVariantRecord | null>;
  list(params: ListVariantParams): Promise<MediaVariantRecord[]>;
  updateById(
    id: string,
    values: Partial<
      Pick<
        MediaVariantRecord,
        | "url"
        | "width"
        | "height"
        | "size"
        | "mimeType"
        | "format"
        | "status"
        | "provider"
        | "error"
        | "updatedAt"
      >
    >,
  ): Promise<void>;
}

/**
 * Create a repository wrapper for media variant records.
 * @param db - Drizzle database instance
 * @returns Media variant repository
 */
export function createMediaVariantRepository(
  db: DrizzleD1Database<typeof schema>,
): MediaVariantRepository {
  return {
    async insert(record) {
      await db.insert(schema.mediaVariants).values(record);
    },
    async insertMany(records) {
      if (records.length === 0) return;
      await db.insert(schema.mediaVariants).values(records);
    },
    async findById(id) {
      const rows = await db
        .select()
        .from(schema.mediaVariants)
        .where(eq(schema.mediaVariants.id, id))
        .limit(1);
      return rows[0] ?? null;
    },
    async findByMediaIdAndTemplateKey(mediaId, templateKey) {
      const rows = await db
        .select()
        .from(schema.mediaVariants)
        .where(
          and(
            eq(schema.mediaVariants.mediaId, mediaId),
            eq(schema.mediaVariants.templateKey, templateKey),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },
    async list(params) {
      const conditions = [] as any[];
      if (params.mediaId) {
        conditions.push(eq(schema.mediaVariants.mediaId, params.mediaId));
      }
      if (params.status) {
        conditions.push(eq(schema.mediaVariants.status, params.status));
      }
      const filter =
        conditions.length === 0
          ? undefined
          : conditions.length === 1
            ? conditions[0]
            : and(...conditions);

      const base = db
        .select()
        .from(schema.mediaVariants)
        .orderBy(desc(schema.mediaVariants.createdAt));

      const query = filter ? base.where(filter) : base;
      if (typeof params.limit === "number") {
        query.limit(params.limit);
      }
      if (typeof params.offset === "number") {
        query.offset(params.offset);
      }

      return await query;
    },
    async updateById(id, values) {
      await db
        .update(schema.mediaVariants)
        .set(values)
        .where(eq(schema.mediaVariants.id, id));
    },
  } satisfies MediaVariantRepository;
}
