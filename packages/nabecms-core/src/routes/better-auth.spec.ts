import { beforeEach, describe, expect, it, vi } from "vitest";
import app from "./index";

const betterAuthMock = vi.hoisted(() => {
  class MockSsoConfigError extends Error {}

  return {
    getBetterAuth: vi.fn(),
    SsoConfigError: MockSsoConfigError,
  };
});

const authLogMock = vi.hoisted(() => ({
  logAuthEvent: vi.fn(),
}));

vi.mock("../lib/better-auth", () => betterAuthMock);
vi.mock("../lib/auth-log", () => authLogMock);

const createEnv = () =>
  ({
    DB: {} as any,
    WORKER_ENV: "test",
    ASSETS: { fetch: vi.fn() },
  }) as any;

describe("better-auth route mounting", () => {
  beforeEach(() => {
    betterAuthMock.getBetterAuth.mockReset();
    authLogMock.logAuthEvent.mockReset();
  });

  it("delegates /api/auth/* to Better Auth handler", async () => {
    const handler = vi.fn(
      async (_request: Request) => new Response("ok", { status: 207 }),
    );
    betterAuthMock.getBetterAuth.mockResolvedValue({ handler });

    const res = await app.request(
      "/api/auth/get-session",
      { method: "GET" },
      createEnv(),
    );

    expect(res.status).toBe(207);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]).toBeInstanceOf(Request);
  });

  it("does not expose Better Auth social sign-in in v1", async () => {
    const handler = vi.fn(
      async (_request: Request) => new Response("ok", { status: 200 }),
    );
    betterAuthMock.getBetterAuth.mockResolvedValue({ handler });

    const res = await app.request(
      "/api/auth/sign-in/social",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "google" }),
      },
      createEnv(),
    );

    expect(res.status).toBe(404);
    expect(handler).not.toHaveBeenCalled();
  });

  it("logs successful email/password sign-in attempts", async () => {
    const handler = vi.fn(
      async (_request: Request) =>
        new Response(
          JSON.stringify({
            user: {
              id: "user_1",
              email: "admin@example.com",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    betterAuthMock.getBetterAuth.mockResolvedValue({ handler });

    const res = await app.request(
      "/api/auth/sign-in/email",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "203.0.113.10",
          "User-Agent": "vitest-agent",
        },
        body: JSON.stringify({
          email: "Admin@Example.com",
          password: "password",
        }),
      },
      createEnv(),
    );

    expect(res.status).toBe(200);
    expect(authLogMock.logAuthEvent).toHaveBeenCalledWith(expect.anything(), {
      userId: "user_1",
      provider: "local",
      result: "success",
      reason: null,
    });
  });

  it("logs failed email/password sign-in attempts", async () => {
    const handler = vi.fn(
      async (_request: Request) =>
        new Response(JSON.stringify({ error: "Invalid credentials" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
    );
    betterAuthMock.getBetterAuth.mockResolvedValue({ handler });

    const res = await app.request(
      "/api/auth/sign-in/email",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "missing@example.com",
          password: "password",
        }),
      },
      createEnv(),
    );

    expect(res.status).toBe(401);
    expect(authLogMock.logAuthEvent).toHaveBeenCalledWith(expect.anything(), {
      userId: null,
      provider: "local",
      result: "failed",
      reason: "other",
    });
  });

  it("shares one opaque login counter across Better Auth and admin login", async () => {
    const limit = vi.fn(async (_input: { key: string }) => ({
      success: false,
    }));
    const env = {
      ...createEnv(),
      JWT_SECRET: "rate-limit-test-secret",
      AUTH_LOGIN_RATE_LIMITER: { limit },
    };

    const betterAuthResponse = await app.request(
      "/api/auth/sign-in/email",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "Admin@Example.com",
          password: "password",
        }),
      },
      env,
    );
    const adminResponse = await app.request(
      "/api/admin/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "admin@example.com",
          password: "password",
        }),
      },
      env,
    );

    expect(betterAuthResponse.status).toBe(429);
    expect(adminResponse.status).toBe(429);
    expect(betterAuthResponse.headers.get("Retry-After")).toBe("60");
    expect(adminResponse.headers.get("Retry-After")).toBe("60");
    expect(await betterAuthResponse.json()).toEqual({
      error: {
        code: "AUTH_RATE_LIMITED",
        message: "Too many authentication attempts",
      },
    });
    expect(limit).toHaveBeenCalledTimes(2);
    expect(limit.mock.calls[0]?.[0]).toEqual(limit.mock.calls[1]?.[0]);
    expect(String(limit.mock.calls[0]?.[0]?.key)).not.toContain(
      "admin@example.com",
    );
    expect(betterAuthMock.getBetterAuth).not.toHaveBeenCalled();
  });

  it("fails closed before Better Auth when production binding is missing", async () => {
    const res = await app.request(
      "/api/auth/sign-in/email",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "admin@example.com",
          password: "password",
        }),
      },
      {
        ...createEnv(),
        WORKER_ENV: "production",
        JWT_SECRET: "rate-limit-test-secret",
      },
    );

    expect(res.status).toBe(503);
    expect((await res.json()).error?.code).toBe("AUTH_RATE_LIMIT_UNAVAILABLE");
    expect(betterAuthMock.getBetterAuth).not.toHaveBeenCalled();
  });

  it("returns 404 when optional Better Auth sessions are disabled", async () => {
    betterAuthMock.getBetterAuth.mockResolvedValue(null);

    const res = await app.request(
      "/api/auth/get-session",
      { method: "GET" },
      createEnv(),
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error?.code).toBe("AUTH_SESSION_DISABLED");
  });

  it("returns 500 when local auth session configuration is invalid", async () => {
    betterAuthMock.getBetterAuth.mockRejectedValue(
      new betterAuthMock.SsoConfigError("missing env"),
    );

    const res = await app.request(
      "/api/auth/get-session",
      { method: "GET" },
      createEnv(),
    );
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error?.code).toBe("AUTH_CONFIGURATION_ERROR");
  });
});
