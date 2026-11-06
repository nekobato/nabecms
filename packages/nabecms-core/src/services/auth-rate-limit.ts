/**
 * Cloudflare Workers Rate Limiting enforcement for authentication endpoints.
 * Stable identifiers are HMACed before they reach the binding or logs.
 * @module
 */
import type { Context } from "hono";
import { ensureJwtSecret } from "../lib/auth";
import type { AppContext, Env, RateLimitBinding } from "../types";

const AUTH_RATE_LIMIT_EVENT = "nabecms.auth_rate_limit" as const;
const AUTH_RATE_LIMIT_RETRY_AFTER_SECONDS = 60 as const;
const AUTH_LOGIN_RATE_LIMIT_BINDING = "AUTH_LOGIN_RATE_LIMITER" as const;
const AUTH_SENSITIVE_RATE_LIMIT_BINDING =
  "AUTH_SENSITIVE_RATE_LIMITER" as const;
const encoder = new TextEncoder();

/**
 * Authentication operation domains that receive independent opaque keys.
 */
export type AuthRateLimitOperation =
  | "login"
  | "initialize"
  | "invite_accept"
  | "invite_regenerate"
  | "invite_email"
  | "email_test"
  | "password_reset_request"
  | "password_reset_ip"
  | "password_reset_confirm";

/**
 * Inputs required to consume one authentication rate limit token.
 */
export type AuthRateLimitInput = {
  operation: AuthRateLimitOperation;
  identifier: string;
  requestId?: string;
};

/**
 * Result of one authentication rate limit check.
 */
export type AuthRateLimitDecision =
  { outcome: "allowed" } | { outcome: "limited" } | { outcome: "unavailable" };

type ResolvedAuthRateLimitBinding = {
  binding?: RateLimitBinding;
  bindingName:
    | typeof AUTH_LOGIN_RATE_LIMIT_BINDING
    | typeof AUTH_SENSITIVE_RATE_LIMIT_BINDING;
};

/**
 * Convert bytes into a lowercase hexadecimal value.
 */
const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

/**
 * Normalize stable identifiers before signing them.
 */
const normalizeIdentifier = (
  operation: AuthRateLimitOperation,
  identifier: string,
): string => {
  const normalized =
    operation === "login" ? identifier.trim().toLowerCase() : identifier.trim();
  if (normalized.length === 0) {
    throw new Error("Auth rate limit identifier must not be empty");
  }
  return normalized;
};

/**
 * Create a domain-separated HMAC-SHA256 key for a stable identifier.
 *
 * @param secret - Secret used only as HMAC key material
 * @param operation - Authentication operation domain
 * @param identifier - Stable email, token, actor ID, or route fallback value
 * @returns An opaque key safe to send to the Cloudflare binding
 */
export const createAuthRateLimitKey = async (
  secret: string,
  operation: AuthRateLimitOperation,
  identifier: string,
): Promise<string> => {
  const normalizedSecret = secret.trim();
  if (normalizedSecret.length === 0) {
    throw new Error("Auth rate limit secret must not be empty");
  }
  const normalizedIdentifier = normalizeIdentifier(operation, identifier);
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(normalizedSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(
      `nabecms:auth-rate-limit:v1:${operation}:${normalizedIdentifier}`,
    ),
  );

  return `v1:${operation}:${bytesToHex(new Uint8Array(signature))}`;
};

/**
 * Resolve the binding assigned to an authentication operation.
 */
const resolveAuthRateLimitBinding = (
  env: Env,
  operation: AuthRateLimitOperation,
): ResolvedAuthRateLimitBinding =>
  operation === "login"
    ? {
        binding: env.AUTH_LOGIN_RATE_LIMITER,
        bindingName: AUTH_LOGIN_RATE_LIMIT_BINDING,
      }
    : {
        binding: env.AUTH_SENSITIVE_RATE_LIMITER,
        bindingName: AUTH_SENSITIVE_RATE_LIMIT_BINDING,
      };

/**
 * Emit a structured rate limit event without identifier, HMAC, or error text.
 */
const logAuthRateLimitDecision = (
  env: Env,
  input: AuthRateLimitInput,
  bindingName: ResolvedAuthRateLimitBinding["bindingName"],
  outcome: "limited" | "unavailable",
): void => {
  console.warn(
    JSON.stringify({
      event: AUTH_RATE_LIMIT_EVENT,
      operation: input.operation,
      outcome,
      binding: bindingName,
      workerEnv: env.WORKER_ENV,
      ...(input.requestId ? { requestId: input.requestId } : {}),
      status: outcome === "limited" ? 429 : 503,
      ...(outcome === "limited"
        ? { retryAfterSeconds: AUTH_RATE_LIMIT_RETRY_AFTER_SECONDS }
        : {}),
    }),
  );
};

/**
 * Consume one rate limit token for an authentication operation.
 * Missing bindings are tolerated only outside production. A configured but
 * invalid or failing binding always fails closed.
 */
export const checkAuthRateLimit = async (
  env: Env,
  input: AuthRateLimitInput,
): Promise<AuthRateLimitDecision> => {
  const { binding, bindingName } = resolveAuthRateLimitBinding(
    env,
    input.operation,
  );

  if (!binding) {
    if (env.WORKER_ENV !== "production") return { outcome: "allowed" };
    logAuthRateLimitDecision(env, input, bindingName, "unavailable");
    return { outcome: "unavailable" };
  }

  if (typeof binding.limit !== "function") {
    logAuthRateLimitDecision(env, input, bindingName, "unavailable");
    return { outcome: "unavailable" };
  }

  try {
    const key = await createAuthRateLimitKey(
      ensureJwtSecret(env),
      input.operation,
      input.identifier,
    );
    const result = await binding.limit({ key });
    if (result.success) return { outcome: "allowed" };

    logAuthRateLimitDecision(env, input, bindingName, "limited");
    return { outcome: "limited" };
  } catch {
    logAuthRateLimitDecision(env, input, bindingName, "unavailable");
    return { outcome: "unavailable" };
  }
};

/**
 * Enforce an authentication rate limit in a Hono route.
 *
 * @returns A blocking JSON response, or null when the request may continue
 */
export const enforceAuthRateLimit = async (
  c: Context<AppContext>,
  input: Omit<AuthRateLimitInput, "requestId">,
): Promise<Response | null> => {
  const decision = await checkAuthRateLimit(c.env, {
    ...input,
    requestId: c.get("requestId"),
  });
  if (decision.outcome === "allowed") return null;

  if (decision.outcome === "limited") {
    c.header("Retry-After", String(AUTH_RATE_LIMIT_RETRY_AFTER_SECONDS));
    return c.json(
      {
        error: {
          code: "AUTH_RATE_LIMITED",
          message: "Too many authentication attempts",
        },
      },
      429,
    );
  }

  return c.json(
    {
      error: {
        code: "AUTH_RATE_LIMIT_UNAVAILABLE",
        message: "Authentication protection is unavailable",
      },
    },
    503,
  );
};
