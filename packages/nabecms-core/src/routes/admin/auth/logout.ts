import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { getCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import { authSessions } from "../../../database/schema";
import {
  REFRESH_COOKIE,
  sha256Hex,
  clearRefreshCookie,
} from "../../../lib/auth";
import type { AppContext } from "../../../types";

const app = new Hono<AppContext>().post("/api/admin/auth/logout", async (c) => {
  const cookie = getCookie(c, REFRESH_COOKIE);
  if (cookie) {
    const db = drizzle(c.env.DB);
    const hash = await sha256Hex(cookie);
    await db
      .delete(authSessions)
      .where(eq(authSessions.legacyRefreshTokenHash, hash));
  }
  clearRefreshCookie(c);
  return c.body(null, 204);
});

export default app;
