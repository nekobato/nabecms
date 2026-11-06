import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import * as schema from "../../database/schema";
import { createRoleRepository } from "../../repositories/roles";
import { requireActor, requirePermission } from "./_authz";
import {
  listRoles,
  createRole,
  updateRole,
  deleteRole,
  RoleAlreadyExistsError,
  RoleNotFoundError,
  SystemRoleModificationError,
  type RolesServiceDeps,
} from "../../services/roles";
import type { AppContext } from "../../types";
import { generateIdWithPrefix } from "../../utils/id";

const rolePermissionsSchema = z.object({
  allow: z.array(z.string().trim()).default([]),
});

const createRoleSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(512).nullish(),
  permissions: rolePermissionsSchema,
});

const updateRoleSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(512).nullish().optional(),
  permissions: rolePermissionsSchema.optional(),
});

const ROLES_READ_PERMISSIONS = ["roles:*:read", "roles:*:write"] as const;
const ROLES_WRITE_PERMISSION = "roles:*:write" as const;

function createDeps(c: any): RolesServiceDeps {
  const db = drizzle(c.env.DB, { schema });
  return {
    repo: createRoleRepository(db),
    generateId: generateIdWithPrefix,
    now: () => new Date(),
  };
}

const app = new Hono<AppContext>()
  .get("/api/admin/roles", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const permission = await requirePermission(
      c,
      actor,
      ROLES_READ_PERMISSIONS,
    );
    if (permission instanceof Response) return permission;

    const deps = createDeps(c);
    const items = await listRoles(deps);
    return c.json({ items });
  })
  .post("/api/admin/roles", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const permission = await requirePermission(
      c,
      actor,
      ROLES_WRITE_PERMISSION,
    );
    if (permission instanceof Response) return permission;

    const body = await c.req.json().catch(() => null);
    const parsed = createRoleSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: { code: "BAD_REQUEST", message: "Invalid payload" } },
        400,
      );
    }

    try {
      const deps = createDeps(c);
      const role = await createRole(deps, {
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        permissions: parsed.data.permissions,
      });
      return c.json({ role }, 201);
    } catch (error) {
      if (error instanceof RoleAlreadyExistsError) {
        return c.json(
          { error: { code: "CONFLICT", message: "Role already exists" } },
          409,
        );
      }
      console.error("Failed to create role", error);
      return c.json(
        {
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to create role",
          },
        },
        500,
      );
    }
  })
  .put("/api/admin/roles/:roleId", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const permission = await requirePermission(
      c,
      actor,
      ROLES_WRITE_PERMISSION,
    );
    if (permission instanceof Response) return permission;

    const body = await c.req.json().catch(() => null);
    const parsed = updateRoleSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: { code: "BAD_REQUEST", message: "Invalid payload" } },
        400,
      );
    }

    try {
      const deps = createDeps(c);
      const role = await updateRole(deps, c.req.param("roleId"), parsed.data);
      return c.json({ role }, 200);
    } catch (error) {
      if (error instanceof RoleNotFoundError) {
        return c.json(
          { error: { code: "NOT_FOUND", message: "Role not found" } },
          404,
        );
      }
      if (error instanceof RoleAlreadyExistsError) {
        return c.json(
          { error: { code: "CONFLICT", message: "Role already exists" } },
          409,
        );
      }
      if (error instanceof SystemRoleModificationError) {
        return c.json(
          {
            error: {
              code: "BAD_REQUEST",
              message: "Cannot modify system role",
            },
          },
          400,
        );
      }
      console.error("Failed to update role", error);
      return c.json(
        {
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to update role",
          },
        },
        500,
      );
    }
  })
  .delete("/api/admin/roles/:roleId", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const permission = await requirePermission(
      c,
      actor,
      ROLES_WRITE_PERMISSION,
    );
    if (permission instanceof Response) return permission;

    try {
      const deps = createDeps(c);
      await deleteRole(deps, c.req.param("roleId"));
      return c.body(null, 204);
    } catch (error) {
      if (error instanceof RoleNotFoundError) {
        return c.json(
          { error: { code: "NOT_FOUND", message: "Role not found" } },
          404,
        );
      }
      if (error instanceof SystemRoleModificationError) {
        return c.json(
          {
            error: {
              code: "BAD_REQUEST",
              message: "Cannot delete system role",
            },
          },
          400,
        );
      }
      console.error("Failed to delete role", error);
      return c.json(
        {
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to delete role",
          },
        },
        500,
      );
    }
  });

export default app;
