import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { getCookie } from "hono/cookie";
import { and, eq } from "drizzle-orm";
import { authSessions, users } from "../../../database/schema";
import {
  REFRESH_COOKIE,
  sha256Hex,
  setRefreshCookie,
  createAccessToken,
  ensureJwtSecret,
  REFRESH_TTL_SECONDS,
} from "../../../lib/auth";
import { resolveUserPreferences } from "../../../lib/user-preferences";
import type { AppContext } from "../../../types";

const app = new Hono<AppContext>().post(
  "/api/admin/auth/refresh",
  async (c) => {
    const cookie = getCookie(c, REFRESH_COOKIE);
    if (!cookie)
      return c.json(
        { error: { code: "UNAUTHORIZED", message: "No refresh" } },
        401,
      );
    const db = drizzle(c.env.DB);
    const hash = await sha256Hex(cookie);
    const rows = await db
      .select()
      .from(authSessions)
      .where(eq(authSessions.legacyRefreshTokenHash, hash));
    const sess = rows?.[0];
    if (!sess)
      return c.json(
        { error: { code: "UNAUTHORIZED", message: "Invalid session" } },
        401,
      );
    if (new Date((sess as any).expiresAt).getTime() < Date.now()) {
      return c.json(
        { error: { code: "UNAUTHORIZED", message: "Session expired" } },
        401,
      );
    }

    // Load user
    const userRows = await db
      .select()
      .from(users)
      .where(eq(users.id, (sess as any).userId));
    const user = userRows?.[0];
    if (!user)
      return c.json(
        { error: { code: "UNAUTHORIZED", message: "Invalid user" } },
        401,
      );

    // Rotate refresh
    const newToken =
      crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
    const newHash = await sha256Hex(newToken);
    const newExp = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);

    const roles = (user as any).roleId || [];
    const uiPreferences = resolveUserPreferences((user as any).uiPreferences);

    try {
      const jwtSecret = ensureJwtSecret(c.env);
      const accessToken = await createAccessToken(jwtSecret, {
        sub: (user as any).id,
        email: (user as any).email,
        roles,
        sid: (sess as any).id,
      });
      const updated = await db
        .update(authSessions)
        .set({
          token: `legacy:${newHash}`,
          legacyRefreshTokenHash: newHash,
          expiresAt: newExp,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(authSessions.id, (sess as any).id),
            eq(authSessions.legacyRefreshTokenHash, hash),
          ),
        )
        .returning({ id: authSessions.id });
      if (updated.length !== 1) {
        return c.json(
          { error: { code: "UNAUTHORIZED", message: "Session rotated" } },
          401,
        );
      }
      setRefreshCookie(c, newToken, REFRESH_TTL_SECONDS);
      return c.json({
        accessToken,
        user: {
          id: (user as any).id,
          email: (user as any).email,
          name: (user as any).name,
          roleId: roles,
          uiPreferences,
        },
      });
    } catch (error) {
      console.error("Failed to sign access token", error);
      return c.json(
        {
          error: {
            code: "SERVER_ERROR",
            message: "Authentication is misconfigured",
          },
        },
        500,
      );
    }
  },
);

export default app;
