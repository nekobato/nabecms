import { asc, desc, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../database/schema";

export type LocaleInsert = typeof schema.locales.$inferInsert;
export type LocaleRecord = typeof schema.locales.$inferSelect;

export interface LocaleRepository {
  list(): Promise<LocaleRecord[]>;
  findByCode(code: string): Promise<LocaleRecord | null>;
  getDefault(): Promise<LocaleRecord | null>;
  insert(record: LocaleInsert): Promise<void>;
  clearDefault(updatedAt: string): Promise<void>;
  updateByCode(
    code: string,
    values: Partial<Pick<LocaleRecord, "isDefault" | "updatedAt">>,
  ): Promise<void>;
  deleteByCode(code: string): Promise<void>;
}

export function createLocaleRepository(
  db: DrizzleD1Database<typeof schema>,
): LocaleRepository {
  return {
    async list() {
      return await db
        .select()
        .from(schema.locales)
        .orderBy(desc(schema.locales.isDefault), asc(schema.locales.code));
    },
    async findByCode(code) {
      const rows = await db
        .select()
        .from(schema.locales)
        .where(eq(schema.locales.code, code))
        .limit(1);
      return rows[0] ?? null;
    },
    async getDefault() {
      const rows = await db
        .select()
        .from(schema.locales)
        .where(eq(schema.locales.isDefault, true))
        .limit(1);
      return rows[0] ?? null;
    },
    async insert(record) {
      await db.insert(schema.locales).values(record);
    },
    async clearDefault(updatedAt) {
      await db
        .update(schema.locales)
        .set({ isDefault: false, updatedAt })
        .where(eq(schema.locales.isDefault, true));
    },
    async updateByCode(code, values) {
      await db
        .update(schema.locales)
        .set(values)
        .where(eq(schema.locales.code, code));
    },
    async deleteByCode(code) {
      await db.delete(schema.locales).where(eq(schema.locales.code, code));
    },
  } satisfies LocaleRepository;
}
