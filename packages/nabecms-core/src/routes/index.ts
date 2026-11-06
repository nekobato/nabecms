import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import type { AppContext, Env } from "../types";
import { getBetterAuth, SsoConfigError } from "../lib/better-auth";
import { logAuthEvent } from "../lib/auth-log";
import { enforceAuthRateLimit } from "../services/auth-rate-limit";
import adminRoute from "./admin";
import contentsRoute from "./contents";

type EmailSignInLogContext = {
  email: string | null;
};

const LOCAL_AUTH_ROUTES = new Set([
  "GET /api/auth/get-session",
  "POST /api/auth/sign-in/email",
  "POST /api/auth/sign-out",
]);

/**
 * Restrict the Better Auth bridge to local password/session endpoints in v1.
 */
const isSupportedLocalAuthRequest = (request: Request): boolean => {
  const url = new URL(request.url);
  return LOCAL_AUTH_ROUTES.has(
    `${request.method.toUpperCase()} ${url.pathname}`,
  );
};

/**
 * Determine whether the request targets Better Auth email sign-in.
 * @param request - Incoming request
 * @returns True for POST /api/auth/sign-in/email
 */
const isBetterAuthEmailSignInRequest = (request: Request): boolean => {
  const url = new URL(request.url);
  return (
    request.method.toUpperCase() === "POST" &&
    url.pathname === "/api/auth/sign-in/email"
  );
};

/**
 * Safely coerce an unknown value into a plain record.
 */
function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Normalize an email value for rate limiting.
 */
function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length > 0 ? email : null;
}

/**
 * Read the email for rate limiting from a cloned sign-in request.
 */
async function readEmailSignInLogContext(
  request: Request,
): Promise<EmailSignInLogContext | null> {
  if (!isBetterAuthEmailSignInRequest(request)) return null;

  const body = await request
    .clone()
    .json()
    .catch(() => null);
  const record = toRecord(body);

  return {
    email: normalizeEmail(record?.email),
  };
}

/**
 * Extract a Better Auth user id from a cloned sign-in response when available.
 */
async function extractAuthResponseUserId(
  response: Response,
): Promise<string | null> {
  const payload = await response
    .clone()
    .json()
    .catch(() => null);
  const record = toRecord(payload);
  const user =
    toRecord(record?.user) ?? toRecord(toRecord(record?.session)?.user);
  const id = user?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * Best-effort logging for Better Auth email/password sign-in outcomes.
 */
async function logEmailSignInResult(
  env: Env,
  context: EmailSignInLogContext | null,
  response: Response,
): Promise<void> {
  if (!context) return;

  try {
    const result = response.status < 400 ? "success" : "failed";
    const db = drizzle(env.DB);
    await logAuthEvent(db, {
      userId:
        result === "success" ? await extractAuthResponseUserId(response) : null,
      provider: "local",
      result,
      reason: result === "failed" ? "other" : null,
    });
  } catch {
    console.warn("[auth] failed to log Better Auth email sign-in");
  }
}

const app = new Hono<AppContext>()
  .get("/", (c) => c.text("Hello Hono!"))
  .on(["GET", "POST"], "/api/auth/*", async (c) => {
    if (!isSupportedLocalAuthRequest(c.req.raw)) return c.notFound();
    const emailSignInLogContext = await readEmailSignInLogContext(c.req.raw);
    if (emailSignInLogContext) {
      const rateLimitResponse = await enforceAuthRateLimit(c, {
        operation: "login",
        identifier: emailSignInLogContext.email ?? "route-fallback",
      });
      if (rateLimitResponse) return rateLimitResponse;
    }
    try {
      const auth = await getBetterAuth(c.env);
      if (!auth) {
        const response = c.json(
          {
            error: {
              code: "AUTH_SESSION_DISABLED",
              message: "Optional local auth sessions are disabled",
            },
          },
          404,
        );
        await logEmailSignInResult(c.env, emailSignInLogContext, response);
        return response;
      }
      const response = await auth.handler(c.req.raw);
      await logEmailSignInResult(c.env, emailSignInLogContext, response);
      return response;
    } catch (error) {
      if (error instanceof SsoConfigError) {
        const response = c.json(
          {
            error: {
              code: "AUTH_CONFIGURATION_ERROR",
              message: error.message,
            },
          },
          500,
        );
        await logEmailSignInResult(c.env, emailSignInLogContext, response);
        return response;
      }
      console.error("Failed to handle Better Auth request", error);
      const response = c.json(
        {
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to handle auth request",
          },
        },
        500,
      );
      await logEmailSignInResult(c.env, emailSignInLogContext, response);
      return response;
    }
  })
  // Mount each sub-app at root; each defines full path
  .route("/", adminRoute)
  .route("/", contentsRoute);

export default app;
export type AppType = typeof app;
