import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkAuthRateLimit, createAuthRateLimitKey } from "./auth-rate-limit";
import type { Env } from "../types";

/**
 * Build the minimum environment required by the auth rate limiter.
 */
const createEnv = (overrides: Partial<Env> = {}): Env =>
  ({
    DB: {} as Env["DB"],
    WORKER_ENV: "test",
    JWT_SECRET: "rate-limit-test-secret",
    ASSETS: { fetch: vi.fn() },
    R2: {} as Env["R2"],
    ...overrides,
  }) as Env;

describe("auth rate limiting", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("creates the same opaque login key for normalized email identifiers", async () => {
    const first = await createAuthRateLimitKey(
      "rate-limit-test-secret",
      "login",
      " Admin@Example.com ",
    );
    const second = await createAuthRateLimitKey(
      "rate-limit-test-secret",
      "login",
      "admin@example.com",
    );

    expect(first).toBe(second);
    expect(first).toMatch(/^v1:login:[0-9a-f]{64}$/u);
    expect(first).not.toContain("admin@example.com");
  });

  it("keeps operation domains separate without exposing stable identifiers", async () => {
    const inviteToken = "invite-token-that-must-not-be-exposed";
    const acceptKey = await createAuthRateLimitKey(
      "rate-limit-test-secret",
      "invite_accept",
      inviteToken,
    );
    const regenerateKey = await createAuthRateLimitKey(
      "rate-limit-test-secret",
      "invite_regenerate",
      inviteToken,
    );

    expect(acceptKey).not.toBe(regenerateKey);
    expect(acceptKey).not.toContain(inviteToken);
    expect(regenerateKey).not.toContain(inviteToken);
  });

  it("allows development and test when the binding is absent", async () => {
    await expect(
      checkAuthRateLimit(createEnv(), {
        operation: "login",
        identifier: "admin@example.com",
      }),
    ).resolves.toEqual({ outcome: "allowed" });
  });

  it("fails closed in production when the binding is absent", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      checkAuthRateLimit(
        createEnv({
          WORKER_ENV: "production",
        }),
        {
          operation: "login",
          identifier: "admin@example.com",
          requestId: "req_missing_binding",
        },
      ),
    ).resolves.toEqual({ outcome: "unavailable" });

    const serializedLogs = warn.mock.calls.flat().join(" ");
    expect(serializedLogs).toContain('"outcome":"unavailable"');
    expect(serializedLogs).toContain('"requestId":"req_missing_binding"');
    expect(serializedLogs).not.toContain("admin@example.com");
  });

  it("returns a limited decision and emits a PII-free structured event", async () => {
    const limit = vi.fn(async (_input: { key: string }) => ({
      success: false,
    }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      checkAuthRateLimit(
        createEnv({
          AUTH_LOGIN_RATE_LIMITER: { limit },
        }),
        {
          operation: "login",
          identifier: "admin@example.com",
          requestId: "req_limited",
        },
      ),
    ).resolves.toEqual({ outcome: "limited" });

    expect(limit).toHaveBeenCalledWith({
      key: expect.stringMatching(/^v1:login:[0-9a-f]{64}$/u),
    });
    const serializedLogs = warn.mock.calls.flat().join(" ");
    expect(serializedLogs).toContain('"event":"nabecms.auth_rate_limit"');
    expect(serializedLogs).toContain('"outcome":"limited"');
    expect(serializedLogs).not.toContain("admin@example.com");
  });

  it("fails closed when a configured binding throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const limit = vi.fn(async () => {
      throw new Error("binding unavailable");
    });

    await expect(
      checkAuthRateLimit(
        createEnv({
          WORKER_ENV: "production",
          AUTH_SENSITIVE_RATE_LIMITER: { limit },
        }),
        {
          operation: "invite_accept",
          identifier: "private-invite-token",
        },
      ),
    ).resolves.toEqual({ outcome: "unavailable" });

    const serializedLogs = warn.mock.calls.flat().join(" ");
    expect(serializedLogs).toContain('"outcome":"unavailable"');
    expect(serializedLogs).not.toContain("private-invite-token");
    expect(serializedLogs).not.toContain("binding unavailable");
  });
});
