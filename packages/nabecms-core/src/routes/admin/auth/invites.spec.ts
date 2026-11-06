import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../../create-app";
import * as authLib from "../../../lib/auth";
import * as invitesService from "../../../services/invites";
import * as usersService from "../../../services/users";
import * as authLifecycle from "../../../services/auth-lifecycle";
import * as rolesRepository from "../../../repositories/roles";
import * as usersRepository from "../../../repositories/users";

const app = createApp();

const env = {
  DB: {} as any,
  WORKER_ENV: "test" as const,
  JWT_SECRET: "test-secret",
  BCRYPT_COST: "4",
  ASSETS: { fetch: vi.fn() },
} as any;

describe("admin auth invites routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(authLib, "verifyAccessToken").mockResolvedValue({
      sub: "user_admin",
      sid: "sess_test",
      roles: ["system.super-admin"],
    } as any);
  });

  it("returns USER_ALREADY_EXISTS_FOR_INVITE when invite email already exists", async () => {
    vi.spyOn(invitesService, "createInvite").mockRejectedValue(
      new usersService.UserAlreadyExistsError("existing@example.com"),
    );

    const res = await app.request(
      "/api/admin/auth/invites",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: "existing@example.com",
          roleIds: ["role.editor"],
        }),
      },
      env,
    );
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error?.code).toBe("USER_ALREADY_EXISTS_FOR_INVITE");
  });

  it("commits invite acceptance before setting the refresh cookie", async () => {
    vi.spyOn(invitesService, "resolveInviteByToken").mockResolvedValue({
      ok: true,
      invite: {
        id: "invite_1",
        email: "editor@example.com",
        roleIds: ["role.editor"],
        tokenHash: "invite-token-hash",
        tokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        status: "sent",
      },
    } as any);
    vi.spyOn(rolesRepository, "createRoleRepository").mockReturnValue({
      findManyByIds: vi.fn(async () => [{ id: "role.editor" }]),
    } as any);
    vi.spyOn(usersRepository, "createUserRepository").mockReturnValue({
      findByEmail: vi.fn(async () => null),
    } as any);
    vi.spyOn(authLib, "sha256Hex").mockResolvedValue("refresh-token-hash");
    vi.spyOn(authLib, "createAccessToken").mockResolvedValue("access-token");
    const acceptInviteLifecycle = vi
      .spyOn(authLifecycle, "acceptInviteLifecycle")
      .mockResolvedValue();

    const res = await app.request(
      "/api/admin/auth/accept-invite",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "test-agent",
        },
        body: JSON.stringify({
          token: "valid-invite-token",
          name: "Editor",
          password: "Password123",
        }),
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(acceptInviteLifecycle).toHaveBeenCalledTimes(1);
    expect(acceptInviteLifecycle).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        inviteId: "invite_1",
        inviteTokenHash: "invite-token-hash",
        email: "editor@example.com",
        roleIds: ["role.editor"],
        passwordHash: expect.any(String),
        refreshTokenHash: "refresh-token-hash",
        sessionExpiresAt: expect.any(Date),
        now: expect.any(Date),
      }),
    );
    expect(acceptInviteLifecycle.mock.calls[0]?.[1]).not.toHaveProperty(
      "sessionToken",
    );
    expect(res.headers.get("Set-Cookie")).toContain("__Host.refresh=");
  });

  it("does not set a cookie when the invite batch is rolled back", async () => {
    vi.spyOn(invitesService, "resolveInviteByToken").mockResolvedValue({
      ok: true,
      invite: {
        id: "invite_1",
        email: "editor@example.com",
        roleIds: ["role.editor"],
        tokenHash: "invite-token-hash",
        tokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        status: "sent",
      },
    } as any);
    vi.spyOn(rolesRepository, "createRoleRepository").mockReturnValue({
      findManyByIds: vi.fn(async () => [{ id: "role.editor" }]),
    } as any);
    vi.spyOn(usersRepository, "createUserRepository").mockReturnValue({
      findByEmail: vi.fn(async () => null),
    } as any);
    vi.spyOn(authLib, "sha256Hex").mockResolvedValue("refresh-token-hash");
    vi.spyOn(authLib, "createAccessToken").mockResolvedValue("access-token");
    vi.spyOn(authLifecycle, "acceptInviteLifecycle").mockRejectedValue(
      new authLifecycle.InviteAcceptanceConflictError(),
    );

    const res = await app.request(
      "/api/admin/auth/accept-invite",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: "valid-invite-token",
          name: "Editor",
          password: "Password123",
        }),
      },
      env,
    );

    expect(res.status).toBe(410);
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("shares one token-scoped counter across invite validate and accept", async () => {
    const limit = vi.fn(async (_input: { key: string }) => ({
      success: false,
    }));
    const rateLimitedEnv = {
      ...env,
      AUTH_SENSITIVE_RATE_LIMITER: { limit },
    };
    const token = "valid-invite-token";

    const validateResponse = await app.request(
      "/api/admin/auth/accept-invite/validate",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      },
      rateLimitedEnv,
    );
    const acceptResponse = await app.request(
      "/api/admin/auth/accept-invite",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          name: "Editor",
          password: "Password123",
        }),
      },
      rateLimitedEnv,
    );

    expect(validateResponse.status).toBe(429);
    expect(acceptResponse.status).toBe(429);
    expect(validateResponse.headers.get("Retry-After")).toBe("60");
    expect(acceptResponse.headers.get("Retry-After")).toBe("60");
    expect(limit).toHaveBeenCalledTimes(2);
    expect(limit.mock.calls[0]?.[0]).toEqual(limit.mock.calls[1]?.[0]);
    expect(String(limit.mock.calls[0]?.[0]?.key)).not.toContain(token);
  });

  it("rate limits malformed invite payloads with a stable fallback key", async () => {
    const limit = vi.fn(async (_input: { key: string }) => ({
      success: false,
    }));
    const rateLimitedEnv = {
      ...env,
      AUTH_SENSITIVE_RATE_LIMITER: { limit },
    };

    const missingTokenResponse = await app.request(
      "/api/admin/auth/accept-invite/validate",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
      rateLimitedEnv,
    );
    const invalidTokenResponse = await app.request(
      "/api/admin/auth/accept-invite",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "short" }),
      },
      rateLimitedEnv,
    );

    expect(missingTokenResponse.status).toBe(429);
    expect(invalidTokenResponse.status).toBe(429);
    expect(limit).toHaveBeenCalledTimes(2);
    expect(limit.mock.calls[0]?.[0]).toEqual(limit.mock.calls[1]?.[0]);
    expect(String(limit.mock.calls[0]?.[0]?.key)).not.toContain(
      "route-fallback",
    );
  });

  it("rate limits invite regeneration by authenticated actor", async () => {
    const limit = vi.fn(async (_input: { key: string }) => ({
      success: false,
    }));

    const res = await app.request(
      "/api/admin/auth/invites/invite_1/regenerate",
      {
        method: "POST",
        headers: { Authorization: "Bearer token" },
      },
      {
        ...env,
        AUTH_SENSITIVE_RATE_LIMITER: { limit },
      },
    );

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(limit).toHaveBeenCalledWith({
      key: expect.stringMatching(/^v1:invite_regenerate:[0-9a-f]{64}$/u),
    });
    expect(String(limit.mock.calls[0]?.[0]?.key)).not.toContain("user_admin");
  });
});
