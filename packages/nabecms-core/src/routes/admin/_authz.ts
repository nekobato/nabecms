import { drizzle } from "drizzle-orm/d1";
import type { AppContext } from "../../types";
import * as schema from "../../database/schema";
import { eq } from "drizzle-orm";
import {
  bearerTokenFrom,
  ensureJwtSecret,
  verifyAccessToken,
} from "../../lib/auth";
import { createRoleRepository } from "../../repositories/roles";
import { createUserRepository } from "../../repositories/users";
import { hasPermission, mergeRolePermissions } from "../../lib/permissions";
import { SUPER_ADMIN_ROLE_ID } from "../../lib/system-roles";

export type Actor = {
  id: string;
  roleIds: string[];
};

type ActorResolution =
  { actor: Actor; error: null } | { actor: null; error: "missing" | "invalid" };

const toRoleIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((roleId) => roleId.trim())
        .filter((roleId) => roleId.length > 0),
    ),
  );
};

/**
 * Determine whether an actor owns the reserved Super Admin system role.
 * @param actor - Authenticated actor
 * @returns True when the actor has the reserved Super Admin role
 */
export const isSuperAdminActor = (actor: Actor): boolean =>
  actor.roleIds.includes(SUPER_ADMIN_ROLE_ID);

const hasQueryableBinding = (value: unknown): boolean =>
  Boolean(
    value && typeof (value as { prepare?: unknown }).prepare === "function",
  );

const shouldSkipSessionValidation = (c: any): boolean =>
  c.env.WORKER_ENV === "test" && !hasQueryableBinding(c.env.DB);

async function authenticateActor(c: any): Promise<ActorResolution> {
  const token = bearerTokenFrom(c);
  if (!token) return { actor: null, error: "missing" };

  try {
    const secret = ensureJwtSecret(c.env);
    const payload = await verifyAccessToken(secret, token);
    if (!payload?.sub) return { actor: null, error: "invalid" };

    const skipSessionValidation = shouldSkipSessionValidation(c);
    const sessionId = typeof payload.sid === "string" ? payload.sid.trim() : "";
    if (!skipSessionValidation && sessionId.length === 0) {
      return { actor: null, error: "invalid" };
    }

    if (!skipSessionValidation) {
      const db = drizzle(c.env.DB, { schema });
      const rows = await db
        .select()
        .from(schema.authSessions)
        .where(eq(schema.authSessions.id, sessionId))
        .limit(1);
      const session = rows[0];

      if (
        !session ||
        session.userId !== payload.sub ||
        session.expiresAt.getTime() < Date.now()
      ) {
        return { actor: null, error: "invalid" };
      }
    }

    const tokenRoleIds = toRoleIds(payload.roles);
    if (tokenRoleIds.length > 0) {
      return {
        actor: { id: payload.sub as string, roleIds: tokenRoleIds },
        error: null,
      };
    }

    // Backward compatibility for legacy tokens that do not include role IDs.
    const db = drizzle(c.env.DB, { schema });
    const userRepo = createUserRepository(db);
    const user = await userRepo.findById(payload.sub as string);
    if (!user) return { actor: null, error: "invalid" };

    return {
      actor: { id: user.id, roleIds: toRoleIds(user.roleId) },
      error: null,
    };
  } catch (error) {
    console.error("Failed to verify token", error);
    return { actor: null, error: "invalid" };
  }
}

export async function requireActor(c: any): Promise<Response | Actor> {
  const result = await authenticateActor(c);
  if (!result.actor) {
    const message =
      result.error === "missing" ? "Missing token" : "Invalid token";
    return c.json({ error: { code: "UNAUTHORIZED", message } }, 401);
  }
  return result.actor;
}

export async function requirePermission(
  c: any,
  actor: Actor,
  required: string | readonly string[],
): Promise<Response | void> {
  if (isSuperAdminActor(actor)) return;

  const requiredList = Array.isArray(required) ? required : [required];
  const db = drizzle(c.env.DB, { schema });
  const roleRepo = createRoleRepository(db);
  const roles = await roleRepo.findManyByIds(actor.roleIds);
  const rules = mergeRolePermissions(roles);
  const granted = requiredList.some((permission) =>
    hasPermission(rules, permission),
  );

  if (!granted) {
    return c.json(
      { error: { code: "FORBIDDEN", message: "Missing permission" } },
      403,
    );
  }
}

/**
 * Require the reserved Super Admin role, independent of wildcard permissions.
 * @param c - Hono context
 * @param actor - Authenticated actor
 * @returns Response when forbidden, otherwise void
 */
export function requireSuperAdmin(c: any, actor: Actor): Response | void {
  if (isSuperAdminActor(actor)) return;

  return c.json(
    { error: { code: "FORBIDDEN", message: "Super admin required" } },
    403,
  );
}

export async function requireRoleAssignmentAllowed(
  c: any,
  actor: Actor,
  roleIds: readonly string[],
): Promise<Response | void> {
  if (isSuperAdminActor(actor)) return;

  const db = drizzle(c.env.DB, { schema });
  const roleRepo = createRoleRepository(db);
  const targetRoles = await roleRepo.findManyByIds([...roleIds]);

  if (targetRoles.length !== roleIds.length) {
    return c.json(
      { error: { code: "BAD_REQUEST", message: "Unknown role specified" } },
      400,
    );
  }

  const includesSystemRole = targetRoles.some((role) => Boolean(role.isSystem));
  if (includesSystemRole) {
    return c.json(
      {
        error: {
          code: "FORBIDDEN",
          message: "System roles can only be assigned by super admin",
        },
      },
      403,
    );
  }
}
