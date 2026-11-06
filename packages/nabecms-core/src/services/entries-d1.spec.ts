/** D1 batch budget regression tests for entry lifecycle wiring. */
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it, vi } from "vitest";
import * as schema from "../database/schema";
import {
  ENTRY_D1_QUERY_BUDGET,
  EntryQueryBudgetExceededError,
} from "./entries";
import { createD1EntriesServiceDeps } from "./entries-d1";

/** Minimal D1 prepared statement captured by the Drizzle batch adapter. */
type CapturedStatement = {
  query: string;
  params: unknown[];
};

describe("D1 entry service dependency wiring", () => {
  it("fails closed before an oversized recorded batch reaches D1", async () => {
    const batch = vi.fn(async () => []);
    const client = {
      prepare: (query: string) => ({
        bind: (...params: unknown[]): CapturedStatement => ({ query, params }),
      }),
      batch,
    } as any;
    const deps = createD1EntriesServiceDeps(drizzle(client, { schema }));

    await expect(
      deps.runAtomicWrite(async ({ logAuditEvent }) => {
        for (let index = 0; index <= ENTRY_D1_QUERY_BUDGET; index += 1) {
          await logAuditEvent({
            actorId: "user_budget",
            action: "budget_probe",
            targetTable: "entries",
            targetId: `entry_${index}`,
            before: null,
            after: null,
          });
        }
      }),
    ).rejects.toEqual(
      new EntryQueryBudgetExceededError(
        ENTRY_D1_QUERY_BUDGET + 1,
        ENTRY_D1_QUERY_BUDGET,
      ),
    );
    expect(batch).not.toHaveBeenCalled();
  });
});
