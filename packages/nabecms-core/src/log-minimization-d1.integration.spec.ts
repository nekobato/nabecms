/// <reference types="@cloudflare/vitest-plugin/types" />
import { applyD1Migrations, env, type D1Migration } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeAll, expect, it, vi } from "vitest";
import * as schema from "./database/schema";
import { createAccessToken } from "./lib/auth";
import { logAuthEvent } from "./lib/auth-log";
import { sanitizeAuditSnapshot } from "./lib/audit-log";
import logs from "./routes/admin/logs";
import { createD1EntriesServiceDeps } from "./services/entries-d1";

type Database = Parameters<typeof applyD1Migrations>[0];
const bindings = env as unknown as {
  DB: Database;
  LEGACY_DB: Database;
  TEST_MIGRATIONS: D1Migration[];
};
const db = drizzle(bindings.DB, { schema });
const secret = "log-minimization-test-secret-32-bytes";
const sensitive = {
  email: "secret@example.test",
  ip: "203.0.113.45",
  userAgent: "private-agent",
  location: { city: "private-city" },
  sessionId: "session-secret",
  requestId: "request-secret",
  password: "password-secret",
  token: "token-secret",
  keyHash: "hash-secret",
  Cookie: "cookie-secret",
  Authorization: "Bearer secret",
  body: "body-secret",
  error: "exception-secret",
};

beforeAll(async () => {
  await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS);
  await db.insert(schema.users).values({
    id: "log-user",
    email: sensitive.email,
    name: "Log Reader",
    roleId: [],
  });
  await db.insert(schema.roles).values([
    {
      id: "log-reader",
      name: "Log Reader",
      permissions: { allow: ["logs:*:read"] },
    },
    { id: "no-logs", name: "No Logs", permissions: { allow: [] } },
  ]);
  const now = new Date();
  await db.insert(schema.authSessions).values({
    id: "log-session",
    userId: "log-user",
    token: "session-secret",
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(now.getTime() + 3600000),
  });
});

const request = async (path: string, role?: string) => {
  const token = role
    ? await createAccessToken(secret, {
        sub: "log-user",
        email: sensitive.email,
        roles: [role],
        sid: "log-session",
      })
    : null;
  return logs.request(
    path,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    { DB: bindings.DB, JWT_SECRET: secret },
  );
};

it("writes only allowed authentication columns for known and unknown users", async () => {
  for (const userId of ["log-user", null]) {
    await logAuthEvent(db, {
      ...sensitive,
      userId,
      result: "failed",
      reason: "invalid_password",
    });
  }
  const rows = await bindings.DB.prepare(
    "SELECT * FROM auth_login_events",
  ).all();
  expect(rows.results).toHaveLength(2);
  for (const row of rows.results) {
    expect(Object.keys(row).sort()).toEqual(
      ["id", "user_id", "provider", "result", "reason", "created_at"].sort(),
    );
    expect(row).toMatchObject({
      provider: "local",
      result: "failed",
      reason: "invalid_password",
    });
  }
  expect(JSON.stringify(rows.results)).not.toContain("secret");
});

it("does not log exception details when an authentication log write fails", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    await logAuthEvent(
      {
        insert() {
          throw new Error(sensitive.password);
        },
      },
      { result: "failed" },
    );
    expect(warn).toHaveBeenCalledWith("[auth] failed to log auth event");
    expect(JSON.stringify(warn.mock.calls)).not.toContain(sensitive.password);
  } finally {
    warn.mockRestore();
  }
});

it("filters operation payloads at the D1 storage boundary", async () => {
  const deps = createD1EntriesServiceDeps(db);
  await deps.runAtomicWrite(async (writer) => {
    await writer.logAuditEvent({
      actorId: "log-user",
      action: "update",
      targetTable: "entries",
      targetId: "test-entry",
      before: { ...sensitive, status: "draft" },
      after: {
        ...sensitive,
        status: "published",
        publishedRevisionId: "Abcd12345678",
      },
    });
  });
  const [row] = await db.select().from(schema.auditLogs);
  expect(row.before).toEqual({ status: "draft" });
  expect(row.after).toEqual({
    status: "published",
    publishedRevisionId: "Abcd12345678",
  });
  expect(
    sanitizeAuditSnapshot({
      status: sensitive.password,
      publishedRevisionId: sensitive.email,
    }),
  ).toBeNull();
});

it("returns metadata only even for legacy payloads, without joining email or exposing revision content", async () => {
  await bindings.DB.prepare(
    "INSERT INTO audit_logs (id, user_id, action, target_table, target_id, before, after) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      "legacy-log",
      "log-user",
      "update",
      "entries",
      "test-entry",
      JSON.stringify({ ...sensitive, status: "draft" }),
      JSON.stringify(sensitive),
    )
    .run();
  await db.insert(schema.models).values({ id: "log-model", name: "Log Model" });
  await db.insert(schema.entries).values({
    id: "log-entry",
    modelId: "log-model",
    status: "draft",
    updatedBy: "log-user",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await db.insert(schema.entryRevisions).values({
    id: "log-revision",
    entryId: "log-entry",
    revisionNumber: 1,
    status: "draft",
    createdBy: "log-user",
    content: sensitive,
  });
  const response = await request("/api/admin/logs", "log-reader");
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    auditLogs: { items: Record<string, unknown>[] };
    entryRevisions: { items: Record<string, unknown>[] };
  };
  expect(
    body.auditLogs.items.find((row) => row.id === "legacy-log"),
  ).toMatchObject({ before: { status: "draft" }, after: null });
  expect(body.entryRevisions.items[0]).not.toHaveProperty("content");
  expect(JSON.stringify(body)).not.toContain("secret");
  await logAuthEvent(db, {
    ...sensitive,
    userId: "log-user",
    result: "success",
  });
  const authResponse = await request("/api/admin/logs/auth", "log-reader");
  expect(authResponse.status).toBe(200);
  expect(await authResponse.text()).not.toContain("secret");
});

it.each(["/api/admin/logs", "/api/admin/logs/auth"])(
  "requires authentication and logs permission for %s",
  async (path) => {
    expect((await request(path)).status).toBe(401);
    expect((await request(path, "no-logs")).status).toBe(403);
  },
);

it("removes historical sensitive columns and snapshots while preserving log rows", async () => {
  const database = bindings.LEGACY_DB;
  const migrationIndex = bindings.TEST_MIGRATIONS.findIndex(
    (migration) => migration.name === "0009_minimize_auth_logs.sql",
  );
  const last = bindings.TEST_MIGRATIONS[migrationIndex]!;
  expect(last.name).toBe("0009_minimize_auth_logs.sql");
  await applyD1Migrations(
    database,
    bindings.TEST_MIGRATIONS.slice(0, migrationIndex),
  );
  await database
    .prepare(
      "INSERT INTO auth_login_events (id, email, ip, user_agent, location, provider, result) VALUES (?, ?, ?, ?, ?, 'local', 'failed')",
    )
    .bind(
      "old-auth",
      sensitive.email,
      sensitive.ip,
      sensitive.userAgent,
      JSON.stringify(sensitive.location),
    )
    .run();
  await database
    .prepare(
      "INSERT INTO audit_logs (id, action, target_table, target_id, before, after) VALUES ('old-audit', 'update', 'settings', 'auth', ?, ?)",
    )
    .bind(JSON.stringify(sensitive), JSON.stringify(sensitive))
    .run();
  await applyD1Migrations(database, [last]);
  const auth = await database.prepare("SELECT * FROM auth_login_events").all();
  expect(auth.results).toHaveLength(1);
  expect(Object.keys(auth.results[0]).sort()).toEqual(
    ["id", "user_id", "provider", "result", "reason", "created_at"].sort(),
  );
  expect(
    await database.prepare("SELECT id, before, after FROM audit_logs").first(),
  ).toEqual({ id: "old-audit", before: null, after: null });
  expect(
    (await database.prepare("PRAGMA foreign_key_check").all()).results,
  ).toEqual([]);
});

it("filters operation items and count together without filtering revisions", async () => {
  await db
    .insert(schema.models)
    .values({ id: "filter-model", name: "Filter model" });
  await db.insert(schema.entries).values({
    id: "filter-entry",
    modelId: "filter-model",
    updatedBy: "log-user",
  });
  await db.insert(schema.entryRevisions).values({
    id: "filter-revision",
    entryId: "filter-entry",
    revisionNumber: 1,
    content: { body: "private-body" },
    createdBy: "log-user",
  });
  await db.insert(schema.auditLogs).values([
    {
      id: "match-a",
      targetTable: "entries",
      targetId: "filter-entry",
      action: "publish",
      createdAt: "2026-09-14 15:00:00",
    },
    {
      id: "match-b",
      targetTable: "entries",
      targetId: "filter-entry",
      action: "publish",
      createdAt: "2026-09-14T15:00:00.000Z",
    },
    {
      id: "wrong-action",
      targetTable: "entries",
      targetId: "filter-entry",
      action: "update",
      createdAt: "2026-09-14 15:00:00",
    },
    {
      id: "wrong-target",
      targetTable: "entries",
      targetId: "filter-entry-2",
      action: "publish",
      createdAt: "2026-09-14 15:00:00",
    },
    {
      id: "too-early",
      targetTable: "entries",
      targetId: "filter-entry",
      action: "publish",
      createdAt: "2026-09-14 14:59:59",
    },
  ]);
  const query = new URLSearchParams({
    action: "publish",
    targetId: "filter-entry",
    dateFrom: "2026-09-15T00:00:00+09:00",
    dateTo: "2026-09-15T00:00:00+09:00",
    auditLimit: "1",
  });
  const first = await request(`/api/admin/logs?${query}`, "log-reader");
  expect(first.status).toBe(200);
  const body = (await first.json()) as {
    auditLogs: { items: { id: string }[]; total: number };
    entryRevisions: { total: number };
  };
  expect(body.auditLogs).toMatchObject({
    total: 2,
    items: [{ id: "match-b" }],
  });
  const unfiltered = (await (
    await request("/api/admin/logs", "log-reader")
  ).json()) as { entryRevisions: { total: number } };
  expect(body.entryRevisions.total).toBe(unfiltered.entryRevisions.total);
  query.set("auditOffset", "1");
  const second = await (
    await request(`/api/admin/logs?${query}`, "log-reader")
  ).json();
  expect(second).toMatchObject({
    auditLogs: { total: 2, items: [{ id: "match-a" }] },
  });
  query.set("targetId", "missing");
  expect(
    await (await request(`/api/admin/logs?${query}`, "log-reader")).json(),
  ).toMatchObject({ auditLogs: { total: 0, items: [] } });
});

it("filters authentication across timestamp formats, users, reasons and page boundaries", async () => {
  await db.insert(schema.users).values({
    id: "filter-auth-user",
    email: "filter-auth@example.test",
    name: "Filter user",
    roleId: [],
  });
  await db.insert(schema.authLoginEvents).values([
    {
      id: "auth-a",
      userId: "filter-auth-user",
      provider: "local",
      result: "failed",
      reason: "invalid_password",
      createdAt: "2026-09-14 15:00:00",
    },
    {
      id: "auth-b",
      userId: "filter-auth-user",
      provider: "local",
      result: "failed",
      reason: "invalid_password",
      createdAt: "2026-09-15T14:59:59.999Z",
    },
    {
      id: "auth-next-day",
      userId: "filter-auth-user",
      provider: "local",
      result: "failed",
      reason: "invalid_password",
      createdAt: "2026-09-15 15:00:00",
    },
    {
      id: "auth-unknown",
      provider: "local",
      result: "failed",
      reason: "user_not_found",
      createdAt: "2026-09-15 00:00:00",
    },
    {
      id: "auth-success",
      userId: "filter-auth-user",
      provider: "local",
      result: "success",
      createdAt: "2026-09-15 00:00:00",
    },
  ]);
  const query = new URLSearchParams({
    result: "failed",
    reason: "invalid_password",
    userId: "filter-auth-user",
    dateFrom: "2026-09-15T00:00:00+09:00",
    dateTo: "2026-09-15T23:59:59.999+09:00",
    limit: "1",
  });
  expect(
    await (await request(`/api/admin/logs/auth?${query}`, "log-reader")).json(),
  ).toMatchObject({ authLogs: { total: 2, items: [{ id: "auth-b" }] } });
  query.set("offset", "1");
  expect(
    await (await request(`/api/admin/logs/auth?${query}`, "log-reader")).json(),
  ).toMatchObject({ authLogs: { total: 2, items: [{ id: "auth-a" }] } });
  expect(
    await (
      await request("/api/admin/logs/auth?reason=user_not_found", "log-reader")
    ).json(),
  ).toMatchObject({
    authLogs: {
      total: 1,
      items: [{ id: "auth-unknown", userName: null, userId: null }],
    },
  });
});

it("rejects invalid or reversed dates after applying log permissions", async () => {
  for (const path of ["/api/admin/logs", "/api/admin/logs/auth"]) {
    for (const query of [
      "dateFrom=not-a-date",
      "dateFrom=2026-02-30",
      "dateFrom=2026-09-16&dateTo=2026-09-15",
    ]) {
      const response = await request(`${path}?${query}`, "log-reader");
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "INVALID_LOG_DATE_RANGE" },
      });
      expect((await request(`${path}?${query}`, "no-logs")).status).toBe(403);
    }
  }
});
