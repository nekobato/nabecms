import type { BatchItem } from "drizzle-orm/batch";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it, vi } from "vitest";
import * as schema from "../database/schema";
import { createEntriesRepository } from "./entries";

/** Build one complete entry-field row for recorder chunking tests. */
const createEntryField = (index: number) => ({
  id: `entry_field_${index}`,
  entryId: "entry_recorded",
  fieldId: `field_${index}`,
  locale: "en",
  valueString: `value-${index}`,
  valueNumber: null,
  valueDate: null,
  valueBoolean: null,
  valueJson: null,
  valueMedia: null,
  valueRelation: null,
  createdAt: "2026-07-15T00:00:00.000Z",
  updatedAt: "2026-07-15T00:00:00.000Z",
});

describe("entries repository", () => {
  it("records seven-row field chunks without executing them", async () => {
    const client = {
      prepare: vi.fn(() => {
        throw new Error("recorded queries must not execute");
      }),
    };
    const db = drizzle(client as never, { schema });
    const recorded: BatchItem<"sqlite">[] = [];
    const repo = createEntriesRepository(db, {
      recordWrite: (query) => recorded.push(query),
    });

    await repo.insertEntryFields(
      Array.from({ length: 8 }, (_, index) => createEntryField(index)),
    );

    expect(recorded).toHaveLength(2);
    expect(client.prepare).not.toHaveBeenCalled();
    expect(
      recorded.map(
        (query) =>
          (query as unknown as { toSQL: () => { params: unknown[] } }).toSQL()
            .params.length,
      ),
    ).toEqual([91, 13]);
  });

  it("chunks entry relation lookups at the D1 100-binding limit", async () => {
    const select = vi.fn(() => {
      const chunkNumber = select.mock.calls.length;
      const query = {
        from: vi.fn(() => query),
        where: vi.fn(() =>
          Promise.resolve([
            { id: `entry_result_${chunkNumber}`, modelId: "model_target" },
          ]),
        ),
      };
      return query;
    });
    const repo = createEntriesRepository({ select } as never);

    const rows = await repo.findEntriesByIds(
      Array.from({ length: 201 }, (_, index) => `entry_${index}`),
    );

    expect(select).toHaveBeenCalledTimes(3);
    expect(rows).toHaveLength(3);
  });
});
