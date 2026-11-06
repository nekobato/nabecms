/**
 * Admin user preference endpoints.
 */
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../database/schema";
import {
  mergeUserPreferences,
  parseUserPreferencesPatch,
  resolveUserPreferences,
} from "../../lib/user-preferences";
import type { UserPreferencesPatch } from "../../lib/user-preferences";
import type { AppContext } from "../../types";
import { requireActor } from "./_authz";

const app = new Hono<AppContext>()
  .get("/api/admin/user-preferences", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;

    const db = drizzle(c.env.DB, { schema });
    const rows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, actor.id));
    const user = rows?.[0];
    if (!user) {
      return c.json(
        { error: { code: "UNAUTHORIZED", message: "Invalid user" } },
        401,
      );
    }

    const item = resolveUserPreferences((user as any).uiPreferences);
    return c.json({ item });
  })
  .put("/api/admin/user-preferences", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;

    const body = await c.req.json().catch(() => null);
    let patch: UserPreferencesPatch;
    try {
      patch = parseUserPreferencesPatch(body);
    } catch {
      return c.json(
        { error: { code: "BAD_REQUEST", message: "Invalid payload" } },
        400,
      );
    }

    const db = drizzle(c.env.DB, { schema });
    const rows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, actor.id));
    const user = rows?.[0];
    if (!user) {
      return c.json(
        { error: { code: "UNAUTHORIZED", message: "Invalid user" } },
        401,
      );
    }

    const next = mergeUserPreferences((user as any).uiPreferences, patch);
    await db
      .update(schema.users)
      .set({ uiPreferences: next, updatedAt: new Date().toISOString() })
      .where(eq(schema.users.id, actor.id));

    return c.json({ item: next });
  });

export default app;
