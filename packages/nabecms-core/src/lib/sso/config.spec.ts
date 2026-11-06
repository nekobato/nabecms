import { describe, it, expect } from "vitest";
import { resolveSsoConfig, SsoConfigError } from "./config";

type EnvOverrides = Partial<{
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
}>;

const createEnv = (overrides: EnvOverrides = {}) => ({
  BETTER_AUTH_SECRET: undefined,
  BETTER_AUTH_URL: undefined,
  ...overrides,
});

describe("resolveSsoConfig", () => {
  it("returns disabled config when both optional session values are absent", () => {
    expect(resolveSsoConfig(createEnv())).toEqual({
      enabled: false,
      betterAuth: null,
      providers: { google: { enabled: false } },
    });
  });

  it("throws a descriptive error when BETTER_AUTH_URL is missing", () => {
    expect(() =>
      resolveSsoConfig(
        createEnv({
          BETTER_AUTH_SECRET: "secret",
        }),
      ),
    ).toThrow(SsoConfigError);

    try {
      resolveSsoConfig(
        createEnv({
          BETTER_AUTH_SECRET: "secret",
        }),
      );
    } catch (error) {
      const typed = error as SsoConfigError;
      expect(typed.missing).toEqual(["BETTER_AUTH_URL"]);
    }
  });

  it("throws a descriptive error when BETTER_AUTH_SECRET is missing", () => {
    expect(() =>
      resolveSsoConfig(
        createEnv({
          BETTER_AUTH_URL: "https://example.com",
        }),
      ),
    ).toThrowError(
      expect.objectContaining({
        missing: ["BETTER_AUTH_SECRET"],
      }),
    );
  });

  it("resolves local Better Auth sessions without social providers", () => {
    expect(
      resolveSsoConfig(
        createEnv({
          BETTER_AUTH_SECRET: "secret",
          BETTER_AUTH_URL: "https://example.com",
        }),
      ),
    ).toEqual({
      enabled: true,
      betterAuth: {
        secret: "secret",
        baseURL: "https://example.com",
      },
      providers: {
        google: {
          enabled: false,
        },
      },
    });
  });
});
