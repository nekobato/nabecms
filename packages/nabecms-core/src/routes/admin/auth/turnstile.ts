import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import type { AppContext } from "../../../types";
import * as schema from "../../../database/schema";
import { createSettingsRepository } from "../../../repositories/settings";
import {
  getAuthSecuritySettings,
  getTurnstileEnvironmentState,
} from "../../../services/auth-security-settings";

const app = new Hono<AppContext>().get(
  "/api/admin/auth/turnstile/config",
  async (c) => {
    const db = drizzle(c.env.DB, { schema });
    const repo = createSettingsRepository(db);
    const settings = await getAuthSecuritySettings({ repo });
    const env = getTurnstileEnvironmentState(c.env);

    return c.json({
      enabled: settings.turnstile.enabled,
      siteKey: env.siteKey,
      configured: {
        siteKey: env.siteKeyConfigured,
        secretKey: env.secretKeyConfigured,
        canEnable: env.canEnable,
      },
    });
  },
);

export default app;
