/// <reference types="@cloudflare/vitest-plugin/types" />
import { applyD1Migrations, env, type D1Migration } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import {
  getLogManagement,
  getLogRetention,
  logRetentionSchema,
  runLogCleanup,
  updateLogRetention,
} from "./services/log-retention";
import { createAccessToken } from "./lib/auth";
import routes from "./routes/admin/log-management";

type Database = Parameters<typeof applyD1Migrations>[0];
const bindings = env as unknown as {
  DB: Database;
  TEST_MIGRATIONS: D1Migration[];
};
const db = bindings.DB;
const now = Date.parse("2026-09-12T12:00:00.500Z");
const cutoff = "2026-06-14T12:00:00.500Z";
let errorCalls: unknown[][] = [];
const secret = "retention-test-secret-32-bytes-long";

beforeAll(async () => {
  await applyD1Migrations(db, bindings.TEST_MIGRATIONS);
  await db
    .prepare(
      "INSERT INTO users (id, email, name, role_id) VALUES ('retention-admin', 'admin@example.test', 'Admin', '[]')",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO auth_sessions (id, user_id, token, expires_at, created_at, updated_at) VALUES ('retention-session', 'retention-admin', 'test-session', ?, ?, ?)",
    )
    .bind(Date.now() + 86400000, Date.now(), Date.now())
    .run();
});
beforeEach(async () => {
  await db.batch(
    ["audit_logs", "auth_login_events", "log_cleanup_state", "settings"].map(
      (table) => db.prepare(`DELETE FROM ${table}`),
    ),
  );
  vi.spyOn(Date, "now").mockReturnValue(now);
  vi.spyOn(console, "log").mockImplementation(() => {});
  errorCalls = [];
  vi.spyOn(console, "error").mockImplementation((...args) => {
    errorCalls.push(args);
  });
});
afterEach(() => vi.restoreAllMocks());

async function seed(id: string, createdAt: string) {
  await db.batch([
    db
      .prepare(
        "INSERT INTO audit_logs (id, action, target_table, target_id, created_at) VALUES (?, 'update', 'entries', 'entry', ?)",
      )
      .bind(id, createdAt),
    db
      .prepare(
        "INSERT INTO auth_login_events (id, provider, result, created_at) VALUES (?, 'local', 'failed', ?)",
      )
      .bind(id, createdAt),
  ]);
}

it("defaults to 90 days, accepts indefinite retention, and rejects unsafe settings", async () => {
  expect(await getLogRetention(db)).toEqual({ retentionDays: 90 });
  for (const retentionDays of [0, -1, 1.5, "90", null, true, 730001]) {
    expect(logRetentionSchema.safeParse({ retentionDays }).success).toBe(false);
  }
  expect(logRetentionSchema.safeParse({ retentionDays: false }).success).toBe(
    true,
  );
  expect(
    logRetentionSchema.safeParse({ retentionDays: 1, extra: true }).success,
  ).toBe(false);
  await updateLogRetention(db, { retentionDays: false }, "retention-admin");
  await seed("old", "2000-01-01 00:00:00");
  await runLogCleanup({ DB: db });
  expect(
    await db.prepare("SELECT count(*) AS n FROM auth_login_events").first("n"),
  ).toBe(1);
  expect(await getLogManagement(db)).toMatchObject({
    item: { retentionDays: false },
    health: "disabled",
    cleanup: { status: "disabled", auditDeleted: 0, authDeleted: 0 },
  });
});

it("compares UTC instants across timestamp formats and preserves the exact cutoff", async () => {
  await seed("before", "2026-06-14T12:00:00.499Z");
  await seed("legacy-before", "2026-06-14 12:00:00");
  await seed("equal", cutoff);
  await seed("offset-equal", "2026-06-14T14:00:00.500+02:00");
  await seed("after", "2026-06-14T12:00:00.501Z");
  await seed("invalid", "not-a-date");
  await runLogCleanup({ DB: db });
  for (const table of ["audit_logs", "auth_login_events"]) {
    const rows = await db.prepare(`SELECT id FROM ${table} ORDER BY id`).all();
    expect(rows.results.map((r: { id: string }) => r.id)).toEqual([
      "after",
      "equal",
      "invalid",
      "offset-equal",
    ]);
  }
  expect(await getLogManagement(db)).toMatchObject({
    cleanup: {
      status: "completed",
      cutoff,
      auditDeleted: 2,
      authDeleted: 2,
      remaining: false,
    },
  });
  await runLogCleanup({ DB: db });
  expect(await getLogManagement(db)).toMatchObject({
    cleanup: { auditDeleted: 0, authDeleted: 0 },
  });
});

it("uses the expression indexes for cutoff queries", async () => {
  for (const table of ["audit_logs", "auth_login_events"]) {
    const plan = await db
      .prepare(
        `EXPLAIN QUERY PLAN SELECT id FROM ${table} WHERE julianday(created_at) < julianday(?) ORDER BY julianday(created_at), id LIMIT 500`,
      )
      .bind(cutoff)
      .all();
    expect(JSON.stringify(plan.results)).toContain(`${table}_cleanup_idx`);
    expect(JSON.stringify(plan.results)).not.toContain("USE TEMP B-TREE");
  }
});

it("bounds both tables and resumes a backlog on the next invocation", async () => {
  for (const table of ["audit_logs", "auth_login_events"]) {
    const columns =
      table === "audit_logs"
        ? "id, action, target_table, target_id, created_at"
        : "id, provider, result, created_at";
    const values =
      table === "audit_logs"
        ? "'bulk-' || x, 'update', 'entries', 'e', '2000-01-01'"
        : "'bulk-' || x, 'local', 'failed', '2000-01-01'";
    await db
      .prepare(
        `INSERT INTO ${table} (${columns}) WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<2600) SELECT ${values} FROM n`,
      )
      .run();
  }
  await runLogCleanup({ DB: db });
  expect(await getLogManagement(db)).toMatchObject({
    cleanup: { auditDeleted: 2500, authDeleted: 2500, remaining: true },
  });
  await runLogCleanup({ DB: db });
  expect(await getLogManagement(db)).toMatchObject({
    cleanup: { auditDeleted: 100, authDeleted: 100, remaining: false },
  });
});

it("retains committed counts after partial failure and safely retries", async () => {
  await seed("old", "2000-01-01");
  await db
    .prepare(
      "CREATE TRIGGER fail_cleanup BEFORE DELETE ON auth_login_events BEGIN SELECT RAISE(FAIL, 'private database details'); END",
    )
    .run();
  try {
    await expect(runLogCleanup({ DB: db })).rejects.toThrow(
      "LOG_CLEANUP_DATABASE_ERROR",
    );
    expect(await getLogManagement(db)).toMatchObject({
      cleanup: {
        status: "failed",
        auditDeleted: 1,
        authDeleted: 0,
        remaining: null,
        lastSuccessAt: null,
      },
    });
    expect(JSON.stringify(errorCalls)).not.toContain(
      "private database details",
    );
  } finally {
    await db.prepare("DROP TRIGGER fail_cleanup").run();
  }
  await runLogCleanup({ DB: db });
  expect(await getLogManagement(db)).toMatchObject({
    cleanup: {
      status: "completed",
      auditDeleted: 0,
      authDeleted: 1,
      remaining: false,
    },
  });
});

it("does not delete when the stored policy is malformed", async () => {
  await seed("old", "2000-01-01");
  await db
    .prepare("INSERT INTO settings (key, value) VALUES ('log_retention', '{}')")
    .run();
  await expect(runLogCleanup({ DB: db })).rejects.toThrow(
    "LOG_RETENTION_SETTINGS_ERROR",
  );
  expect(
    await db.prepare("SELECT count(*) AS n FROM auth_login_events").first("n"),
  ).toBe(1);
  expect(
    await db.prepare("SELECT status FROM log_cleanup_state").first("status"),
  ).toBe("failed");
});

it("skips active leases and recovers expired leases", async () => {
  await seed("old", "2000-01-01");
  await db
    .prepare(
      "INSERT INTO log_cleanup_state (id, run_id, status, started_at, lease_expires_at) VALUES ('logs', 'other', 'running', ?, datetime('now', '+15 minutes'))",
    )
    .bind(new Date(now).toISOString())
    .run();
  await runLogCleanup({ DB: db });
  expect(
    await db.prepare("SELECT count(*) AS n FROM auth_login_events").first("n"),
  ).toBe(1);
  await db
    .prepare(
      "UPDATE log_cleanup_state SET lease_expires_at = '2000-01-01 00:00:00'",
    )
    .run();
  expect((await getLogManagement(db)).health).toBe("interrupted");
  await runLogCleanup({ DB: db });
  expect((await getLogManagement(db)).cleanup?.status).toBe("completed");
});

it.each(["expired", "replaced"])(
  "fences a worker whose lease was %s before deletion",
  async (kind) => {
    await seed("old", "2000-01-01");
    const guarded = new Proxy(db, {
      get(target, key) {
        if (key === "batch")
          return async (statements: Parameters<typeof db.batch>[0]) => {
            await db
              .prepare(
                kind === "expired"
                  ? "UPDATE log_cleanup_state SET lease_expires_at = '2000-01-01 00:00:00'"
                  : "UPDATE log_cleanup_state SET run_id = 'replacement'",
              )
              .run();
            return db.batch(statements);
          };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await runLogCleanup({ DB: guarded });
    expect(
      await db.prepare("SELECT count(*) AS n FROM audit_logs").first("n"),
    ).toBe(1);
    expect(
      await db
        .prepare("SELECT count(*) AS n FROM auth_login_events")
        .first("n"),
    ).toBe(1);
    expect((await getLogManagement(db)).cleanup).toMatchObject({
      status: "running",
      auditDeleted: 0,
      authDeleted: 0,
      finishedAt: null,
    });
  },
);

it("stops deletion when reading the policy fails", async () => {
  await seed("old", "2000-01-01");
  const unavailable = new Proxy(db, {
    get(target, key) {
      if (key === "prepare")
        return (sql: string) => {
          if (sql.startsWith("SELECT value FROM settings"))
            throw new Error("private database details");
          return db.prepare(sql);
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  await expect(runLogCleanup({ DB: unavailable })).rejects.toThrow(
    "LOG_RETENTION_SETTINGS_ERROR",
  );
  expect(
    await db.prepare("SELECT count(*) AS n FROM audit_logs").first("n"),
  ).toBe(1);
  expect(
    await db.prepare("SELECT count(*) AS n FROM auth_login_events").first("n"),
  ).toBe(1);
  expect((await getLogManagement(db)).cleanup).toMatchObject({
    status: "failed",
    errorCode: "LOG_RETENTION_SETTINGS_ERROR",
  });
  expect(JSON.stringify(errorCalls)).not.toContain("private database details");
});

it("serializes simultaneous invocations without double counting", async () => {
  await seed("old", "2000-01-01");
  await Promise.all([runLogCleanup({ DB: db }), runLogCleanup({ DB: db })]);
  expect((await getLogManagement(db)).cleanup).toMatchObject({
    status: "completed",
    auditDeleted: 1,
    authDeleted: 1,
  });
});

it("never changes business data, revisions, sessions or other settings", async () => {
  await db
    .prepare(
      "INSERT INTO settings (key, value) VALUES ('other-setting', '{\"keep\":true}')",
    )
    .run();
  await db
    .prepare("INSERT INTO models (id, name) VALUES ('keep-model', 'keep')")
    .run();
  await db
    .prepare(
      "INSERT INTO entries (id, model_id, updated_by) VALUES ('keep-entry', 'keep-model', 'retention-admin')",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO entry_revisions (id, entry_id, revision_number, status, content, created_by) VALUES ('keep-revision', 'keep-entry', 1, 'draft', '{}', 'retention-admin')",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO auth_sessions (id, user_id, token, expires_at, created_at, updated_at) VALUES ('keep-session', 'retention-admin', 'private-token', 1, 1, 1)",
    )
    .run();
  const tables = [
    "entries",
    "entry_revisions",
    "users",
    "auth_sessions",
    "settings",
  ];
  const before = await Promise.all(
    tables.map((table) => db.prepare(`SELECT * FROM ${table}`).all()),
  );
  await seed("old", "2000-01-01");
  await runLogCleanup({ DB: db });
  const after = await Promise.all(
    tables.map((table) => db.prepare(`SELECT * FROM ${table}`).all()),
  );
  expect(after.map((r: { results: unknown }) => r.results)).toEqual(
    before.map((r: { results: unknown }) => r.results),
  );
});

async function request(method: string, roles?: string[], body?: unknown) {
  const token = roles
    ? await createAccessToken(secret, {
        sub: "retention-admin",
        email: "admin@example.test",
        roles,
        sid: "retention-session",
      })
    : null;
  return routes.request(
    "/api/admin/settings/logs",
    {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "Content-Type": "application/json",
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    },
    { DB: db, JWT_SECRET: secret },
  );
}

it("restricts settings and status to Super Admin and atomically audits updates", async () => {
  vi.mocked(Date.now).mockRestore();
  for (const method of ["GET", "PUT"]) {
    expect(
      (
        await request(
          method,
          undefined,
          method === "PUT" ? { retentionDays: 30 } : undefined,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await request(
          method,
          ["editor"],
          method === "PUT" ? { retentionDays: 30 } : undefined,
        )
      ).status,
    ).toBe(403);
  }
  const roles = ["system.super-admin"];
  const initial = await request("GET", roles);
  expect(initial.headers.get("Cache-Control")).toBe("no-store");
  expect(await initial.json()).toMatchObject({
    item: { retentionDays: 90 },
    health: "never",
  });
  expect((await request("PUT", roles, { retentionDays: 0 })).status).toBe(400);
  expect((await request("PUT", roles, { retentionDays: 30 })).status).toBe(200);
  expect(await getLogRetention(db)).toEqual({ retentionDays: 30 });
  expect(
    await db.prepare("SELECT user_id, target_id FROM audit_logs").first(),
  ).toEqual({ user_id: "retention-admin", target_id: "log_retention" });
  await db
    .prepare(
      "CREATE TRIGGER fail_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(FAIL, 'no audit'); END",
    )
    .run();
  try {
    expect((await request("PUT", roles, { retentionDays: 60 })).status).toBe(
      503,
    );
    expect(await getLogRetention(db)).toEqual({ retentionDays: 30 });
  } finally {
    await db.prepare("DROP TRIGGER fail_audit").run();
  }
});
