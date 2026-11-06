import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import type { AppContext } from "../../../types";
import * as schema from "../../../database/schema";
import { generateIdWithPrefix } from "../../../utils/id";
import { createModelRepository } from "../../../repositories/models";
import { requireActor, requirePermission } from "../_authz";
import {
  MODEL_READ_PERMISSIONS,
  MODEL_WRITE_PERMISSION,
} from "../_permissions";
import {
  createModel,
  listModels,
  getModelById,
  getModelDependencies,
  deleteModel,
  updateModel,
  ModelDeletionBlockedError,
  ModelNotFoundError,
  ModelTitleFieldInvalidError,
  type ModelsServiceDeps,
} from "../../../services/models";

const createModelSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1024).optional().nullable(),
  isPublic: z.boolean().optional().default(true),
});

const updateModelSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1024).optional().nullable(),
  isPublic: z.boolean().optional().default(true),
  titleFieldId: z.string().min(1).optional().nullable(),
});

type LogAuditEntry = Parameters<ModelsServiceDeps["logAuditEvent"]>[0];

function createDeps(c: any): ModelsServiceDeps {
  const db = drizzle(c.env.DB, { schema });
  return {
    repo: createModelRepository(db),
    generateId: (prefix: "model") => generateIdWithPrefix(prefix),
    now: () => new Date(),
    logAuditEvent: async (entry: LogAuditEntry) => {
      await db.insert(schema.auditLogs).values({
        id: generateIdWithPrefix("audit"),
        userId: entry.actorId,
        action: entry.action,
        targetTable: entry.targetTable,
        targetId: entry.targetId,
        before: null,
        after: null,
        createdAt: new Date().toISOString(),
      });
    },
  };
}

const app = new Hono<AppContext>()
  .get("/api/admin/models", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const permission = await requirePermission(
      c,
      actor,
      MODEL_READ_PERMISSIONS,
    );
    if (permission instanceof Response) return permission;

    const deps = createDeps(c);
    const items = await listModels(deps);
    return c.json({ items });
  })
  .post("/api/admin/models", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const permission = await requirePermission(
      c,
      actor,
      MODEL_WRITE_PERMISSION,
    );
    if (permission instanceof Response) return permission;

    let body: unknown;
    try {
      body = await c.req.json();
    } catch (error) {
      return c.json({ error: { code: "INVALID_PAYLOAD" } }, 400);
    }
    let payload;
    try {
      payload = createModelSchema.parse(body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return c.json(
          { error: { code: "INVALID_PAYLOAD", issues: error.issues } },
          400,
        );
      }
      return c.json({ error: { code: "INVALID_PAYLOAD" } }, 400);
    }

    const deps = createDeps(c);
    try {
      const item = await createModel(deps, payload);
      return c.json({ item }, 201);
    } catch (error) {
      console.error("Failed to create model", error);
      return c.json({ error: { code: "MODEL_CREATE_FAILED" } }, 500);
    }
  })
  .get("/api/admin/models/:modelId", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const permission = await requirePermission(
      c,
      actor,
      MODEL_READ_PERMISSIONS,
    );
    if (permission instanceof Response) return permission;

    const deps = createDeps(c);
    const item = await getModelById(deps, c.req.param("modelId"));
    if (!item) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Model not found" } },
        404,
      );
    }
    return c.json({ item });
  })
  .put("/api/admin/models/:modelId", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const permission = await requirePermission(
      c,
      actor,
      MODEL_WRITE_PERMISSION,
    );
    if (permission instanceof Response) return permission;

    let body: unknown;
    try {
      body = await c.req.json();
    } catch (error) {
      return c.json({ error: { code: "INVALID_PAYLOAD" } }, 400);
    }

    let payload: z.infer<typeof updateModelSchema>;
    try {
      payload = updateModelSchema.parse(body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return c.json(
          { error: { code: "INVALID_PAYLOAD", issues: error.issues } },
          400,
        );
      }
      return c.json({ error: { code: "INVALID_PAYLOAD" } }, 400);
    }

    const deps = createDeps(c);
    const modelId = c.req.param("modelId");

    try {
      const item = await updateModel(deps, {
        id: modelId,
        name: payload.name,
        description: payload.description ?? null,
        isPublic: payload.isPublic ?? true,
        titleFieldId: payload.titleFieldId ?? null,
        actorId: actor.id,
      });
      return c.json({ item });
    } catch (error) {
      if (error instanceof ModelNotFoundError) {
        return c.json(
          { error: { code: "NOT_FOUND", message: "Model not found" } },
          404,
        );
      }
      if (error instanceof ModelTitleFieldInvalidError) {
        return c.json(
          {
            error: {
              code: "INVALID_TITLE_FIELD",
              message: error.message,
            },
          },
          400,
        );
      }

      console.error("Failed to update model", error);
      return c.json(
        {
          error: {
            code: "MODEL_UPDATE_FAILED",
            message: "Failed to update model",
          },
        },
        500,
      );
    }
  })
  .get("/api/admin/models/:modelId/dependencies", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const permission = await requirePermission(
      c,
      actor,
      MODEL_READ_PERMISSIONS,
    );
    if (permission instanceof Response) return permission;

    const deps = createDeps(c);
    const modelId = c.req.param("modelId");
    const model = await getModelById(deps, modelId);
    if (!model) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Model not found" } },
        404,
      );
    }

    const dependencies = await getModelDependencies(deps, modelId);
    return c.json({ dependencies });
  })
  .delete("/api/admin/models/:modelId", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const permission = await requirePermission(
      c,
      actor,
      MODEL_WRITE_PERMISSION,
    );
    if (permission instanceof Response) return permission;

    const deps = createDeps(c);
    const modelId = c.req.param("modelId");
    const model = await getModelById(deps, modelId);
    if (!model) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Model not found" } },
        404,
      );
    }

    try {
      await deleteModel(deps, { id: modelId, actorId: actor.id });
      return c.body(null, 204);
    } catch (error) {
      if (error instanceof ModelDeletionBlockedError) {
        return c.json(
          {
            error: {
              code: "MODEL_HAS_DEPENDENCIES",
              message: error.message,
            },
            dependencies: error.dependencies,
          },
          409,
        );
      }

      console.error("Failed to delete model", error);
      return c.json(
        {
          error: {
            code: "MODEL_DELETE_FAILED",
            message: "Failed to delete model",
          },
        },
        500,
      );
    }
  });

export default app;
