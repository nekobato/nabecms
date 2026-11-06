import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import type { AppContext } from "../../types";
import * as schema from "../../database/schema";
import {
  createApiKey,
  listApiKeys,
  rotateApiKey,
  updateApiKey,
  deleteApiKey,
  revokeApiKey,
  ApiKeyNotFoundError,
  ApiKeyConflictError,
  ApiKeyValidationError,
  API_KEY_SCOPE_VALUES,
} from "../../services/api-keys";
import { createApiKeyRepository } from "../../repositories/api-keys";
import { requireActor, requirePermission } from "./_authz";
import { generateIdWithPrefix } from "../../utils/id";

const createSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(512).nullish(),
    permissions: z.array(z.enum(API_KEY_SCOPE_VALUES)).min(1),
    allowedModels: z.array(z.string().trim()).optional(),
  })
  .strict();

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(512).nullish().optional(),
    permissions: z.array(z.enum(API_KEY_SCOPE_VALUES)).min(1).optional(),
    allowedModels: z.array(z.string().trim()).optional().nullable(),
  })
  .strict();

const API_KEYS_READ_PERMISSIONS = [
  "api_keys:*:read",
  "api_keys:*:write",
] as const;
const API_KEYS_WRITE_PERMISSION = "api_keys:*:write" as const;

function createDeps(c: any) {
  const db = drizzle(c.env.DB, { schema });
  return {
    repo: createApiKeyRepository(db),
    generateId: generateIdWithPrefix,
    now: () => new Date(),
  };
}

const app = new Hono<AppContext>()
  .get("/api/admin/api-keys", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const permission = await requirePermission(
      c,
      actor,
      API_KEYS_READ_PERMISSIONS,
    );
    if (permission instanceof Response) return permission;

    const search = c.req.query("q") ?? undefined;
    const deps = createDeps(c);
    const result = await listApiKeys(deps, { search });
    return c.json(result);
  })
  .post("/api/admin/api-keys", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const permission = await requirePermission(
      c,
      actor,
      API_KEYS_WRITE_PERMISSION,
    );
    if (permission instanceof Response) return permission;

    const body = await c.req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: { code: "BAD_REQUEST", message: "Invalid payload" } },
        400,
      );
    }

    try {
      const deps = createDeps(c);
      const { key, secret } = await createApiKey(deps, {
        ...parsed.data,
        actorId: actor.id,
      });
      return c.json({ key, secret }, 201);
    } catch (error) {
      if (error instanceof ApiKeyConflictError) {
        return c.json(
          { error: { code: "CONFLICT", message: error.message } },
          409,
        );
      }
      if (error instanceof ApiKeyValidationError) {
        return c.json(
          { error: { code: "BAD_REQUEST", message: error.message } },
          400,
        );
      }
      console.error("Failed to create api key", error);
      return c.json({ error: { code: "INTERNAL_SERVER_ERROR" } }, 500);
    }
  })
  .get("/api/admin/api-keys/:id", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const permission = await requirePermission(
      c,
      actor,
      API_KEYS_READ_PERMISSIONS,
    );
    if (permission instanceof Response) return permission;

    const deps = createDeps(c);
    const record = await deps.repo.findById(c.req.param("id"));
    if (!record) return c.json({ error: { code: "NOT_FOUND" } }, 404);
    const { items } = await listApiKeys(deps);
    const key = items.find((k) => k.id === record.id);
    if (!key) return c.json({ error: { code: "NOT_FOUND" } }, 404);
    return c.json({ key });
  })
  .put("/api/admin/api-keys/:id", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const permission = await requirePermission(
      c,
      actor,
      API_KEYS_WRITE_PERMISSION,
    );
    if (permission instanceof Response) return permission;

    const body = await c.req.json().catch(() => null);
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: { code: "BAD_REQUEST", message: "Invalid payload" } },
        400,
      );
    }

    try {
      const deps = createDeps(c);
      const key = await updateApiKey(deps, c.req.param("id"), parsed.data);
      return c.json({ key });
    } catch (error) {
      if (error instanceof ApiKeyNotFoundError) {
        return c.json(
          { error: { code: "NOT_FOUND", message: error.message } },
          404,
        );
      }
      if (error instanceof ApiKeyValidationError) {
        return c.json(
          { error: { code: "BAD_REQUEST", message: error.message } },
          400,
        );
      }
      console.error("Failed to update api key", error);
      return c.json({ error: { code: "INTERNAL_SERVER_ERROR" } }, 500);
    }
  })
  .post("/api/admin/api-keys/:id/rotate", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const permission = await requirePermission(
      c,
      actor,
      API_KEYS_WRITE_PERMISSION,
    );
    if (permission instanceof Response) return permission;
    try {
      const deps = createDeps(c);
      const result = await rotateApiKey(deps, c.req.param("id"), actor.id);
      return c.json(result);
    } catch (error) {
      if (error instanceof ApiKeyNotFoundError) {
        return c.json(
          { error: { code: "NOT_FOUND", message: error.message } },
          404,
        );
      }
      if (error instanceof ApiKeyConflictError) {
        return c.json(
          { error: { code: "CONFLICT", message: error.message } },
          409,
        );
      }
      console.error("Failed to rotate api key", error);
      return c.json({ error: { code: "INTERNAL_SERVER_ERROR" } }, 500);
    }
  })
  .post("/api/admin/api-keys/:id/revoke", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const permission = await requirePermission(
      c,
      actor,
      API_KEYS_WRITE_PERMISSION,
    );
    if (permission instanceof Response) return permission;
    try {
      const deps = createDeps(c);
      const key = await revokeApiKey(deps, c.req.param("id"), actor.id);
      return c.json({ key });
    } catch (error) {
      if (error instanceof ApiKeyNotFoundError) {
        return c.json(
          { error: { code: "NOT_FOUND", message: error.message } },
          404,
        );
      }
      console.error("Failed to revoke api key", error);
      return c.json({ error: { code: "INTERNAL_SERVER_ERROR" } }, 500);
    }
  })
  .delete("/api/admin/api-keys/:id", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const permission = await requirePermission(
      c,
      actor,
      API_KEYS_WRITE_PERMISSION,
    );
    if (permission instanceof Response) return permission;
    try {
      const deps = createDeps(c);
      await deleteApiKey(deps, c.req.param("id"));
      return c.body(null, 204);
    } catch (error) {
      if (error instanceof ApiKeyNotFoundError) {
        return c.json(
          { error: { code: "NOT_FOUND", message: error.message } },
          404,
        );
      }
      console.error("Failed to delete api key", error);
      return c.json({ error: { code: "INTERNAL_SERVER_ERROR" } }, 500);
    }
  });

export default app;
export type AdminApiKeysRoute = typeof app;
