/// <reference types="@cloudflare/vitest-plugin/types" />
import { applyD1Migrations, env, type D1Migration } from "cloudflare:test";
import { beforeEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "./create-app";
import type { Env } from "./types";
import { emailEnvironment } from "./services/email-settings";

const bindings = env as unknown as Env & { TEST_MIGRATIONS: D1Migration[] };
const messages: { to: string; text: string; from: unknown }[] = [];
let fail = false;
const send = vi.fn(async (message) => {
  if (fail) throw new Error("sensitive-provider-error");
  messages.push(message);
  return { messageId: "test-message" };
});
const runtime: Env = {
  ...bindings,
  BETTER_AUTH_SECRET: undefined,
  BETTER_AUTH_URL: undefined,
  WORKER_ENV: "test",
  AUTH_EMAIL_FROM: "no-reply@example.com",
  AUTH_EMAIL_BASE_URL: "https://cms.example.com",
  EMAIL_SENDER: { send },
  AUTH_SENSITIVE_RATE_LIMITER: { limit: async () => ({ success: true }) },
};
const app = createApp({
  config: { database: { migrations: { enabled: false } } },
});
let bearer = "";
const request = (
  path: string,
  method = "GET",
  body?: unknown,
  authorized = true,
  currentEnv = runtime,
) =>
  app.request(
    path,
    {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(authorized ? { Authorization: `Bearer ${bearer}` } : {}),
        "X-Nabecms-Bootstrap-Secret": bindings.BOOTSTRAP_SECRET!,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    currentEnv,
  );
const policy = {
  senderName: "Example CMS",
  invitesEnabled: true,
  passwordResetEnabled: true,
};
const tokenFrom = (text: string) =>
  new URL(text.match(/https:\/\/[^\s]+/u)![0]).searchParams.get("token")!;

beforeEach(() => {
  fail = false;
});
beforeAll(async () => {
  await applyD1Migrations(
    bindings.DB as Parameters<typeof applyD1Migrations>[0],
    bindings.TEST_MIGRATIONS,
  );
  const init = await request(
    "/api/admin/auth/initialize",
    "POST",
    {
      email: "owner@example.com",
      password: "OwnerPassword123",
      name: "Owner",
      defaultLocale: "ja",
    },
    false,
  );
  expect(init.status).toBe(201);
  const login = await request(
    "/api/admin/auth/login",
    "POST",
    { email: "owner@example.com", password: "OwnerPassword123" },
    false,
  );
  expect(login.status).toBe(200);
  bearer = (await login.json()).accessToken;
  await (bindings.DB as Parameters<typeof applyD1Migrations>[0])
    .prepare(
      "INSERT INTO roles (id, name, permissions, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(
      "system.editor",
      "Editor",
      JSON.stringify({ allow: ["entries:*:read"] }),
      new Date().toISOString(),
      new Date().toISOString(),
    )
    .run();
});

describe("authentication email with real D1", () => {
  it("defaults off, blocks unauthenticated settings and rejects missing environment", async () => {
    expect(
      (await request("/api/admin/settings/email", "GET", undefined, false))
        .status,
    ).toBe(401);
    expect(
      await (
        await request(
          "/api/admin/auth/email-capabilities",
          "GET",
          undefined,
          false,
        )
      ).json(),
    ).toEqual({ invitesEnabled: false, passwordResetEnabled: false });
    expect(
      (
        await request("/api/admin/settings/email", "PUT", policy, true, {
          ...runtime,
          EMAIL_SENDER: undefined,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/api/admin/settings/email", "PUT", {
          ...policy,
          from: "attacker@example.com",
        })
      ).status,
    ).toBe(400);
    expect(
      emailEnvironment({
        ...runtime,
        AUTH_EMAIL_BASE_URL: "https://attacker@example.com",
      }).configured,
    ).toBe(false);
    expect(
      emailEnvironment({
        ...runtime,
        WORKER_ENV: "production",
        AUTH_EMAIL_BASE_URL: "http://localhost:8787",
      }).configured,
    ).toBe(false);
    expect(
      (await request("/api/admin/settings/email", "PUT", policy)).status,
    ).toBe(200);
  });
  it("tests only the current admin address and stores a redacted outcome", async () => {
    expect(
      (
        await request("/api/admin/settings/email/test", "POST", {
          to: "other@example.com",
        })
      ).status,
    ).toBe(200);
    expect(messages.at(-1)?.to).toBe("owner@example.com");
    expect(messages.at(-1)?.from).toEqual({
      email: "no-reply@example.com",
      name: "Example CMS",
    });
    const settings = await (await request("/api/admin/settings/email")).json();
    expect(settings.lastDelivery).toMatchObject({
      status: "accepted",
      purpose: "test",
    });
    expect(JSON.stringify(settings)).not.toContain("owner@example.com");
  });
  it("preserves an invitation on delivery failure and resends the same token", async () => {
    fail = true;
    const response = await request("/api/admin/auth/invites", "POST", {
      email: "invitee@example.com",
      roleIds: ["system.editor"],
      sendEmail: true,
    });
    const created = await response.json();
    expect(response.status, JSON.stringify(created)).toBe(201);
    expect(created.delivery.status).toBe("failed");
    fail = false;
    const resent = await request(
      `/api/admin/auth/invites/${created.inviteId}/send`,
      "POST",
    );
    expect(resent.status).toBe(200);
    expect(tokenFrom(messages.at(-1)!.text)).toBe(created.token);
    const list = await (await request("/api/admin/auth/invites")).json();
    expect(JSON.stringify(list)).not.toContain(created.token);
    expect(JSON.stringify(list)).not.toContain("emailToken");
    expect(list.items[0].emailDelivery.status).toBe("accepted");
    const stored = await (
      bindings.DB as Parameters<typeof applyD1Migrations>[0]
    )
      .prepare("SELECT metadata FROM auth_invites WHERE id = ?")
      .bind(created.inviteId)
      .first<{ metadata: string }>();
    expect(stored!.metadata).not.toContain(created.token);
    const accept = await request(
      "/api/admin/auth/accept-invite",
      "POST",
      { token: created.token, name: "Invitee", password: "InviteePass123" },
      false,
    );
    expect(accept.status).toBe(200);
    const editor = (await accept.json()).accessToken;
    const savedBearer = bearer;
    bearer = editor;
    expect((await request("/api/admin/settings/email")).status).toBe(403);
    bearer = savedBearer;
    expect(
      (
        await request(
          `/api/admin/auth/invites/${created.inviteId}/send`,
          "POST",
        )
      ).status,
    ).toBe(409);
  });
  it("rejects expired, revoked and regenerated invitation links", async () => {
    const result = await request("/api/admin/auth/invites", "POST", {
      email: "other@example.com",
      roleIds: ["system.editor"],
    });
    const original = await result.json();
    expect(result.status).toBe(201);
    const regenerated = await (
      await request(
        `/api/admin/auth/invites/${original.inviteId}/regenerate`,
        "POST",
      )
    ).json();
    expect(regenerated.token).not.toBe(original.token);
    expect(
      (
        await request(
          "/api/admin/auth/accept-invite/validate",
          "POST",
          { token: original.token },
          false,
        )
      ).status,
    ).toBe(404);
    await request(`/api/admin/auth/invites/${original.inviteId}/send`, "POST");
    expect(tokenFrom(messages.at(-1)!.text)).toBe(regenerated.token);
    const database = bindings.DB as Parameters<typeof applyD1Migrations>[0];
    await database
      .prepare("UPDATE auth_invites SET token_expires_at = ? WHERE id = ?")
      .bind(new Date(Date.now() - 1000).toISOString(), original.inviteId)
      .run();
    const count = send.mock.calls.length;
    expect(
      (
        await request(
          `/api/admin/auth/invites/${original.inviteId}/send`,
          "POST",
        )
      ).status,
    ).toBe(409);
    await database
      .prepare(
        "UPDATE auth_invites SET status = 'revoked', token_expires_at = ? WHERE id = ?",
      )
      .bind(new Date(Date.now() + 60000).toISOString(), original.inviteId)
      .run();
    expect(
      (
        await request(
          `/api/admin/auth/invites/${original.inviteId}/send`,
          "POST",
        )
      ).status,
    ).toBe(409);
    expect(send.mock.calls.length).toBe(count);
  });
  it.each(["invited", "passwordless"])(
    "lets a %s user reset only with the emailed token after admin replacement is rejected",
    async (kind) => {
      const email = `self-reset-${kind}@example.com`;
      const originalPassword = "OriginalPassword123";
      const newPassword = "SelfChosenPassword123";
      if (kind === "passwordless") {
        const created = await request("/api/admin/users", "POST", {
          name: "Self reset user",
          email,
          roleIds: ["system.editor"],
        });
        expect(created.status).toBe(201);
      } else {
        const invite = await (
          await request("/api/admin/auth/invites", "POST", {
            email,
            roleIds: ["system.editor"],
          })
        ).json();
        const accepted = await request(
          "/api/admin/auth/accept-invite",
          "POST",
          {
            token: invite.token,
            name: "Self reset user",
            password: originalPassword,
          },
          false,
        );
        expect(accepted.status).toBe(200);
      }
      const { items } = await (await request("/api/admin/users")).json();
      const user = items.find(
        (item: { email: string }) => item.email === email,
      );
      expect(user).toBeDefined();
      const replacement = await request(`/api/admin/users/${user.id}`, "PUT", {
        name: "Must not save",
        password: "AdministratorChosen123",
      });
      expect(replacement.status).toBe(400);
      const login = await request(
        "/api/admin/auth/login",
        "POST",
        { email, password: originalPassword },
        false,
      );
      expect(login.status).toBe(kind === "invited" ? 200 : 401);
      const originalSession =
        kind === "invited" ? (await login.json()).accessToken : null;
      const resetRequest = await request(
        "/api/admin/auth/request-password-reset",
        "POST",
        { email },
        false,
      );
      expect(resetRequest.status).toBe(200);
      expect(messages.at(-1)?.to).toBe(email);
      const token = tokenFrom(messages.at(-1)!.text);
      expect(JSON.stringify(await resetRequest.json())).not.toContain(token);
      // An administrator's bearer token cannot replace the emailed one-time token.
      expect(
        (
          await request("/api/admin/auth/reset-password", "POST", {
            email,
            newPassword,
          })
        ).status,
      ).toBe(400);
      const reset = await request(
        "/api/admin/auth/reset-password",
        "POST",
        { token, newPassword },
        false,
      );
      expect(reset.status).toBe(200);
      if (originalSession)
        expect(
          (
            await app.request(
              "/api/admin/auth/me",
              { headers: { Authorization: `Bearer ${originalSession}` } },
              runtime,
            )
          ).status,
        ).toBe(401);
      expect(
        (
          await request(
            "/api/admin/auth/login",
            "POST",
            { email, password: originalPassword },
            false,
          )
        ).status,
      ).toBe(401);
      expect(
        (
          await request(
            "/api/admin/auth/login",
            "POST",
            { email, password: newPassword },
            false,
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await request(
            "/api/admin/auth/reset-password",
            "POST",
            { token, newPassword: "ReplayPassword123" },
            false,
          )
        ).status,
      ).toBe(400);
      const updated = await (await request("/api/admin/users")).json();
      expect(
        updated.items.find((item: { id: string }) => item.id === user.id).name,
      ).toBe("Self reset user");
    },
  );
  it("uses the fixed URL, conceals delivery errors and keeps previous reset tokens", async () => {
    const path = "/api/admin/auth/request-password-reset";
    const missing = await request(
      path,
      "POST",
      { email: "missing@example.com" },
      false,
    );
    expect(missing.status).toBe(200);
    const first = await request(
      path,
      "POST",
      { email: "owner@example.com", redirectTo: "https://evil.example/" },
      false,
    );
    expect(first.status).toBe(200);
    const firstToken = tokenFrom(messages.at(-1)!.text);
    expect(messages.at(-1)!.text).toContain(
      "https://cms.example.com/admin/auth/reset-password",
    );
    expect(messages.at(-1)!.text).not.toContain("evil.example");
    fail = true;
    const failed = await request(
      path,
      "POST",
      { email: "owner@example.com" },
      false,
    );
    expect(failed.status).toBe(200);
    expect(await failed.json()).toEqual(await missing.json());
    fail = false;
    await request(path, "POST", { email: "owner@example.com" }, false);
    const secondToken = tokenFrom(messages.at(-1)!.text);
    expect(secondToken).not.toBe(firstToken);
    await request("/api/admin/settings/email", "PUT", {
      ...policy,
      passwordResetEnabled: false,
    });
    expect(
      (await request(path, "POST", { email: "owner@example.com" }, false))
        .status,
    ).toBe(403);
    const reset = await request(
      "/api/admin/auth/reset-password",
      "POST",
      { token: firstToken, newPassword: "ChangedPassword123" },
      false,
    );
    expect(reset.status).toBe(200);
    expect(
      (
        await request(
          "/api/admin/auth/reset-password",
          "POST",
          { token: firstToken, newPassword: "ReplayPassword123" },
          false,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await request(
          "/api/admin/auth/reset-password",
          "POST",
          { token: secondToken, newPassword: "ReplayPassword123" },
          false,
        )
      ).status,
    ).toBe(400);
    expect((await request("/api/admin/settings/email")).status).toBe(401);
    const login = await request(
      "/api/admin/auth/login",
      "POST",
      { email: "owner@example.com", password: "ChangedPassword123" },
      false,
    );
    expect(login.status).toBe(200);
    bearer = (await login.json()).accessToken;
  });
  it("enforces rate limits before sending", async () => {
    const prior = send.mock.calls.length;
    const response = await request(
      "/api/admin/settings/email/test",
      "POST",
      {},
      true,
      {
        ...runtime,
        AUTH_SENSITIVE_RATE_LIMITER: {
          limit: async () => ({ success: false }),
        },
      },
    );
    expect(response.status).toBe(429);
    expect(send.mock.calls.length).toBe(prior);
  });
});
