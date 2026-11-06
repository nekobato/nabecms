import { Hono, type Context } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { settings, users } from "../../../database/schema";
import type { AppContext } from "../../../types";
import { eq } from "drizzle-orm";
import { hasBootstrapAdminRole } from "../../../lib/system-roles";

const SYSTEM_INITIALIZED_KEY = "system.initialized" as const;
const NO_SUCH_TABLE_PATTERN = /no such table/i;

type ErrorWithCause = {
  message?: unknown;
  cause?: unknown;
};

/**
 * Extract a message string from unknown error-like values.
 */
const getErrorMessage = (value: unknown): string | null => {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  if (
    value &&
    typeof value === "object" &&
    "message" in value &&
    typeof (value as { message?: unknown }).message === "string"
  ) {
    return (value as { message: string }).message;
  }
  return null;
};

/**
 * Detect D1 schema-not-initialized errors by traversing nested causes.
 */
export const isDatabaseNotInitializedError = (error: unknown): boolean => {
  const stack: unknown[] = [error];
  const seen = new Set<object>();

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    const message = getErrorMessage(current);
    if (message && NO_SUCH_TABLE_PATTERN.test(message)) {
      return true;
    }

    if (typeof current !== "object") continue;
    if (seen.has(current)) continue;
    seen.add(current);

    if ("cause" in current) {
      stack.push((current as ErrorWithCause).cause);
    }
  }

  return false;
};

function getDb(c: Context<AppContext>) {
  if (!c.env || !c.env.DB) {
    throw new Error("DB binding 'DB' is not configured");
  }
  return drizzle(c.env.DB);
}

const app = new Hono<AppContext>().get(
  "/api/admin/system/bootstrap",
  async (c) => {
    let db;
    try {
      db = getDb(c);
    } catch (error) {
      console.error("Bootstrap failed: database binding missing", error);
      return c.json(
        {
          error: {
            code: "DATABASE_NOT_CONFIGURED",
            message:
              (error as Error)?.message ?? "DB binding is not configured",
          },
        },
        500,
      );
    }

    try {
      const sentinel = await db
        .select({ key: settings.key })
        .from(settings)
        .where(eq(settings.key, SYSTEM_INITIALIZED_KEY));
      if (sentinel.length > 0) {
        return c.json({ initialized: true, allowInitialize: false });
      }
      const rows = await db
        .select({ id: users.id, roleId: users.roleId })
        .from(users as any);
      const hasAdmin = rows.some((u: any) => hasBootstrapAdminRole(u.roleId));
      const initialized = rows.length > 0 && hasAdmin;
      const allowInitialize = !initialized;
      return c.json({ initialized, allowInitialize });
    } catch (error) {
      const message = (error as Error)?.message ?? "Unknown error";
      const code = isDatabaseNotInitializedError(error)
        ? "DATABASE_NOT_INITIALIZED"
        : "SYSTEM_BOOTSTRAP_FAILED";
      console.error("Bootstrap failed", error);
      return c.json({ error: { code, message } }, 500);
    }
  },
);

export default app;
