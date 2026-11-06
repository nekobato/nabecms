import { setCookie, deleteCookie } from "hono/cookie";
import { SignJWT, jwtVerify } from "jose";
import { and, eq } from "drizzle-orm";
import {
  users,
  authAccounts,
  authIdentities,
  authCredentials,
} from "../database/schema";
import type { Env } from "../types";

export const ACCESS_TTL_SECONDS = 15 * 60; // 15 minutes
export const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
export const REFRESH_COOKIE = "__Host.refresh";

const enc = new TextEncoder();
const DEV_FALLBACK_SECRET_BYTES = 32;
let cachedDevJwtSecret: string | null = null;

type JwtSecretEnv = Pick<Env, "JWT_SECRET" | "WORKER_ENV">;

function encodeSecret(secret: string) {
  const normalized = secret.trim();
  if (normalized.length === 0) {
    throw new Error("JWT secret must not be empty");
  }
  return enc.encode(normalized);
}

function generateDevSecret() {
  const bytes = crypto.getRandomValues(
    new Uint8Array(DEV_FALLBACK_SECRET_BYTES),
  );
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function ensureJwtSecret(env: JwtSecretEnv): string {
  const configured = (env.JWT_SECRET ?? "").trim();
  if (configured.length > 0) {
    return configured;
  }

  if (env.WORKER_ENV === "production") {
    throw new Error(
      "JWT_SECRET must be configured when running in production environment",
    );
  }

  if (!cachedDevJwtSecret) {
    cachedDevJwtSecret = generateDevSecret();
    console.warn(
      "[auth] JWT_SECRET is not configured; generated ephemeral development secret. Set JWT_SECRET for stable sessions.",
    );
  }

  return cachedDevJwtSecret;
}

export async function sha256Hex(input: string): Promise<string> {
  const data = enc.encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function createAccessToken(
  secret: string,
  payload: { sub: string; email: string; roles: string[]; sid: string },
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({
    sub: payload.sub,
    email: payload.email,
    roles: payload.roles,
    sid: payload.sid,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + ACCESS_TTL_SECONDS)
    .sign(encodeSecret(secret));
}

export async function verifyAccessToken(secret: string, token: string) {
  const { payload } = await jwtVerify(token, encodeSecret(secret), {
    algorithms: ["HS256"],
  });
  return payload as {
    sub?: string;
    email?: string;
    roles?: string[];
    sid?: string;
    iat?: number;
    exp?: number;
  };
}

export function bearerTokenFrom(c: any): string | null {
  const auth = c.req.header("authorization") || c.req.header("Authorization");
  if (!auth) return null;
  const [scheme, token] = auth.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

export function setRefreshCookie(c: any, token: string, maxAgeSeconds: number) {
  setCookie(c, REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: maxAgeSeconds,
  });
}

export function clearRefreshCookie(c: any) {
  deleteCookie(c, REFRESH_COOKIE, { path: "/" });
}

export async function getUserByEmail(db: any, email: string) {
  const rows = await db.select().from(users).where(eq(users.email, email));
  return rows?.[0] ?? null;
}

/**
 * Read the canonical credential account for a user.
 */
export async function getCredentialAccountByUserId(db: any, userId: string) {
  const rows = await db
    .select()
    .from(authAccounts)
    .where(
      and(
        eq(authAccounts.userId, userId),
        eq(authAccounts.providerId, "credential"),
      ),
    )
    .limit(1);
  return rows?.[0] ?? null;
}

/** @deprecated Read-only compatibility helper for pre-v1 migrations. */
export async function getLocalIdentity(db: any, userId: string) {
  const rows = await db
    .select()
    .from(authIdentities)
    .where(
      and(
        eq(authIdentities.userId, userId),
        eq(authIdentities.provider, "local"),
      ),
    );
  return rows?.[0] ?? null;
}

/** @deprecated Read-only compatibility helper for pre-v1 migrations. */
export async function getCredentialByIdentity(db: any, identityId: string) {
  const rows = await db
    .select()
    .from(authCredentials)
    .where(eq(authCredentials.identityId, identityId));
  return rows?.[0] ?? null;
}
