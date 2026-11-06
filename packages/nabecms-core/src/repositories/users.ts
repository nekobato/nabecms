import { and, asc, eq, exists, inArray, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../database/schema";

export type UserRecord = typeof schema.users.$inferSelect;
export type UserInsert = typeof schema.users.$inferInsert;
export type ManagedUserUpdate = {
  values: Partial<Pick<UserRecord, "name" | "email">>;
  roleIds?: string[];
  updatedAt: string;
  canModifySystemUser: boolean;
  actorId?: string;
  revokeSessions: boolean;
};

export interface UserRepository {
  list(): Promise<UserRecord[]>;
  findById(id: string): Promise<UserRecord | null>;
  findByEmail(email: string): Promise<UserRecord | null>;
  findManyByIds(ids: string[]): Promise<UserRecord[]>;
  listRoleIdsByUserId(userId: string): Promise<string[]>;
  listRoleIdsByUserIds(userIds: string[]): Promise<Record<string, string[]>>;
  replaceRoleIds(
    userId: string,
    roleIds: string[],
    updatedAt: string,
  ): Promise<void>;
  insert(record: UserInsert): Promise<void>;
  updateById(
    id: string,
    values: Partial<
      Pick<
        UserRecord,
        "name" | "email" | "password" | "uiPreferences" | "updatedAt"
      >
    >,
  ): Promise<void>;
  deleteById(id: string): Promise<void>;
  updateManagedUser(id: string, update: ManagedUserUpdate): Promise<boolean>;
  deleteManagedUser(id: string): Promise<boolean>;
}

export function createUserRepository(
  db: DrizzleD1Database<typeof schema>,
): UserRepository {
  const isNotSuperAdmin = (userId: string) => sql<boolean>`
    NOT EXISTS (
      SELECT 1 FROM ${schema.userRoles}
      WHERE ${schema.userRoles.userId} = ${userId}
        AND ${schema.userRoles.roleId} = ${"system.super-admin"}
    ) AND NOT EXISTS (
      SELECT 1 FROM json_each(${schema.users.roleId})
      WHERE value = ${"system.super-admin"}
    )
  `;

  return {
    async list() {
      return await db
        .select()
        .from(schema.users)
        .orderBy(schema.users.createdAt);
    },
    async findById(id) {
      const rows = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, id))
        .limit(1);
      return rows[0] ?? null;
    },
    async findByEmail(email) {
      const rows = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1);
      return rows[0] ?? null;
    },
    async findManyByIds(ids) {
      const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
      if (uniqueIds.length === 0) return [];
      return db
        .select()
        .from(schema.users)
        .where(inArray(schema.users.id, uniqueIds));
    },
    async listRoleIdsByUserId(userId) {
      const rows = await db
        .select({ roleId: schema.userRoles.roleId })
        .from(schema.userRoles)
        .where(eq(schema.userRoles.userId, userId))
        .orderBy(asc(schema.userRoles.roleId));
      return rows.map((row) => row.roleId);
    },
    async listRoleIdsByUserIds(userIds) {
      const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));
      const grouped = Object.fromEntries(
        uniqueIds.map((id) => [id, [] as string[]]),
      );
      if (uniqueIds.length === 0) return grouped;

      const rows = await db
        .select({
          userId: schema.userRoles.userId,
          roleId: schema.userRoles.roleId,
        })
        .from(schema.userRoles)
        .where(inArray(schema.userRoles.userId, uniqueIds))
        .orderBy(asc(schema.userRoles.userId), asc(schema.userRoles.roleId));

      for (const row of rows) {
        grouped[row.userId] ??= [];
        grouped[row.userId].push(row.roleId);
      }
      return grouped;
    },
    async replaceRoleIds(userId, roleIds, updatedAt) {
      const roleInserts = [];
      // Each binding has three parameters; keep every statement below D1's 100.
      const rowsPerInsert = Math.floor(100 / 3);
      for (let index = 0; index < roleIds.length; index += rowsPerInsert) {
        roleInserts.push(
          db.insert(schema.userRoles).values(
            roleIds.slice(index, index + rowsPerInsert).map((roleId) => ({
              userId,
              roleId,
              createdAt: updatedAt,
            })),
          ),
        );
      }
      // Auth issuers and privilege checks must never observe a partial replacement.
      await db.batch([
        db.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId)),
        ...roleInserts,
        db
          .update(schema.users)
          .set({ roleId: roleIds, updatedAt })
          .where(eq(schema.users.id, userId)),
      ] as const);
    },
    async insert(record) {
      await db.insert(schema.users).values(record);
    },
    async updateById(id, values) {
      await db.update(schema.users).set(values).where(eq(schema.users.id, id));
    },
    async deleteById(id) {
      await db.delete(schema.users).where(eq(schema.users.id, id));
    },
    async updateManagedUser(id, update) {
      if (update.values.email !== undefined && update.actorId !== id) {
        return false;
      }
      if (
        !update.canModifySystemUser &&
        update.roleIds?.includes("system.super-admin")
      ) {
        return false;
      }

      // Re-evaluate protection inside the same batch as every affected write.
      // Even a Super Admin cannot remove the reserved role from a target that
      // was promoted after the service's earlier read.
      const mustBeOrdinary =
        !update.canModifySystemUser ||
        (update.roleIds !== undefined &&
          !update.roleIds.includes("system.super-admin"));
      const permittedUser = db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(
          and(
            eq(schema.users.id, id),
            mustBeOrdinary ? isNotSuperAdmin(id) : undefined,
          ),
        );
      const roleWrites =
        update.roleIds === undefined
          ? []
          : [
              db
                .delete(schema.userRoles)
                .where(
                  and(eq(schema.userRoles.userId, id), exists(permittedUser)),
                ),
              db.insert(schema.userRoles).select(sql`
                SELECT ${id}, value, ${update.updatedAt}
                FROM json_each(${JSON.stringify(update.roleIds)})
                WHERE ${exists(permittedUser)}
              `),
            ];
      const sessionWrites = update.revokeSessions
        ? [
            db
              .delete(schema.authSessions)
              .where(
                and(eq(schema.authSessions.userId, id), exists(permittedUser)),
              ),
          ]
        : [];
      const [updated] = await db.batch([
        db
          .update(schema.users)
          .set({
            ...update.values,
            updatedAt: update.updatedAt,
            ...(update.roleIds === undefined ? {} : { roleId: update.roleIds }),
          })
          .where(inArray(schema.users.id, permittedUser))
          .returning({ id: schema.users.id }),
        ...roleWrites,
        ...sessionWrites,
      ] as const);
      return updated.length === 1;
    },
    async deleteManagedUser(id) {
      // Credential, role and session rows cascade only when this guarded DELETE
      // succeeds; no stale service read can authorize a protected-account delete.
      const deleted = await db
        .delete(schema.users)
        .where(and(eq(schema.users.id, id), isNotSuperAdmin(id)))
        .returning({ id: schema.users.id });
      return deleted.length === 1;
    },
  } satisfies UserRepository;
}
