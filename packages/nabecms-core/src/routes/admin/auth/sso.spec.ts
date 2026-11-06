import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../../create-app";

const app = createApp();

const createEnv = (overrides: Record<string, string | undefined> = {}) =>
  ({
    DB: {} as any,
    WORKER_ENV: "test" as const,
    ASSETS: { fetch: vi.fn() },
    AUTH_SSO_ENABLED: undefined,
    AUTH_GOOGLE_ENABLED: undefined,
    BETTER_AUTH_SECRET: undefined,
    BETTER_AUTH_URL: undefined,
    GOOGLE_CLIENT_ID: undefined,
    GOOGLE_CLIENT_SECRET: undefined,
    ...overrides,
  }) as any;

describe("v1 admin authentication route surface", () => {
  it.each([
    ["GET", "/api/admin/auth/providers"],
    ["POST", "/api/admin/auth/sso/google/start"],
    ["GET", "/api/admin/auth/sso/google/callback"],
  ])("does not mount %s %s", async (method, path) => {
    const res = await app.request(path, { method }, createEnv());

    expect(res.status).toBe(404);
  });
});
