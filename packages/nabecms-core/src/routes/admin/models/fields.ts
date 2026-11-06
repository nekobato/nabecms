import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq, and, inArray, ne } from "drizzle-orm";
import { ZodError, z } from "zod";
import { modelFields, models } from "../../../database/schema";
import {
  parseModelFieldPayload,
  type ParsedModelFieldPayload,
} from "../../../validators/model-field";
import type { AppContext } from "../../../types";
import { requireActor, requirePermission } from "../_authz";
import {
  MODEL_READ_PERMISSIONS,
  MODEL_WRITE_PERMISSION,
} from "../_permissions";

/** Return unique relation target model IDs from a parsed field payload. */
function getRelationAllowedModelIds(parsed: ParsedModelFieldPayload): string[] {
  if (parsed.type !== "relation") return [];
  const allowedModels =
    parsed.options &&
    typeof parsed.options === "object" &&
    "allowedModels" in parsed.options &&
    Array.isArray(parsed.options.allowedModels)
      ? parsed.options.allowedModels
      : [];

  return Array.from(
    new Set(
      allowedModels
        .map((id) => (typeof id === "string" ? id.trim() : ""))
        .filter((id) => id.length > 0),
    ),
  );
}

/** Reject relation fields that point to unknown target model IDs. */
async function ensureRelationAllowedModelsExist(
  c: any,
  db: ReturnType<typeof drizzle>,
  parsed: ParsedModelFieldPayload,
): Promise<Response | void> {
  const allowedModelIds = getRelationAllowedModelIds(parsed);
  if (allowedModelIds.length === 0) return;

  const rows = await db
    .select({ id: models.id })
    .from(models)
    .where(inArray(models.id, allowedModelIds));
  const foundIds = new Set(rows.map((row) => row.id));
  const missingIds = allowedModelIds.filter((id) => !foundIds.has(id));

  if (missingIds.length > 0) {
    return c.json(
      {
        error: `Relation allowedModels contains unknown model id: ${missingIds.join(", ")}`,
      },
      400,
    );
  }
}

const app = new Hono<AppContext>()
  // GET: list fields
  .get("/api/admin/models/:modelId/fields", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;

    const permission = await requirePermission(
      c,
      actor,
      MODEL_READ_PERMISSIONS,
    );
    if (permission instanceof Response) return permission;

    const db = drizzle(c.env.DB);
    const modelId = c.req.param("modelId");

    const model = (
      await db
        .select({
          id: models.id,
          titleFieldId: models.titleFieldId,
        })
        .from(models)
        .where(eq(models.id, modelId))
        .limit(1)
    )[0];

    if (!model) {
      return c.json({ error: "Model not found" }, 404);
    }

    const fields = await db
      .select()
      .from(modelFields)
      .where(eq(modelFields.modelId, modelId))
      .orderBy(modelFields.position);

    const enriched = fields.map((field) => ({
      ...field,
      isDisplayTitle: field.id === model.titleFieldId,
    }));

    return c.json(enriched);
  })
  // POST: create field with displayTitle uniqueness validation
  .post("/api/admin/models/:modelId/fields", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;

    const permission = await requirePermission(
      c,
      actor,
      MODEL_WRITE_PERMISSION,
    );
    if (permission instanceof Response) return permission;

    const db = drizzle(c.env.DB);
    const modelId = c.req.param("modelId");
    const body = await c.req.json();

    const model = (
      await db
        .select({
          id: models.id,
          titleFieldId: models.titleFieldId,
        })
        .from(models)
        .where(eq(models.id, modelId))
        .limit(1)
    )[0];

    if (!model) {
      return c.json({ error: "Model not found" }, 404);
    }

    if (body.isDisplayTitle) {
      if (model.titleFieldId) {
        return c.json(
          { error: "Only one field can be set as display title per model" },
          400,
        );
      }
    }

    let parsed;
    try {
      parsed = parseModelFieldPayload(body);
    } catch (error) {
      if (error instanceof ZodError) {
        return c.json({ error: error.flatten() }, 400);
      }
      if (error instanceof Error) {
        return c.json({ error: error.message }, 400);
      }
      return c.json({ error: "Invalid payload" }, 400);
    }

    if (parsed.type === "custom") {
      return c.json(
        {
          error: {
            code: "UNSUPPORTED_FIELD_TYPE",
            message: "Custom fields are not supported in v1",
          },
        },
        400,
      );
    }

    const relationModelValidation = await ensureRelationAllowedModelsExist(
      c,
      db,
      parsed,
    );
    if (relationModelValidation instanceof Response) {
      return relationModelValidation;
    }

    const firstExistingField = (
      await db
        .select({ id: modelFields.id })
        .from(modelFields)
        .where(eq(modelFields.modelId, modelId))
        .limit(1)
    )[0];
    const shouldSetDisplayTitle =
      parsed.isDisplayTitle ||
      (!model.titleFieldId && firstExistingField === undefined);

    const duplicateKey = (
      await db
        .select({ id: modelFields.id })
        .from(modelFields)
        .where(
          and(
            eq(modelFields.modelId, modelId),
            eq(modelFields.fieldKey, parsed.fieldKey),
          ),
        )
        .limit(1)
    )[0];

    if (duplicateKey) {
      return c.json(
        { error: "Field key must be unique within the model" },
        400,
      );
    }

    const fieldId = `field_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const newField = {
      id: fieldId,
      modelId,
      name: parsed.name,
      fieldKey: parsed.fieldKey,
      type: parsed.type,
      position: parsed.position ?? 0,
      required: parsed.required,
      hasLocales: parsed.hasLocales,
      isUnique: parsed.isUnique,
      variant: parsed.variant,
      options: parsed.options,
      defaultValue: parsed.defaultValue,
      isPrivate: parsed.isPrivate,
    };

    await db.insert(modelFields).values(newField);

    if (shouldSetDisplayTitle) {
      await db
        .update(models)
        .set({ titleFieldId: fieldId })
        .where(eq(models.id, modelId));
    }

    return c.json(
      {
        ...newField,
        isDisplayTitle: shouldSetDisplayTitle,
      },
      201,
    );
  })
  .patch("/api/admin/models/:modelId/fields/order", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;

    const permission = await requirePermission(
      c,
      actor,
      MODEL_WRITE_PERMISSION,
    );
    if (permission instanceof Response) return permission;

    const db = drizzle(c.env.DB);
    const modelId = c.req.param("modelId");

    const schema = z.object({
      orders: z
        .array(
          z.object({
            fieldId: z.string().min(1),
            position: z.number().int().min(0),
          }),
        )
        .min(1),
    });

    let body: unknown;
    try {
      body = await c.req.json();
    } catch (error) {
      return c.json({ error: "Invalid payload" }, 400);
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }

    const model = (
      await db
        .select({ id: models.id })
        .from(models)
        .where(eq(models.id, modelId))
        .limit(1)
    )[0];

    if (!model) {
      return c.json({ error: "Model not found" }, 404);
    }

    const existingFields = await db
      .select({ id: modelFields.id })
      .from(modelFields)
      .where(eq(modelFields.modelId, modelId));

    if (existingFields.length === 0) {
      return c.json({ error: "No fields to reorder" }, 400);
    }

    const providedOrders = parsed.data.orders;

    const fieldIdSet = new Set(existingFields.map((field) => field.id));
    const providedIdSet = new Set(providedOrders.map((order) => order.fieldId));
    const positionSet = new Set(providedOrders.map((order) => order.position));
    const maxPosition = Math.max(
      ...providedOrders.map((order) => order.position),
    );
    const minPosition = Math.min(
      ...providedOrders.map((order) => order.position),
    );

    if (providedOrders.length !== existingFields.length) {
      return c.json({ error: "Orders must include all fields" }, 400);
    }

    const missingFieldIds = [...providedIdSet].filter(
      (id) => !fieldIdSet.has(id),
    );
    if (missingFieldIds.length > 0) {
      return c.json({ error: "Orders contain unknown fieldId" }, 400);
    }

    if (positionSet.size !== providedOrders.length) {
      return c.json({ error: "Positions must be unique" }, 400);
    }

    if (minPosition !== 0 || maxPosition !== providedOrders.length - 1) {
      return c.json(
        { error: "Positions must be contiguous starting at 0" },
        400,
      );
    }

    const now = new Date().toISOString();

    const updates = providedOrders.map((order) =>
      db
        .update(modelFields)
        .set({ position: order.position, updatedAt: now })
        .where(
          and(
            eq(modelFields.id, order.fieldId),
            eq(modelFields.modelId, modelId),
          ),
        ),
    );

    if (updates.length > 0) {
      await db.batch(updates as [(typeof updates)[number], ...typeof updates]);
    }

    await db
      .update(models)
      .set({ updatedAt: now })
      .where(eq(models.id, modelId));

    return c.json({ success: true });
  })
  // PUT: update field with displayTitle uniqueness validation
  .put("/api/admin/models/:modelId/fields/:fieldId", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;

    const permission = await requirePermission(
      c,
      actor,
      MODEL_WRITE_PERMISSION,
    );
    if (permission instanceof Response) return permission;

    const db = drizzle(c.env.DB);
    const modelId = c.req.param("modelId");
    const fieldId = c.req.param("fieldId");
    const body = await c.req.json();

    const model = (
      await db
        .select({
          id: models.id,
          titleFieldId: models.titleFieldId,
        })
        .from(models)
        .where(eq(models.id, modelId))
        .limit(1)
    )[0];

    if (!model) {
      return c.json({ error: "Model not found" }, 404);
    }

    if (body.isDisplayTitle) {
      if (model.titleFieldId && model.titleFieldId !== fieldId) {
        return c.json(
          { error: "Only one field can be set as display title per model" },
          400,
        );
      }
    }

    let parsed;
    try {
      parsed = parseModelFieldPayload(body);
    } catch (error) {
      if (error instanceof ZodError) {
        return c.json({ error: error.flatten() }, 400);
      }
      if (error instanceof Error) {
        return c.json({ error: error.message }, 400);
      }
      return c.json({ error: "Invalid payload" }, 400);
    }

    const relationModelValidation = await ensureRelationAllowedModelsExist(
      c,
      db,
      parsed,
    );
    if (relationModelValidation instanceof Response) {
      return relationModelValidation;
    }

    const duplicateKey = (
      await db
        .select({ id: modelFields.id })
        .from(modelFields)
        .where(
          and(
            eq(modelFields.modelId, modelId),
            eq(modelFields.fieldKey, parsed.fieldKey),
            ne(modelFields.id, fieldId),
          ),
        )
        .limit(1)
    )[0];

    if (duplicateKey) {
      return c.json(
        { error: "Field key must be unique within the model" },
        400,
      );
    }

    const updateData = {
      name: parsed.name,
      fieldKey: parsed.fieldKey,
      type: parsed.type,
      required: parsed.required,
      hasLocales: parsed.hasLocales,
      isUnique: parsed.isUnique,
      variant: parsed.variant,
      options: parsed.options,
      defaultValue: parsed.defaultValue,
      isPrivate: parsed.isPrivate,
      ...(parsed.position !== null ? { position: parsed.position } : {}),
    } as const;

    await db
      .update(modelFields)
      .set(updateData)
      .where(eq(modelFields.id, fieldId));

    const currentTitleFieldId = model.titleFieldId;
    const wantsDisplayTitle = parsed.isDisplayTitle;
    const isCurrentlyDisplayTitle = currentTitleFieldId === fieldId;

    if (wantsDisplayTitle && !isCurrentlyDisplayTitle) {
      await db
        .update(models)
        .set({ titleFieldId: fieldId })
        .where(eq(models.id, modelId));
    } else if (!wantsDisplayTitle && isCurrentlyDisplayTitle) {
      await db
        .update(models)
        .set({ titleFieldId: null })
        .where(eq(models.id, modelId));
    }

    return c.json({ success: true });
  })
  .delete("/api/admin/models/:modelId/fields/:fieldId", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;

    const permission = await requirePermission(
      c,
      actor,
      MODEL_WRITE_PERMISSION,
    );
    if (permission instanceof Response) return permission;

    const db = drizzle(c.env.DB);
    const modelId = c.req.param("modelId");
    const fieldId = c.req.param("fieldId");

    const model = (
      await db
        .select({
          id: models.id,
          titleFieldId: models.titleFieldId,
        })
        .from(models)
        .where(eq(models.id, modelId))
        .limit(1)
    )[0];

    if (!model) {
      return c.json({ error: "Model not found" }, 404);
    }

    const field = (
      await db
        .select({
          id: modelFields.id,
          position: modelFields.position,
        })
        .from(modelFields)
        .where(
          and(eq(modelFields.id, fieldId), eq(modelFields.modelId, modelId)),
        )
        .limit(1)
    )[0];

    if (!field) {
      return c.json({ error: "Field not found" }, 404);
    }

    const remainingFields = await db
      .select({ id: modelFields.id })
      .from(modelFields)
      .where(and(eq(modelFields.modelId, modelId), ne(modelFields.id, fieldId)))
      .orderBy(modelFields.position);
    const now = new Date().toISOString();

    await db
      .delete(modelFields)
      .where(
        and(eq(modelFields.id, fieldId), eq(modelFields.modelId, modelId)),
      );

    const positionUpdates = remainingFields.map((remainingField, index) =>
      db
        .update(modelFields)
        .set({ position: index, updatedAt: now })
        .where(
          and(
            eq(modelFields.id, remainingField.id),
            eq(modelFields.modelId, modelId),
          ),
        ),
    );

    if (positionUpdates.length > 0) {
      await db.batch(
        positionUpdates as [
          (typeof positionUpdates)[number],
          ...typeof positionUpdates,
        ],
      );
    }

    await db
      .update(models)
      .set({
        ...(model.titleFieldId === fieldId ? { titleFieldId: null } : {}),
        updatedAt: now,
      })
      .where(eq(models.id, modelId));

    return c.body(null, 204);
  });

export default app;
