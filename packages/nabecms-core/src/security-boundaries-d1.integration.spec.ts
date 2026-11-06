/// <reference types="@cloudflare/vitest-plugin/types" />

import { applyD1Migrations, env, type D1Migration } from "cloudflare:test";
import bcrypt from "bcryptjs";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./create-app";
import * as schema from "./database/schema";
import { createAccessToken, ensureJwtSecret, sha256Hex } from "./lib/auth";
import type { Env } from "./types";
import { createUserRepository } from "./repositories/users";

const ORIGIN = "https://cms.example.test";
const PASSWORD = "SecurityTest123!";
const LEGITIMATE_LOGIN_HEADERS: Record<string, string>[] = [
  {},
  { Origin: ORIGIN },
  { "Sec-Fetch-Site": "same-origin" },
];
const bindings = env as unknown as Env & { TEST_MIGRATIONS: D1Migration[] };
const testEnv = {
  ...bindings,
  BETTER_AUTH_URL: undefined,
  BETTER_AUTH_SECRET: undefined,
  WORKER_ENV: "test" as const,
};
const app = createApp();
const db = drizzle(bindings.DB, { schema });
type PreparedStatement = ReturnType<Env["DB"]["prepare"]>;

let ownerId: string;
let ownerEmail: string;
let ownerToken: string;
let managerToken: string;
let managerId: string;
let publicModel: string;
let privateModel: string;
let publicEntry: string;
let privateEntry: string;
let apiKey: string;
let mediaField: string;
let mediaId: string;

const request = (path: string, init?: RequestInit) =>
  app.request(new URL(path, ORIGIN).toString(), init, testEnv);

async function userSnapshot(userId: string) {
  return {
    user: await createUserRepository(db).findById(userId),
    roles: await createUserRepository(db).listRoleIdsByUserId(userId),
    accounts: await db
      .select()
      .from(schema.authAccounts)
      .where(eq(schema.authAccounts.userId, userId)),
    sessions: await db
      .select()
      .from(schema.authSessions)
      .where(eq(schema.authSessions.userId, userId)),
  };
}

/** Interleave a completed HTTP promotion immediately before the real D1 write. */
async function requestAcrossPromotion(init: RequestInit) {
  const delegate = bindings.DB;
  let promoted = false;
  let afterPromotion: Awaited<ReturnType<typeof userSnapshot>> | undefined;
  const promote = async () => {
    if (promoted) return;
    promoted = true;
    const response = await request(`/api/admin/users/${managerId}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ roleIds: ["system.super-admin"] }),
    });
    expect(response.status).toBe(200);
    afterPromotion = await userSnapshot(managerId);
  };
  const wrapDelete = (statement: PreparedStatement): PreparedStatement =>
    new Proxy(statement, {
      get(target, property) {
        if (property === "bind")
          return (...values: unknown[]) => wrapDelete(target.bind(...values));
        const value = Reflect.get(target, property, target);
        if (typeof value !== "function") return value;
        if (property === "all" || property === "run" || property === "raw") {
          return async (...args: unknown[]) => {
            await promote();
            return value.apply(target, args);
          };
        }
        return value.bind(target);
      },
    });
  const intercepted = {
    prepare: (query: string) =>
      /^\s*delete\s+from\s+"users"\s/iu.test(query)
        ? wrapDelete(delegate.prepare(query))
        : delegate.prepare(query),
    batch: async (statements: PreparedStatement[]) => {
      await promote();
      return delegate.batch(statements);
    },
    exec: (query: string) => delegate.exec(query),
    dump: () => delegate.dump(),
  } as unknown as Env["DB"];
  const raceApp = createApp({
    config: { database: { migrations: { enabled: false } } },
  });
  const response = await raceApp.request(
    new URL(`/api/admin/users/${managerId}`, ORIGIN).toString(),
    init,
    { ...testEnv, DB: intercepted },
  );
  expect(promoted).toBe(true);
  expect(await userSnapshot(managerId)).toEqual(afterPromotion);
  return response;
}

async function accessToken(userId: string, roles: string[]): Promise<string> {
  const sessionId = crypto.randomUUID();
  await db.insert(schema.authSessions).values({
    id: sessionId,
    userId,
    token: crypto.randomUUID(),
    expiresAt: new Date(Date.now() + 60_000),
  });
  return createAccessToken(ensureJwtSecret(testEnv), {
    sub: userId,
    email: `${userId}@example.test`,
    roles,
    sid: sessionId,
  });
}

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
  await db
    .insert(schema.locales)
    .values({ code: "en-US", isDefault: true })
    .onConflictDoNothing();
});

beforeEach(async () => {
  const suffix = crypto.randomUUID();
  ownerId = `owner_${suffix}`;
  ownerEmail = `${ownerId}@example.test`;
  managerId = `manager_${suffix}`;
  const managerRole = `manager_role_${suffix}`;
  publicModel = `public_${suffix}`;
  privateModel = `private_${suffix}`;
  publicEntry = `public_entry_${suffix}`;
  privateEntry = `private_entry_${suffix}`;
  apiKey = crypto.randomUUID();
  const keyHash = await sha256Hex(apiKey);

  await db.insert(schema.roles).values({
    id: managerRole,
    name: managerRole,
    permissions: { allow: ["users:*:write"] },
  });
  await db.insert(schema.users).values([
    {
      id: ownerId,
      email: ownerEmail,
      name: "Owner",
      roleId: ["system.super-admin"],
    },
    {
      id: managerId,
      email: `${managerId}@example.test`,
      name: "User manager",
      roleId: [managerRole],
    },
  ]);
  await db.insert(schema.userRoles).values([
    { userId: ownerId, roleId: "system.super-admin" },
    { userId: managerId, roleId: managerRole },
  ]);
  await db.insert(schema.authAccounts).values({
    id: `account_${suffix}`,
    userId: ownerId,
    providerId: "credential",
    accountId: ownerId,
    password: await bcrypt.hash(PASSWORD, 4),
  });
  ownerToken = await accessToken(ownerId, ["system.super-admin"]);
  managerToken = await accessToken(managerId, [managerRole]);
  await db.insert(schema.apiKeys).values({
    id: `key_${suffix}`,
    key: keyHash,
    keyHash,
    name: "Published content reader",
    permissions: ["contents:read"],
  });
  await db.insert(schema.models).values([
    { id: publicModel, name: publicModel },
    { id: privateModel, name: privateModel, isPrivate: true },
  ]);
  const publicField = `public_title_${suffix}`;
  const privateField = `private_body_${suffix}`;
  mediaField = `private_media_${suffix}`;
  const relationField = `related_${suffix}`;
  const fieldDefaults = {
    type: "text" as const,
    position: 0,
    required: false,
    hasLocales: true,
  };
  await db.insert(schema.modelFields).values([
    {
      ...fieldDefaults,
      id: publicField,
      modelId: publicModel,
      name: "Title",
      fieldKey: "title",
    },
    {
      ...fieldDefaults,
      id: privateField,
      modelId: privateModel,
      name: "Body",
      fieldKey: "body",
    },
    {
      ...fieldDefaults,
      id: mediaField,
      modelId: publicModel,
      name: "Internal attachment",
      fieldKey: "internalAttachment",
      type: "media",
      isPrivate: true,
    },
    {
      ...fieldDefaults,
      id: relationField,
      modelId: publicModel,
      name: "Related",
      fieldKey: "related",
      type: "relation",
    },
  ]);
  await db.insert(schema.entries).values([
    {
      id: publicEntry,
      modelId: publicModel,
      status: "published",
      updatedBy: ownerId,
    },
    {
      id: privateEntry,
      modelId: privateModel,
      status: "published",
      updatedBy: ownerId,
    },
  ]);
  mediaId = `media_${suffix}`;
  await db.insert(schema.media).values({
    id: mediaId,
    groupId: mediaId,
    url: `internal/${suffix}.png`,
    type: "image",
    mimeType: "image/png",
    name: "Internal attachment.png",
    description: "Private field attachment metadata",
    size: 8,
    status: "published",
    updatedBy: ownerId,
  });
  await db.insert(schema.entryFields).values([
    {
      id: `value_public_${suffix}`,
      entryId: publicEntry,
      fieldId: publicField,
      locale: "en-US",
      valueString: "Public title",
    },
    {
      id: `value_private_${suffix}`,
      entryId: privateEntry,
      fieldId: privateField,
      locale: "en-US",
      valueString: "CONFIDENTIAL_CONTENT",
    },
    {
      id: `value_media_${suffix}`,
      entryId: publicEntry,
      fieldId: mediaField,
      locale: "en-US",
      valueMedia: mediaId,
    },
    {
      id: `value_relation_${suffix}`,
      entryId: publicEntry,
      fieldId: relationField,
      locale: "en-US",
      valueRelation: { type: "one", entryIds: [privateEntry] },
    },
  ]);
});

describe("security boundaries against real D1", () => {
  it.each([
    { password: "Replacement123!" },
    { email: "gap-replacement@example.test" },
    { name: "Replacement" },
  ])(
    "protects the Super Admin projection during a role binding gap: %j",
    async (change) => {
      // Reproduce the observable state between the old DELETE and INSERT calls.
      await db
        .delete(schema.userRoles)
        .where(eq(schema.userRoles.userId, ownerId));
      const before = await db
        .select()
        .from(schema.authAccounts)
        .where(eq(schema.authAccounts.userId, ownerId));
      const sessions = await db
        .select()
        .from(schema.authSessions)
        .where(eq(schema.authSessions.userId, ownerId));
      const response = await request(`/api/admin/users/${ownerId}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${managerToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(change),
      });
      expect(response.status).toBe("password" in change ? 400 : 403);
      const [owner] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, ownerId));
      expect(owner).toMatchObject({
        email: ownerEmail,
        name: "Owner",
        roleId: ["system.super-admin"],
      });
      expect(
        await db
          .select()
          .from(schema.authAccounts)
          .where(eq(schema.authAccounts.userId, ownerId)),
      ).toEqual(before);
      expect(
        await db
          .select()
          .from(schema.authSessions)
          .where(eq(schema.authSessions.userId, ownerId)),
      ).toEqual(sessions);
    },
  );

  it("rejects deletion of a Super Admin with missing role bindings", async () => {
    await db
      .delete(schema.userRoles)
      .where(eq(schema.userRoles.userId, ownerId));
    const response = await request(`/api/admin/users/${ownerId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    expect(response.status).toBe(400);
    expect(await createUserRepository(db).findById(ownerId)).not.toBeNull();
  });

  it.each([
    { name: "Updated owner" },
    { email: "self-updated-owner@example.test" },
  ])(
    "allows the Super Admin's profile update while only the projection protects them: %j",
    async (change) => {
      await db
        .delete(schema.userRoles)
        .where(eq(schema.userRoles.userId, ownerId));
      const before = await userSnapshot(ownerId);
      const response = await request(`/api/admin/users/${ownerId}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(change),
      });
      expect(response.status).toBe(200);
      const after = await userSnapshot(ownerId);
      expect(after.user).toMatchObject({
        ...change,
        roleId: ["system.super-admin"],
      });
      expect(after.roles).toEqual([]);
      expect(after.accounts).toEqual(before.accounts);
    },
  );

  it("replaces a large role set and its projection atomically", async () => {
    const ids = Array.from(
      { length: 34 },
      (_, index) => `${ownerId}_role_${index}`,
    );
    await db
      .insert(schema.roles)
      .values(
        ids
          .slice(0, 15)
          .map((id) => ({ id, name: id, permissions: { allow: [] } })),
      );
    await db
      .insert(schema.roles)
      .values(
        ids
          .slice(15, 30)
          .map((id) => ({ id, name: id, permissions: { allow: [] } })),
      );
    await db
      .insert(schema.roles)
      .values(
        ids
          .slice(30)
          .map((id) => ({ id, name: id, permissions: { allow: [] } })),
      );
    const roles = ["system.super-admin", ...ids];
    const repo = createUserRepository(db);
    await repo.replaceRoleIds(ownerId, roles, new Date().toISOString());
    expect((await repo.listRoleIdsByUserId(ownerId)).toSorted()).toEqual(
      roles.toSorted(),
    );
    expect((await repo.findById(ownerId))?.roleId).toEqual(roles);
    const response = await request(`/api/admin/users/${ownerId}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ roleIds: roles }),
    });
    expect(response.status).toBe(200);
    expect((await repo.listRoleIdsByUserId(ownerId)).toSorted()).toEqual(
      roles.toSorted(),
    );
    expect((await repo.findById(ownerId))?.roleId).toEqual(roles);
    expect((await userSnapshot(ownerId)).sessions).toEqual([]);
  });

  it("rolls back role bindings and their projection when replacement fails", async () => {
    const repo = createUserRepository(db);
    const [before] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, ownerId));
    await expect(
      repo.replaceRoleIds(
        ownerId,
        ["system.super-admin", "missing-role"],
        new Date().toISOString(),
      ),
    ).rejects.toThrow();
    expect(await repo.listRoleIdsByUserId(ownerId)).toEqual([
      "system.super-admin",
    ]);
    expect(await repo.findById(ownerId)).toEqual(before);
  });

  it("preserves a legitimate Super Admin role save", async () => {
    const response = await request(`/api/admin/users/${ownerId}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Updated owner",
        roleIds: ["system.super-admin"],
      }),
    });
    expect(response.status).toBe(200);
    const repo = createUserRepository(db);
    expect(await repo.listRoleIdsByUserId(ownerId)).toEqual([
      "system.super-admin",
    ]);
    expect(await repo.findById(ownerId)).toMatchObject({
      name: "Updated owner",
      roleId: ["system.super-admin"],
    });
  });

  it.each([
    { password: "Replacement123!" },
    { email: "replacement@example.test" },
    { name: "Replacement" },
  ])(
    "rejects a user manager changing Super Admin credentials: %j",
    async (change) => {
      const response = await request(`/api/admin/users/${ownerId}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${managerToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(change),
      });
      expect(response.status).toBe("password" in change ? 400 : 403);
      const [owner] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, ownerId));
      expect(owner.email).toBe(ownerEmail);
      expect(owner.name).toBe("Owner");
      const [account] = await db
        .select()
        .from(schema.authAccounts)
        .where(eq(schema.authAccounts.userId, ownerId));
      expect(await bcrypt.compare(PASSWORD, account.password!)).toBe(true);
    },
  );

  it.each([false, true])(
    "does not expose private models through query, preview=%s",
    async (draft) => {
      await db
        .update(schema.apiKeys)
        .set({
          permissions: ["contents:read", "contents:preview"],
          allowedModels: [privateModel],
        })
        .where(eq(schema.apiKeys.keyHash, await sha256Hex(apiKey)));
      const response = await request("/api/contents/query", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ modelId: privateModel, draft }),
      });
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain("CONFIDENTIAL_CONTENT");
    },
  );

  it.each(["", "/entries", "/entries/ENTRY"])(
    "does not deliver a private model through %s",
    async (endpoint) => {
      const response = await request(
        `/api/contents/models/${privateModel}${endpoint.replace("ENTRY", privateEntry)}`,
        { headers: { Authorization: `Bearer ${apiKey}` } },
      );
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain("CONFIDENTIAL_CONTENT");
    },
  );

  it("does not side-load entries belonging to private models", async () => {
    const response = await request(
      `/api/contents/models/${publicModel}/entries/${publicEntry}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      included: { entries: unknown[] };
    };
    expect(body.included.entries).toEqual([]);
    expect(JSON.stringify(body)).not.toContain("CONFIDENTIAL_CONTENT");
  });

  it.each(["single", "multiple"])(
    "does not include assets referenced only by private %s media fields",
    async (variant) => {
      if (variant === "multiple") {
        await db
          .update(schema.modelFields)
          .set({ variant })
          .where(eq(schema.modelFields.id, mediaField));
        await db
          .update(schema.entryFields)
          .set({ valueMedia: null, valueJson: [mediaId] })
          .where(eq(schema.entryFields.fieldId, mediaField));
      }
      const response = await request(
        `/api/contents/models/${publicModel}/entries/${publicEntry}?include=media`,
        { headers: { Authorization: `Bearer ${apiKey}` } },
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        included: { assets: unknown[] };
      };
      expect(body.included.assets).toEqual([]);
      expect(JSON.stringify(body)).not.toContain(
        "Private field attachment metadata",
      );
    },
  );

  it("does not retain Rich Text references to private model entries", async () => {
    const fieldId = crypto.randomUUID();
    await db.insert(schema.modelFields).values({
      id: fieldId,
      modelId: publicModel,
      name: "Body",
      fieldKey: "body",
      type: "rich_text",
      position: 1,
      required: false,
      hasLocales: true,
    });
    await db.insert(schema.entryFields).values({
      id: crypto.randomUUID(),
      entryId: publicEntry,
      fieldId,
      locale: "en-US",
      valueJson: {
        type: "doc",
        content: [{ type: "entryReference", attrs: { entryId: privateEntry } }],
      },
    });
    const response = await request(
      `/api/contents/models/${publicModel}/entries/${publicEntry}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
      },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      item: { fields: { body: unknown } };
    };
    expect(JSON.stringify(body.item.fields.body)).not.toContain(privateEntry);
  });

  it("rejects cross-origin simple requests to the compatibility login", async () => {
    const response = await request("/api/admin/auth/login", {
      method: "POST",
      headers: {
        Origin: "https://attacker.example",
        "Content-Type": "text/plain",
      },
      body: JSON.stringify({ email: ownerEmail, password: PASSWORD }),
    });
    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it.each(["refresh", "logout", "session-token"])(
    "rejects cross-site Cookie authentication requests to %s",
    async (endpoint) => {
      const response = await request(`/api/admin/auth/${endpoint}`, {
        method: "POST",
        headers: { "Sec-Fetch-Site": "cross-site" },
      });
      expect(response.status).toBe(403);
      expect(response.headers.get("set-cookie")).toBeNull();
    },
  );

  it.each([
    "[__proto__]",
    "[nested][__proto__]",
    "[constructor][prototype]",
    "[nested][0][__proto__]",
    "[__pr%6fto__]",
  ])(
    "rejects prototype path %s without altering later objects",
    async (path) => {
      const prototype = Object.prototype as Record<string, unknown>;
      try {
        const response = await request(
          `/api/contents/models/${publicModel}/entries?filters${path}[securityAuditMarker]=poisoned`,
          { headers: { Authorization: `Bearer ${apiKey}` } },
        );
        expect(
          ({} as Record<string, unknown>).securityAuditMarker,
        ).toBeUndefined();
        expect(response.status).toBe(422);
      } finally {
        delete prototype.securityAuditMarker;
      }
    },
  );

  it.each(LEGITIMATE_LOGIN_HEADERS)(
    "allows legitimate compatibility logins with %j",
    async (headers) => {
      const response = await request("/api/admin/auth/login", {
        method: "POST",
        headers: { ...headers, "Content-Type": "text/plain" },
        body: JSON.stringify({ email: ownerEmail, password: PASSWORD }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("set-cookie")).toContain("__Host.refresh=");
    },
  );

  it("allows user managers to modify ordinary users", async () => {
    const response = await request(`/api/admin/users/${managerId}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${managerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "Updated user manager" }),
    });
    expect(response.status).toBe(200);
  });

  it("still includes media referenced by public fields", async () => {
    await db
      .update(schema.modelFields)
      .set({ isPrivate: false })
      .where(eq(schema.modelFields.id, mediaField));
    const response = await request(
      `/api/contents/models/${publicModel}/entries/${publicEntry}?include=media`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
      },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      included: { assets: { id: string }[] };
    };
    expect(body.included.assets.map((asset) => asset.id)).toContain(mediaId);
  });

  it.each(["owner", "manager"])(
    "rejects direct password replacement by %s without partial updates",
    async (actor) => {
      const before = await userSnapshot(ownerId);
      const response = await request(`/api/admin/users/${ownerId}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${actor === "owner" ? ownerToken : managerToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Must not save",
          password: "OwnerReplacement123!",
        }),
      });
      expect(response.status).toBe(400);
      expect(await userSnapshot(ownerId)).toEqual(before);
    },
  );

  it.each(["manager-profile", "manager-roles", "owner-roles"])(
    "protects a newly promoted target against a stale %s save",
    async (operation) => {
      const roles =
        await createUserRepository(db).listRoleIdsByUserId(managerId);
      const response = await requestAcrossPromotion({
        method: "PUT",
        headers: {
          Authorization: `Bearer ${operation === "owner-roles" ? ownerToken : managerToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Must not save",
          ...(operation === "manager-profile" ? {} : { roleIds: roles }),
        }),
      });
      expect(response.status).toBe(operation === "owner-roles" ? 400 : 403);
    },
  );

  it.each(["owner", "manager"])(
    "rejects an ordinary user's reset email being changed by %s",
    async (actor) => {
      const targetId = `target_${crypto.randomUUID()}`;
      const roles =
        await createUserRepository(db).listRoleIdsByUserId(managerId);
      await db.insert(schema.users).values({
        id: targetId,
        name: "Target",
        email: `${targetId}@example.test`,
        roleId: roles,
      });
      await db
        .insert(schema.userRoles)
        .values({ userId: targetId, roleId: roles[0] });
      await accessToken(targetId, roles);
      const before = await userSnapshot(targetId);
      const response = await request(`/api/admin/users/${targetId}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${actor === "owner" ? ownerToken : managerToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Must not save",
          email: "replacement@example.test",
          roleIds: roles,
        }),
      });
      expect(response.status).toBe(403);
      expect(await userSnapshot(targetId)).toEqual(before);
    },
  );

  it("allows only the user's own email change and invalidates their old session", async () => {
    const before = await userSnapshot(managerId);
    const response = await request(`/api/admin/users/${managerId}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${managerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: "self-changed@example.test" }),
    });
    expect(response.status).toBe(200);
    const after = await userSnapshot(managerId);
    expect(after.user?.email).toBe("self-changed@example.test");
    expect(after.accounts).toEqual(before.accounts);
    expect(after.roles).toEqual(before.roles);
    expect(after.sessions).toEqual([]);
    const oldSession = await request("/api/admin/users", {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    expect(oldSession.status).toBe(401);
  });

  it("protects a newly promoted target against a stale deletion", async () => {
    const response = await requestAcrossPromotion({
      method: "DELETE",
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(response.status).toBe(400);
  });

  it("rolls back the profile, roles and sessions together when a managed update fails", async () => {
    const before = await userSnapshot(managerId);
    await expect(
      createUserRepository(db).updateManagedUser(managerId, {
        values: { name: "Must not save" },
        roleIds: ["missing-role"],
        updatedAt: new Date().toISOString(),
        canModifySystemUser: true,
        revokeSessions: true,
      }),
    ).rejects.toThrow();
    expect(await userSnapshot(managerId)).toEqual(before);
  });
});
