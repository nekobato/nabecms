import type { Env } from "../../types";

type SsoEnv = Pick<Env, "BETTER_AUTH_SECRET" | "BETTER_AUTH_URL">;

/**
 * SSO provider identifier currently supported by this configuration module.
 */
export type SsoProviderId = "google";

/**
 * Resolved local Better Auth session configuration.
 */
export type SsoConfig = {
  enabled: boolean;
  betterAuth: {
    secret: string;
    baseURL: string;
  } | null;
  providers: {
    google: {
      enabled: false;
    };
  };
};

/**
 * Raised when local Better Auth session configuration is incomplete.
 */
export class SsoConfigError extends Error {
  readonly missing: readonly string[];

  constructor(missing: readonly string[]) {
    super(
      `[auth] Missing required environment variables: ${missing.join(", ")}`,
    );
    this.name = "SsoConfigError";
    this.missing = missing;
  }
}

/**
 * Normalize an optional environment variable by trimming whitespace.
 */
const normalizeEnvValue = (value: string | undefined): string | null => {
  if (!value) return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

/**
 * Resolve local Better Auth runtime configuration from Worker bindings.
 *
 * Validation rules:
 * Both values omitted disables the optional Better Auth session bridge.
 * Supplying only one value is rejected as an incomplete configuration.
 */
export const resolveSsoConfig = (env: SsoEnv): SsoConfig => {
  const betterAuthSecret = normalizeEnvValue(env.BETTER_AUTH_SECRET);
  const betterAuthUrl = normalizeEnvValue(env.BETTER_AUTH_URL);

  if (!betterAuthSecret && !betterAuthUrl) {
    return {
      enabled: false,
      betterAuth: null,
      providers: {
        google: { enabled: false },
      },
    };
  }

  const missing: string[] = [];
  if (!betterAuthSecret) missing.push("BETTER_AUTH_SECRET");
  if (!betterAuthUrl) missing.push("BETTER_AUTH_URL");

  if (missing.length > 0) {
    throw new SsoConfigError(missing);
  }

  return {
    enabled: true,
    betterAuth: {
      secret: betterAuthSecret as string,
      baseURL: betterAuthUrl as string,
    },
    providers: {
      google: { enabled: false },
    },
  };
};
