import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import type { AppContext } from "../../types";
import * as schema from "../../database/schema";
import { createSettingsRepository } from "../../repositories/settings";
import { requireActor, requireSuperAdmin, isSuperAdminActor } from "./_authz";
import { generateIdWithPrefix } from "../../utils/id";
import {
  getAuthSecuritySettings,
  getTurnstileEnvironmentState,
  updateAuthSecuritySettings,
  AuthSecuritySettingsValidationError,
  TurnstileEnvironmentMissingError,
  AUTH_SECURITY_SETTINGS_KEY,
} from "../../services/auth-security-settings";

const updateAuthSecuritySettingsSchema = z.object({
  turnstile: z.object({
    enabled: z.boolean(),
  }),
});

/**
 * Create repository dependencies for auth security settings routes.
 * @param c - Hono context
 * @returns Database and settings repository
 */
function createDeps(c: any) {
  const db = drizzle(c.env.DB, { schema });
  return {
    db,
    repo: createSettingsRepository(db),
  };
}

const app = new Hono<AppContext>()
  .get("/api/admin/settings/auth-security", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;

    const { repo } = createDeps(c);
    const settings = await getAuthSecuritySettings({ repo });
    const env = getTurnstileEnvironmentState(c.env);
    return c.json({
      item: settings,
      env: {
        siteKeyConfigured: env.siteKeyConfigured,
        secretKeyConfigured: env.secretKeyConfigured,
        canEnable: env.canEnable,
      },
      editable: isSuperAdminActor(actor),
    });
  })
  .put("/api/admin/settings/auth-security", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;

    const superAdmin = requireSuperAdmin(c, actor);
    if (superAdmin instanceof Response) return superAdmin;

    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch (error) {
      if (error instanceof SyntaxError) {
        return c.json(
          { error: { code: "INVALID_REQUEST", message: "Invalid JSON" } },
          400,
        );
      }
      throw error;
    }

    const parsed = updateAuthSecuritySettingsSchema.safeParse(payload);
    if (!parsed.success) {
      return c.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "Invalid auth security settings",
            issues: parsed.error.issues,
          },
        },
        400,
      );
    }

    const { db, repo } = createDeps(c);

    try {
      const settings = await updateAuthSecuritySettings(
        { repo, now: () => new Date() },
        c.env,
        parsed.data,
      );
      await db.insert(schema.auditLogs).values({
        id: generateIdWithPrefix("audit"),
        userId: actor.id,
        action: "update",
        targetTable: "settings",
        targetId: AUTH_SECURITY_SETTINGS_KEY,
        before: null,
        after: null,
        createdAt: new Date().toISOString(),
      });
      const env = getTurnstileEnvironmentState(c.env);
      return c.json({
        item: settings,
        env: {
          siteKeyConfigured: env.siteKeyConfigured,
          secretKeyConfigured: env.secretKeyConfigured,
          canEnable: env.canEnable,
        },
        editable: true,
      });
    } catch (error) {
      if (error instanceof TurnstileEnvironmentMissingError) {
        return c.json(
          {
            error: {
              code: "TURNSTILE_ENV_MISSING",
              message: "Turnstile environment variables are missing",
              missing: error.missing,
            },
          },
          400,
        );
      }
      if (error instanceof AuthSecuritySettingsValidationError) {
        return c.json(
          {
            error: {
              code: "INVALID_REQUEST",
              message: "Invalid auth security settings",
              issues: error.issues,
            },
          },
          400,
        );
      }

      console.error("Failed to update auth security settings", error);
      return c.json(
        {
          error: {
            code: "AUTH_SECURITY_SETTINGS_UPDATE_FAILED",
            message: "Failed to update auth security settings",
          },
        },
        500,
      );
    }
  });

export default app;
