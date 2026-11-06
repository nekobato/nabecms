import { beforeEach, describe, expect, it, vi } from "vitest";

const createEnv = () =>
  ({
    DB: {} as any,
    WORKER_ENV: "test",
    ASSETS: { fetch: vi.fn() },
  }) as any;

describe("admin auth session-token route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns 404 when optional Better Auth sessions are disabled", async () => {
    vi.doMock("../../../lib/better-auth", () => ({
      getBetterAuth: vi.fn(() => null),
      SsoConfigError: class SsoConfigError extends Error {},
    }));

    const { default: app } = await import("./session-token");
    const res = await app.request(
      "/api/admin/auth/session-token",
      { method: "POST" },
      createEnv(),
    );
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.error?.code).toBe("AUTH_SESSION_DISABLED");
  });

  it("returns 401 when no Better Auth session exists", async () => {
    const handler = vi.fn(
      async () =>
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.doMock("../../../lib/better-auth", () => ({
      getBetterAuth: vi.fn(() => ({ handler })),
      SsoConfigError: class SsoConfigError extends Error {},
    }));

    const { default: app } = await import("./session-token");
    const res = await app.request(
      "/api/admin/auth/session-token",
      { method: "POST" },
      createEnv(),
    );
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data.error?.code).toBe("UNAUTHORIZED");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("returns 200 with access token when Better Auth session exists", async () => {
    const createAccessToken = vi.fn(async () => "token_123");
    let selectCount = 0;
    vi.doMock("drizzle-orm/d1", () => ({
      drizzle: vi.fn(() => ({
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => {
                selectCount += 1;
                if (selectCount === 1) {
                  return [
                    {
                      id: "sess_1",
                      userId: "user_1",
                      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
                    },
                  ];
                }
                return [
                  {
                    id: "user_1",
                    email: "admin@example.com",
                    name: "Admin",
                    roleId: ["system.super-admin"],
                    uiPreferences: null,
                  },
                ];
              },
            }),
          }),
        }),
      })),
    }));
    vi.doMock("../../../lib/auth", async () => {
      const actual = await vi.importActual("../../../lib/auth");
      return {
        ...(actual as object),
        ensureJwtSecret: vi.fn(() => "jwt-secret"),
        createAccessToken,
      };
    });

    const handler = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            user: {
              id: "user_1",
              email: "admin@example.com",
              name: "Admin",
              emailVerified: true,
            },
            session: {
              id: "sess_1",
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    );
    vi.doMock("../../../lib/better-auth", () => ({
      getBetterAuth: vi.fn(() => ({ handler })),
      SsoConfigError: class SsoConfigError extends Error {},
    }));

    const { default: app } = await import("./session-token");
    const res = await app.request(
      "/api/admin/auth/session-token",
      { method: "POST", headers: { Cookie: "session=abc" } },
      createEnv(),
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.accessToken).toBe("token_123");
    expect(data.user?.id).toBe("user_1");
    expect(data.user?.roleId).toEqual(["system.super-admin"]);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(createAccessToken).toHaveBeenCalledWith("jwt-secret", {
      sub: "user_1",
      email: "admin@example.com",
      roles: ["system.super-admin"],
      sid: "sess_1",
    });
  });

  it("returns 401 when the Better Auth session no longer exists in auth_sessions", async () => {
    let selectCount = 0;
    vi.doMock("drizzle-orm/d1", () => ({
      drizzle: vi.fn(() => ({
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => {
                selectCount += 1;
                if (selectCount === 1) {
                  return [];
                }
                return [];
              },
            }),
          }),
        }),
      })),
    }));

    const handler = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            user: {
              id: "user_1",
              email: "admin@example.com",
              name: "Admin",
              emailVerified: true,
            },
            session: {
              id: "sess_1",
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    );
    vi.doMock("../../../lib/better-auth", () => ({
      getBetterAuth: vi.fn(() => ({ handler })),
      SsoConfigError: class SsoConfigError extends Error {},
    }));

    const { default: app } = await import("./session-token");
    const res = await app.request(
      "/api/admin/auth/session-token",
      { method: "POST", headers: { Cookie: "session=abc" } },
      createEnv(),
    );
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data.error?.code).toBe("UNAUTHORIZED");
  });

  it("returns 500 when Better Auth config is invalid", async () => {
    class MockSsoConfigError extends Error {}
    vi.doMock("../../../lib/better-auth", () => ({
      getBetterAuth: vi.fn(() => {
        throw new MockSsoConfigError("missing env");
      }),
      SsoConfigError: MockSsoConfigError,
    }));

    const { default: app } = await import("./session-token");
    const res = await app.request(
      "/api/admin/auth/session-token",
      { method: "POST" },
      createEnv(),
    );
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error?.code).toBe("AUTH_CONFIGURATION_ERROR");
  });
});
