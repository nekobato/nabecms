/// <reference types="@cloudflare/vitest-plugin/types" />
import { applyD1Migrations, env, type D1Migration } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./create-app";
import * as schema from "./database/schema";
import { createAccessToken, ensureJwtSecret, sha256Hex } from "./lib/auth";
import type { Env } from "./types";
import { createAuthInvitesRepository } from "./repositories/auth-invites";
import { createRoleRepository } from "./repositories/roles";
import { createUserRepository } from "./repositories/users";
import { createAuthRepository } from "./repositories/auth";
import {
  InviteRoleAssignmentError,
  consumeInvite,
  regenerateInvite,
} from "./services/invites";
import { deliverInvite } from "./services/invite-email";

const bindings = env as unknown as Env & { TEST_MIGRATIONS: D1Migration[] };
const runtime = {
  ...bindings,
  BETTER_AUTH_SECRET: undefined,
  BETTER_AUTH_URL: undefined,
  WORKER_ENV: "test" as const,
};
const app = createApp();
const db = drizzle(bindings.DB, { schema });
const PERMISSIONS = ["users:invite:write", "users:*:write", "*"];
let ownerToken: string;
let ownerId: string;
let customRole: string;
let reservedRole: string;

async function token(userId: string, roles: string[]) {
  const sid = crypto.randomUUID();
  await db.insert(schema.authSessions).values({
    id: sid,
    userId,
    token: sid,
    expiresAt: new Date(Date.now() + 60_000),
  });
  return createAccessToken(ensureJwtSecret(runtime), {
    sub: userId,
    email: `${userId}@example.test`,
    roles,
    sid,
  });
}
async function manager(permission: string) {
  const id = crypto.randomUUID();
  const role = crypto.randomUUID();
  await db
    .insert(schema.roles)
    .values({ id: role, name: role, permissions: { allow: [permission] } });
  await db.insert(schema.users).values({
    id,
    email: `${id}@example.test`,
    name: "Manager",
    roleId: [role],
  });
  return token(id, [role]);
}
const actorToken = (permission: string) =>
  permission === "Super Admin" ? ownerToken : manager(permission);
const jsonRequest = (path: string, body: unknown, bearer?: string) =>
  app.request(
    `https://cms.example.test/api/admin/auth/${path}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify(body),
    },
    runtime,
  );
async function invite(roles: string[], status: "pending" | "sent" = "sent") {
  const id = crypto.randomUUID();
  await db.insert(schema.authInvites).values({
    id,
    email: `${id}@example.test`,
    roleIds: roles,
    status,
    tokenHash: await sha256Hex(`old-${id}`),
    tokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    createdBy: ownerId,
    metadata: {
      emailToken: "original-secret-envelope",
      emailDelivery: { status: "accepted" },
    },
  });
  return (
    await db
      .select()
      .from(schema.authInvites)
      .where(eq(schema.authInvites.id, id))
  )[0];
}
const regenerate = (id: string, bearer: string) =>
  app.request(
    `https://cms.example.test/api/admin/auth/invites/${id}/regenerate`,
    { method: "POST", headers: { Authorization: `Bearer ${bearer}` } },
    runtime,
  );

beforeAll(async () => {
  await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS);
  await db
    .insert(schema.roles)
    .values({
      id: "system.super-admin",
      name: "Super Admin",
      permissions: { allow: ["*"] },
      isSystem: true,
    })
    .onConflictDoNothing();
});
beforeEach(async () => {
  ownerId = crypto.randomUUID();
  customRole = crypto.randomUUID();
  reservedRole = crypto.randomUUID();
  await db.insert(schema.roles).values([
    {
      id: customRole,
      name: customRole,
      permissions: { allow: ["entries:*:read"] },
    },
    {
      id: reservedRole,
      name: reservedRole,
      permissions: { allow: [] },
      isSystem: true,
    },
  ]);
  await db.insert(schema.users).values({
    id: ownerId,
    email: `${ownerId}@example.test`,
    name: "Owner",
    roleId: ["system.super-admin"],
  });
  ownerToken = await token(ownerId, ["system.super-admin"]);
});

describe("invitation role authorization with real D1", () => {
  it.each(PERMISSIONS)(
    "denies reserved invite regeneration to %s without modifying it",
    async (permission) => {
      const bearer = await manager(permission);
      for (const roles of [
        ["system.super-admin"],
        [reservedRole],
        [customRole, reservedRole],
      ]) {
        for (const status of ["pending", "sent"] as const) {
          const original = await invite(roles, status);
          const response = await regenerate(original.id, bearer);
          expect(response.status).toBe(403);
          expect((await response.json()) as unknown).not.toHaveProperty(
            "token",
          );
          expect(
            (
              await db
                .select()
                .from(schema.authInvites)
                .where(eq(schema.authInvites.id, original.id))
            )[0],
          ).toEqual(original);
        }
      }
    },
  );
  it.each(PERMISSIONS)(
    "allows %s to regenerate an ordinary invite",
    async (permission) => {
      const original = await invite([customRole]);
      const response = await regenerate(original.id, await manager(permission));
      expect(response.status).toBe(200);
      const result = (await response.json()) as { token: string };
      const [updated] = await db
        .select()
        .from(schema.authInvites)
        .where(eq(schema.authInvites.id, original.id));
      expect(updated.tokenHash).toBe(await sha256Hex(result.token));
      expect(updated.tokenHash).not.toBe(original.tokenHash);
      expect(updated.roleIds).toEqual([customRole]);
    },
  );
  it("denies Super Admin regeneration of a mixed reserved-role invite", async () => {
    const original = await invite([
      customRole,
      reservedRole,
      "system.super-admin",
    ]);
    const response = await regenerate(original.id, ownerToken);
    expect(response.status).toBe(403);
    const [updated] = await db
      .select()
      .from(schema.authInvites)
      .where(eq(schema.authInvites.id, original.id));
    expect(updated).toEqual(original);
  });
  it("denies Super Admin creation of a Super Admin invite", async () => {
    const response = await app.request(
      "https://cms.example.test/api/admin/auth/invites",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: "new-owner@example.test",
          roleIds: ["system.super-admin"],
        }),
      },
      runtime,
    );
    expect(response.status).toBe(403);
    expect(await response.json()).not.toHaveProperty("token");
  });
  it("denies previously issued Super Admin invitation tokens", async () => {
    const original = await invite([customRole, "system.super-admin"]);
    for (const path of ["accept-invite/validate", "accept-invite"]) {
      const response = await app.request(
        `https://cms.example.test/api/admin/auth/${path}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token: `old-${original.id}`,
            name: "Unexpected owner",
            password: "Password123!",
          }),
        },
        runtime,
      );
      expect(response.status).toBe(403);
      expect(response.headers.has("Set-Cookie")).toBe(false);
    }
    expect(
      await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, original.email)),
    ).toEqual([]);
    expect(
      (
        await db
          .select()
          .from(schema.authInvites)
          .where(eq(schema.authInvites.id, original.id))
      )[0],
    ).toEqual(original);
  });
  it.each([...PERMISSIONS, "Super Admin"])(
    "denies %s creation and sending of reserved-role invitations",
    async (permission) => {
      const bearer = await actorToken(permission);
      for (const roles of [
        ["system.super-admin"],
        [reservedRole],
        [customRole, "system.super-admin"],
      ]) {
        const original = await invite(roles);
        const create = await jsonRequest(
          "invites",
          { email: `${crypto.randomUUID()}@example.test`, roleIds: roles },
          bearer,
        );
        expect(create.status).toBe(403);
        const send = await app.request(
          `https://cms.example.test/api/admin/auth/invites/${original.id}/send`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${bearer}` },
          },
          runtime,
        );
        expect(send.status).toBe(403);
        expect(
          (
            await db
              .select()
              .from(schema.authInvites)
              .where(eq(schema.authInvites.id, original.id))
          )[0],
        ).toEqual(original);
      }
    },
  );
  it.each([...PERMISSIONS, "Super Admin"])(
    "allows %s to choose, create, regenerate, send and accept a user-defined role",
    async (permission) => {
      const bearer = await actorToken(permission);
      const roleName =
        permission === "users:invite:write" ? "Admin" : `Admin ${customRole}`;
      await db
        .update(schema.roles)
        .set({ name: roleName, permissions: { allow: ["*"] } })
        .where(eq(schema.roles.id, customRole));
      const options = await app.request(
        "https://cms.example.test/api/admin/auth/invites/role-options",
        {
          headers: { Authorization: `Bearer ${bearer}` },
        },
        runtime,
      );
      expect(options.status).toBe(200);
      const body = (await options.json()) as {
        items: Record<string, unknown>[];
      };
      expect(body.items).toContainEqual({
        id: customRole,
        name: roleName,
        description: null,
        isSystem: false,
      });
      expect(
        body.items.some(
          (role) => role.id === "system.super-admin" || role.isSystem,
        ),
      ).toBe(false);
      expect(
        body.items.every((role) => !Object.hasOwn(role, "permissions")),
      ).toBe(true);
      if (permission === "users:invite:write") {
        const roles = await app.request(
          "https://cms.example.test/api/admin/roles",
          { headers: { Authorization: `Bearer ${bearer}` } },
          runtime,
        );
        expect(roles.status).toBe(403);
      }
      const email = `${crypto.randomUUID()}@example.test`;
      const created = await jsonRequest(
        "invites",
        { email, roleIds: [customRole] },
        bearer,
      );
      expect(created.status).toBe(201);
      const { inviteId } = (await created.json()) as { inviteId: string };
      const regenerated = await regenerate(inviteId, bearer);
      expect(regenerated.status).toBe(200);
      const { token: inviteToken } = (await regenerated.json()) as {
        token: string;
      };
      await db
        .insert(schema.settings)
        .values({
          key: "email_settings",
          value: {
            senderName: "CMS",
            invitesEnabled: true,
            passwordResetEnabled: false,
          },
        })
        .onConflictDoUpdate({
          target: schema.settings.key,
          set: {
            value: {
              senderName: "CMS",
              invitesEnabled: true,
              passwordResetEnabled: false,
            },
          },
        });
      const send = vi.fn(async () => ({ messageId: "test-only-message" }));
      const sent = await app.request(
        `https://cms.example.test/api/admin/auth/invites/${inviteId}/send`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${bearer}` },
        },
        {
          ...runtime,
          AUTH_EMAIL_FROM: "no-reply@example.test",
          AUTH_EMAIL_BASE_URL: "https://cms.example.test",
          EMAIL_SENDER: { send },
        },
      );
      expect(sent.status).toBe(200);
      expect(send).toHaveBeenCalledTimes(1);
      expect(
        (await jsonRequest("accept-invite/validate", { token: inviteToken }))
          .status,
      ).toBe(200);
      const accepted = await jsonRequest("accept-invite", {
        token: inviteToken,
        name: "New admin",
        password: "Password123!",
      });
      expect(accepted.status).toBe(200);
      expect(await accepted.json()).toMatchObject({
        user: { email, roleId: [customRole] },
      });
    },
  );
  it("rejects the canonical Super Admin even if its system flag is false", async () => {
    await db
      .update(schema.roles)
      .set({ isSystem: false })
      .where(eq(schema.roles.id, "system.super-admin"));
    try {
      const original = await invite(["system.super-admin"]);
      expect((await regenerate(original.id, ownerToken)).status).toBe(403);
      expect(
        (
          await jsonRequest(
            "invites",
            {
              email: "bad-owner@example.test",
              roleIds: [" system.super-admin "],
            },
            ownerToken,
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await jsonRequest("accept-invite", {
            token: `old-${original.id}`,
            name: "Owner",
            password: "Password123!",
          })
        ).status,
      ).toBe(403);
    } finally {
      await db
        .update(schema.roles)
        .set({ isSystem: true })
        .where(eq(schema.roles.id, "system.super-admin"));
    }
  });
  it("denies invitation access without an invitation permission", async () => {
    const bearer = await manager("entries:*:read");
    expect(
      (
        await app.request(
          "https://cms.example.test/api/admin/auth/invites/role-options",
          { headers: { Authorization: `Bearer ${bearer}` } },
          runtime,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await jsonRequest(
          "invites",
          { email: "blocked@example.test", roleIds: [customRole] },
          bearer,
        )
      ).status,
    ).toBe(403);
  });
  it("rejects direct delivery and consumption of a prohibited invitation", async () => {
    const original = await invite(["system.super-admin"]);
    await expect(deliverInvite(runtime, original)).rejects.toThrow(
      InviteRoleAssignmentError,
    );
    await expect(
      consumeInvite(
        {
          invitesRepo: createAuthInvitesRepository(db),
          rolesRepo: createRoleRepository(db),
          usersRepo: createUserRepository(db),
          authRepo: createAuthRepository(db),
          now: () => new Date(),
          generateId: () => crypto.randomUUID(),
          randomToken: () => "unused",
          hashToken: sha256Hex,
          hashPassword: async (value) => value,
        },
        {
          token: `old-${original.id}`,
          name: "Owner",
          password: "Password123!",
        },
      ),
    ).rejects.toThrow(InviteRoleAssignmentError);
    expect(
      await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, original.email)),
    ).toEqual([]);
  });
  it("allows a non-system role with a system-prefixed legacy ID", async () => {
    const roleId = `system.editor.${crypto.randomUUID()}`;
    await db.insert(schema.roles).values({
      id: roleId,
      name: "Legacy editor",
      permissions: { allow: [] },
      isSystem: false,
    });
    const original = await invite([roleId]);
    const response = await regenerate(
      original.id,
      await manager("users:invite:write"),
    );
    expect(response.status).toBe(200);
  });
  it("rejects reserved roles before a service caller generates a token", async () => {
    const original = await invite(["system.super-admin"]);
    const randomToken = vi.fn(() => "new-token");
    await expect(
      regenerateInvite(
        {
          invitesRepo: createAuthInvitesRepository(db),
          rolesRepo: createRoleRepository(db),
          usersRepo: createUserRepository(db),
          authRepo: createAuthRepository(db),
          now: () => new Date(),
          generateId: () => crypto.randomUUID(),
          randomToken,
          hashToken: sha256Hex,
          hashPassword: async (value) => value,
        },
        original.id,
        ownerId,
      ),
    ).rejects.toThrow(InviteRoleAssignmentError);
    expect(randomToken).not.toHaveBeenCalled();
    expect(
      (
        await db
          .select()
          .from(schema.authInvites)
          .where(eq(schema.authInvites.id, original.id))
      )[0],
    ).toEqual(original);
  });
  it("preserves the missing and consumed invitation responses", async () => {
    expect((await regenerate(crypto.randomUUID(), ownerToken)).status).toBe(
      404,
    );
    const original = await invite([customRole]);
    await db
      .update(schema.authInvites)
      .set({ status: "consumed" })
      .where(eq(schema.authInvites.id, original.id));
    expect((await regenerate(original.id, ownerToken)).status).toBe(410);
  });
});
