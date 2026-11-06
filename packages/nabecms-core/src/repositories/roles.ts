import { eq, inArray } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../database/schema";

export type RoleInsert = typeof schema.roles.$inferInsert;
export type RoleRecord = typeof schema.roles.$inferSelect;

export type RolePermissions = {
  allow: string[];
};

export interface RoleRepository {
  list(): Promise<RoleRecord[]>;
  findById(id: string): Promise<RoleRecord | null>;
  findByName(name: string): Promise<RoleRecord | null>;
  findManyByIds(ids: string[]): Promise<RoleRecord[]>;
  insert(record: RoleInsert): Promise<void>;
  updateById(
    id: string,
    values: Partial<
      Pick<RoleRecord, "name" | "description" | "permissions" | "updatedAt">
    >,
  ): Promise<void>;
  deleteById(id: string): Promise<void>;
}

export function createRoleRepository(
  db: DrizzleD1Database<typeof schema>,
): RoleRepository {
  return {
    async list() {
      return await db
        .select()
        .from(schema.roles)
        .orderBy(schema.roles.createdAt);
    },
    async findById(id) {
      const rows = await db
        .select()
        .from(schema.roles)
        .where(eq(schema.roles.id, id))
        .limit(1);
      return rows[0] ?? null;
    },
    async findByName(name) {
      const rows = await db
        .select()
        .from(schema.roles)
        .where(eq(schema.roles.name, name))
        .limit(1);
      return rows[0] ?? null;
    },
    async findManyByIds(ids) {
      if (ids.length === 0) return [];
      const unique = Array.from(new Set(ids));
      const rows = await db
        .select()
        .from(schema.roles)
        .where(inArray(schema.roles.id, unique));
      return rows;
    },
    async insert(record) {
      await db.insert(schema.roles).values(record);
    },
    async updateById(id, values) {
      await db.update(schema.roles).set(values).where(eq(schema.roles.id, id));
    },
    async deleteById(id) {
      await db.delete(schema.roles).where(eq(schema.roles.id, id));
    },
  } satisfies RoleRepository;
}
