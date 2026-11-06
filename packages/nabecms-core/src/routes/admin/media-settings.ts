import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import type { AppContext } from "../../types";
import { createSettingsRepository } from "../../repositories/settings";
import {
  getMediaSettings,
  updateMediaSettings,
  MediaSettingsValidationError,
} from "../../services/media-settings";
import * as schema from "../../database/schema";
import { generateIdWithPrefix } from "../../utils/id";
import { requireActor, requirePermission } from "./_authz";
import {
  MEDIA_SETTINGS_READ_PERMISSIONS,
  MEDIA_SETTINGS_WRITE_PERMISSION,
} from "./_permissions";

const app = new Hono<AppContext>()
  .get("/api/admin/settings/media", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const permission = await requirePermission(
      c,
      actor,
      MEDIA_SETTINGS_READ_PERMISSIONS,
    );
    if (permission instanceof Response) return permission;

    const db = drizzle(c.env.DB, { schema });
    const repo = createSettingsRepository(db);
    const settings = await getMediaSettings({ repo });
    return c.json({ item: settings });
  })
  .put("/api/admin/settings/media", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;

    const permission = await requirePermission(
      c,
      actor,
      MEDIA_SETTINGS_WRITE_PERMISSION,
    );
    if (permission instanceof Response) return permission;

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

    const db = drizzle(c.env.DB, { schema });
    const repo = createSettingsRepository(db);

    try {
      const settings = await updateMediaSettings(
        { repo, now: () => new Date() },
        payload,
      );
      await db.insert(schema.auditLogs).values({
        id: generateIdWithPrefix("audit"),
        userId: actor.id,
        action: "update",
        targetTable: "settings",
        targetId: "media_settings",
        before: null,
        after: null,
        createdAt: new Date().toISOString(),
      });
      return c.json({ item: settings });
    } catch (error) {
      if (error instanceof MediaSettingsValidationError) {
        return c.json(
          {
            error: {
              code: "INVALID_REQUEST",
              message: "Invalid media settings",
              issues: error.issues,
            },
          },
          400,
        );
      }
      if (error instanceof z.ZodError) {
        return c.json(
          {
            error: {
              code: "INVALID_REQUEST",
              message: "Invalid media settings",
              issues: error.issues,
            },
          },
          400,
        );
      }
      console.error("Failed to update media settings", error);
      return c.json(
        {
          error: {
            code: "MEDIA_SETTINGS_UPDATE_FAILED",
            message: "Failed to update media settings",
          },
        },
        500,
      );
    }
  });

export default app;
