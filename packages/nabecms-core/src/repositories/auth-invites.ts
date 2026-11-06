import { and, eq, inArray, sql, gte } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../database/schema";

export type AuthInviteInsert = typeof schema.authInvites.$inferInsert;
export type AuthInviteRecord = typeof schema.authInvites.$inferSelect;

export type ListInvitesFilter = {
  status?: Array<AuthInviteRecord["status"]>;
  email?: string;
  limit?: number;
};

export interface AuthInvitesRepository {
  insert(invite: AuthInviteInsert): Promise<void>;
  findById(id: string): Promise<AuthInviteRecord | null>;
  findByTokenHash(hash: string): Promise<AuthInviteRecord | null>;
  findActiveByEmail(email: string): Promise<AuthInviteRecord | null>;
  updateById(id: string, values: Partial<AuthInviteRecord>): Promise<void>;
  list(filter?: ListInvitesFilter): Promise<AuthInviteRecord[]>;
  countCreatedBySince(userId: string, sinceIso: string): Promise<number>;
}

export function createAuthInvitesRepository(
  db: DrizzleD1Database<typeof schema>,
): AuthInvitesRepository {
  return {
    async insert(invite) {
      await db.insert(schema.authInvites).values(invite);
    },
    async findById(id) {
      const rows = await db
        .select()
        .from(schema.authInvites)
        .where(eq(schema.authInvites.id, id))
        .limit(1);
      return rows[0] ?? null;
    },
    async findByTokenHash(hash) {
      const rows = await db
        .select()
        .from(schema.authInvites)
        .where(eq(schema.authInvites.tokenHash, hash))
        .limit(1);
      return rows[0] ?? null;
    },
    async findActiveByEmail(email) {
      const rows = await db
        .select()
        .from(schema.authInvites)
        .where(
          and(
            eq(schema.authInvites.email, email),
            inArray(schema.authInvites.status, ["pending", "sent"]),
          ),
        )
        .orderBy(sql`token_expires_at DESC`)
        .limit(1);
      return rows[0] ?? null;
    },
    async updateById(id, values) {
      await db
        .update(schema.authInvites)
        .set(values)
        .where(eq(schema.authInvites.id, id));
    },
    async list(filter) {
      const conditions = [];
      if (filter?.email) {
        conditions.push(eq(schema.authInvites.email, filter.email));
      }
      if (filter?.status && filter.status.length > 0) {
        conditions.push(inArray(schema.authInvites.status, filter.status));
      }
      const query = db
        .select()
        .from(schema.authInvites)
        .orderBy(sql`created_at DESC`);
      if (conditions.length > 0) {
        (query as any).where(and(...conditions));
      }
      if (filter?.limit && filter.limit > 0) {
        (query as any).limit(filter.limit);
      }
      const rows = await query;
      return rows;
    },
    async countCreatedBySince(userId, sinceIso) {
      const rows = await db
        .select({
          count: sql<number>`count(*)`,
        })
        .from(schema.authInvites)
        .where(
          and(
            eq(schema.authInvites.createdBy, userId),
            gte(schema.authInvites.createdAt, sinceIso),
          ),
        );
      return Number(rows[0]?.count ?? 0);
    },
  };
}
