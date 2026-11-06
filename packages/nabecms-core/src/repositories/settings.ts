import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../database/schema";

export type SettingRecord = typeof schema.settings.$inferSelect;
export type SettingInsert = typeof schema.settings.$inferInsert;

export interface SettingsRepository {
  findByKey(key: string): Promise<SettingRecord | null>;
  upsert(
    key: string,
    value: SettingRecord["value"],
    updatedAt: string,
  ): Promise<void>;
}

/**
 * Create a repository wrapper for settings records.
 * @param db - Drizzle database instance
 * @returns Settings repository
 */
export function createSettingsRepository(
  db: DrizzleD1Database<typeof schema>,
): SettingsRepository {
  return {
    async findByKey(key) {
      const rows = await db
        .select()
        .from(schema.settings)
        .where(eq(schema.settings.key, key))
        .limit(1);
      return rows[0] ?? null;
    },
    async upsert(key, value, updatedAt) {
      const existing = await db
        .select({ key: schema.settings.key })
        .from(schema.settings)
        .where(eq(schema.settings.key, key))
        .limit(1);
      if (existing.length > 0) {
        await db
          .update(schema.settings)
          .set({ value, updatedAt })
          .where(eq(schema.settings.key, key));
        return;
      }
      await db.insert(schema.settings).values({ key, value, updatedAt });
    },
  } satisfies SettingsRepository;
}
