/// <reference types="@cloudflare/vitest-plugin/types" />
import { applyD1Migrations, env, type D1Migration } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./create-app";
import * as schema from "./database/schema";
import { sha256Hex } from "./lib/auth";
import {
  acceptInviteLifecycle,
  InviteAcceptanceConflictError,
  InviteEmailConflictError,
  type AcceptInviteLifecycleInput,
} from "./services/auth-lifecycle";
import type { Env } from "./types";

const bindings = env as unknown as Env & { TEST_MIGRATIONS: D1Migration[] };
const db = drizzle(bindings.DB, { schema });
const app = createApp({
  config: { database: { migrations: { enabled: false } } },
});
const runtime: Env = {
  ...bindings,
  WORKER_ENV: "test",
  BCRYPT_COST: "4",
  BETTER_AUTH_SECRET: undefined,
  BETTER_AUTH_URL: undefined,
};
const tables = [
  "users",
  "user_roles",
  "auth_accounts",
  "auth_invites",
  "auth_sessions",
  "auth_login_events",
] as const;

async function snapshot() {
  return Promise.all(
    tables.map(
      async (table) =>
        (
          await bindings.DB.prepare(
            `SELECT * FROM "${table}" ORDER BY rowid`,
          ).all()
        ).results,
    ),
  );
}

async function fixture(roleCount = 1, status: "pending" | "sent" = "sent") {
  const now = new Date();
  const ownerId = crypto.randomUUID();
  const roleIds = Array.from({ length: roleCount }, () => crypto.randomUUID());
  const token = `invite-token-${crypto.randomUUID()}`;
  const input: AcceptInviteLifecycleInput = {
    inviteId: crypto.randomUUID(),
    inviteTokenHash: await sha256Hex(token),
    userId: crypto.randomUUID(),
    accountId: crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
    authLogId: crypto.randomUUID(),
    email: `${crypto.randomUUID()}@example.test`,
    name: "Invited editor",
    roleIds,
    passwordHash: "test-password-hash",
    refreshTokenHash: crypto.randomUUID(),
    now,
    sessionExpiresAt: new Date(now.getTime() + 60_000),
  };
  await db.insert(schema.users).values({
    id: ownerId,
    email: `${ownerId}@example.test`,
    name: "Owner",
    roleId: [],
  });
  for (const id of roleIds) {
    await db
      .insert(schema.roles)
      .values({ id, name: id, permissions: { allow: [] } });
  }
  await db.insert(schema.authInvites).values({
    id: input.inviteId,
    email: input.email,
    roleIds,
    tokenHash: input.inviteTokenHash,
    tokenExpiresAt: new Date(now.getTime() + 60_000).toISOString(),
    status,
    createdBy: ownerId,
  });
  return { input, token };
}

beforeAll(async () => {
  await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS);
});

describe("invitation eligibility in the real D1 acceptance batch", () => {
  it.each([
    "input-super",
    "stored-super",
    "stored-system",
    "input-system",
    "unknown-stored-role",
  ])(
    "rolls back every canonical record when roles are prohibited at commit: %s",
    async (state) => {
      const { input } = await fixture();
      if (state.endsWith("super")) {
        await db
          .insert(schema.roles)
          .values({
            id: "system.super-admin",
            name: "Super Admin",
            permissions: { allow: ["*"] },
            isSystem: false,
          })
          .onConflictDoNothing();
      }
      if (state === "input-super") input.roleIds = ["system.super-admin"];
      if (state === "stored-super" || state === "unknown-stored-role") {
        await db
          .update(schema.authInvites)
          .set({
            roleIds: [
              state === "stored-super" ? "system.super-admin" : "missing-role",
            ],
          })
          .where(eq(schema.authInvites.id, input.inviteId));
      }
      if (state === "stored-system") {
        await db
          .update(schema.roles)
          .set({ isSystem: true })
          .where(eq(schema.roles.id, input.roleIds[0]));
      }
      if (state === "input-system") {
        const id = crypto.randomUUID();
        await db
          .insert(schema.roles)
          .values({ id, name: id, permissions: { allow: [] }, isSystem: true });
        input.roleIds = [id];
      }
      const before = await snapshot();
      await expect(acceptInviteLifecycle(db, input)).rejects.toBeInstanceOf(
        InviteAcceptanceConflictError,
      );
      expect(await snapshot()).toEqual(before);
    },
  );
  it.each([
    "rotated",
    "revoked",
    "consumed",
    "expired",
    "deadline",
    "past",
    "missing",
  ])(
    "rolls back every canonical record when the invite is %s",
    async (state) => {
      const { input } = await fixture();
      if (state === "missing") {
        await db
          .delete(schema.authInvites)
          .where(eq(schema.authInvites.id, input.inviteId));
      } else {
        await db
          .update(schema.authInvites)
          .set(
            state === "rotated"
              ? { tokenHash: `replacement-${input.inviteId}` }
              : state === "deadline"
                ? { tokenExpiresAt: input.now.toISOString() }
                : state === "past"
                  ? {
                      tokenExpiresAt: new Date(
                        input.now.getTime() - 1,
                      ).toISOString(),
                    }
                  : { status: state as "revoked" | "consumed" | "expired" },
          )
          .where(eq(schema.authInvites.id, input.inviteId));
      }
      const before = await snapshot();
      await expect(acceptInviteLifecycle(db, input)).rejects.toBeInstanceOf(
        InviteAcceptanceConflictError,
      );
      expect(await snapshot()).toEqual(before);
    },
  );

  it("does not attach credentials to an existing credential-less user on a stale claim", async () => {
    const { input } = await fixture();
    await db.insert(schema.users).values({
      id: input.userId,
      email: `${input.userId}@example.test`,
      name: "Existing SSO user",
      roleId: [],
    });
    await db
      .update(schema.authInvites)
      .set({ tokenHash: `replacement-${input.inviteId}` })
      .where(eq(schema.authInvites.id, input.inviteId));
    const before = await snapshot();
    await expect(acceptInviteLifecycle(db, input)).rejects.toBeInstanceOf(
      InviteAcceptanceConflictError,
    );
    expect(await snapshot()).toEqual(before);
  });

  it.each([
    { count: 1, status: "pending" as const },
    { count: 1, status: "sent" as const },
    { count: 34, status: "sent" as const },
  ])(
    "accepts a $status invite with $count roles",
    async ({ count, status }) => {
      const { input } = await fixture(count, status);
      await acceptInviteLifecycle(db, input);
      const [user] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, input.userId));
      expect(user.email).toBe(input.email);
      expect(user.roleId).toEqual(input.roleIds);
      expect(
        await db
          .select()
          .from(schema.userRoles)
          .where(eq(schema.userRoles.userId, input.userId)),
      ).toHaveLength(count);
      const [account] = await db
        .select()
        .from(schema.authAccounts)
        .where(eq(schema.authAccounts.id, input.accountId));
      expect(account.password).toBe(input.passwordHash);
      expect(account.userId).toBe(input.userId);
      expect(
        await db
          .select()
          .from(schema.authSessions)
          .where(eq(schema.authSessions.id, input.sessionId)),
      ).toHaveLength(1);
      expect(
        await db
          .select()
          .from(schema.authLoginEvents)
          .where(eq(schema.authLoginEvents.id, input.authLogId)),
      ).toHaveLength(1);
      const [invite] = await db
        .select()
        .from(schema.authInvites)
        .where(eq(schema.authInvites.id, input.inviteId));
      expect(invite.status).toBe("consumed");
      expect(invite.consumedByUserId).toBe(input.userId);
      const before = await snapshot();
      await expect(
        acceptInviteLifecycle(db, {
          ...input,
          userId: crypto.randomUUID(),
          accountId: crypto.randomUUID(),
          sessionId: crypto.randomUUID(),
          authLogId: crypto.randomUUID(),
        }),
      ).rejects.toBeInstanceOf(InviteAcceptanceConflictError);
      expect(await snapshot()).toEqual(before);
    },
  );

  it("preserves the email-conflict error and rolls back the batch", async () => {
    const { input } = await fixture();
    await db.insert(schema.users).values({
      id: crypto.randomUUID(),
      email: input.email,
      name: "Concurrent claimant",
      roleId: [],
    });
    const before = await snapshot();
    await expect(acceptInviteLifecycle(db, input)).rejects.toBeInstanceOf(
      InviteEmailConflictError,
    );
    expect(await snapshot()).toEqual(before);
  });

  it.each([
    "rotated",
    "revoked",
    "missing",
    "consumed",
    "expired",
    "super-role",
    "reserved-role",
  ])(
    "returns 410 with no session or credentials when an invite is %s after route validation",
    async (state) => {
      const { input, token } = await fixture();
      let intercepted = false;
      let before: Awaited<ReturnType<typeof snapshot>> | undefined;
      const interceptedRuntime: Env = {
        ...runtime,
        DB: {
          prepare: bindings.DB.prepare.bind(bindings.DB),
          batch: async (statements: Parameters<Env["DB"]["batch"]>[0]) => {
            if (!intercepted) {
              intercepted = true;
              if (state === "super-role") {
                await db
                  .insert(schema.roles)
                  .values({
                    id: "system.super-admin",
                    name: "Super Admin",
                    permissions: { allow: ["*"] },
                    isSystem: true,
                  })
                  .onConflictDoNothing();
                await db
                  .update(schema.authInvites)
                  .set({ roleIds: ["system.super-admin"] })
                  .where(eq(schema.authInvites.id, input.inviteId));
              } else if (state === "reserved-role") {
                await db
                  .update(schema.roles)
                  .set({ isSystem: true })
                  .where(eq(schema.roles.id, input.roleIds[0]));
              } else if (state === "missing") {
                await db
                  .delete(schema.authInvites)
                  .where(eq(schema.authInvites.id, input.inviteId));
              } else {
                await db
                  .update(schema.authInvites)
                  .set(
                    state === "rotated"
                      ? { tokenHash: `replacement-${input.inviteId}` }
                      : { status: state as "revoked" | "consumed" | "expired" },
                  )
                  .where(eq(schema.authInvites.id, input.inviteId));
              }
              before = await snapshot();
            }
            return bindings.DB.batch(statements);
          },
        } as Env["DB"],
      };
      const response = await app.request(
        "https://cms.example.test/api/admin/auth/accept-invite",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token,
            name: "Invited editor",
            password: "EditorPass123!",
          }),
        },
        interceptedRuntime,
      );
      expect(intercepted).toBe(true);
      expect(response.status).toBe(410);
      expect(await response.json()).toMatchObject({ error: { code: "GONE" } });
      expect(response.headers.has("Set-Cookie")).toBe(false);
      expect(await snapshot()).toEqual(before);
      const login = await app.request(
        "https://cms.example.test/api/admin/auth/login",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: input.email,
            password: "EditorPass123!",
          }),
        },
        runtime,
      );
      expect(login.status).toBe(401);
      expect(login.headers.has("Set-Cookie")).toBe(false);
    },
  );

  it("consumes one invite only once when two valid HTTP requests reach the write boundary", async () => {
    const { input, token } = await fixture();
    let arrived = 0;
    let release: () => void;
    const bothValidated = new Promise<void>((resolve) => {
      release = resolve;
    });
    const interceptedRuntime: Env = {
      ...runtime,
      DB: {
        prepare: bindings.DB.prepare.bind(bindings.DB),
        batch: async (statements: Parameters<Env["DB"]["batch"]>[0]) => {
          arrived += 1;
          if (arrived === 2) release();
          await bothValidated;
          return bindings.DB.batch(statements);
        },
      } as Env["DB"],
    };
    const responses = await Promise.all(
      [1, 2].map(() =>
        app.request(
          "https://cms.example.test/api/admin/auth/accept-invite",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              token,
              name: "Concurrent invitee",
              password: "EditorPass123!",
            }),
          },
          interceptedRuntime,
        ),
      ),
    );
    expect(arrived).toBe(2);
    expect(responses.map((response) => response.status).toSorted()).toEqual([
      200, 410,
    ]);
    expect(
      responses.filter((response) => response.headers.has("Set-Cookie")),
    ).toHaveLength(1);
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, input.email));
    expect(user).toBeDefined();
    expect(
      await db
        .select()
        .from(schema.authAccounts)
        .where(eq(schema.authAccounts.userId, user.id)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(schema.authSessions)
        .where(eq(schema.authSessions.userId, user.id)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(schema.authLoginEvents)
        .where(eq(schema.authLoginEvents.userId, user.id)),
    ).toHaveLength(1);
    const login = await app.request(
      "https://cms.example.test/api/admin/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: input.email,
          password: "EditorPass123!",
        }),
      },
      runtime,
    );
    expect(login.status).toBe(200);
    expect(login.headers.has("Set-Cookie")).toBe(true);
  });

  it("keeps the pre-hashing expiry reference when processing crosses the deadline", async () => {
    const { input } = await fixture();
    const startedAt = new Date(input.now.getTime() - 10_000);
    const expiredWhileHashing = new Date(input.now.getTime() - 1_000);
    await db
      .update(schema.authInvites)
      .set({ tokenExpiresAt: expiredWhileHashing.toISOString() })
      .where(eq(schema.authInvites.id, input.inviteId));
    await acceptInviteLifecycle(db, { ...input, now: startedAt });
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, input.userId));
    expect(user.email).toBe(input.email);
  });
});
