/** Production D1 dependency wiring for atomic entry lifecycle mutations. */
import { sanitizeAuditSnapshot } from "../lib/audit-log";
import type { BatchItem } from "drizzle-orm/batch";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../database/schema";
import { createEntriesRepository } from "../repositories/entries";
import { createMediaRepository } from "../repositories/media";
import { generateIdWithPrefix } from "../utils/id";
import {
  ENTRY_D1_QUERY_BUDGET,
  EntryQueryBudgetExceededError,
  type AuditLogEntry,
  type EntriesServiceDeps,
} from "./entries";
import {
  serializeIdempotencyResponseBody,
  type IdempotencyRecordInput,
} from "./idempotency";

type RecordedEntryWrite = BatchItem<"sqlite">;

export type D1EntriesServiceOptions = {
  idempotency?: {
    record: IdempotencyRecordInput;
    responseStatus: number;
    createResponseBody: (result: unknown) => unknown;
  };
};

/**
 * Create entry service dependencies whose mutation callback commits through
 * exactly one D1 batch together with its audit rows.
 */
export function createD1EntriesServiceDeps(
  db: DrizzleD1Database<typeof schema>,
  options: D1EntriesServiceOptions = {},
): EntriesServiceDeps {
  const createAuditInsert = (entry: AuditLogEntry) =>
    db.insert(schema.auditLogs).values({
      id: generateIdWithPrefix("audit"),
      userId: entry.actorId,
      action: entry.action,
      targetTable: entry.targetTable,
      targetId: entry.targetId,
      before: sanitizeAuditSnapshot(entry.before),
      after: sanitizeAuditSnapshot(entry.after),
      createdAt: new Date().toISOString(),
    });

  return {
    repo: createEntriesRepository(db),
    mediaRepo: createMediaRepository(db),
    generateId: (prefix: "entry" | "entry_field" | "entry_revision") =>
      generateIdWithPrefix(prefix),
    now: () => new Date(),
    runAtomicWrite: async (work) => {
      const queries: RecordedEntryWrite[] = [];
      const recordWrite = (query: RecordedEntryWrite): void => {
        queries.push(query);
      };
      const result = await work({
        repo: createEntriesRepository(db, { recordWrite }),
        logAuditEvent: async (entry) => {
          recordWrite(createAuditInsert(entry));
        },
      });

      const idempotencyWrite = options.idempotency
        ? db.insert(schema.idempotencyRecords).values({
            ...options.idempotency.record,
            responseStatus: options.idempotency.responseStatus,
            responseBody: serializeIdempotencyResponseBody(
              options.idempotency.createResponseBody(result),
            ),
          })
        : null;
      const atomicQueries: RecordedEntryWrite[] = idempotencyWrite
        ? [idempotencyWrite, ...queries]
        : queries;

      if (atomicQueries.length === 0) {
        throw new Error("Atomic entry write produced no D1 statements");
      }
      if (atomicQueries.length > ENTRY_D1_QUERY_BUDGET) {
        throw new EntryQueryBudgetExceededError(
          atomicQueries.length,
          ENTRY_D1_QUERY_BUDGET,
        );
      }

      await db.batch(
        atomicQueries as [RecordedEntryWrite, ...RecordedEntryWrite[]],
      );
      return result;
    },
  };
}
