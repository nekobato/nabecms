import { describe, expect, it, vi } from "vitest";
import {
  AUTH_SECURITY_SETTINGS_KEY,
  defaultAuthSecuritySettings,
  getAuthSecuritySettings,
  getTurnstileEnvironmentState,
  normalizeAuthSecuritySettings,
  TurnstileEnvironmentMissingError,
  updateAuthSecuritySettings,
} from "./auth-security-settings";

const createRepo = () => ({
  findByKey: vi.fn(),
  upsert: vi.fn(),
});

describe("auth security settings service", () => {
  it("returns default settings when missing", async () => {
    const repo = createRepo();
    repo.findByKey.mockResolvedValue(null);

    const result = await getAuthSecuritySettings({ repo });

    expect(result).toEqual(defaultAuthSecuritySettings);
  });

  it("normalizes partial stored values", () => {
    expect(normalizeAuthSecuritySettings({})).toEqual(
      defaultAuthSecuritySettings,
    );
    expect(
      normalizeAuthSecuritySettings({ turnstile: { enabled: true } }),
    ).toEqual({
      turnstile: { enabled: true },
    });
  });

  it("resolves Turnstile environment availability without exposing secret", () => {
    const result = getTurnstileEnvironmentState({
      TURNSTILE_SITE_KEY: " site-key ",
      TURNSTILE_SECRET_KEY: " secret-key ",
    });

    expect(result).toEqual({
      siteKeyConfigured: true,
      secretKeyConfigured: true,
      siteKey: "site-key",
      canEnable: true,
    });
  });

  it("rejects enabling Turnstile without required environment", async () => {
    const repo = createRepo();

    await expect(
      updateAuthSecuritySettings(
        { repo, now: () => new Date("2026-01-01T00:00:00.000Z") },
        { TURNSTILE_SITE_KEY: "site-key" },
        { turnstile: { enabled: true } },
      ),
    ).rejects.toMatchObject(
      new TurnstileEnvironmentMissingError(["TURNSTILE_SECRET_KEY"]),
    );
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it("stores enabled Turnstile settings when environment is complete", async () => {
    const repo = createRepo();

    const result = await updateAuthSecuritySettings(
      { repo, now: () => new Date("2026-01-01T00:00:00.000Z") },
      {
        TURNSTILE_SITE_KEY: "site-key",
        TURNSTILE_SECRET_KEY: "secret-key",
      },
      { turnstile: { enabled: true } },
    );

    expect(result).toEqual({ turnstile: { enabled: true } });
    expect(repo.upsert).toHaveBeenCalledWith(
      AUTH_SECURITY_SETTINGS_KEY,
      { turnstile: { enabled: true } },
      "2026-01-01T00:00:00.000Z",
    );
  });

  it("stores disabled Turnstile settings without environment", async () => {
    const repo = createRepo();

    const result = await updateAuthSecuritySettings(
      { repo, now: () => new Date("2026-01-01T00:00:00.000Z") },
      {},
      { turnstile: { enabled: false } },
    );

    expect(result).toEqual(defaultAuthSecuritySettings);
    expect(repo.upsert).toHaveBeenCalledWith(
      AUTH_SECURITY_SETTINGS_KEY,
      defaultAuthSecuritySettings,
      "2026-01-01T00:00:00.000Z",
    );
  });
});
