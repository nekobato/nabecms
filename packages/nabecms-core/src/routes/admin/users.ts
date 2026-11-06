import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import * as schema from "../../database/schema";
import { createUserRepository } from "../../repositories/users";
import { createRoleRepository } from "../../repositories/roles";
import { createAuthRepository } from "../../repositories/auth";
import {
  requireActor,
  requirePermission,
  requireRoleAssignmentAllowed,
  isSuperAdminActor,
  type Actor,
} from "./_authz";
import {
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  UserAlreadyExistsError,
  UserNotFoundError,
  InvalidUserRoleError,
  InvalidUserUpdateError,
  UserEmailAuthorizationError,
  SystemUserModificationError,
  SystemUserAuthorizationError,
  type UsersServiceDeps,
} from "../../services/users";
import type { AppContext } from "../../types";
import { generateIdWithPrefix } from "../../utils/id";
import bcrypt from "bcryptjs";

const createUserSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email(),
  password: z.string().min(8).optional(),
  roleIds: z.array(z.string().trim().min(1)).min(1),
});

const updateUserSchema = z.strictObject({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().email().optional(),
  roleIds: z.array(z.string().trim().min(1)).min(1).optional(),
});

const USERS_READ_PERMISSIONS = ["users:*:read", "users:*:write"] as const;
const USERS_WRITE_PERMISSION = "users:*:write" as const;
const USERS_DELETE_PERMISSIONS = ["users:*:delete", "users:*:write"] as const;

function createDeps(c: any, actor?: Actor): UsersServiceDeps {
  const db = drizzle(c.env.DB, { schema });
  return {
    repo: createUserRepository(db),
    rolesRepo: createRoleRepository(db),
    authRepo: createAuthRepository(db),
    canModifySystemUser: actor ? isSuperAdminActor(actor) : false,
    actorId: actor?.id,
    now: () => new Date(),
    generateId: (prefix) => generateIdWithPrefix(prefix),
    hashPassword: async (password: string) => {
      const cost = Number(c.env.BCRYPT_COST || 10);
      return bcrypt.hash(password, cost);
    },
  };
}

const app = new Hono<AppContext>()
  .get("/api/admin/users", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const permission = await requirePermission(
      c,
      actor,
      USERS_READ_PERMISSIONS,
    );
    if (permission instanceof Response) return permission;

    const deps = createDeps(c);
    const items = await listUsers(deps);
    return c.json({ items });
  })
  .post("/api/admin/users", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const permission = await requirePermission(
      c,
      actor,
      USERS_WRITE_PERMISSION,
    );
    if (permission instanceof Response) return permission;

    const body = await c.req.json().catch(() => null);
    const parsed = createUserSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: { code: "BAD_REQUEST", message: "Invalid payload" } },
        400,
      );
    }
    const roleAssignment = await requireRoleAssignmentAllowed(
      c,
      actor,
      parsed.data.roleIds,
    );
    if (roleAssignment instanceof Response) return roleAssignment;

    try {
      const deps = createDeps(c);
      const user = await createUser(deps, parsed.data);
      return c.json({ user }, 201);
    } catch (error) {
      if (error instanceof UserAlreadyExistsError) {
        return c.json(
          { error: { code: "CONFLICT", message: "User already exists" } },
          409,
        );
      }
      if (error instanceof InvalidUserRoleError) {
        return c.json(
          { error: { code: "BAD_REQUEST", message: error.message } },
          400,
        );
      }
      console.error("Failed to create user", error);
      return c.json(
        {
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to create user",
          },
        },
        500,
      );
    }
  })
  .put("/api/admin/users/:userId", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const permission = await requirePermission(
      c,
      actor,
      USERS_WRITE_PERMISSION,
    );
    if (permission instanceof Response) return permission;

    const body = await c.req.json().catch(() => null);
    const parsed = updateUserSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: { code: "BAD_REQUEST", message: "Invalid payload" } },
        400,
      );
    }
    if (parsed.data.roleIds) {
      const roleAssignment = await requireRoleAssignmentAllowed(
        c,
        actor,
        parsed.data.roleIds,
      );
      if (roleAssignment instanceof Response) return roleAssignment;
    }

    try {
      const deps = createDeps(c, actor);
      const user = await updateUser(deps, c.req.param("userId"), parsed.data);
      return c.json({ user }, 200);
    } catch (error) {
      if (error instanceof UserEmailAuthorizationError) {
        return c.json(
          { error: { code: "FORBIDDEN", message: error.message } },
          403,
        );
      }
      if (error instanceof SystemUserAuthorizationError) {
        return c.json(
          { error: { code: "FORBIDDEN", message: "Super admin required" } },
          403,
        );
      }
      if (error instanceof UserNotFoundError) {
        return c.json(
          { error: { code: "NOT_FOUND", message: "User not found" } },
          404,
        );
      }
      if (error instanceof UserAlreadyExistsError) {
        return c.json(
          { error: { code: "CONFLICT", message: "User already exists" } },
          409,
        );
      }
      if (
        error instanceof InvalidUserRoleError ||
        error instanceof InvalidUserUpdateError ||
        error instanceof SystemUserModificationError
      ) {
        return c.json(
          { error: { code: "BAD_REQUEST", message: error.message } },
          400,
        );
      }
      console.error("Failed to update user", error);
      return c.json(
        {
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to update user",
          },
        },
        500,
      );
    }
  })
  .delete("/api/admin/users/:userId", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const permission = await requirePermission(
      c,
      actor,
      USERS_DELETE_PERMISSIONS,
    );
    if (permission instanceof Response) return permission;

    try {
      const deps = createDeps(c);
      await deleteUser(deps, c.req.param("userId"));
      return c.body(null, 204);
    } catch (error) {
      if (error instanceof UserNotFoundError) {
        return c.json(
          { error: { code: "NOT_FOUND", message: "User not found" } },
          404,
        );
      }
      if (error instanceof SystemUserModificationError) {
        return c.json(
          { error: { code: "BAD_REQUEST", message: error.message } },
          400,
        );
      }
      console.error("Failed to delete user", error);
      return c.json(
        {
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to delete user",
          },
        },
        500,
      );
    }
  });

export default app;
