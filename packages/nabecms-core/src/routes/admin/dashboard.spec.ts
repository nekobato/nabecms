import { describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";

type QueryState = {
  table: unknown;
  joined: boolean;
  limited: boolean;
};

/**
 * Create a minimal Drizzle-like query object for dashboard route tests.
 */
const createDashboardDbMock = () => {
  const tableName = (table: unknown): string => getTableName(table as never);
  const rowsFor = (state: QueryState): unknown[] => {
    const name = tableName(state.table);
    if (name === "models") return [{ value: 1 }];
    if (name === "entries" && !state.joined) return [{ value: 1 }];
    if (name === "media" && !state.limited) return [{ value: 0 }];
    if (name === "users" && !state.joined) return [{ value: 1 }];
    if (name === "entries" && state.joined) {
      return [
        {
          id: "entry_1",
          modelId: "model_article",
          modelName: "Article",
          titleFieldId: "field_title",
          status: "draft",
          updatedAt: "2026-05-08T10:00:00.000Z",
          updatedBy: "user_1",
          updatedByName: "nekobato",
          currentDraftRevisionId: "revision_draft",
        },
      ];
    }
    if (name === "locales") {
      return [{ code: "ja-JP", isDefault: true }];
    }
    if (name === "model_fields") {
      return [
        {
          id: "field_title",
          modelId: "model_article",
          name: "Title",
          fieldKey: "title",
          type: "text",
          position: 0,
          required: true,
          hasLocales: false,
          isUnique: false,
          variant: "shortText",
          options: null,
          defaultValue: null,
          isPrivate: false,
          createdAt: "2026-05-08T09:00:00.000Z",
          updatedAt: "2026-05-08T09:00:00.000Z",
        },
      ];
    }
    if (name === "entry_fields") {
      return [
        {
          entryId: "entry_1",
          fieldId: "field_title",
          locale: "ja-JP",
          valueString: "Published title",
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
          id: "revision_draft",
          entryId: "entry_1",
          content: {
            status: "draft",
            fields: [
              {
                fieldId: "field_title",
                locale: "ja-JP",
                type: "text",
                valueString: "Draft title",
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
    if (name === "media" && state.limited) return [];
    if (name === "audit_logs") return [];
    return [];
  };

  const createQuery = (state: QueryState) => {
    const query = {
      leftJoin: () => {
        state.joined = true;
        return query;
      },
      innerJoin: () => {
        state.joined = true;
        return query;
      },
      where: () => query,
      orderBy: () => query,
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

describe("admin dashboard route", () => {
  it("uses the model title field value for recent entry display title", async () => {
    vi.resetModules();
    const db = createDashboardDbMock();
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

    const { default: app } = await import("./dashboard");
    const res = await app.request(
      "/api/admin/dashboard",
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
    expect(body.recentEntries[0]).toMatchObject({
      id: "entry_1",
      displayTitle: "Draft title",
      updatedBy: "user_1",
      updatedByName: "nekobato",
    });
  });
});
