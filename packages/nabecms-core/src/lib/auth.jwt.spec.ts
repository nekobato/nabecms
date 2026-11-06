import { describe, it, expect } from "vitest";
import { ensureJwtSecret } from "./auth";

type EnvOverrides = Partial<{
  JWT_SECRET: string | undefined;
  WORKER_ENV: "development" | "production" | "test";
}>;

const createEnv = (overrides: EnvOverrides = {}) => ({
  JWT_SECRET: undefined,
  WORKER_ENV: "development" as const,
  ...overrides,
});

describe("ensureJwtSecret", () => {
  it("returns configured secret when provided", () => {
    const env = createEnv({ JWT_SECRET: "configured-secret" });
    expect(ensureJwtSecret(env)).toBe("configured-secret");
  });

  it("generates fallback secret in non-production environments", () => {
    const env = createEnv();
    const secret = ensureJwtSecret(env);
    expect(secret).toBeTypeOf("string");
    expect(secret.length).toBeGreaterThanOrEqual(32);
    expect(ensureJwtSecret(env)).toBe(secret);
  });

  it("throws when JWT_SECRET is missing in production", () => {
    const env = createEnv({ WORKER_ENV: "production" });
    expect(() => ensureJwtSecret(env)).toThrow(/JWT_SECRET/);
  });
});
