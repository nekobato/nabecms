import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { users, settings } from "../../../database/schema";
import * as schema from "../../../database/schema";
import { generateIdWithPrefix } from "../../../utils/id";
import { eq } from "drizzle-orm";
import type { AppContext } from "../../../types";
import {
  BOOTSTRAP_SECRET_HEADER,
  constantTimeEquals,
  getBootstrapSecret,
} from "../../../lib/bootstrap-secret";
import { initializeAuthLifecycle } from "../../../services/auth-lifecycle";
import { enforceAuthRateLimit } from "../../../services/auth-rate-limit";

const InitializeSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
  name: z.string().trim().min(1),
  defaultLocale: z
    .string()
    .trim()
    .min(2)
    .max(32)
    .regex(/^[A-Za-z0-9-]+$/u, "Invalid locale code"),
});

const SYSTEM_INITIALIZED_KEY = "system.initialized" as const;

/**
 * Return whether a failed bootstrap batch collided with an initialization
 * sentinel or first-user uniqueness constraint.
 */
const isInitializationConflictError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /unique constraint failed:\s*(settings\.key|users\.(id|email))/iu.test(
    message,
  );
};

const app = new Hono<AppContext>().post(
  "/api/admin/auth/initialize",
  async (c) => {
    const rateLimitResponse = await enforceAuthRateLimit(c, {
      operation: "initialize",
      identifier: "route-global",
    });
    if (rateLimitResponse) return rateLimitResponse;

    const db = drizzle(c.env.DB, { schema });

    const sentinel = await db
      .select({ key: settings.key })
      .from(settings)
      .where(eq(settings.key, SYSTEM_INITIALIZED_KEY));
    if (sentinel.length > 0) {
      return c.json(
        {
          error: {
            code: "ALREADY_INITIALIZED",
            message: "System is already initialized",
          },
        },
        409,
      );
    }

    const existingUsers = await db.select({ id: users.id }).from(users as any);
    if (existingUsers.length > 0) {
      return c.json(
        {
          error: {
            code: "ALREADY_INITIALIZED",
            message: "System is already initialized",
          },
        },
        409,
      );
    }

    const bootstrapSecret = getBootstrapSecret(c.env);
    if (!bootstrapSecret) {
      return c.json(
        {
          error: {
            code: "BOOTSTRAP_SECRET_NOT_CONFIGURED",
            message: "BOOTSTRAP_SECRET is not configured",
          },
        },
        500,
      );
    }

    const providedSecret = c.req.header(BOOTSTRAP_SECRET_HEADER) ?? "";
    if (
      providedSecret.length === 0 ||
      !constantTimeEquals(bootstrapSecret, providedSecret)
    ) {
      return c.json(
        {
          error: {
            code: "INVALID_BOOTSTRAP_SECRET",
            message: "Bootstrap secret is invalid",
          },
        },
        401,
      );
    }

    const body = await c.req.json().catch(() => null);
    const parsed = InitializeSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: { code: "BAD_REQUEST", message: "Invalid payload" } },
        400,
      );
    }
    const { password, defaultLocale } = parsed.data;
    const email = parsed.data.email.trim().toLowerCase();
    const name = parsed.data.name.trim();

    const cost = Number(c.env.BCRYPT_COST || 10);
    const passwordHash = await bcrypt.hash(password, cost);

    const userId = generateIdWithPrefix("user");
    const accountId = generateIdWithPrefix("authacct");
    const now = new Date();

    try {
      await initializeAuthLifecycle(db, {
        userId,
        accountId,
        email,
        name,
        passwordHash,
        defaultLocale,
        now,
      });

      // Do NOT issue any session; client should redirect to login page
      return c.json({ userId }, 201);
    } catch (error) {
      console.error("Failed during initialize sequence", error);

      if (isInitializationConflictError(error)) {
        return c.json(
          {
            error: {
              code: "ALREADY_INITIALIZED",
              message: "System is already initialized",
            },
          },
          409,
        );
      }

      return c.json(
        {
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to initialize system",
          },
        },
        500,
      );
    }
  },
);

export default app;
