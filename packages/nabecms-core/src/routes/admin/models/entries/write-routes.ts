import { Hono } from "hono";
import { z } from "zod";
import type { AppContext } from "../../../../types";
import {
  bulkPublishEntries,
  createEntry,
  deleteEntry,
  publishEntryRevision,
  restoreEntryRevision,
  unpublishEntry,
  updateEntry,
} from "../../../../services/entries";
import {
  bulkSchema,
  createDeps,
  createEntrySchema,
  handleDatabaseBindingError,
  handleEntriesMutationError,
  isRecord,
  publishSchema,
  requireActor,
  requirePermission,
  runIdempotentEntryMutation,
} from "./shared";
import {
  ENTRY_GLOBAL_UPDATE_PERMISSION,
  entryPermission,
} from "../../_permissions";

const writeRoutes = new Hono<AppContext>()
  .post("/api/admin/models/:modelId/entries", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const modelId = c.req.param("modelId");
    const createPermission = await requirePermission(
      c,
      actor,
      entryPermission(modelId, "create"),
    );
    if (createPermission instanceof Response) return createPermission;

    let payload: z.infer<typeof createEntrySchema>;
    try {
      payload = createEntrySchema.parse(await c.req.json());
    } catch (error) {
      if (error instanceof z.ZodError) {
        return c.json(
          { error: { code: "INVALID_PAYLOAD", issues: error.issues } },
          400,
        );
      }
      return c.json({ error: { code: "INVALID_PAYLOAD" } }, 400);
    }

    if (payload.status !== "draft") {
      const publishPermission = await requirePermission(
        c,
        actor,
        entryPermission(modelId, "publish"),
      );
      if (publishPermission instanceof Response) return publishPermission;
    }

    return await runIdempotentEntryMutation(c, {
      actorId: actor.id,
      operation: "entry.create",
      requestBody: payload,
      responseStatus: 201,
      createResponseBody: (item) => ({ item }),
      execute: async (deps) =>
        await createEntry(deps, {
          actorId: actor.id,
          modelId,
          status: payload.status,
          fields: payload.fields,
        }),
      databaseContext: "entry creation",
      handleError: (error) =>
        handleEntriesMutationError(c, error, {
          fallbackCode: "ENTRY_CREATE_FAILED",
          fallbackMessage: "Failed to create entry",
        }),
    });
  })
  .put("/api/admin/models/:modelId/entries/:entryId", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const modelId = c.req.param("modelId");
    const updatePermission = await requirePermission(
      c,
      actor,
      entryPermission(modelId, "update"),
    );
    if (updatePermission instanceof Response) return updatePermission;

    let payload: z.infer<typeof createEntrySchema>;
    try {
      payload = createEntrySchema.parse(await c.req.json());
    } catch (error) {
      if (error instanceof z.ZodError) {
        return c.json(
          { error: { code: "INVALID_PAYLOAD", issues: error.issues } },
          400,
        );
      }
      return c.json({ error: { code: "INVALID_PAYLOAD" } }, 400);
    }

    if (payload.status !== "draft") {
      const publishPermission = await requirePermission(
        c,
        actor,
        entryPermission(modelId, "publish"),
      );
      if (publishPermission instanceof Response) return publishPermission;
    }

    const entryId = c.req.param("entryId");
    return await runIdempotentEntryMutation(c, {
      actorId: actor.id,
      operation: "entry.update",
      requestBody: payload,
      responseStatus: 200,
      createResponseBody: (item) => ({ item }),
      execute: async (deps) =>
        await updateEntry(deps, {
          actorId: actor.id,
          entryId,
          modelId,
          status: payload.status,
          fields: payload.fields,
        }),
      databaseContext: "entry update",
      handleError: (error) =>
        handleEntriesMutationError(c, error, {
          fallbackCode: "ENTRY_UPDATE_FAILED",
          fallbackMessage: "Failed to update entry",
        }),
    });
  })
  .post("/api/admin/models/:modelId/entries/:entryId/publish", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const modelId = c.req.param("modelId");
    const permission = await requirePermission(
      c,
      actor,
      entryPermission(modelId, "publish"),
    );
    if (permission instanceof Response) return permission;

    let payload: z.infer<typeof publishSchema>;
    try {
      payload = publishSchema.parse(await c.req.json());
    } catch (error) {
      if (error instanceof z.ZodError) {
        return c.json(
          { error: { code: "INVALID_PAYLOAD", issues: error.issues } },
          400,
        );
      }
      payload = { revisionId: undefined };
    }

    const entryId = c.req.param("entryId");
    return await runIdempotentEntryMutation(c, {
      actorId: actor.id,
      operation: "entry.publish",
      requestBody: payload,
      responseStatus: 200,
      createResponseBody: (item) => ({ item }),
      execute: async (deps) =>
        await publishEntryRevision(deps, {
          actorId: actor.id,
          entryId,
          modelId,
          revisionId: payload.revisionId ?? null,
        }),
      databaseContext: "entry publish",
      handleError: (error) =>
        handleEntriesMutationError(c, error, {
          fallbackCode: "ENTRY_PUBLISH_FAILED",
          fallbackMessage: "Failed to publish entry revision",
          includeRevisionNotFound: true,
        }),
    });
  })
  .post(
    "/api/admin/models/:modelId/entries/:entryId/revisions/:revisionId/restore",
    async (c) => {
      const actor = await requireActor(c);
      if (actor instanceof Response) return actor;
      const modelId = c.req.param("modelId");
      const permission = await requirePermission(
        c,
        actor,
        entryPermission(modelId, "update"),
      );
      if (permission instanceof Response) return permission;

      const entryId = c.req.param("entryId");
      const revisionId = c.req.param("revisionId");
      return await runIdempotentEntryMutation(c, {
        actorId: actor.id,
        operation: "entry.restore_revision",
        requestBody: { revisionId },
        responseStatus: 200,
        createResponseBody: (item) => ({ item }),
        execute: async (deps) =>
          await restoreEntryRevision(deps, {
            actorId: actor.id,
            entryId,
            modelId,
            revisionId,
          }),
        databaseContext: "entry revision restore",
        handleError: (error) =>
          handleEntriesMutationError(c, error, {
            fallbackCode: "ENTRY_REVISION_RESTORE_FAILED",
            fallbackMessage: "Failed to restore entry revision",
            includeRevisionNotFound: true,
          }),
      });
    },
  )
  .post("/api/admin/models/:modelId/entries/:entryId/unpublish", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const modelId = c.req.param("modelId");
    const permission = await requirePermission(
      c,
      actor,
      entryPermission(modelId, "publish"),
    );
    if (permission instanceof Response) return permission;

    const entryId = c.req.param("entryId");
    return await runIdempotentEntryMutation(c, {
      actorId: actor.id,
      operation: "entry.unpublish",
      requestBody: null,
      responseStatus: 200,
      createResponseBody: (item) => ({ item }),
      execute: async (deps) =>
        await unpublishEntry(deps, {
          actorId: actor.id,
          entryId,
          modelId,
        }),
      databaseContext: "entry unpublish",
      handleError: (error) =>
        handleEntriesMutationError(c, error, {
          fallbackCode: "ENTRY_UNPUBLISH_FAILED",
          fallbackMessage: "Failed to unpublish entry",
        }),
    });
  })
  .delete("/api/admin/models/:modelId/entries/:entryId", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const modelId = c.req.param("modelId");
    const permission = await requirePermission(
      c,
      actor,
      entryPermission(modelId, "delete"),
    );
    if (permission instanceof Response) return permission;

    const referenceAction =
      c.req.query("detachReferences") === "true" ? "detach" : "restrict";
    if (referenceAction === "detach") {
      const updatePermission = await requirePermission(
        c,
        actor,
        ENTRY_GLOBAL_UPDATE_PERMISSION,
      );
      if (updatePermission instanceof Response) return updatePermission;
    }

    const entryId = c.req.param("entryId");
    return await runIdempotentEntryMutation(c, {
      actorId: actor.id,
      operation: "entry.delete",
      requestBody: { referenceAction },
      responseStatus: 204,
      createResponseBody: () => null,
      execute: async (deps) =>
        await deleteEntry(deps, {
          actorId: actor.id,
          entryId,
          modelId,
          referenceAction,
        }),
      databaseContext: "entry delete",
      handleError: (error) =>
        handleEntriesMutationError(c, error, {
          fallbackCode: "ENTRY_DELETE_FAILED",
          fallbackMessage: "Failed to delete entry",
        }),
    });
  })
  .post("/api/admin/models/:modelId/entries/bulk", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const modelId = c.req.param("modelId");

    let payload: z.infer<typeof bulkSchema>;
    try {
      payload = bulkSchema.parse(await c.req.json());
    } catch (error) {
      if (error instanceof z.ZodError) {
        return c.json(
          { error: { code: "INVALID_PAYLOAD", issues: error.issues } },
          400,
        );
      }
      return c.json(
        {
          error: {
            code: "INVALID_PAYLOAD",
            message: "Invalid JSON body",
          },
        },
        400,
      );
    }

    const permission = await requirePermission(
      c,
      actor,
      entryPermission(
        modelId,
        payload.action === "delete" ? "delete" : "publish",
      ),
    );
    if (permission instanceof Response) return permission;

    if (payload.action === "publish") {
      return await runIdempotentEntryMutation(c, {
        actorId: actor.id,
        operation: "entry.bulk.publish",
        requestBody: payload,
        responseStatus: 200,
        createResponseBody: (
          items: Awaited<ReturnType<typeof bulkPublishEntries>>,
        ) => ({
          results: items.map((item) => ({ id: item.id, status: 200 })),
        }),
        execute: async (deps) =>
          await bulkPublishEntries(deps, {
            actorId: actor.id,
            modelId,
            entryIds: payload.entryIds,
          }),
        databaseContext: "bulk entries",
        handleError: (error) =>
          handleEntriesMutationError(c, error, {
            fallbackCode: "ENTRY_BULK_FAILED",
            fallbackMessage: "Bulk entry action failed",
            includeRevisionNotFound: true,
          }),
      });
    }

    let deps;
    try {
      deps = createDeps(c);
    } catch (error) {
      return handleDatabaseBindingError(c, "bulk entries", error);
    }

    const results: Array<{ id: string; status: number; error?: string }> = [];

    for (const entryId of payload.entryIds) {
      try {
        if (payload.action === "unpublish") {
          await unpublishEntry(deps, {
            actorId: actor.id,
            entryId,
            modelId,
          });
        } else {
          await deleteEntry(deps, {
            actorId: actor.id,
            entryId,
            modelId,
          });
        }
        results.push({ id: entryId, status: 200 });
      } catch (error) {
        const response = handleEntriesMutationError(c, error, {
          fallbackCode: "ENTRY_BULK_FAILED",
          fallbackMessage: "Bulk entry action failed",
          includeRevisionNotFound: true,
        });
        let parsedError: string | undefined;
        try {
          const json: unknown = await response.clone().json();
          const responseError = isRecord(json) ? json.error : undefined;
          parsedError =
            isRecord(responseError) && typeof responseError.message === "string"
              ? responseError.message
              : undefined;
        } catch {
          parsedError =
            error instanceof Error ? error.message : "Bulk entry action failed";
        }
        console.error("Bulk entry action failed", entryId, error);
        results.push({
          id: entryId,
          status: response.status,
          error: parsedError,
        });
      }
    }

    return c.json({ results });
  });

export default writeRoutes;
