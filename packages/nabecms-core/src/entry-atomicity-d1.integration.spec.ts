/// <reference types="@cloudflare/vitest-plugin/types" />

/** Real D1 rollback coverage for entry lifecycle batches. */
import { applyD1Migrations, env, type D1Migration } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { createDeps, getDrizzleDb } from "./routes/admin/models/entries/shared";
import {
  bulkPublishEntries,
  createEntry,
  deleteEntry,
  publishEntryRevision,
  restoreEntryRevision,
  unpublishEntry,
  updateEntry,
} from "./services/entries";
import { createD1EntriesServiceDeps } from "./services/entries-d1";
import {
  IdempotencyKeyReusedError,
  prepareIdempotencyRequest,
} from "./services/idempotency";

type MigrationDatabase = Parameters<typeof applyD1Migrations>[0];

type IntegrationTestEnv = {
  DB: MigrationDatabase;
  TEST_MIGRATIONS: D1Migration[];
};

type EntryTableSnapshot = {
  auditLogs: Record<string, unknown>[];
  entries: Record<string, unknown>[];
  entryFields: Record<string, unknown>[];
  entryRevisions: Record<string, unknown>[];
};

type PreparedStatement = ReturnType<MigrationDatabase["prepare"]>;

type FailureInjectingDatabase = {
  database: MigrationDatabase;
  getBatchCallCount: () => number;
  getStatementCount: () => number | null;
};

const bindings = env as unknown as IntegrationTestEnv;
const ACTOR_ID = "user_entry_atomicity";
const SINGLE_MODEL_ID = "model_entry_atomicity_single";
const SINGLE_FIELD_ID = "field_entry_atomicity_title";
const RELATION_FIELD_ID = "field_entry_atomicity_relation";
const CHUNK_MODEL_ID = "model_entry_atomicity_chunk";
const CHUNK_FIELD_IDS = Array.from(
  { length: 8 },
  (_, index) => `field_entry_atomicity_chunk_${index}`,
);

/** Read every row from one table in a stable order. */
const readTable = async (
  tableName: "entries" | "entry_revisions" | "entry_fields" | "audit_logs",
): Promise<Record<string, unknown>[]> => {
  const result = await bindings.DB.prepare(
    `SELECT * FROM ${tableName} ORDER BY id`,
  ).all<Record<string, unknown>>();
  return result.results;
};

/** Capture all entry lifecycle tables whose state must roll back together. */
const captureEntryTables = async (): Promise<EntryTableSnapshot> => ({
  entries: await readTable("entries"),
  entryRevisions: await readTable("entry_revisions"),
  entryFields: await readTable("entry_fields"),
  auditLogs: await readTable("audit_logs"),
});

/** Build production entry service dependencies against a D1-compatible binding. */
const createRealDeps = (database: MigrationDatabase = bindings.DB) =>
  createDeps({
    env: { DB: database },
  });

type RealEntryDeps = ReturnType<typeof createRealDeps>;
type EntryMutation = (deps: RealEntryDeps) => Promise<unknown>;

/**
 * Delegate D1 operations to the real binding while inserting one valid,
 * execution-time CHECK violation into the next batch at the selected boundary.
 */
const createFailureInjectingDatabase = (
  failureIndex: number,
): FailureInjectingDatabase => {
  let batchCallCount = 0;
  let statementCount: number | null = null;

  const database = {
    prepare: (query: string) => bindings.DB.prepare(query),
    exec: (query: string) => bindings.DB.exec(query),
    dump: () => bindings.DB.dump(),
    batch: async (statements: PreparedStatement[]) => {
      batchCallCount += 1;
      statementCount = statements.length;
      if (failureIndex < 0 || failureIndex > statements.length) {
        throw new Error(
          `Failure index ${failureIndex} is outside batch length ${statements.length}`,
        );
      }

      const failureStatement = bindings.DB.prepare(
        `INSERT INTO entry_atomicity_failure_guard (value) VALUES (?)`,
      ).bind(1);
      const injectedStatements = [...statements];
      injectedStatements.splice(failureIndex, 0, failureStatement);
      return await bindings.DB.batch(injectedStatements);
    },
  } as unknown as MigrationDatabase;

  return {
    database,
    getBatchCallCount: () => batchCallCount,
    getStatementCount: () => statementCount,
  };
};

/** Create one single-field entry for a later lifecycle transition. */
const createSingleFieldEntry = async (
  status: "draft" | "published",
  title: string,
) =>
  await createEntry(createRealDeps(), {
    actorId: ACTOR_ID,
    modelId: SINGLE_MODEL_ID,
    status,
    fields: [{ fieldId: SINGLE_FIELD_ID, locale: "en", value: title }],
  });

/** Install an audit-log trigger that aborts one entry action. */
const installAuditFailure = async (
  triggerName: string,
  action: string,
  targetId?: string,
): Promise<void> => {
  const targetPredicate = targetId ? ` AND NEW.target_id = '${targetId}'` : "";
  await bindings.DB.prepare(
    `CREATE TRIGGER ${triggerName}
     BEFORE INSERT ON audit_logs
     WHEN NEW.target_table = 'entries'
       AND NEW.action = '${action}'${targetPredicate}
     BEGIN
       SELECT RAISE(ABORT, 'injected ${action} audit failure');
     END`,
  ).run();
};

/** Drop a test-only failure trigger. */
const dropTrigger = async (triggerName: string): Promise<void> => {
  await bindings.DB.prepare(`DROP TRIGGER IF EXISTS ${triggerName}`).run();
};

/** Assert a failing mutation leaves all entry lifecycle tables unchanged. */
const expectAtomicRollback = async (
  mutation: () => Promise<unknown>,
): Promise<void> => {
  const before = await captureEntryTables();
  await expect(mutation()).rejects.toThrow();
  expect(await captureEntryTables()).toEqual(before);
};

/**
 * Inject an execution-time failure before every statement and immediately
 * after the final statement, proving the whole real D1 batch rolls back.
 */
const expectRollbackAtEveryBatchBoundary = async (
  mutation: EntryMutation,
): Promise<number> => {
  const before = await captureEntryTables();
  let expectedStatementCount: number | null = null;
  let failureIndex = 0;

  while (
    expectedStatementCount === null ||
    failureIndex <= expectedStatementCount
  ) {
    const injected = createFailureInjectingDatabase(failureIndex);
    await expect(mutation(createRealDeps(injected.database))).rejects.toThrow(
      /CHECK constraint failed/iu,
    );

    const statementCount = injected.getStatementCount();
    expect(statementCount).not.toBeNull();
    expect(injected.getBatchCallCount()).toBe(1);
    if (expectedStatementCount === null) {
      expectedStatementCount = statementCount;
    } else {
      expect(statementCount).toBe(expectedStatementCount);
    }
    expect(await captureEntryTables()).toEqual(before);
    failureIndex += 1;
  }

  expect(expectedStatementCount).not.toBeNull();
  return expectedStatementCount!;
};

beforeAll(async () => {
  await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS);
  await bindings.DB.prepare(
    `CREATE TABLE IF NOT EXISTS entry_atomicity_failure_guard (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       value INTEGER NOT NULL CHECK (value = 0)
     )`,
  ).run();
  const now = "2026-07-15T00:00:00.000Z";

  await bindings.DB.batch([
    bindings.DB.prepare(
      `INSERT OR IGNORE INTO users (
         id, email, password, name, email_verified, role_id, ui_preferences,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      ACTOR_ID,
      "entry-atomicity@example.test",
      "!",
      "Entry Atomicity",
      1,
      "[]",
      null,
      now,
      now,
    ),
    bindings.DB.prepare(
      `INSERT OR IGNORE INTO locales (
         code, is_default, created_at, updated_at
       ) VALUES (?, ?, ?, ?)`,
    ).bind("en", 1, now, now),
    bindings.DB.prepare(
      `INSERT OR IGNORE INTO models (
         id, name, description, is_private, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(SINGLE_MODEL_ID, "Entry atomicity single", null, 0, now, now),
    bindings.DB.prepare(
      `INSERT OR IGNORE INTO model_fields (
         id, model_id, name, field_key, type, position, required, has_locales,
         is_unique, variant, options, default_value, is_private, created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      SINGLE_FIELD_ID,
      SINGLE_MODEL_ID,
      "Title",
      "title",
      "text",
      0,
      1,
      1,
      0,
      null,
      null,
      null,
      0,
      now,
      now,
    ),
    bindings.DB.prepare(
      `INSERT OR IGNORE INTO model_fields (
         id, model_id, name, field_key, type, position, required, has_locales,
         is_unique, variant, options, default_value, is_private, created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      RELATION_FIELD_ID,
      SINGLE_MODEL_ID,
      "Related entry",
      "related_entry",
      "relation",
      1,
      0,
      0,
      0,
      "many",
      JSON.stringify({ allowedModels: [SINGLE_MODEL_ID] }),
      null,
      0,
      now,
      now,
    ),
    bindings.DB.prepare(
      `INSERT OR IGNORE INTO models (
         id, name, description, is_private, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(CHUNK_MODEL_ID, "Entry atomicity chunk", null, 0, now, now),
    ...CHUNK_FIELD_IDS.map((fieldId, index) =>
      bindings.DB.prepare(
        `INSERT OR IGNORE INTO model_fields (
           id, model_id, name, field_key, type, position, required,
           has_locales, is_unique, variant, options, default_value,
           is_private, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        fieldId,
        CHUNK_MODEL_ID,
        `Chunk ${index}`,
        `chunk_${index}`,
        "text",
        index,
        1,
        1,
        0,
        null,
        null,
        null,
        0,
        now,
        now,
      ),
    ),
  ]);
});

describe("real D1 entry atomicity", () => {
  it("keeps only status and revision identifiers across the entry lifecycle", async () => {
    const deps = createRealDeps();
    const entry = await createSingleFieldEntry("draft", "private-entry-body");
    const original = await bindings.DB.prepare(
      "SELECT current_draft_revision_id AS id FROM entries WHERE id = ?",
    )
      .bind(entry.id)
      .first<{ id: string }>();
    const params = {
      actorId: ACTOR_ID,
      entryId: entry.id,
      modelId: SINGLE_MODEL_ID,
    };
    await updateEntry(deps, {
      ...params,
      status: "draft",
      fields: [
        {
          fieldId: SINGLE_FIELD_ID,
          locale: "en",
          value: "private-updated-body",
        },
      ],
    });
    await publishEntryRevision(deps, params);
    await restoreEntryRevision(deps, { ...params, revisionId: original!.id });
    await unpublishEntry(deps, params);
    const rows = (await readTable("audit_logs")).filter(
      (row) => row.target_id === entry.id,
    );
    expect(rows.map((row) => row.action).sort()).toEqual(
      ["create", "update", "publish", "restore_revision", "unpublish"].sort(),
    );
    for (const row of rows) {
      for (const key of ["before", "after"]) {
        const snapshot = row[key] ? JSON.parse(row[key] as string) : null;
        if (!snapshot) continue;
        expect(
          Object.keys(snapshot).every((field) =>
            [
              "status",
              "currentDraftRevisionId",
              "publishedRevisionId",
              "sourceRevisionId",
            ].includes(field),
          ),
        ).toBe(true);
      }
    }
    expect(JSON.stringify(rows)).not.toContain("private-");
    const restored = JSON.parse(
      rows.find((row) => row.action === "restore_revision")!.after as string,
    );
    expect(restored.sourceRevisionId).toBe(original!.id);
    expect(restored.currentDraftRevisionId).toBeTruthy();
    await deleteEntry(deps, params);
    const deleted = (await readTable("audit_logs")).find(
      (row) => row.target_id === entry.id && row.action === "delete",
    );
    expect(deleted?.after).toBeNull();
    expect(JSON.parse(deleted!.before as string).status).toBe("draft");
  });

  it("fails closed when an atomic callback records no statements", async () => {
    const deps = createRealDeps();
    const before = await captureEntryTables();

    await expect(deps.runAtomicWrite(async () => undefined)).rejects.toThrow(
      "Atomic entry write produced no D1 statements",
    );
    expect(await captureEntryTables()).toEqual(before);
  });

  it("rolls back a published create when the late audit insert fails", async () => {
    const triggerName = "reject_entry_atomicity_create_audit";
    await installAuditFailure(triggerName, "create");
    try {
      await expectAtomicRollback(
        async () =>
          await createEntry(createRealDeps(), {
            actorId: ACTOR_ID,
            modelId: SINGLE_MODEL_ID,
            status: "published",
            fields: [
              {
                fieldId: SINGLE_FIELD_ID,
                locale: "en",
                value: "Rejected create",
              },
            ],
          }),
      );
    } finally {
      await dropTrigger(triggerName);
    }
  });

  it("rolls back the first seven entry fields when the second chunk fails", async () => {
    const triggerName = "reject_entry_atomicity_second_field_chunk";
    await bindings.DB.prepare(
      `CREATE TRIGGER ${triggerName}
       BEFORE INSERT ON entry_fields
       WHEN NEW.field_id LIKE 'field_entry_atomicity_chunk_%'
         AND (
           SELECT COUNT(*) FROM entry_fields
           WHERE entry_id = NEW.entry_id
         ) >= 7
       BEGIN
         SELECT RAISE(ABORT, 'injected second field chunk failure');
       END`,
    ).run();

    try {
      await expectAtomicRollback(
        async () =>
          await createEntry(createRealDeps(), {
            actorId: ACTOR_ID,
            modelId: CHUNK_MODEL_ID,
            status: "published",
            fields: CHUNK_FIELD_IDS.map((fieldId, index) => ({
              fieldId,
              locale: "en",
              value: `Chunk value ${index}`,
            })),
          }),
      );
    } finally {
      await dropTrigger(triggerName);
    }
  });

  it("rolls back publish projection and revision changes on late failure", async () => {
    const entry = await createSingleFieldEntry("draft", "Draft publish");
    const triggerName = "reject_entry_atomicity_publish_audit";
    await installAuditFailure(triggerName, "publish", entry.id);
    try {
      await expectAtomicRollback(
        async () =>
          await publishEntryRevision(createRealDeps(), {
            actorId: ACTOR_ID,
            entryId: entry.id,
            modelId: SINGLE_MODEL_ID,
          }),
      );
    } finally {
      await dropTrigger(triggerName);
    }
  });

  it("rolls back a new revision and projection rebuild on update failure", async () => {
    const entry = await createSingleFieldEntry("published", "Before update");
    const triggerName = "reject_entry_atomicity_update_audit";
    await installAuditFailure(triggerName, "update", entry.id);
    try {
      await expectAtomicRollback(
        async () =>
          await updateEntry(createRealDeps(), {
            actorId: ACTOR_ID,
            entryId: entry.id,
            modelId: SINGLE_MODEL_ID,
            status: "published",
            fields: [
              {
                fieldId: SINGLE_FIELD_ID,
                locale: "en",
                value: "After update",
              },
            ],
          }),
      );
    } finally {
      await dropTrigger(triggerName);
    }
  });

  it("rolls back unpublish projection and revision changes on late failure", async () => {
    const entry = await createSingleFieldEntry("published", "Published live");
    const triggerName = "reject_entry_atomicity_unpublish_audit";
    await installAuditFailure(triggerName, "unpublish", entry.id);
    try {
      await expectAtomicRollback(
        async () =>
          await unpublishEntry(createRealDeps(), {
            actorId: ACTOR_ID,
            entryId: entry.id,
            modelId: SINGLE_MODEL_ID,
          }),
      );
    } finally {
      await dropTrigger(triggerName);
    }
  });

  it("rolls back a restored revision when the audit insert fails", async () => {
    const entry = await createSingleFieldEntry("published", "Restore source");
    const revision = await bindings.DB.prepare(
      `SELECT published_revision_id AS id FROM entries WHERE id = ?`,
    )
      .bind(entry.id)
      .first<{ id: string }>();
    expect(revision?.id).toBeTruthy();

    const triggerName = "reject_entry_atomicity_restore_audit";
    await installAuditFailure(triggerName, "restore_revision", entry.id);
    try {
      await expectAtomicRollback(
        async () =>
          await restoreEntryRevision(createRealDeps(), {
            actorId: ACTOR_ID,
            entryId: entry.id,
            modelId: SINGLE_MODEL_ID,
            revisionId: revision!.id,
          }),
      );
    } finally {
      await dropTrigger(triggerName);
    }
  });

  it("rolls back entry A when entry B fails late in one bulk publish", async () => {
    const entryA = await createSingleFieldEntry("draft", "Bulk A");
    const entryB = await createSingleFieldEntry("draft", "Bulk B");
    const triggerName = "reject_entry_atomicity_bulk_b_audit";
    await installAuditFailure(triggerName, "publish", entryB.id);
    try {
      await expectAtomicRollback(
        async () =>
          await bulkPublishEntries(createRealDeps(), {
            actorId: ACTOR_ID,
            modelId: SINGLE_MODEL_ID,
            entryIds: [entryA.id, entryB.id],
          }),
      );
    } finally {
      await dropTrigger(triggerName);
    }
  });

  it("rolls back target deletion and every detached source reference", async () => {
    const target = await createSingleFieldEntry("published", "Delete target");
    const source = await createEntry(createRealDeps(), {
      actorId: ACTOR_ID,
      modelId: SINGLE_MODEL_ID,
      status: "published",
      fields: [
        {
          fieldId: SINGLE_FIELD_ID,
          locale: "en",
          value: "Reference source",
        },
        {
          fieldId: RELATION_FIELD_ID,
          value: { type: "many", entryIds: [target.id] },
        },
      ],
    });
    await updateEntry(createRealDeps(), {
      actorId: ACTOR_ID,
      entryId: source.id,
      modelId: SINGLE_MODEL_ID,
      status: "draft",
      fields: [
        {
          fieldId: RELATION_FIELD_ID,
          value: { type: "many", entryIds: [target.id] },
        },
      ],
    });

    const triggerName = "reject_entry_atomicity_delete_audit";
    await installAuditFailure(triggerName, "delete", target.id);
    try {
      await expectAtomicRollback(
        async () =>
          await deleteEntry(createRealDeps(), {
            actorId: ACTOR_ID,
            entryId: target.id,
            modelId: SINGLE_MODEL_ID,
            referenceAction: "detach",
          }),
      );
    } finally {
      await dropTrigger(triggerName);
    }
  });
});

describe("real D1 entry idempotency", () => {
  it("stores and replays one create result without duplicating domain rows", async () => {
    const db = getDrizzleDb({ env: { DB: bindings.DB } });
    const key = "entry-create-replay-key";
    const request = {
      method: "POST",
      path: `/api/admin/models/${SINGLE_MODEL_ID}/entries`,
      body: { status: "draft", title: "Idempotent create" },
    };
    const prepared = await prepareIdempotencyRequest(db, {
      key,
      principalId: ACTOR_ID,
      operation: "entry.create",
      request,
    });
    expect(prepared.kind).toBe("execute");
    if (prepared.kind !== "execute") {
      throw new Error("Expected a new idempotency record");
    }

    const item = await createEntry(
      createD1EntriesServiceDeps(db, {
        idempotency: {
          record: prepared.record,
          responseStatus: 201,
          createResponseBody: (result) => ({ item: result }),
        },
      }),
      {
        actorId: ACTOR_ID,
        modelId: SINGLE_MODEL_ID,
        status: "draft",
        fields: [
          {
            fieldId: SINGLE_FIELD_ID,
            locale: "en",
            value: "Idempotent create",
          },
        ],
      },
    );

    const replay = await prepareIdempotencyRequest(db, {
      key,
      principalId: ACTOR_ID,
      operation: "entry.create",
      request,
    });
    expect(replay).toEqual({
      kind: "replay",
      responseStatus: 201,
      responseBody: { item },
    });

    const entryCount = await bindings.DB.prepare(
      "SELECT COUNT(*) AS count FROM entries WHERE id = ?",
    )
      .bind(item.id)
      .first<{ count: number }>();
    const revisionCount = await bindings.DB.prepare(
      "SELECT COUNT(*) AS count FROM entry_revisions WHERE entry_id = ?",
    )
      .bind(item.id)
      .first<{ count: number }>();
    const auditCount = await bindings.DB.prepare(
      "SELECT COUNT(*) AS count FROM audit_logs WHERE target_id = ? AND action = 'create'",
    )
      .bind(item.id)
      .first<{ count: number }>();
    expect(entryCount?.count).toBe(1);
    expect(revisionCount?.count).toBe(1);
    expect(auditCount?.count).toBe(1);
  });

  it("rejects reuse of one key for a different request", async () => {
    const db = getDrizzleDb({ env: { DB: bindings.DB } });
    const key = "entry-create-replay-key";

    await expect(
      prepareIdempotencyRequest(db, {
        key,
        principalId: ACTOR_ID,
        operation: "entry.create",
        request: {
          method: "POST",
          path: `/api/admin/models/${SINGLE_MODEL_ID}/entries`,
          body: { status: "draft", title: "Changed payload" },
        },
      }),
    ).rejects.toBeInstanceOf(IdempotencyKeyReusedError);
  });

  it("rolls back the idempotency record with a failed domain batch", async () => {
    const db = getDrizzleDb({ env: { DB: bindings.DB } });
    const key = "entry-create-rollback-key";
    const request = { title: "Idempotency rollback" };
    const prepared = await prepareIdempotencyRequest(db, {
      key,
      principalId: ACTOR_ID,
      operation: "entry.create",
      request,
    });
    expect(prepared.kind).toBe("execute");
    if (prepared.kind !== "execute") {
      throw new Error("Expected a new idempotency record");
    }

    const injected = createFailureInjectingDatabase(2);
    const injectedDb = getDrizzleDb({ env: { DB: injected.database } });
    await expect(
      createEntry(
        createD1EntriesServiceDeps(injectedDb, {
          idempotency: {
            record: prepared.record,
            responseStatus: 201,
            createResponseBody: (result) => ({ item: result }),
          },
        }),
        {
          actorId: ACTOR_ID,
          modelId: SINGLE_MODEL_ID,
          status: "draft",
          fields: [
            {
              fieldId: SINGLE_FIELD_ID,
              locale: "en",
              value: "Idempotency rollback",
            },
          ],
        },
      ),
    ).rejects.toThrow(/CHECK constraint failed/iu);

    const recordCount = await bindings.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM idempotency_records
       WHERE id = ?`,
    )
      .bind(prepared.record.id)
      .first<{ count: number }>();
    expect(recordCount?.count).toBe(0);

    const retry = await prepareIdempotencyRequest(db, {
      key,
      principalId: ACTOR_ID,
      operation: "entry.create",
      request,
    });
    expect(retry.kind).toBe("execute");
  });
});

describe("real D1 entry batch statement boundaries", () => {
  it("rolls back create at every statement boundary", async () => {
    const statementCount = await expectRollbackAtEveryBatchBoundary(
      async (deps) =>
        await createEntry(deps, {
          actorId: ACTOR_ID,
          modelId: SINGLE_MODEL_ID,
          status: "published",
          fields: [
            {
              fieldId: SINGLE_FIELD_ID,
              locale: "en",
              value: "Boundary create",
            },
          ],
        }),
    );

    expect(statementCount).toBe(5);
  });

  it("rolls back update at every statement boundary", async () => {
    const entry = await createSingleFieldEntry(
      "published",
      "Boundary update source",
    );

    const statementCount = await expectRollbackAtEveryBatchBoundary(
      async (deps) =>
        await updateEntry(deps, {
          actorId: ACTOR_ID,
          entryId: entry.id,
          modelId: SINGLE_MODEL_ID,
          status: "published",
        }),
    );

    expect(statementCount).toBe(5);
  });

  it("rolls back publish at every statement boundary", async () => {
    const entry = await createSingleFieldEntry(
      "draft",
      "Boundary publish source",
    );

    const statementCount = await expectRollbackAtEveryBatchBoundary(
      async (deps) =>
        await publishEntryRevision(deps, {
          actorId: ACTOR_ID,
          entryId: entry.id,
          modelId: SINGLE_MODEL_ID,
        }),
    );

    expect(statementCount).toBe(5);
  });

  it("rolls back unpublish at every statement boundary", async () => {
    const entry = await createSingleFieldEntry(
      "published",
      "Boundary unpublish source",
    );

    const statementCount = await expectRollbackAtEveryBatchBoundary(
      async (deps) =>
        await unpublishEntry(deps, {
          actorId: ACTOR_ID,
          entryId: entry.id,
          modelId: SINGLE_MODEL_ID,
        }),
    );

    expect(statementCount).toBe(4);
  });

  it("rolls back restore at every statement boundary", async () => {
    const entry = await createSingleFieldEntry(
      "published",
      "Boundary restore source",
    );
    const revision = await bindings.DB.prepare(
      `SELECT published_revision_id AS id FROM entries WHERE id = ?`,
    )
      .bind(entry.id)
      .first<{ id: string }>();
    expect(revision?.id).toBeTruthy();

    const statementCount = await expectRollbackAtEveryBatchBoundary(
      async (deps) =>
        await restoreEntryRevision(deps, {
          actorId: ACTOR_ID,
          entryId: entry.id,
          modelId: SINGLE_MODEL_ID,
          revisionId: revision!.id,
        }),
    );

    expect(statementCount).toBe(3);
  });

  it("rolls back the whole bulk publish at every statement boundary", async () => {
    const entryA = await createSingleFieldEntry("draft", "Boundary bulk A");
    const entryB = await createSingleFieldEntry("draft", "Boundary bulk B");

    const statementCount = await expectRollbackAtEveryBatchBoundary(
      async (deps) =>
        await bulkPublishEntries(deps, {
          actorId: ACTOR_ID,
          modelId: SINGLE_MODEL_ID,
          entryIds: [entryA.id, entryB.id],
        }),
    );

    expect(statementCount).toBe(10);
  });

  it("rolls back delete and detach at every statement boundary", async () => {
    const target = await createSingleFieldEntry(
      "published",
      "Boundary delete target",
    );
    const source = await createEntry(createRealDeps(), {
      actorId: ACTOR_ID,
      modelId: SINGLE_MODEL_ID,
      status: "published",
      fields: [
        {
          fieldId: SINGLE_FIELD_ID,
          locale: "en",
          value: "Boundary reference source",
        },
        {
          fieldId: RELATION_FIELD_ID,
          value: { type: "many", entryIds: [target.id] },
        },
      ],
    });
    await updateEntry(createRealDeps(), {
      actorId: ACTOR_ID,
      entryId: source.id,
      modelId: SINGLE_MODEL_ID,
      status: "draft",
      fields: [
        {
          fieldId: RELATION_FIELD_ID,
          value: { type: "many", entryIds: [target.id] },
        },
      ],
    });

    const statementCount = await expectRollbackAtEveryBatchBoundary(
      async (deps) =>
        await deleteEntry(deps, {
          actorId: ACTOR_ID,
          entryId: target.id,
          modelId: SINGLE_MODEL_ID,
          referenceAction: "detach",
        }),
    );

    expect(statementCount).toBe(7);
  });
});
