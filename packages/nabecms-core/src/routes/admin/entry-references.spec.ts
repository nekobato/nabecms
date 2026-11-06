import { getTableName } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

type QueryState = {
  table: unknown;
  joined: boolean;
  limited: boolean;
};

/** Create a minimal Drizzle-like query object for entry reference route tests. */
const createEntryReferencesDbMock = () => {
  const tableName = (table: unknown): string => getTableName(table as never);
  const rowsFor = (state: QueryState): unknown[] => {
    const name = tableName(state.table);
    if (name === "entries") {
      return [
        {
          entryId: "entry_tag",
          modelId: "model_tags",
          modelName: "tags",
          status: "draft",
          currentDraftRevisionId: "revision_tag_draft",
        },
      ];
    }
    if (name === "models") {
      return [{ id: "model_tags", titleFieldId: "field_tag_name" }];
    }
    if (name === "model_fields") {
      return [
        {
          id: "field_tag_name",
          modelId: "model_tags",
          type: "text",
          hasLocales: false,
        },
      ];
    }
    if (name === "locales") {
      return [{ code: "ja-JP", isDefault: true }];
    }
    if (name === "entry_fields") {
      return [
        {
          entryId: "entry_tag",
          fieldId: "field_tag_name",
          locale: "ja-JP",
          valueString: "Published tag",
          valueNumber: null,
          valueDate: null,
          valueBoolean: null,
          valueJson: null,
          valueMedia: null,
          valueRelation: null,
          fieldType: "text",
        },
      ];
    }
    if (name === "entry_revisions") {
      return [
        {
          id: "revision_tag_draft",
          entryId: "entry_tag",
          content: {
            status: "draft",
            fields: [
              {
                fieldId: "field_tag_name",
                locale: "ja-JP",
                type: "text",
                valueString: "Draft tag",
                valueNumber: null,
                valueDate: null,
                valueBoolean: null,
                valueJson: null,
                valueMedia: null,
                valueRelation: null,
              },
            ],
          },
        },
      ];
    }
    return [];
  };

  const createQuery = (state: QueryState) => {
    const query = {
      innerJoin: () => {
        state.joined = true;
        return query;
      },
      where: () => query,
      limit: () => {
        state.limited = true;
        return Promise.resolve(rowsFor(state));
      },
      then: (
        resolve: (value: unknown[]) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => Promise.resolve(rowsFor(state)).then(resolve, reject),
    };
    return query;
  };

  return {
    select: () => ({
      from: (table: unknown) =>
        createQuery({ table, joined: false, limited: false }),
    }),
  };
};

describe("admin entry references route", () => {
  it("uses the configured title field from the current draft revision", async () => {
    vi.resetModules();
    const db = createEntryReferencesDbMock();
    vi.doMock("drizzle-orm/d1", () => ({
      drizzle: vi.fn(() => db),
    }));
    vi.doMock("./_authz", () => ({
      requireActor: vi.fn(async () => ({
        id: "user_1",
        roleIds: ["system.super-admin"],
      })),
      requirePermission: vi.fn(async () => undefined),
    }));

    const { default: app } = await import("./entry-references");
    const res = await app.request(
      "/api/admin/entry-references?entryId=entry_tag",
      {
        method: "GET",
        headers: { Authorization: "Bearer token" },
      },
      {
        DB: {} as any,
        WORKER_ENV: "test",
        JWT_SECRET: "secret",
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items[0]).toMatchObject({
      entryId: "entry_tag",
      displayTitle: "Draft tag",
    });
  });
});
