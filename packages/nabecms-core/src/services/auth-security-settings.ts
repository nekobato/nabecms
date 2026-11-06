import { z } from "zod";
import type { SettingsRepository } from "../repositories/settings";

export const AUTH_SECURITY_SETTINGS_KEY = "auth_security_settings" as const;

export type AuthSecuritySettings = {
  turnstile: {
    enabled: boolean;
  };
};

export type TurnstileEnvironmentState = {
  siteKeyConfigured: boolean;
  secretKeyConfigured: boolean;
  siteKey: string | null;
  canEnable: boolean;
};

export type AuthSecuritySettingsDeps = {
  repo: SettingsRepository;
  now?: () => Date;
};

type TurnstileEnv = {
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
};

export const defaultAuthSecuritySettings: AuthSecuritySettings = {
  turnstile: {
    enabled: false,
  },
};

const authSecuritySettingsSchema = z
  .object({
    turnstile: z
      .object({
        enabled: z.boolean().default(false),
      })
      .default({ enabled: false }),
  })
  .default(defaultAuthSecuritySettings);

/**
 * Validation error for auth security settings payloads.
 */
export class AuthSecuritySettingsValidationError extends Error {
  /**
   * @param issues - Zod validation issues
   */
  constructor(public readonly issues: z.ZodIssue[]) {
    super("Invalid auth security settings payload");
  }
}

/**
 * Raised when Turnstile is enabled without the required Worker env bindings.
 */
export class TurnstileEnvironmentMissingError extends Error {
  /**
   * @param missing - Missing environment variable names
   */
  constructor(public readonly missing: readonly string[]) {
    super(`Missing Turnstile environment variables: ${missing.join(", ")}`);
  }
}

/**
 * Normalize an optional environment variable by trimming whitespace.
 * @param value - Raw environment value
 * @returns Non-empty normalized value, otherwise null
 */
export function normalizeOptionalEnvValue(
  value: string | undefined,
): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

/**
 * Resolve Turnstile environment availability without exposing the secret.
 * @param env - Worker environment
 * @returns Environment state used by settings and login UI
 */
export function getTurnstileEnvironmentState(
  env: object,
): TurnstileEnvironmentState {
  const legacyEnv = env as TurnstileEnv;
  const siteKey = normalizeOptionalEnvValue(legacyEnv.TURNSTILE_SITE_KEY);
  const secretKey = normalizeOptionalEnvValue(legacyEnv.TURNSTILE_SECRET_KEY);
  return {
    siteKeyConfigured: Boolean(siteKey),
    secretKeyConfigured: Boolean(secretKey),
    siteKey,
    canEnable: Boolean(siteKey && secretKey),
  };
}

/**
 * Normalize and validate auth security settings.
 * @param input - Raw settings value
 * @returns Normalized settings
 */
export function normalizeAuthSecuritySettings(
  input: unknown,
): AuthSecuritySettings {
  const parsed = authSecuritySettingsSchema.parse(input ?? {});
  return {
    turnstile: {
      enabled: parsed.turnstile.enabled,
    },
  };
}

/**
 * Resolve current auth security settings.
 * @param deps - Settings repository dependency
 * @returns Stored settings or defaults
 */
export async function getAuthSecuritySettings(
  deps: AuthSecuritySettingsDeps,
): Promise<AuthSecuritySettings> {
  const record = await deps.repo.findByKey(AUTH_SECURITY_SETTINGS_KEY);
  if (!record) return defaultAuthSecuritySettings;

  try {
    return normalizeAuthSecuritySettings(record.value);
  } catch (error) {
    console.warn("Failed to normalize auth security settings", error);
    return defaultAuthSecuritySettings;
  }
}

/**
 * Update auth security settings after validating Turnstile env requirements.
 * @param deps - Settings repository and clock
 * @param env - Worker environment
 * @param input - Proposed settings
 * @returns Stored settings
 */
export async function updateAuthSecuritySettings(
  deps: AuthSecuritySettingsDeps,
  env: object,
  input: unknown,
): Promise<AuthSecuritySettings> {
  let normalized: AuthSecuritySettings;
  try {
    normalized = normalizeAuthSecuritySettings(input);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new AuthSecuritySettingsValidationError(error.issues);
    }
    throw error;
  }

  if (normalized.turnstile.enabled) {
    const envState = getTurnstileEnvironmentState(env);
    const missing = [
      !envState.siteKeyConfigured ? "TURNSTILE_SITE_KEY" : null,
      !envState.secretKeyConfigured ? "TURNSTILE_SECRET_KEY" : null,
    ].filter((value): value is string => typeof value === "string");

    if (missing.length > 0) {
      throw new TurnstileEnvironmentMissingError(missing);
    }
  }

  const nowIso = (deps.now ?? (() => new Date()))().toISOString();
  await deps.repo.upsert(AUTH_SECURITY_SETTINGS_KEY, normalized, nowIso);
  return normalized;
}
