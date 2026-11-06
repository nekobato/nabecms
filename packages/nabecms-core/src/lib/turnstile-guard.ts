import { drizzle } from "drizzle-orm/d1";
import * as schema from "../database/schema";
import { createSettingsRepository } from "../repositories/settings";
import { getAuthSecuritySettings } from "../services/auth-security-settings";
import {
  normalizeTurnstileToken,
  verifyTurnstileToken,
  TurnstileVerificationConfigurationError,
} from "../services/turnstile";

const hasQueryableBinding = (value: unknown): boolean =>
  Boolean(
    value && typeof (value as { prepare?: unknown }).prepare === "function",
  );

/**
 * Determine whether login Turnstile protection is enabled.
 * @param c - Hono context
 * @returns True when login attempts must include a Turnstile token
 */
export async function isTurnstileRequiredForLogin(c: any): Promise<boolean> {
  if (c.env.WORKER_ENV === "test" && !hasQueryableBinding(c.env.DB)) {
    return false;
  }

  const db = drizzle(c.env.DB, { schema });
  const repo = createSettingsRepository(db);
  const settings = await getAuthSecuritySettings({ repo });
  return settings.turnstile.enabled;
}

/**
 * Verify Turnstile for an authentication request when protection is enabled.
 * @param c - Hono context
 * @param tokenValue - Raw token from request body
 * @returns Response when the request must be rejected, otherwise void
 */
export async function requireTurnstileForLogin(
  c: any,
  tokenValue: unknown,
): Promise<Response | void> {
  const required = await isTurnstileRequiredForLogin(c);
  if (!required) return;

  const token = normalizeTurnstileToken(tokenValue);
  if (!token) {
    return c.json(
      {
        error: {
          code: "TURNSTILE_REQUIRED",
          message: "Turnstile token is required",
        },
      },
      403,
    );
  }

  try {
    const result = await verifyTurnstileToken(
      { env: c.env },
      {
        token,
        remoteIp: c.req.header("CF-Connecting-IP") ?? undefined,
      },
    );
    if (result.success) return;

    return c.json(
      {
        error: {
          code: "TURNSTILE_FAILED",
          message: "Turnstile verification failed",
          details: result.errorCodes,
        },
      },
      403,
    );
  } catch (error) {
    if (error instanceof TurnstileVerificationConfigurationError) {
      return c.json(
        {
          error: {
            code: "TURNSTILE_CONFIGURATION_ERROR",
            message: "Turnstile is not configured",
          },
        },
        500,
      );
    }
    throw error;
  }
}
