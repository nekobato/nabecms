import { describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../database/schema";
import {
  acceptInviteLifecycle,
  initializeAuthLifecycle,
  InviteAcceptanceConflictError,
  InviteEmailConflictError,
  resetCredentialPasswordLifecycle,
  rotatePasswordResetVerification,
} from "./auth-lifecycle";

type CapturedStatement = {
  query: string;
  params: unknown[];
};

type D1ClientOptions = {
  changes?: number[];
  failure?: Error;
};

/**
 * Create the minimal D1 client surface needed by Drizzle's batch adapter.
 */
const createD1Client = (options: D1ClientOptions = {}) => {
  const prepare = vi.fn((query: string) => ({
    bind: (...params: unknown[]): CapturedStatement => ({ query, params }),
  }));
  const batch = vi.fn(async (statements: CapturedStatement[]) => {
    if (options.failure) throw options.failure;
    return statements.map((_, index) => ({
      success: true,
      results: [],
      meta: { changes: options.changes?.[index] ?? 1 },
    }));
  });

  return {
    client: { prepare, batch } as any,
    prepare,
    batch,
  };
};

/**
 * Flatten the SQL sent in the only expected D1 batch.
 */
const batchSql = (
  batch: ReturnType<typeof createD1Client>["batch"],
): string[] =>
  (batch.mock.calls[0]?.[0] ?? []).map((statement) => statement.query);

/**
 * Flatten all bound parameters sent in the only expected D1 batch.
 */
const batchParameters = (
  batch: ReturnType<typeof createD1Client>["batch"],
): unknown[] =>
  (batch.mock.calls[0]?.[0] ?? []).flatMap((statement) => statement.params);

describe("auth lifecycle D1 batches", () => {
  it("initializes every canonical record in one batch without legacy hashes", async () => {
    const { client, batch } = createD1Client();
    const db = drizzle(client, { schema });
    const now = new Date("2026-07-15T00:00:00.000Z");

    await initializeAuthLifecycle(db, {
      userId: "user_1",
      accountId: "account_1",
      email: "admin@example.com",
      name: "Admin",
      passwordHash: "canonical-password-hash",
      defaultLocale: "ja-JP",
      now,
    });

    expect(batch).toHaveBeenCalledTimes(1);
    const statements = batchSql(batch);
    expect(statements).toHaveLength(7);
    expect(statements[0]).toContain('insert into "settings"');
    expect(statements[1]).toContain('insert into "roles"');
    expect(statements[2]).toContain('insert into "users"');
    expect(statements[3]).toContain('insert into "user_roles"');
    expect(statements[4]).toContain('insert into "auth_accounts"');
    expect(statements[5]).toContain('update "locales"');
    expect(statements[6]).toContain('insert into "locales"');
    expect(statements.join("\n")).not.toContain("auth_credentials");
    expect(statements.join("\n")).not.toContain("auth_identities");
    expect(
      batchParameters(batch).filter(
        (parameter) => parameter === "canonical-password-hash",
      ),
    ).toHaveLength(1);
  });

  it("accepts an invite and issues its session in one guarded batch", async () => {
    const { client, batch } = createD1Client();
    const db = drizzle(client, { schema });
    const now = new Date("2026-07-15T00:00:00.000Z");

    await acceptInviteLifecycle(db, {
      inviteId: "invite_1",
      inviteTokenHash: "invite-token-hash",
      userId: "user_1",
      accountId: "account_1",
      sessionId: "session_1",
      authLogId: "authlog_1",
      email: "editor@example.com",
      name: "Editor",
      roleIds: ["role.editor"],
      passwordHash: "canonical-password-hash",
      refreshTokenHash: "refresh-token-hash",
      sessionExpiresAt: new Date("2026-08-14T00:00:00.000Z"),
      ipAddress: "203.0.113.1",
      userAgent: "test-agent",
      now,
    });

    expect(batch).toHaveBeenCalledTimes(1);
    const statements = batchSql(batch);
    expect(statements).toHaveLength(6);
    expect(statements[0]).toContain('insert into "users"');
    expect(statements[1]).toContain('insert into "user_roles"');
    expect(statements[2]).toContain('insert into "auth_accounts"');
    expect(statements[3]).toContain('update "auth_invites"');
    expect(statements[3]).toContain('"status" in (?, ?)');
    expect(statements[4]).toContain('insert into "auth_sessions"');
    expect(statements[4]).toContain('from "auth_invites"');
    expect(statements[5]).toContain('insert into "auth_login_events"');
    expect(statements.join("\n")).not.toContain("auth_credentials");
    expect(statements.join("\n")).not.toContain("auth_identities");
    const parameters = batchParameters(batch);
    expect(
      parameters.filter((parameter) => parameter === "canonical-password-hash"),
    ).toHaveLength(1);
    expect(parameters).toContain("legacy:refresh-token-hash");
    expect(parameters).toContain("refresh-token-hash");
    expect(parameters).not.toContain("raw-refresh-token");
  });

  it("chunks large invite role assignments below the D1 binding limit", async () => {
    const { client, batch } = createD1Client();
    const db = drizzle(client, { schema });
    const now = new Date("2026-07-15T00:00:00.000Z");
    const roleIds = Array.from({ length: 34 }, (_, index) => `role.${index}`);

    await acceptInviteLifecycle(db, {
      inviteId: "invite_many_roles",
      inviteTokenHash: "invite-token-hash",
      userId: "user_many_roles",
      accountId: "account_many_roles",
      sessionId: "session_many_roles",
      authLogId: "authlog_many_roles",
      email: "many-roles@example.com",
      name: "Many Roles",
      roleIds,
      passwordHash: "canonical-password-hash",
      refreshTokenHash: "refresh-token-hash",
      sessionExpiresAt: new Date("2026-08-14T00:00:00.000Z"),
      now,
    });

    expect(batch).toHaveBeenCalledTimes(1);
    const statements = batch.mock.calls[0]?.[0] ?? [];
    const roleStatements = statements.filter((statement) =>
      statement.query.includes('insert into "user_roles"'),
    );
    expect(roleStatements).toHaveLength(2);
    expect(roleStatements.map((statement) => statement.params.length)).toEqual([
      99, 3,
    ]);
    expect(roleStatements.flatMap((statement) => statement.params)).toEqual(
      roleIds.flatMap((roleId) => [
        "user_many_roles",
        roleId,
        now.toISOString(),
      ]),
    );
  });

  it("classifies a failed invite guard after D1 rolls the batch back", async () => {
    const { client } = createD1Client({
      failure: new Error("FOREIGN KEY constraint failed"),
    });
    const db = drizzle(client, { schema });

    await expect(
      acceptInviteLifecycle(db, {
        inviteId: "invite_1",
        inviteTokenHash: "invite-token-hash",
        userId: "user_1",
        accountId: "account_1",
        sessionId: "session_1",
        authLogId: "authlog_1",
        email: "editor@example.com",
        name: "Editor",
        roleIds: ["role.editor"],
        passwordHash: "canonical-password-hash",
        refreshTokenHash: "refresh-token-hash",
        sessionExpiresAt: new Date("2026-08-14T00:00:00.000Z"),
        now: new Date("2026-07-15T00:00:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(InviteAcceptanceConflictError);
  });

  it("classifies a concurrent invite email claim", async () => {
    const { client } = createD1Client({
      failure: new Error("UNIQUE constraint failed: users.email"),
    });
    const db = drizzle(client, { schema });

    await expect(
      acceptInviteLifecycle(db, {
        inviteId: "invite_1",
        inviteTokenHash: "invite-token-hash",
        userId: "user_1",
        accountId: "account_1",
        sessionId: "session_1",
        authLogId: "authlog_1",
        email: "editor@example.com",
        name: "Editor",
        roleIds: ["role.editor"],
        passwordHash: "canonical-password-hash",
        refreshTokenHash: "refresh-token-hash",
        sessionExpiresAt: new Date("2026-08-14T00:00:00.000Z"),
        now: new Date("2026-07-15T00:00:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(InviteEmailConflictError);
  });

  it("rotates reset verifications in one batch", async () => {
    const { client, batch } = createD1Client();
    const db = drizzle(client, { schema });

    await rotatePasswordResetVerification(db, {
      id: "verification_1",
      identifier: "password_reset:user_1",
      value: "verification-hash",
      expiresAt: new Date("2026-07-15T01:00:00.000Z"),
      now: new Date("2026-07-15T00:00:00.000Z"),
    });

    expect(batch).toHaveBeenCalledTimes(1);
    const statements = batchSql(batch);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain('delete from "auth_verifications"');
    expect(statements[1]).toContain('insert into "auth_verifications"');
  });

  it.each([
    { changed: 1, expected: true },
    { changed: 0, expected: false },
  ])(
    "returns $expected when the guarded password update changes $changed row",
    async ({ changed, expected }) => {
      const { client, batch } = createD1Client({ changes: [changed, 1, 1] });
      const db = drizzle(client, { schema });

      const result = await resetCredentialPasswordLifecycle(db, {
        accountId: "account_1",
        userId: "user_1",
        verificationId: "verification_1",
        verificationIdentifier: "password_reset:user_1",
        verificationValue: "verification-hash",
        passwordHash: "new-password-hash",
        now: new Date("2026-07-15T00:00:00.000Z"),
      });

      expect(result).toBe(expected);
      expect(batch).toHaveBeenCalledTimes(1);
      const statements = batchSql(batch);
      expect(statements).toHaveLength(3);
      expect(statements[0]).toContain('update "auth_accounts"');
      expect(statements[0]).toContain("exists");
      expect(statements[1]).toContain('delete from "auth_sessions"');
      expect(statements[1]).toContain("exists");
      expect(statements[2]).toContain('delete from "auth_verifications"');
      expect(statements[2]).toContain("exists");
      expect(
        batchParameters(batch).filter(
          (parameter) => parameter === "verification-hash",
        ),
      ).toHaveLength(3);
    },
  );
});
