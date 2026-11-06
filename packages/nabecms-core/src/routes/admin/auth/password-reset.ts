import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import bcrypt from "bcryptjs";
import type { AppContext } from "../../../types";
import { authAccounts, authVerifications } from "../../../database/schema";
import * as schema from "../../../database/schema";
import { getUserByEmail, sha256Hex } from "../../../lib/auth";
import {
  getEmailSettings,
  sendAuthEmail,
} from "../../../services/email-settings";
import { enforceAuthRateLimit } from "../../../services/auth-rate-limit";
import { generateIdWithPrefix } from "../../../utils/id";
import { resetCredentialPasswordLifecycle } from "../../../services/auth-lifecycle";

const REQUEST_PASSWORD_RESET_PATH = "/admin/auth/reset-password";
const PASSWORD_RESET_EXPIRES_MS = 60 * 60 * 1000;
const TOKEN_SECRET_BYTES = 24;
const PASSWORD_RESET_SUBJECT = "NabeCMS password reset";
const CREDENTIAL_PROVIDER_ID = "credential";

const requestPasswordResetSchema = z.object({
  email: z.email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(16),
  newPassword: z.string().min(8).max(72),
});

/**
 * Build the verification identifier namespace for one user.
 */
const buildResetIdentifier = (userId: string): string =>
  `password_reset:${userId}`;

/**
 * Convert bytes into a URL-safe base64 string.
 */
const toBase64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "");
};

/**
 * Generate high-entropy token secret for password reset flow.
 */
const generateTokenSecret = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_SECRET_BYTES));
  return toBase64Url(bytes);
};

/**
 * Parse `userId.secret` token format.
 */
const parseResetToken = (
  token: string,
): { userId: string; secret: string } | null => {
  const separator = token.indexOf(".");
  if (separator <= 0 || separator === token.length - 1) return null;

  const userId = token.slice(0, separator).trim();
  const secret = token.slice(separator + 1).trim();
  if (userId.length === 0 || secret.length === 0) return null;

  return { userId, secret };
};

/**
 * Find the canonical credential account for one user.
 */
const getCredentialAccountByUserId = async (
  db: DrizzleD1Database<typeof schema>,
  userId: string,
) => {
  const rows = await db
    .select()
    .from(authAccounts)
    .where(
      and(
        eq(authAccounts.userId, userId),
        eq(authAccounts.providerId, CREDENTIAL_PROVIDER_ID),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
};

const app = new Hono<AppContext>()
  .use("/api/admin/auth/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  })
  .post("/api/admin/auth/request-password-reset", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = requestPasswordResetSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: { code: "BAD_REQUEST", message: "Invalid payload" } },
        400,
      );
    }

    const config = await getEmailSettings(c.env);
    if (!config.environment.configured || !config.item.passwordResetEnabled)
      return c.json(
        {
          error: {
            code: "EMAIL_DISABLED",
            message: "Password reset is unavailable",
          },
        },
        403,
      );
    for (const limit of [
      {
        operation: "password_reset_request" as const,
        identifier: parsed.data.email.trim().toLowerCase(),
      },
      {
        operation: "password_reset_ip" as const,
        identifier: c.req.header("CF-Connecting-IP") || "local",
      },
    ]) {
      const blocked = await enforceAuthRateLimit(c, limit);
      if (blocked) return blocked;
    }
    // A common response must not wait for account lookup or provider delivery.
    const dispatch = async () => {
      const db = drizzle(c.env.DB, { schema });
      const email = parsed.data.email.trim().toLowerCase();
      const user = await getUserByEmail(db, email);

      // Avoid user enumeration: always return success when the user is absent.
      if (!user) {
        return;
      }

      const now = new Date();
      const expiresAt = new Date(now.getTime() + PASSWORD_RESET_EXPIRES_MS);
      const secret = generateTokenSecret();
      const token = `${(user as any).id}.${secret}`;
      const secretHash = await sha256Hex(secret);
      const identifier = buildResetIdentifier((user as any).id);

      const verificationId = generateIdWithPrefix("verify");
      // Keep earlier valid links when another delivery is requested or fails.
      await db.insert(authVerifications).values({
        id: verificationId,
        identifier,
        value: secretHash,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      });
      const resetUrl = new URL(
        REQUEST_PASSWORD_RESET_PATH,
        config.environment.baseUrl!,
      );
      resetUrl.searchParams.set("token", token);
      const delivery = await sendAuthEmail(
        c.env,
        config.item,
        "password_reset",
        (user as any).email,
        PASSWORD_RESET_SUBJECT,
        `A password reset was requested. / パスワード再設定が要求されました。\n\n${resetUrl}\n\nExpires / 有効期限: ${expiresAt.toISOString()}`,
      );
      if (delivery.status === "failed")
        await db
          .delete(authVerifications)
          .where(eq(authVerifications.id, verificationId));
      return;
    };
    const work = dispatch().catch(() => {
      console.warn("Password reset request could not be processed");
    });
    let executionContext;
    try {
      executionContext = c.executionCtx;
    } catch {
      /* Standalone app.request tests have no Worker context. */
    }
    if (executionContext) executionContext.waitUntil(work);
    else await work;
    return c.json({ success: true });
  })
  .post("/api/admin/auth/reset-password", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = resetPasswordSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: { code: "BAD_REQUEST", message: "Invalid payload" } },
        400,
      );
    }

    const blocked = await enforceAuthRateLimit(c, {
      operation: "password_reset_confirm",
      identifier: parsed.data.token,
    });
    if (blocked) return blocked;
    const tokenParts = parseResetToken(parsed.data.token);
    if (!tokenParts) {
      return c.json(
        { error: { code: "INVALID_TOKEN", message: "Invalid reset token" } },
        400,
      );
    }

    const db = drizzle(c.env.DB, { schema });
    const identifier = buildResetIdentifier(tokenParts.userId);
    const tokenHash = await sha256Hex(tokenParts.secret);
    const rows = await db
      .select()
      .from(authVerifications)
      .where(
        and(
          eq(authVerifications.identifier, identifier),
          eq(authVerifications.value, tokenHash),
        ),
      )
      .limit(1);
    const verification = rows[0];
    if (!verification) {
      return c.json(
        { error: { code: "INVALID_TOKEN", message: "Invalid reset token" } },
        400,
      );
    }

    const now = new Date();
    if (verification.expiresAt.getTime() <= now.getTime()) {
      await db
        .delete(authVerifications)
        .where(eq(authVerifications.id, verification.id));
      return c.json(
        { error: { code: "TOKEN_EXPIRED", message: "Reset token expired" } },
        410,
      );
    }

    const credentialAccount = await getCredentialAccountByUserId(
      db,
      tokenParts.userId,
    );
    const cost = Number(c.env.BCRYPT_COST || 10);
    const passwordHash = await bcrypt.hash(parsed.data.newPassword, cost);
    const reset = await resetCredentialPasswordLifecycle(db, {
      accountId: credentialAccount?.id ?? generateIdWithPrefix("authacct"),
      createAccount: !credentialAccount,
      userId: tokenParts.userId,
      verificationId: verification.id,
      verificationIdentifier: identifier,
      verificationValue: tokenHash,
      passwordHash,
      now,
    });
    if (!reset) {
      return c.json(
        { error: { code: "INVALID_TOKEN", message: "Invalid reset token" } },
        400,
      );
    }

    return c.json({ success: true });
  });

export default app;
