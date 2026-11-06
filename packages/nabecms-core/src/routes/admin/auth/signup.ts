import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import bcrypt from "bcryptjs";
import {
  users,
  userRoles,
  authAccounts,
  authSessions,
} from "../../../database/schema";
import {
  sha256Hex,
  setRefreshCookie,
  createAccessToken,
  ensureJwtSecret,
  REFRESH_TTL_SECONDS,
  getUserByEmail,
} from "../../../lib/auth";
import { DEFAULT_USER_PREFERENCES } from "../../../lib/user-preferences";
import {
  SUPER_ADMIN_ROLE_ID,
  hasBootstrapAdminRole,
} from "../../../lib/system-roles";
import {
  BOOTSTRAP_SECRET_HEADER,
  constantTimeEquals,
  getBootstrapSecret,
} from "../../../lib/bootstrap-secret";
import { generateIdWithPrefix } from "../../../utils/id";
import { AppContext } from "../../../types";

const SignupSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
  name: z.string().min(1),
});

const app = new Hono<AppContext>().post("/api/admin/auth/signup", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = SignupSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: { code: "BAD_REQUEST", message: "Invalid payload" } },
      400,
    );
  }
  const db = drizzle(c.env.DB);
  const { email, password, name } = parsed.data;

  // Check bootstrap state
  const existingUsers = await db
    .select({ id: users.id, roleId: users.roleId })
    .from(users);
  const adminExists = existingUsers.some((u: any) =>
    hasBootstrapAdminRole(u.roleId),
  );
  if (existingUsers.length > 0 && adminExists) {
    return c.json(
      {
        error: {
          code: "FORBIDDEN",
          message: "Signup disabled: admin already exists",
        },
      },
      403,
    );
  }

  const bootstrapSecret = getBootstrapSecret(c.env);
  if (!bootstrapSecret) {
    return c.json(
      {
        error: {
          code: "BOOTSTRAP_SECRET_NOT_CONFIGURED",
          message: "BOOTSTRAP_SECRET is not configured",
        },
      },
      500,
    );
  }

  const providedSecret = c.req.header(BOOTSTRAP_SECRET_HEADER) ?? "";
  if (
    providedSecret.length === 0 ||
    !constantTimeEquals(bootstrapSecret, providedSecret)
  ) {
    return c.json(
      {
        error: {
          code: "INVALID_BOOTSTRAP_SECRET",
          message: "Bootstrap secret is invalid",
        },
      },
      401,
    );
  }

  const found = await getUserByEmail(db, email);
  if (found) {
    return c.json(
      { error: { code: "CONFLICT", message: "Email already exists" } },
      409,
    );
  }

  const cost = Number(c.env.BCRYPT_COST || 10);
  const passwordHash = await bcrypt.hash(password, cost);

  const userId = generateIdWithPrefix("user");
  const accountId = generateIdWithPrefix("authacct");
  const sessionId = generateIdWithPrefix("sess");

  // Create domain user (roleId includes 'admin')
  const newUser = {
    id: userId,
    email,
    password: "!",
    name,
    roleId: [SUPER_ADMIN_ROLE_ID] as any,
    uiPreferences: DEFAULT_USER_PREFERENCES,
  };
  // Create session & cookie
  const refreshToken = generateIdWithPrefix("rft");
  const refreshHash = await sha256Hex(refreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);
  const userAgent = c.req.header("User-Agent") || undefined;
  const ip = c.req.header("CF-Connecting-IP") || undefined;

  try {
    const jwtSecret = ensureJwtSecret(c.env);
    const accessToken = await createAccessToken(jwtSecret, {
      sub: userId,
      email,
      roles: [SUPER_ADMIN_ROLE_ID],
      sid: sessionId,
    });
    const now = new Date();
    await db.batch([
      db.insert(users).values(newUser),
      db.insert(userRoles).values({
        userId,
        roleId: SUPER_ADMIN_ROLE_ID,
      }),
      db.insert(authAccounts).values({
        id: accountId,
        userId,
        providerId: "credential",
        accountId: userId,
        password: passwordHash,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(authSessions).values({
        id: sessionId,
        userId,
        token: `legacy:${refreshHash}`,
        legacyRefreshTokenHash: refreshHash,
        userAgent,
        ipAddress: ip,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      }),
    ]);
    setRefreshCookie(c, refreshToken, REFRESH_TTL_SECONDS);

    return c.json({
      accessToken,
      user: {
        id: userId,
        email,
        name,
        roleId: [SUPER_ADMIN_ROLE_ID],
        uiPreferences: DEFAULT_USER_PREFERENCES,
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
});

export default app;
