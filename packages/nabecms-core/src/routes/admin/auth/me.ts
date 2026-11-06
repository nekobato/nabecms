import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { users } from "../../../database/schema";
import { resolveUserPreferences } from "../../../lib/user-preferences";
import type { AppContext } from "../../../types";
import { requireActor } from "../_authz";

const app = new Hono<AppContext>().get("/api/admin/auth/me", async (c) => {
  const actor = await requireActor(c);
  if (actor instanceof Response) return actor;

  try {
    const db = drizzle(c.env.DB);
    const rows = await db.select().from(users).where(eq(users.id, actor.id));
    const user = rows?.[0];
    if (!user)
      return c.json(
        { error: { code: "UNAUTHORIZED", message: "Invalid user" } },
        401,
      );
    return c.json({
      user: {
        id: (user as any).id,
        email: (user as any).email,
        name: (user as any).name,
        roleId: (user as any).roleId || [],
        uiPreferences: resolveUserPreferences((user as any).uiPreferences),
      },
    });
  } catch {
    return c.json(
      { error: { code: "UNAUTHORIZED", message: "Invalid token" } },
      401,
    );
  }
});

export default app;
