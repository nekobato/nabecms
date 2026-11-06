import { and, asc, eq, inArray, lte } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../database/schema";

type Db = DrizzleD1Database<typeof schema>;

export type ScheduledPublicationActionType = "publish" | "unpublish";

export type ScheduledPublicationActionStatus =
  "pending" | "processing" | "completed" | "failed" | "cancelled";

export type ScheduledPublicationActionRecord = {
  id: string;
  modelId: string;
  entryId: string;
  revisionId: string | null;
  action: ScheduledPublicationActionType;
  status: ScheduledPublicationActionStatus;
  scheduledAt: string;
  requestedBy: string;
  lockedAt: string | null;
  executedAt: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ScheduledPublicationActionInsert =
  typeof schema.scheduledPublicationActions.$inferInsert;

export type ScheduledPublicationActionUpdate = Partial<
  Pick<
    ScheduledPublicationActionRecord,
    "status" | "lockedAt" | "executedAt" | "error" | "updatedAt"
  >
>;

export type ScheduledPublicationActionListFilter = {
  modelId?: string;
  entryId?: string;
  statuses?: ScheduledPublicationActionStatus[];
  limit?: number;
};

export interface PublicationScheduleRepository {
  insert(
    action: ScheduledPublicationActionInsert,
  ): Promise<ScheduledPublicationActionRecord>;
  findById(id: string): Promise<ScheduledPublicationActionRecord | null>;
  list(
    filter?: ScheduledPublicationActionListFilter,
  ): Promise<readonly ScheduledPublicationActionRecord[]>;
  listDuePending(
    nowIso: string,
    limit: number,
  ): Promise<readonly ScheduledPublicationActionRecord[]>;
  findNextPending(): Promise<ScheduledPublicationActionRecord | null>;
  releaseStaleProcessing(cutoffIso: string, updatedAt: string): Promise<void>;
  claimPendingAction(id: string, lockedAt: string): Promise<boolean>;
  update(id: string, update: ScheduledPublicationActionUpdate): Promise<void>;
}

/**
 * Convert a database row into a scheduled publication record.
 * @param row - Database row
 * @returns Scheduled publication action record
 */
const mapAction = (
  row: typeof schema.scheduledPublicationActions.$inferSelect,
): ScheduledPublicationActionRecord => ({
  id: row.id,
  modelId: row.modelId,
  entryId: row.entryId,
  revisionId: row.revisionId ?? null,
  action: row.action as ScheduledPublicationActionType,
  status: row.status as ScheduledPublicationActionStatus,
  scheduledAt: row.scheduledAt,
  requestedBy: row.requestedBy,
  lockedAt: row.lockedAt ?? null,
  executedAt: row.executedAt ?? null,
  error: row.error ?? null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/**
 * Create the repository used by scheduled publication services.
 * @param db - Drizzle database
 * @returns Repository for scheduled publication actions
 */
export function createPublicationScheduleRepository(
  db: Db,
): PublicationScheduleRepository {
  return {
    async insert(action) {
      await db.insert(schema.scheduledPublicationActions).values(action);
      const inserted = await this.findById(action.id);
      if (!inserted) throw new Error("Failed to create scheduled action");
      return inserted;
    },

    async findById(id) {
      const [row] = await db
        .select()
        .from(schema.scheduledPublicationActions)
        .where(eq(schema.scheduledPublicationActions.id, id))
        .limit(1);
      return row ? mapAction(row) : null;
    },

    async list(filter = {}) {
      const conditions = [];
      if (filter.modelId) {
        conditions.push(
          eq(schema.scheduledPublicationActions.modelId, filter.modelId),
        );
      }
      if (filter.entryId) {
        conditions.push(
          eq(schema.scheduledPublicationActions.entryId, filter.entryId),
        );
      }
      if (filter.statuses?.length) {
        conditions.push(
          inArray(schema.scheduledPublicationActions.status, filter.statuses),
        );
      }

      const base = db
        .select()
        .from(schema.scheduledPublicationActions)
        .orderBy(
          asc(schema.scheduledPublicationActions.scheduledAt),
          asc(schema.scheduledPublicationActions.createdAt),
        )
        .limit(filter.limit ?? 100);
      const rows =
        conditions.length > 0
          ? await base.where(and(...conditions))
          : await base;
      return rows.map(mapAction);
    },

    async listDuePending(nowIso, limit) {
      const rows = await db
        .select()
        .from(schema.scheduledPublicationActions)
        .where(
          and(
            eq(schema.scheduledPublicationActions.status, "pending"),
            lte(schema.scheduledPublicationActions.scheduledAt, nowIso),
          ),
        )
        .orderBy(
          asc(schema.scheduledPublicationActions.scheduledAt),
          asc(schema.scheduledPublicationActions.createdAt),
        )
        .limit(limit);
      return rows.map(mapAction);
    },

    async findNextPending() {
      const [row] = await db
        .select()
        .from(schema.scheduledPublicationActions)
        .where(eq(schema.scheduledPublicationActions.status, "pending"))
        .orderBy(
          asc(schema.scheduledPublicationActions.scheduledAt),
          asc(schema.scheduledPublicationActions.createdAt),
        )
        .limit(1);
      return row ? mapAction(row) : null;
    },

    async releaseStaleProcessing(cutoffIso, updatedAt) {
      await db
        .update(schema.scheduledPublicationActions)
        .set({
          status: "pending",
          lockedAt: null,
          updatedAt,
        })
        .where(
          and(
            eq(schema.scheduledPublicationActions.status, "processing"),
            lte(schema.scheduledPublicationActions.lockedAt, cutoffIso),
          ),
        );
    },

    async claimPendingAction(id, lockedAt) {
      const rows = await db
        .update(schema.scheduledPublicationActions)
        .set({
          status: "processing",
          lockedAt,
          error: null,
          updatedAt: lockedAt,
        })
        .where(
          and(
            eq(schema.scheduledPublicationActions.id, id),
            eq(schema.scheduledPublicationActions.status, "pending"),
          ),
        )
        .returning({ id: schema.scheduledPublicationActions.id });
      return rows.length > 0;
    },

    async update(id, update) {
      await db
        .update(schema.scheduledPublicationActions)
        .set(update)
        .where(eq(schema.scheduledPublicationActions.id, id));
    },
  };
}
