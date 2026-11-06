import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { users, authSessions, settings } from "../../../database/schema";
import {
  sha256Hex,
  setRefreshCookie,
  createAccessToken,
  ensureJwtSecret,
  REFRESH_TTL_SECONDS,
  getUserByEmail,
  getCredentialAccountByUserId,
} from "../../../lib/auth";
import { resolveUserPreferences } from "../../../lib/user-preferences";
import { logAuthEvent } from "../../../lib/auth-log";
import { getBetterAuth, SsoConfigError } from "../../../lib/better-auth";
import { generateIdWithPrefix } from "../../../utils/id";
import type { AppContext } from "../../../types";
import { eq } from "drizzle-orm";
import { enforceAuthRateLimit } from "../../../services/auth-rate-limit";

const LoginSchema = z
  .object({
    email: z.email(),
    password: z.string().min(1),
  })
  .strict();

const SYSTEM_INITIALIZED_KEY = "system.initialized" as const;

/**
 * Copy only request headers needed by Better Auth.
 * @param c - Hono context
 * @returns Headers for delegated auth requests
 */
const createAuthRequestHeaders = (c: any): Headers => {
  const requestHeaders = new Headers();
  const cookie = c.req.header("Cookie");
  if (cookie) requestHeaders.set("Cookie", cookie);
  for (const name of ["Origin", "Sec-Fetch-Site"]) {
    const value = c.req.header(name);
    if (value) requestHeaders.set(name, value);
  }
  requestHeaders.set("Content-Type", "application/json");
  return requestHeaders;
};

/**
 * Try Better Auth email/password sign-in from the admin login endpoint.
 * @param c - Hono context
 * @param email - User email
 * @param password - User password
 * @returns True when Better Auth created a session
 */
const tryBetterAuthEmailLogin = async (
  c: any,
  email: string,
  password: string,
): Promise<boolean> => {
  try {
    const auth = await getBetterAuth(c.env);
    if (!auth) return false;

    const authEndpointUrl = new URL(
      "/api/auth/sign-in/email",
      c.req.url,
    ).toString();
    const authResponse = await auth.handler(
      new Request(authEndpointUrl, {
        method: "POST",
        headers: createAuthRequestHeaders(c),
        body: JSON.stringify({
          email,
          password,
          rememberMe: true,
          disableRedirect: true,
        }),
      }),
    );
    const setCookie = authResponse.headers.get("set-cookie");
    if (setCookie) c.header("set-cookie", setCookie);
    return authResponse.ok;
  } catch (error) {
    if (error instanceof SsoConfigError) return false;
    console.warn(
      "Better Auth email login failed before legacy fallback",
      error,
    );
    return false;
  }
};

const app = new Hono<AppContext>().post("/api/admin/auth/login", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: { code: "BAD_REQUEST", message: "Invalid payload" } },
      400,
    );
  }
  const { email, password } = parsed.data;
  const rateLimitResponse = await enforceAuthRateLimit(c, {
    operation: "login",
    identifier: email,
  });
  if (rateLimitResponse) return rateLimitResponse;

  const db = drizzle(c.env.DB);
  const ip = c.req.header("CF-Connecting-IP") || undefined;
  const userAgent = c.req.header("User-Agent") || undefined;

  // Initialization guard: if system not initialized and no users, instruct client to setup
  const sentinel = await db
    .select({ key: settings.key })
    .from(settings)
    .where(eq(settings.key, SYSTEM_INITIALIZED_KEY));
  if (sentinel.length === 0) {
    const count = await db.select({ id: users.id }).from(users as any);
    if (count.length === 0) {
      return c.json(
        {
          error: {
            code: "INITIAL_SETUP_REQUIRED",
            message: "Initial setup required",
          },
        },
        409,
      );
    }
  }

  const signedInWithBetterAuth = await tryBetterAuthEmailLogin(
    c,
    email,
    password,
  );
  if (signedInWithBetterAuth) {
    return c.json({ betterAuth: true });
  }

  const user = await getUserByEmail(db, email);
  if (!user) {
    await logAuthEvent(db, {
      provider: "local",
      result: "failed",
      reason: "user_not_found",
    });
    return c.json(
      { error: { code: "UNAUTHORIZED", message: "Invalid credentials" } },
      401,
    );
  }

  const credentialAccount = await getCredentialAccountByUserId(db, user.id);
  if (!credentialAccount?.password) {
    await logAuthEvent(db, {
      userId: (user as any).id,
      provider: "local",
      result: "failed",
      reason: "credentials_missing",
    });
    return c.json(
      { error: { code: "UNAUTHORIZED", message: "Invalid credentials" } },
      401,
    );
  }

  const ok = await bcrypt.compare(password, credentialAccount.password);
  if (!ok) {
    await logAuthEvent(db, {
      userId: (user as any).id,
      provider: "local",
      result: "failed",
      reason: "invalid_password",
    });
    return c.json(
      { error: { code: "UNAUTHORIZED", message: "Invalid credentials" } },
      401,
    );
  }

  // New session
  const refreshToken = generateIdWithPrefix("rft");
  const refreshHash = await sha256Hex(refreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);
  const sessionId = generateIdWithPrefix("sess");
  const roles = (user as any).roleId || [];
  const uiPreferences = resolveUserPreferences((user as any).uiPreferences);

  try {
    const jwtSecret = ensureJwtSecret(c.env);
    const accessToken = await createAccessToken(jwtSecret, {
      sub: (user as any).id,
      email: (user as any).email,
      roles,
      sid: sessionId,
    });
    const now = new Date();
    await db.insert(authSessions).values({
      id: sessionId,
      userId: (user as any).id,
      token: `legacy:${refreshHash}`,
      legacyRefreshTokenHash: refreshHash,
      userAgent,
      ipAddress: ip,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    });
    setRefreshCookie(c, refreshToken, REFRESH_TTL_SECONDS);
    await logAuthEvent(db, {
      userId: (user as any).id,
      provider: "local",
      result: "success",
    });
    return c.json({
      accessToken,
      user: {
        id: (user as any).id,
        email: (user as any).email,
        name: (user as any).name,
        roleId: roles,
        uiPreferences,
      },
    });
  } catch (error) {
    console.error("Failed to sign access token", error);
    return c.json(
      {
        error: {
          code: "SERVER_ERROR",
          message: "Authentication is misconfigured",
        },
      },
      500,
    );
  }
});

export default app;
