import { Hono } from "hono";
import type { AppContext } from "../../types";
import { requireActor, requireSuperAdmin } from "./_authz";
import {
  getLogManagement,
  logRetentionSchema,
  updateLogRetention,
} from "../../services/log-retention";

const app = new Hono<AppContext>()
  .use("/api/admin/settings/logs", async (c, next) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const denied = requireSuperAdmin(c, actor);
    if (denied) return denied;
    c.header("Cache-Control", "no-store");
    await next();
  })
  .get("/api/admin/settings/logs", async (c) => {
    try {
      return c.json(await getLogManagement(c.env.DB));
    } catch {
      return c.json(
        {
          error: {
            code: "LOG_MANAGEMENT_UNAVAILABLE",
            message: "Log management is unavailable",
          },
        },
        503,
      );
    }
  })
  .put("/api/admin/settings/logs", async (c) => {
    const parsed = logRetentionSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success)
      return c.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "Invalid retention period",
          },
        },
        400,
      );
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    try {
      await updateLogRetention(c.env.DB, parsed.data, actor.id);
      return c.json({ item: parsed.data });
    } catch {
      return c.json(
        {
          error: {
            code: "LOG_RETENTION_SAVE_FAILED",
            message: "Could not save retention settings",
          },
        },
        503,
      );
    }
  });

export default app;
