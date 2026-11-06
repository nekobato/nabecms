import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { users } from "../../database/schema";
import { Hono } from "hono";
import type { AppContext } from "../../types";
import { requireActor, requireSuperAdmin } from "./_authz";
import {
  emailSettingsSchema,
  getEmailSettings,
  saveEmailSettings,
  sendAuthEmail,
} from "../../services/email-settings";
import { enforceAuthRateLimit } from "../../services/auth-rate-limit";

const app = new Hono<AppContext>()
  .get("/api/admin/auth/email-capabilities", async (c) => {
    c.header("Cache-Control", "no-store");
    const data = await getEmailSettings(c.env);
    return c.json({
      invitesEnabled: data.environment.configured && data.item.invitesEnabled,
      passwordResetEnabled:
        data.environment.configured && data.item.passwordResetEnabled,
    });
  })
  .use("/api/admin/settings/email*", async (c, next) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const denied = requireSuperAdmin(c, actor);
    if (denied) return denied;
    c.header("Cache-Control", "no-store");
    await next();
  })
  .get("/api/admin/settings/email", async (c) =>
    c.json(await getEmailSettings(c.env)),
  )
  .put("/api/admin/settings/email", async (c) => {
    const parsed = emailSettingsSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success)
      return c.json(
        {
          error: { code: "INVALID_REQUEST", message: "Invalid email settings" },
        },
        400,
      );
    const data = await getEmailSettings(c.env);
    if (
      !data.environment.configured &&
      (parsed.data.invitesEnabled || parsed.data.passwordResetEnabled)
    )
      return c.json(
        {
          error: {
            code: "EMAIL_NOT_CONFIGURED",
            message: "Email environment is not configured",
          },
        },
        400,
      );
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    await saveEmailSettings(c.env, parsed.data, actor.id);
    return c.json(await getEmailSettings(c.env));
  })
  .post("/api/admin/settings/email/test", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const blocked = await enforceAuthRateLimit(c, {
      operation: "email_test",
      identifier: actor.id,
    });
    if (blocked) return blocked;
    const data = await getEmailSettings(c.env);
    if (!data.environment.configured)
      return c.json(
        {
          error: {
            code: "EMAIL_NOT_CONFIGURED",
            message: "Email environment is not configured",
          },
        },
        400,
      );
    const [user] = await drizzle(c.env.DB)
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, actor.id))
      .limit(1);
    if (!user)
      return c.json(
        { error: { code: "NOT_FOUND", message: "User not found" } },
        404,
      );
    const delivery = await sendAuthEmail(
      c.env,
      data.item,
      "test",
      user.email,
      "NabeCMS email test",
      "Your NabeCMS email configuration test. / NabeCMSのメール設定テストです。",
    );
    return c.json({ delivery }, delivery.status === "accepted" ? 200 : 502);
  });
export default app;
