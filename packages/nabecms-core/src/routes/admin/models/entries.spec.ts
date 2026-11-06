import { drizzle } from "drizzle-orm/d1";
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as schema from "../../../database/schema";
import { createApp } from "../../../create-app";
import * as authLib from "../../../lib/auth";
import * as webhookLib from "../../../lib/webhook";
import * as entriesService from "../../../services/entries";
import * as idempotencyService from "../../../services/idempotency";
import * as entriesShared from "./entries/shared";

const app = createApp();

vi.mock("../../../services/entries", async () => {
  const actual = await vi.importActual<
    typeof import("../../../services/entries")
  >("../../../services/entries");
  return {
    ...actual,
    createEntry: vi.fn(),
    updateEntry: vi.fn(),
    bulkPublishEntries: vi.fn(),
    publishEntryRevision: vi.fn(),
    restoreEntryRevision: vi.fn(),
    unpublishEntry: vi.fn(),
    deleteEntry: vi.fn(),
  };
});

vi.mock("../../../lib/webhook", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/webhook")>(
    "../../../lib/webhook",
  );
  return {
    ...actual,
    dispatchWebhooks: vi.fn(),
  };
});

vi.mock("../../../services/idempotency", async () => {
  const actual = await vi.importActual<
    typeof import("../../../services/idempotency")
  >("../../../services/idempotency");
  return {
    ...actual,
    prepareIdempotencyRequest: vi.fn(),
    resolveCommittedIdempotencyReplay: vi.fn(),
    isIdempotencyRecordConflict: vi.fn(() => false),
  };
});

vi.mock("./entries/shared", async () => {
  const actual =
    await vi.importActual<typeof import("./entries/shared")>(
      "./entries/shared",
    );
  return {
    ...actual,
    getDrizzleDb: vi.fn(actual.getDrizzleDb),
  };
});

describe("admin model entries routes", () => {
  const env = {
    DB: {} as any,
    WORKER_ENV: "test" as const,
    JWT_SECRET: "secret",
    ASSETS: { fetch: vi.fn() },
  };

  const createEntryMock = vi.mocked(entriesService.createEntry);
  const updateEntryMock = vi.mocked(entriesService.updateEntry);
  const bulkPublishEntriesMock = vi.mocked(entriesService.bulkPublishEntries);
  const publishEntryRevisionMock = vi.mocked(
    entriesService.publishEntryRevision,
  );
  const restoreEntryRevisionMock = vi.mocked(
    entriesService.restoreEntryRevision,
  );
  const unpublishEntryMock = vi.mocked(entriesService.unpublishEntry);
  const deleteEntryMock = vi.mocked(entriesService.deleteEntry);
  const dispatchWebhooksMock = vi.mocked(webhookLib.dispatchWebhooks);
  const getDrizzleDbMock = vi.mocked(entriesShared.getDrizzleDb);
  const prepareIdempotencyRequestMock = vi.mocked(
    idempotencyService.prepareIdempotencyRequest,
  );

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(authLib, "verifyAccessToken").mockResolvedValue({
      sub: "user_42",
      sid: "sess_test",
      roles: ["system.super-admin"],
    } as any);
    createEntryMock.mockReset();
    updateEntryMock.mockReset();
    bulkPublishEntriesMock.mockReset();
    publishEntryRevisionMock.mockReset();
    restoreEntryRevisionMock.mockReset();
    unpublishEntryMock.mockReset();
    deleteEntryMock.mockReset();
    dispatchWebhooksMock.mockReset();
    getDrizzleDbMock.mockReset();
    getDrizzleDbMock.mockImplementation((c) => drizzle(c.env.DB, { schema }));
    prepareIdempotencyRequestMock.mockReset();
    prepareIdempotencyRequestMock.mockResolvedValue({
      kind: "execute",
      record: {
        id: "idempotency_1",
        principalId: "user_42",
        operation: "entry.test",
        keyHash: "key_hash",
        requestHash: "request_hash",
        createdAt: "2026-07-30T00:00:00.000Z",
        expiresAt: "2026-07-31T00:00:00.000Z",
      },
    });
  });

  it("never dispatches legacy webhooks from reachable entry write routes", async () => {
    const item = {
      id: "entry_1",
      modelId: "model_1",
      status: "published" as const,
      createdAt: "2025-09-20T00:00:00.000Z",
      updatedAt: "2025-09-26T12:00:00.000Z",
      publishedAt: "2025-09-26T12:00:00.000Z",
      currentDraftRevisionId: null,
      publishedRevisionId: "revision_live",
    };
    createEntryMock.mockResolvedValue(item);
    updateEntryMock.mockResolvedValue(item);
    bulkPublishEntriesMock.mockResolvedValue([item]);
    publishEntryRevisionMock.mockResolvedValue(item);
    restoreEntryRevisionMock.mockResolvedValue(item);
    unpublishEntryMock.mockResolvedValue(item);
    deleteEntryMock.mockResolvedValue(item);
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const jsonHeaders = {
      Authorization: "Bearer token",
      "Content-Type": "application/json",
    };
    const requests = [
      app.request(
        "/api/admin/models/model_1/entries",
        {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({ status: "draft", fields: [] }),
        },
        env,
      ),
      app.request(
        "/api/admin/models/model_1/entries/entry_1",
        {
          method: "PUT",
          headers: jsonHeaders,
          body: JSON.stringify({ status: "draft", fields: [] }),
        },
        env,
      ),
      app.request(
        "/api/admin/models/model_1/entries/entry_1/publish",
        {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({}),
        },
        env,
      ),
      app.request(
        "/api/admin/models/model_1/entries/entry_1/revisions/revision_1/restore",
        { method: "POST", headers: jsonHeaders },
        env,
      ),
      app.request(
        "/api/admin/models/model_1/entries/entry_1/unpublish",
        { method: "POST", headers: jsonHeaders },
        env,
      ),
      app.request(
        "/api/admin/models/model_1/entries/entry_1",
        { method: "DELETE", headers: { Authorization: "Bearer token" } },
        env,
      ),
      ...(["publish", "unpublish", "delete"] as const).map((action) =>
        app.request(
          "/api/admin/models/model_1/entries/bulk",
          {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ action, entryIds: ["entry_1"] }),
          },
          env,
        ),
      ),
    ];

    const responses = await Promise.all(requests);

    expect(responses.every((response) => response.ok)).toBe(true);
    expect(dispatchWebhooksMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("omits scheduled publishing data from the entry sheet read", async () => {
    const selectedTables: unknown[] = [];
    const rowsForTable = (table: unknown): unknown[] => {
      if (table === schema.models) {
        return [
          {
            id: "model_1",
            name: "Article",
            apiIdentifier: "article",
            titleFieldId: null,
          },
        ];
      }
      if (table === schema.locales) {
        return [{ code: "en", isDefault: true }];
      }
      if (table === schema.entries) {
        return [
          {
            id: "entry_1",
            modelId: "model_1",
            status: "draft",
            createdAt: "2025-09-20T00:00:00.000Z",
            updatedAt: "2025-09-26T12:00:00.000Z",
            updatedBy: "user_42",
            updatedByName: "Admin",
            publishedAt: null,
            currentDraftRevisionId: null,
            publishedRevisionId: null,
          },
        ];
      }
      if (table === schema.scheduledPublicationActions) {
        return [
          {
            id: "schedule_legacy",
            entryId: "entry_1",
            action: "publish",
            status: "pending",
            scheduledAt: "2025-10-01T00:00:00.000Z",
          },
        ];
      }
      return [];
    };
    const db = {
      select: vi.fn(() => {
        let selectedTable: unknown;
        const query = {
          from: vi.fn((table: unknown) => {
            selectedTable = table;
            selectedTables.push(table);
            return query;
          }),
          leftJoin: vi.fn(() => query),
          innerJoin: vi.fn(() => query),
          where: vi.fn(() => query),
          orderBy: vi.fn(() => query),
          limit: vi.fn(() => query),
          then: (
            onFulfilled: (rows: unknown[]) => unknown,
            onRejected?: (error: unknown) => unknown,
          ) =>
            Promise.resolve(rowsForTable(selectedTable)).then(
              onFulfilled,
              onRejected,
            ),
        };
        return query;
      }),
    };
    getDrizzleDbMock.mockReturnValue(db as never);

    const response = await app.request(
      "/api/admin/models/model_1/entries/sheet",
      { headers: { Authorization: "Bearer token" } },
      env,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(selectedTables).not.toContain(schema.scheduledPublicationActions);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).not.toHaveProperty("activeSchedules");
  });

  it("POST /api/admin/models/:modelId/entries creates entry", async () => {
    createEntryMock.mockResolvedValue({
      id: "entry_1",
      modelId: "model_1",
      status: "draft",
      createdAt: "2025-09-26T12:00:00.000Z",
      updatedAt: "2025-09-26T12:00:00.000Z",
      publishedAt: null,
    });

    const res = await app.request(
      "/api/admin/models/model_1/entries",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status: "draft",
          fields: [{ fieldId: "field_title", locale: "en", value: "Hello" }],
        }),
      },
      env,
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.item).toMatchObject({ id: "entry_1" });
    expect(createEntryMock).toHaveBeenCalledWith(expect.any(Object), {
      actorId: "user_42",
      modelId: "model_1",
      status: "draft",
      fields: [{ fieldId: "field_title", locale: "en", value: "Hello" }],
    });
  });

  it("POST returns 400 when Idempotency-Key is missing", async () => {
    prepareIdempotencyRequestMock.mockRejectedValueOnce(
      new idempotencyService.IdempotencyKeyRequiredError(),
    );

    const res = await app.request(
      "/api/admin/models/model_1/entries",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "draft", fields: [] }),
      },
      env,
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "IDEMPOTENCY_KEY_REQUIRED" },
    });
    expect(createEntryMock).not.toHaveBeenCalled();
  });

  it("POST replays the stored response without invoking the entry service", async () => {
    prepareIdempotencyRequestMock.mockResolvedValueOnce({
      kind: "replay",
      responseStatus: 201,
      responseBody: {
        item: {
          id: "entry_replayed",
          modelId: "model_1",
          status: "draft",
        },
      },
    });

    const res = await app.request(
      "/api/admin/models/model_1/entries",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
          "Idempotency-Key": "entry-operation-123",
        },
        body: JSON.stringify({ status: "draft", fields: [] }),
      },
      env,
    );

    expect(res.status).toBe(201);
    expect(res.headers.get("Idempotency-Replayed")).toBe("true");
    await expect(res.json()).resolves.toMatchObject({
      item: { id: "entry_replayed" },
    });
    expect(createEntryMock).not.toHaveBeenCalled();
  });

  it("POST returns 400 for invalid payload", async () => {
    const res = await app.request(
      "/api/admin/models/model_1/entries",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "invalid" }),
      },
      env,
    );

    expect(res.status).toBe(400);
  });

  it("POST returns 404 when model missing", async () => {
    createEntryMock.mockRejectedValue(
      new entriesService.EntryModelNotFoundError("model_1"),
    );

    const res = await app.request(
      "/api/admin/models/model_1/entries",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "draft", fields: [] }),
      },
      env,
    );

    expect(res.status).toBe(404);
  });

  it("PUT /api/admin/models/:modelId/entries/:entryId updates entry", async () => {
    updateEntryMock.mockResolvedValue({
      id: "entry_1",
      modelId: "model_1",
      status: "published",
      createdAt: "2025-09-20T00:00:00.000Z",
      updatedAt: "2025-09-26T12:00:00.000Z",
      publishedAt: "2025-09-26T12:00:00.000Z",
    });

    const res = await app.request(
      "/api/admin/models/model_1/entries/entry_1",
      {
        method: "PUT",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status: "published",
          fields: [{ fieldId: "field_title", locale: "en", value: "Updated" }],
        }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.item).toMatchObject({ id: "entry_1", status: "published" });
    expect(updateEntryMock).toHaveBeenCalledWith(expect.any(Object), {
      actorId: "user_42",
      entryId: "entry_1",
      modelId: "model_1",
      status: "published",
      fields: [{ fieldId: "field_title", locale: "en", value: "Updated" }],
    });
  });

  it("PUT preserves omitted fields as a status-only update", async () => {
    updateEntryMock.mockResolvedValue({
      id: "entry_1",
      modelId: "model_1",
      status: "published",
      createdAt: "2025-09-20T00:00:00.000Z",
      updatedAt: "2025-09-26T12:00:00.000Z",
      publishedAt: "2025-09-26T12:00:00.000Z",
    });

    const res = await app.request(
      "/api/admin/models/model_1/entries/entry_1",
      {
        method: "PUT",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status: "published",
        }),
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(updateEntryMock).toHaveBeenCalledWith(expect.any(Object), {
      actorId: "user_42",
      entryId: "entry_1",
      modelId: "model_1",
      status: "published",
      fields: undefined,
    });
  });

  it("PUT returns 404 when entry missing", async () => {
    updateEntryMock.mockRejectedValue(
      new entriesService.EntryNotFoundError("entry_99"),
    );

    const res = await app.request(
      "/api/admin/models/model_1/entries/entry_99",
      {
        method: "PUT",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "draft", fields: [] }),
      },
      env,
    );

    expect(res.status).toBe(404);
  });

  it("POST bulk publish calls bulkPublishEntries once", async () => {
    bulkPublishEntriesMock.mockResolvedValue([
      {
        id: "entry_1",
        modelId: "model_1",
        status: "published",
        createdAt: "2025-09-20T00:00:00.000Z",
        updatedAt: "2025-09-26T12:00:00.000Z",
        publishedAt: "2025-09-26T12:00:00.000Z",
      },
      {
        id: "entry_2",
        modelId: "model_1",
        status: "published",
        createdAt: "2025-09-20T00:00:00.000Z",
        updatedAt: "2025-09-26T12:00:00.000Z",
        publishedAt: "2025-09-26T12:00:00.000Z",
      },
    ]);

    const res = await app.request(
      "/api/admin/models/model_1/entries/bulk",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "publish",
          entryIds: ["entry_1", "entry_2"],
        }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results.length).toBe(2);
    expect(bulkPublishEntriesMock).toHaveBeenCalledTimes(1);
    expect(bulkPublishEntriesMock).toHaveBeenCalledWith(expect.any(Object), {
      actorId: "user_42",
      modelId: "model_1",
      entryIds: ["entry_1", "entry_2"],
    });
    expect(publishEntryRevisionMock).not.toHaveBeenCalled();
  });

  it("POST bulk publish returns 409 when unique preflight fails", async () => {
    bulkPublishEntriesMock.mockRejectedValue(
      new entriesService.BulkUniqueFieldConflictError([
        {
          entryId: "entry_2",
          fieldId: "field_slug",
          locale: "ja",
          conflictingEntryId: "entry_1",
          scope: "selection",
        },
      ]),
    );

    const res = await app.request(
      "/api/admin/models/model_1/entries/bulk",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "publish",
          entryIds: ["entry_1", "entry_2"],
        }),
      },
      env,
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatchObject({
      code: "ENTRY_BULK_UNIQUE_CONFLICT",
      conflicts: [
        {
          entryId: "entry_2",
          fieldId: "field_slug",
          locale: "ja",
          conflictingEntryId: "entry_1",
          scope: "selection",
        },
      ],
    });
    expect(publishEntryRevisionMock).not.toHaveBeenCalled();
  });

  it("POST /api/admin/models/:modelId/entries/:entryId/revisions/:revisionId/restore restores revision as draft", async () => {
    restoreEntryRevisionMock.mockResolvedValue({
      id: "entry_1",
      modelId: "model_1",
      status: "published",
      createdAt: "2025-09-20T00:00:00.000Z",
      updatedAt: "2025-09-26T12:00:00.000Z",
      publishedAt: "2025-09-21T00:00:00.000Z",
    });

    const res = await app.request(
      "/api/admin/models/model_1/entries/entry_1/revisions/revision_2/restore",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.item).toMatchObject({ id: "entry_1", status: "published" });
    expect(restoreEntryRevisionMock).toHaveBeenCalledWith(expect.any(Object), {
      actorId: "user_42",
      entryId: "entry_1",
      modelId: "model_1",
      revisionId: "revision_2",
    });
  });

  it("POST restore returns 404 when revision is missing", async () => {
    restoreEntryRevisionMock.mockRejectedValue(
      new entriesService.EntryRevisionNotFoundError("revision_missing"),
    );

    const res = await app.request(
      "/api/admin/models/model_1/entries/entry_1/revisions/revision_missing/restore",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
      },
      env,
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("REVISION_NOT_FOUND");
  });

  it("DELETE passes detach reference action when requested", async () => {
    deleteEntryMock.mockResolvedValue({
      id: "entry_1",
      modelId: "model_1",
      status: "published",
      createdAt: "2025-09-20T00:00:00.000Z",
      updatedAt: "2025-09-26T12:00:00.000Z",
      publishedAt: "2025-09-26T12:00:00.000Z",
      currentDraftRevisionId: null,
      publishedRevisionId: "revision_live",
    });

    const res = await app.request(
      "/api/admin/models/model_1/entries/entry_1?detachReferences=true",
      {
        method: "DELETE",
        headers: { Authorization: "Bearer token" },
      },
      env,
    );

    expect(res.status).toBe(204);
    expect(deleteEntryMock).toHaveBeenCalledWith(expect.any(Object), {
      actorId: "user_42",
      entryId: "entry_1",
      modelId: "model_1",
      referenceAction: "detach",
    });
  });

  it("DELETE returns 409 when the entry is referenced", async () => {
    deleteEntryMock.mockRejectedValue(
      new entriesService.EntryReferencedError("entry_1", [
        {
          kind: "relation",
          source: "entry_field",
          entryId: "entry_source",
          fieldId: "field_related",
          entryFieldId: "entry_field_1",
        },
      ]),
    );

    const res = await app.request(
      "/api/admin/models/model_1/entries/entry_1",
      {
        method: "DELETE",
        headers: { Authorization: "Bearer token" },
      },
      env,
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("ENTRY_REFERENCED");
    expect(body.error.references).toHaveLength(1);
  });
});
