import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../database/schema";

export type AuthFlowStateInsert = typeof schema.authFlowStates.$inferInsert;
export type AuthFlowStateRecord = typeof schema.authFlowStates.$inferSelect;

export interface AuthFlowStatesRepository {
  insert(flowState: AuthFlowStateInsert): Promise<void>;
  findById(id: string): Promise<AuthFlowStateRecord | null>;
  markConsumed(id: string, consumedAt: string): Promise<void>;
}

export function createAuthFlowStatesRepository(
  db: DrizzleD1Database<typeof schema>,
): AuthFlowStatesRepository {
  return {
    async insert(flowState) {
      await db.insert(schema.authFlowStates).values(flowState);
    },
    async findById(id) {
      const rows = await db
        .select()
        .from(schema.authFlowStates)
        .where(eq(schema.authFlowStates.id, id))
        .limit(1);
      return rows[0] ?? null;
    },
    async markConsumed(id, consumedAt) {
      await db
        .update(schema.authFlowStates)
        .set({ consumedAt })
        .where(eq(schema.authFlowStates.id, id));
    },
  } satisfies AuthFlowStatesRepository;
}
