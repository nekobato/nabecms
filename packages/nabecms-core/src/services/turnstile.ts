import {
  normalizeOptionalEnvValue,
  type TurnstileEnvironmentState,
} from "./auth-security-settings";

const TURNSTILE_SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify" as const;
const TURNSTILE_TOKEN_MAX_LENGTH = 2048;

type TurnstileEnv = {
  TURNSTILE_SECRET_KEY?: string;
};

export type TurnstileVerificationDeps = {
  env: TurnstileEnv;
  fetch?: typeof fetch;
};

export type TurnstileVerificationParams = {
  token: string;
  remoteIp?: string;
};

export type TurnstileVerificationResult = {
  success: boolean;
  errorCodes: string[];
};

type TurnstileSiteverifyResponse = {
  success?: boolean;
  "error-codes"?: string[];
};

/**
 * Raised when Turnstile server-side validation cannot run.
 */
export class TurnstileVerificationConfigurationError extends Error {
  constructor() {
    super("TURNSTILE_SECRET_KEY is not configured");
  }
}

/**
 * Normalize a Turnstile token submitted from the browser.
 * @param token - Raw token value
 * @returns Trimmed token when valid, otherwise null
 */
export function normalizeTurnstileToken(token: unknown): string | null {
  if (typeof token !== "string") return null;
  const normalized = token.trim();
  if (
    normalized.length === 0 ||
    normalized.length > TURNSTILE_TOKEN_MAX_LENGTH
  ) {
    return null;
  }
  return normalized;
}

/**
 * Verify one Turnstile token through Cloudflare Siteverify.
 * @param deps - Environment and fetch dependency
 * @param params - Token and request metadata
 * @returns Verification result
 */
export async function verifyTurnstileToken(
  deps: TurnstileVerificationDeps,
  params: TurnstileVerificationParams,
): Promise<TurnstileVerificationResult> {
  const secret = normalizeOptionalEnvValue(deps.env.TURNSTILE_SECRET_KEY);
  if (!secret) {
    throw new TurnstileVerificationConfigurationError();
  }

  const token = normalizeTurnstileToken(params.token);
  if (!token) {
    return { success: false, errorCodes: ["missing-input-response"] };
  }

  const form = new URLSearchParams();
  form.set("secret", secret);
  form.set("response", token);
  if (params.remoteIp) form.set("remoteip", params.remoteIp);

  const fetchImpl = deps.fetch ?? fetch;
  const response = await fetchImpl(TURNSTILE_SITEVERIFY_URL, {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    return { success: false, errorCodes: ["siteverify-http-error"] };
  }

  const payload = (await response
    .json()
    .catch(() => null)) as TurnstileSiteverifyResponse | null;
  const errorCodes = Array.isArray(payload?.["error-codes"])
    ? payload["error-codes"].filter(
        (value): value is string => typeof value === "string",
      )
    : [];

  return {
    success: payload?.success === true,
    errorCodes,
  };
}

/**
 * Resolve whether a configured Turnstile integration can render in the UI.
 * @param state - Environment state
 * @returns Public renderability flag
 */
export function canRenderTurnstileWidget(
  state: TurnstileEnvironmentState,
): boolean {
  return state.siteKeyConfigured;
}
