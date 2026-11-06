import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { authSessions, users } from "../../../database/schema";
import { createAccessToken, ensureJwtSecret } from "../../../lib/auth";
import { getBetterAuth, SsoConfigError } from "../../../lib/better-auth";
import { resolveUserPreferences } from "../../../lib/user-preferences";
import type { AppContext } from "../../../types";

const toRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;

const extractSessionUserId = (payload: unknown): string | null => {
  const root = toRecord(payload);
  if (!root) return null;

  const rootUser = toRecord(root.user);
  const nestedSession = toRecord(root.session);
  const nestedUser = toRecord(nestedSession?.user);
  const user = rootUser ?? nestedUser;
  if (!user) return null;

  const id = user.id;
  return typeof id === "string" && id.length > 0 ? id : null;
};

const extractSessionId = (payload: unknown): string | null => {
  const root = toRecord(payload);
  if (!root) return null;

  const session = toRecord(root.session);
  const id = session?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
};

const createAuthRequestHeaders = (c: any): Headers => {
  const requestHeaders = new Headers();
  const cookie = c.req.header("Cookie");
  if (cookie) {
    requestHeaders.set("Cookie", cookie);
  }
  return requestHeaders;
};

const app = new Hono<AppContext>().post(
  "/api/admin/auth/session-token",
  async (c) => {
    try {
      const auth = await getBetterAuth(c.env);
      if (!auth) {
        return c.json(
          {
            error: {
              code: "AUTH_SESSION_DISABLED",
              message: "Optional Better Auth sessions are disabled",
            },
          },
          404,
        );
      }

      const getSessionUrl = new URL(
        "/api/auth/get-session",
        c.req.url,
      ).toString();
      const authSessionResponse = await auth.handler(
        new Request(getSessionUrl, {
          method: "GET",
          headers: createAuthRequestHeaders(c),
        }),
      );
      const setCookie = authSessionResponse.headers.get("set-cookie");
      if (setCookie) {
        c.header("set-cookie", setCookie);
      }

      if (!authSessionResponse.ok) {
        return c.json(
          { error: { code: "UNAUTHORIZED", message: "No active session" } },
          401,
        );
      }

      const authSession = await authSessionResponse.json().catch(() => null);
      const sessionUserId = extractSessionUserId(authSession);
      const sessionId = extractSessionId(authSession);
      if (!sessionUserId || !sessionId) {
        return c.json(
          { error: { code: "UNAUTHORIZED", message: "No active session" } },
          401,
        );
      }

      const db = drizzle(c.env.DB);
      const sessionRows = await db
        .select()
        .from(authSessions)
        .where(eq(authSessions.id, sessionId))
        .limit(1);
      const session = sessionRows[0];
      if (
        !session ||
        session.userId !== sessionUserId ||
        session.expiresAt.getTime() < Date.now()
      ) {
        return c.json(
          { error: { code: "UNAUTHORIZED", message: "Invalid session" } },
          401,
        );
      }

      const rows = await db
        .select()
        .from(users)
        .where(eq(users.id, session.userId))
        .limit(1);
      const user = rows[0];
      if (!user) {
        return c.json(
          { error: { code: "UNAUTHORIZED", message: "Invalid user" } },
          401,
        );
      }

      const roles = (user as any).roleId || [];
      const uiPreferences = resolveUserPreferences((user as any).uiPreferences);
      const jwtSecret = ensureJwtSecret(c.env);
      const accessToken = await createAccessToken(jwtSecret, {
        sub: (user as any).id,
        email: (user as any).email,
        roles,
        sid: sessionId,
      });

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
      if (error instanceof SsoConfigError) {
        return c.json(
          {
            error: {
              code: "AUTH_CONFIGURATION_ERROR",
              message: error.message,
            },
          },
          500,
        );
      }

      console.error("Failed to issue session token", error);
      return c.json(
        {
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to issue session token",
          },
        },
        500,
      );
    }
  },
);

export default app;
