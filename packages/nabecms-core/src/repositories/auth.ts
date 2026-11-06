import { and, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../database/schema";

export type AuthAccountInsert = typeof schema.authAccounts.$inferInsert;
export type AuthAccountRecord = typeof schema.authAccounts.$inferSelect;

export interface AuthRepository {
  findCredentialAccountByUserId(
    userId: string,
  ): Promise<AuthAccountRecord | null>;
  createCredentialAccount(record: AuthAccountInsert): Promise<void>;
  updateCredentialPassword(
    id: string,
    password: string,
    updatedAt: Date,
  ): Promise<void>;
  deleteSessionsByUserId(userId: string): Promise<void>;
}

export function createAuthRepository(
  db: DrizzleD1Database<typeof schema>,
): AuthRepository {
  return {
    async findCredentialAccountByUserId(userId) {
      const rows = await db
        .select()
        .from(schema.authAccounts)
        .where(
          and(
            eq(schema.authAccounts.userId, userId),
            eq(schema.authAccounts.providerId, "credential"),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },
    async createCredentialAccount(record) {
      await db.insert(schema.authAccounts).values(record);
    },
    async updateCredentialPassword(id, password, updatedAt) {
      await db
        .update(schema.authAccounts)
        .set({ password, updatedAt })
        .where(eq(schema.authAccounts.id, id));
    },
    async deleteSessionsByUserId(userId) {
      await db
        .delete(schema.authSessions)
        .where(eq(schema.authSessions.userId, userId));
    },
  } satisfies AuthRepository;
}
