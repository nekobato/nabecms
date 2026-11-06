import { sealInviteToken, deliverInvite } from "../../../services/invite-email";
import { getEmailSettings } from "../../../services/email-settings";
import { Hono } from "hono";
import { z } from "zod";
import { drizzle } from "drizzle-orm/d1";
import bcrypt from "bcryptjs";
import type { AppContext } from "../../../types";
import {
  createAccessToken,
  REFRESH_TTL_SECONDS,
  setRefreshCookie,
  sha256Hex,
  ensureJwtSecret,
} from "../../../lib/auth";
import { DEFAULT_USER_PREFERENCES } from "../../../lib/user-preferences";
import { isInvitableRole } from "../../../contracts/invites";
import * as schema from "../../../database/schema";
import { createAuthInvitesRepository } from "../../../repositories/auth-invites";
import { createRoleRepository } from "../../../repositories/roles";
import { createUserRepository } from "../../../repositories/users";
import { createAuthRepository } from "../../../repositories/auth";
import {
  createInvite,
  InviteAlreadyExistsError,
  InviteConsumedError,
  InviteExpiredError,
  InviteNotFoundError,
  InviteRateLimitError,
  InviteRoleAssignmentError,
  InviteRevokedError,
  listInvites,
  regenerateInvite,
  resolveInviteByToken,
} from "../../../services/invites";
import { generateIdWithPrefix } from "../../../utils/id";
import {
  InvalidUserRoleError,
  UserAlreadyExistsError,
} from "../../../services/users";
import {
  acceptInviteLifecycle,
  InviteAcceptanceConflictError,
  InviteEmailConflictError,
} from "../../../services/auth-lifecycle";
import { requireActor, requirePermission } from "../_authz";
import { enforceAuthRateLimit } from "../../../services/auth-rate-limit";

const inviteCreateSchema = z.object({
  email: z.email(),
  roleIds: z.array(z.string().trim()).min(1),
  locale: z.string().optional(),
  sendEmail: z.boolean().optional(),
  note: z.string().optional(),
});

const inviteAcceptSchema = z.object({
  token: z.string().min(10),
  name: z.string().trim().min(1),
  password: z.string().min(8),
});

const inviteValidateSchema = z.object({
  token: z.string().min(10),
});

const INVITES_MANAGE_PERMISSIONS = [
  "users:invite:write",
  "users:*:write",
] as const;

const INVITE_TOKEN_BYTES = 64;
const INVITE_RATE_LIMIT_FALLBACK = "route-fallback" as const;

/**
 * Resolve a validated invite token or a stable fallback for malformed input.
 */
const resolveInviteRateLimitIdentifier = (body: unknown): string => {
  if (!body || typeof body !== "object") return INVITE_RATE_LIMIT_FALLBACK;
  const token = (body as Record<string, unknown>).token;
  const parsed = z.string().min(10).safeParse(token);
  return parsed.success ? parsed.data : INVITE_RATE_LIMIT_FALLBACK;
};

/**
 * Generate a URL-safe high-entropy invite token.
 */
function randomInviteToken(): string {
  const bytes = new Uint8Array(INVITE_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const base64 = btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return base64;
}

/**
 * Build request-scoped invite dependencies around the current D1 binding.
 */
function depsFactory(c: any) {
  const db = drizzle(c.env.DB, { schema });
  return {
    db,
    invitesRepo: createAuthInvitesRepository(db),
    rolesRepo: createRoleRepository(db),
    usersRepo: createUserRepository(db),
    authRepo: createAuthRepository(db),
    now: () => new Date(),
    generateId: (prefix: any) => generateIdWithPrefix(prefix),
    randomToken: randomInviteToken,
    hashToken: sha256Hex,
    sealToken: (id: string, token: string, expires: string) =>
      sealInviteToken(c.env, id, token, expires),
    hashPassword: async (password: string) => {
      const cost = Number(c.env.BCRYPT_COST || 10);
      return bcrypt.hash(password, cost);
    },
  };
}

const app = new Hono<AppContext>()
  .post("/api/admin/auth/invites", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const permission = await requirePermission(
      c,
      actor,
      INVITES_MANAGE_PERMISSIONS,
    );
    if (permission instanceof Response) return permission;

    const body = await c.req.json().catch(() => null);
    const parsed = inviteCreateSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: { code: "BAD_REQUEST", message: "Invalid payload" } },
        400,
      );
    }
    try {
      const deps = depsFactory(c);
      if (parsed.data.sendEmail) {
        const config = await getEmailSettings(c.env);
        if (!config.environment.configured || !config.item.invitesEnabled)
          return c.json(
            {
              error: {
                code: "EMAIL_DISABLED",
                message: "Invite email is unavailable",
              },
            },
            400,
          );
        const blocked = await enforceAuthRateLimit(c, {
          operation: "invite_email",
          identifier: actor.id,
        });
        if (blocked) return blocked;
      }
      const result = await createInvite(deps, {
        email: parsed.data.email,
        roleIds: parsed.data.roleIds,
        createdBy: actor.id,
        metadata: parsed.data.note ? { note: parsed.data.note } : undefined,
      });
      const invite = parsed.data.sendEmail
        ? await deps.invitesRepo.findById(result.inviteId)
        : null;
      const email = invite ? await deliverInvite(c.env, invite) : undefined;
      return c.json({ ...result, ...email }, 201);
    } catch (error) {
      if (error instanceof InviteRoleAssignmentError) {
        return c.json(
          { error: { code: "FORBIDDEN", message: error.message } },
          403,
        );
      }
      if (error instanceof InviteAlreadyExistsError) {
        return c.json(
          { error: { code: "CONFLICT", message: "Invite already exists" } },
          409,
        );
      }
      if (error instanceof InviteRateLimitError) {
        return c.json(
          { error: { code: "RATE_LIMITED", message: "Too many invites" } },
          429,
        );
      }
      if (error instanceof InviteNotFoundError) {
        return c.json(
          { error: { code: "NOT_FOUND", message: "Invite not found" } },
          404,
        );
      }
      if (error instanceof InviteExpiredError) {
        return c.json(
          { error: { code: "EXPIRED", message: "Invite expired" } },
          410,
        );
      }
      if (
        error instanceof InviteConsumedError ||
        error instanceof InviteRevokedError
      ) {
        return c.json(
          { error: { code: "GONE", message: "Invite not usable" } },
          410,
        );
      }
      if (error instanceof InviteRevokedError) {
        return c.json(
          { error: { code: "GONE", message: "Invite revoked" } },
          410,
        );
      }
      if (error instanceof InvalidUserRoleError) {
        return c.json(
          { error: { code: "BAD_REQUEST", message: error.message } },
          400,
        );
      }
      if (error instanceof UserAlreadyExistsError) {
        return c.json(
          {
            error: {
              code: "USER_ALREADY_EXISTS_FOR_INVITE",
              message:
                "User already exists. Change roles from the role management page.",
            },
          },
          409,
        );
      }
      console.error("Failed to create invite", error);
      return c.json(
        { error: { code: "INTERNAL_SERVER_ERROR", message: "Failed" } },
        500,
      );
    }
  })
  .get("/api/admin/auth/invites/role-options", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const denied = await requirePermission(
      c,
      actor,
      INVITES_MANAGE_PERMISSIONS,
    );
    if (denied instanceof Response) return denied;
    const roles = await depsFactory(c).rolesRepo.list();
    return c.json({
      items: roles
        .filter(isInvitableRole)
        .map(({ id, name, description, isSystem }) => ({
          id,
          name,
          description,
          isSystem,
        })),
    });
  })
  .get("/api/admin/auth/invites", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const permission = await requirePermission(
      c,
      actor,
      INVITES_MANAGE_PERMISSIONS,
    );
    if (permission instanceof Response) return permission;

    const statusParam = c.req.query("status");
    const email = c.req.query("email") || undefined;
    const statusList = statusParam
      ? statusParam
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;

    const deps = depsFactory(c);
    const items = await listInvites(deps, {
      status: statusList as any,
      email,
      limit: 100,
    });

    return c.json({
      items: items.map((inv) => ({
        id: inv.id,
        email: inv.email,
        roleIds: inv.roleIds,
        status: inv.status,
        expiresAt: inv.tokenExpiresAt,
        sentAt: inv.sentAt,
        createdAt: inv.createdAt,
        createdBy: inv.createdBy,
        updatedAt: inv.updatedAt,
        emailDelivery: inv.metadata?.emailDelivery ?? null,
        canResend: typeof inv.metadata?.emailToken === "string",
      })),
    });
  })
  .post("/api/admin/auth/invites/:inviteId/send", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const denied = await requirePermission(
      c,
      actor,
      INVITES_MANAGE_PERMISSIONS,
    );
    if (denied instanceof Response) return denied;
    const blocked = await enforceAuthRateLimit(c, {
      operation: "invite_email",
      identifier: actor.id,
    });
    if (blocked) return blocked;
    const deps = depsFactory(c);
    const invite = await deps.invitesRepo.findById(c.req.param("inviteId"));
    if (!invite)
      return c.json(
        { error: { code: "NOT_FOUND", message: "Invite not found" } },
        404,
      );
    let result: Awaited<ReturnType<typeof deliverInvite>>;
    try {
      result = await deliverInvite(c.env, invite);
    } catch (error) {
      if (error instanceof InviteRoleAssignmentError) {
        return c.json(
          { error: { code: "FORBIDDEN", message: error.message } },
          403,
        );
      }
      if (error instanceof InvalidUserRoleError) {
        return c.json(
          { error: { code: "BAD_REQUEST", message: error.message } },
          400,
        );
      }
      throw error;
    }
    if (result.error)
      return c.json(
        {
          error: { code: result.error, message: "Invite email is unavailable" },
        },
        409,
      );
    return c.json(result, result.delivery?.status === "accepted" ? 200 : 502);
  })
  .post("/api/admin/auth/invites/:inviteId/regenerate", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const permission = await requirePermission(
      c,
      actor,
      INVITES_MANAGE_PERMISSIONS,
    );
    if (permission instanceof Response) return permission;

    const rateLimitResponse = await enforceAuthRateLimit(c, {
      operation: "invite_regenerate",
      identifier: actor.id,
    });
    if (rateLimitResponse) return rateLimitResponse;

    try {
      const deps = depsFactory(c);
      const result = await regenerateInvite(
        deps,
        c.req.param("inviteId"),
        actor.id,
      );
      return c.json(result, 200);
    } catch (error) {
      if (error instanceof InviteRoleAssignmentError) {
        return c.json(
          { error: { code: "FORBIDDEN", message: error.message } },
          403,
        );
      }
      if (error instanceof InvalidUserRoleError) {
        return c.json(
          { error: { code: "BAD_REQUEST", message: error.message } },
          400,
        );
      }
      if (error instanceof InviteNotFoundError) {
        return c.json(
          { error: { code: "NOT_FOUND", message: "Invite not found" } },
          404,
        );
      }
      if (error instanceof InviteConsumedError) {
        return c.json(
          { error: { code: "GONE", message: "Invite already used" } },
          410,
        );
      }
      console.error("Failed to regenerate invite", error);
      return c.json(
        { error: { code: "INTERNAL_SERVER_ERROR", message: "Failed" } },
        500,
      );
    }
  })
  .post("/api/admin/auth/accept-invite/validate", async (c) => {
    const body = await c.req.json().catch(() => null);
    const rateLimitResponse = await enforceAuthRateLimit(c, {
      operation: "invite_accept",
      identifier: resolveInviteRateLimitIdentifier(body),
    });
    if (rateLimitResponse) return rateLimitResponse;

    const parsed = inviteValidateSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: { code: "BAD_REQUEST", message: "Invalid payload" } },
        400,
      );
    }
    const deps = depsFactory(c);
    let resolution: Awaited<ReturnType<typeof resolveInviteByToken>>;
    try {
      resolution = await resolveInviteByToken(deps, parsed.data.token);
    } catch (error) {
      if (error instanceof InviteRoleAssignmentError) {
        return c.json(
          { error: { code: "FORBIDDEN", message: error.message } },
          403,
        );
      }
      if (error instanceof InvalidUserRoleError) {
        return c.json(
          { error: { code: "BAD_REQUEST", message: error.message } },
          400,
        );
      }
      throw error;
    }
    if (!resolution.ok) {
      const statusCode = resolution.reason === "not_found" ? 404 : 410;
      return c.json(
        {
          error: {
            code: resolution.reason.toUpperCase(),
            message: "Invite invalid",
          },
        },
        statusCode,
      );
    }
    return c.json({
      email: resolution.invite.email,
      expiresAt: resolution.invite.tokenExpiresAt,
      status: resolution.invite.status,
    });
  })
  .post("/api/admin/auth/accept-invite", async (c) => {
    const body = await c.req.json().catch(() => null);
    const rateLimitResponse = await enforceAuthRateLimit(c, {
      operation: "invite_accept",
      identifier: resolveInviteRateLimitIdentifier(body),
    });
    if (rateLimitResponse) return rateLimitResponse;

    const parsed = inviteAcceptSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: { code: "BAD_REQUEST", message: "Invalid payload" } },
        400,
      );
    }

    const deps = depsFactory(c);
    try {
      const resolution = await resolveInviteByToken(deps, parsed.data.token);
      if (!resolution.ok) {
        switch (resolution.reason) {
          case "expired":
            throw new InviteExpiredError();
          case "revoked":
            throw new InviteRevokedError();
          case "consumed":
            throw new InviteConsumedError();
          default:
            throw new InviteNotFoundError();
        }
      }

      const { invite } = resolution;
      const roleIds = Array.from(
        new Set(
          (Array.isArray(invite.roleIds) ? invite.roleIds : [])
            .map((roleId) => roleId.trim())
            .filter((roleId) => roleId.length > 0),
        ),
      );
      if (roleIds.length === 0) {
        throw new InvalidUserRoleError("At least one role is required");
      }
      const assignedRoles = await deps.rolesRepo.findManyByIds(roleIds);
      if (assignedRoles.length !== roleIds.length) {
        throw new InvalidUserRoleError("Unknown role specified");
      }
      if (await deps.usersRepo.findByEmail(invite.email)) {
        throw new UserAlreadyExistsError(invite.email);
      }

      const now = deps.now();
      const passwordHash = await deps.hashPassword(parsed.data.password);
      const refreshToken = generateIdWithPrefix("rft");
      const refreshHash = await sha256Hex(refreshToken);
      const expiresAt = new Date(now.getTime() + REFRESH_TTL_SECONDS * 1000);
      const userId = generateIdWithPrefix("user");
      const accountId = generateIdWithPrefix("authacct");
      const sessionId = generateIdWithPrefix("sess");
      const authLogId = generateIdWithPrefix("authlog");
      const ip = c.req.header("CF-Connecting-IP") || undefined;
      const userAgent = c.req.header("User-Agent") || undefined;
      const jwtSecret = ensureJwtSecret(c.env);
      const accessToken = await createAccessToken(jwtSecret, {
        sub: userId,
        email: invite.email,
        roles: roleIds,
        sid: sessionId,
      });

      await acceptInviteLifecycle(deps.db, {
        inviteId: invite.id,
        inviteTokenHash: invite.tokenHash,
        userId,
        accountId,
        sessionId,
        authLogId,
        email: invite.email,
        name: parsed.data.name.trim(),
        roleIds,
        passwordHash,
        refreshTokenHash: refreshHash,
        sessionExpiresAt: expiresAt,
        ipAddress: ip,
        userAgent,
        now,
      });
      setRefreshCookie(c, refreshToken, REFRESH_TTL_SECONDS);

      return c.json({
        accessToken,
        user: {
          id: userId,
          email: invite.email,
          name: parsed.data.name.trim(),
          roleId: roleIds,
          uiPreferences: DEFAULT_USER_PREFERENCES,
        },
        invite: { id: invite.id, status: "consumed" },
      });
    } catch (error) {
      if (error instanceof InviteRoleAssignmentError) {
        return c.json(
          { error: { code: "FORBIDDEN", message: error.message } },
          403,
        );
      }
      if (error instanceof InviteNotFoundError) {
        return c.json(
          { error: { code: "NOT_FOUND", message: "Invite not found" } },
          404,
        );
      }
      if (error instanceof InviteExpiredError) {
        return c.json(
          { error: { code: "EXPIRED", message: "Invite expired" } },
          410,
        );
      }
      if (error instanceof InviteConsumedError) {
        return c.json(
          { error: { code: "GONE", message: "Invite already used" } },
          410,
        );
      }
      if (error instanceof InviteRevokedError) {
        return c.json(
          { error: { code: "GONE", message: "Invite revoked" } },
          410,
        );
      }
      if (error instanceof InviteAcceptanceConflictError) {
        return c.json(
          { error: { code: "GONE", message: "Invite no longer usable" } },
          410,
        );
      }
      if (
        error instanceof InviteEmailConflictError ||
        error instanceof UserAlreadyExistsError
      ) {
        return c.json(
          {
            error: {
              code: "USER_ALREADY_EXISTS_FOR_INVITE",
              message:
                "User already exists. Change roles from the role management page.",
            },
          },
          409,
        );
      }
      if (error instanceof InvalidUserRoleError) {
        return c.json(
          { error: { code: "BAD_REQUEST", message: error.message } },
          400,
        );
      }
      console.error("Failed to accept invite", error);
      return c.json(
        { error: { code: "INTERNAL_SERVER_ERROR", message: "Failed" } },
        500,
      );
    }
  });

export default app;
