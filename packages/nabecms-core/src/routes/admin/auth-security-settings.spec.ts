import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "./_authz";

const routeMocks = vi.hoisted(() => ({
  actor: { id: "user_1", roleIds: [] as string[] },
  repo: {
    findByKey: vi.fn(),
    upsert: vi.fn(),
  },
  insertValues: vi.fn(),
}));

vi.mock("./_authz", async () => {
  const actual = await vi.importActual<typeof import("./_authz")>("./_authz");
  return {
    ...actual,
    requireActor: vi.fn(async () => routeMocks.actor),
  };
});

vi.mock("../../repositories/settings", () => ({
  createSettingsRepository: vi.fn(() => routeMocks.repo),
}));

vi.mock("drizzle-orm/d1", () => ({
  drizzle: vi.fn(() => ({
    insert: vi.fn(() => ({ values: routeMocks.insertValues })),
  })),
}));

import app from "./auth-security-settings";

const createEnv = (
  overrides: Record<string, string | undefined> = {},
): Record<string, unknown> => ({
  DB: {},
  WORKER_ENV: "test",
  TURNSTILE_SITE_KEY: undefined,
  TURNSTILE_SECRET_KEY: undefined,
  ...overrides,
});

const setActor = (actor: Actor): void => {
  routeMocks.actor = actor;
};

describe("admin auth security settings route", () => {
  beforeEach(() => {
    routeMocks.actor = { id: "user_1", roleIds: [] };
    routeMocks.repo.findByKey.mockReset();
    routeMocks.repo.upsert.mockReset();
    routeMocks.insertValues.mockReset();
  });

  it("returns settings with editable=false for non-super-admin actors", async () => {
    setActor({ id: "user_1", roleIds: ["role_admin"] });
    routeMocks.repo.findByKey.mockResolvedValue(null);

    const res = await app.request(
      "/api/admin/settings/auth-security",
      {},
      createEnv({ TURNSTILE_SITE_KEY: "site-key" }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      item: { turnstile: { enabled: false } },
      env: {
        siteKeyConfigured: true,
        secretKeyConfigured: false,
        canEnable: false,
      },
      editable: false,
    });
  });

  it("rejects updates from wildcard-only non-super-admin actors", async () => {
    setActor({
      id: "user_1",
      roleIds: ["role-with-wildcard-permissions"],
    });

    const res = await app.request(
      "/api/admin/settings/auth-security",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turnstile: { enabled: true } }),
      },
      createEnv({
        TURNSTILE_SITE_KEY: "site-key",
        TURNSTILE_SECRET_KEY: "secret-key",
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error?.code).toBe("FORBIDDEN");
    expect(routeMocks.repo.upsert).not.toHaveBeenCalled();
  });

  it("rejects enabling Turnstile when env variables are missing", async () => {
    setActor({
      id: "user_1",
      roleIds: ["system.super-admin"],
    });

    const res = await app.request(
      "/api/admin/settings/auth-security",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turnstile: { enabled: true } }),
      },
      createEnv({ TURNSTILE_SITE_KEY: "site-key" }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error?.code).toBe("TURNSTILE_ENV_MISSING");
    expect(body.error?.missing).toEqual(["TURNSTILE_SECRET_KEY"]);
    expect(routeMocks.repo.upsert).not.toHaveBeenCalled();
  });

  it("stores Turnstile settings for super-admin actors", async () => {
    setActor({
      id: "user_1",
      roleIds: ["system.super-admin"],
    });
    routeMocks.insertValues.mockResolvedValue(undefined);

    const res = await app.request(
      "/api/admin/settings/auth-security",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turnstile: { enabled: true } }),
      },
      createEnv({
        TURNSTILE_SITE_KEY: "site-key",
        TURNSTILE_SECRET_KEY: "secret-key",
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.item).toEqual({ turnstile: { enabled: true } });
    expect(routeMocks.repo.upsert).toHaveBeenCalledWith(
      "auth_security_settings",
      { turnstile: { enabled: true } },
      expect.any(String),
    );
    expect(routeMocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_1",
        action: "update",
        targetTable: "settings",
        targetId: "auth_security_settings",
        after: null,
      }),
    );
  });
});
