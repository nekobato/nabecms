import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppContext } from "../../types";
import * as schema from "../../database/schema";
import { generateIdWithPrefix } from "../../utils/id";
import { dispatchWebhooks } from "../../lib/webhook";
import { requireActor } from "./_authz";

const app = new Hono<AppContext>();

const webhookSchema = z.object({
  name: z.string().min(1),
  url: z
    .string()
    .min(1)
    .refine((value) => {
      try {
        const parsed = new URL(value);
        if (parsed.protocol === "mailto:") {
          return parsed.pathname.trim().length > 0;
        }
        return parsed.protocol === "https:" || parsed.protocol === "http:";
      } catch {
        return false;
      }
    }, "Invalid webhook target URL"),
  secret: z.string().optional().nullable(),
  eventFilters: z.array(z.string()).optional().nullable(),
  customHeaders: z.record(z.string(), z.string()).optional().nullable(),
  timeoutMs: z.number().int().positive().max(120_000).optional().nullable(),
  maxRetries: z.number().int().min(0).max(10).optional().nullable(),
  backoffStrategy: z
    .enum(["exponential_jitter", "exponential", "fixed"])
    .optional()
    .nullable(),
  concurrency: z.number().int().min(1).max(5).optional().nullable(),
  status: z.enum(["active", "paused", "errored"]).optional().nullable(),
  isActive: z.boolean().optional().nullable(),
  bodyTemplate: z.string().max(20000).optional().nullable(),
});

const clampInt = (
  input: string | undefined,
  fallback: number,
  { min = 0, max = 200 } = {},
) => {
  const value = Number.parseInt(input ?? "", 10);
  if (!Number.isFinite(value) || value < min) return fallback;
  return Math.min(value, max);
};

app.get("/api/admin/webhooks", async (c) => {
  const actor = await requireActor(c);
  if (actor instanceof Response) return actor;

  const db = drizzle(c.env.DB, { schema });
  const items = await db
    .select()
    .from(schema.webhooks)
    .orderBy(desc(schema.webhooks.createdAt));

  return c.json({ items });
});

app.post("/api/admin/webhooks", async (c) => {
  const actor = await requireActor(c);
  if (actor instanceof Response) return actor;

  const body = await c.req.json().catch(() => ({}));
  const parsed = webhookSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: { code: "BAD_REQUEST", message: "Invalid payload" } },
      400,
    );
  }

  const now = new Date().toISOString();
  const webhookId = generateIdWithPrefix("wh");
  const payload = parsed.data;
  const db = drizzle(c.env.DB, { schema });

  const customHeaders = (payload.customHeaders ?? null) as Record<
    string,
    string
  > | null;

  await db.insert(schema.webhooks).values({
    id: webhookId,
    name: payload.name,
    url: payload.url,
    method: "POST",
    headers: null,
    body: null,
    isActive: payload.isActive ?? true,
    secret: payload.secret ?? null,
    eventFilters: payload.eventFilters ?? [],
    customHeaders,
    timeoutMs: payload.timeoutMs ?? 10_000,
    maxRetries: payload.maxRetries ?? 5,
    backoffStrategy: payload.backoffStrategy ?? "exponential_jitter",
    concurrency: payload.concurrency ?? 1,
    status: payload.status ?? "active",
    event: "*", // legacy placeholder
    bodyTemplate: payload.bodyTemplate ?? null,
    createdAt: now,
    updatedAt: now,
  });

  return c.json({ id: webhookId });
});

app.put("/api/admin/webhooks/:webhookId", async (c) => {
  const actor = await requireActor(c);
  if (actor instanceof Response) return actor;

  const body = await c.req.json().catch(() => ({}));
  const parsed = webhookSchema.partial().safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: { code: "BAD_REQUEST", message: "Invalid payload" } },
      400,
    );
  }
  const webhookId = c.req.param("webhookId");
  const db = drizzle(c.env.DB, { schema });
  const exists = await db
    .select({ id: schema.webhooks.id })
    .from(schema.webhooks)
    .where(eq(schema.webhooks.id, webhookId))
    .limit(1);
  if (exists.length === 0) {
    return c.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404);
  }

  const updateValues: Partial<typeof schema.webhooks.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };
  if (parsed.data.name !== undefined) updateValues.name = parsed.data.name;
  if (parsed.data.url !== undefined) updateValues.url = parsed.data.url;
  if (parsed.data.secret !== undefined)
    updateValues.secret = parsed.data.secret ?? null;
  if (parsed.data.eventFilters !== undefined)
    updateValues.eventFilters = parsed.data.eventFilters ?? [];
  if (parsed.data.customHeaders !== undefined)
    updateValues.customHeaders = (parsed.data.customHeaders ?? null) as Record<
      string,
      string
    > | null;
  if (parsed.data.timeoutMs !== undefined)
    updateValues.timeoutMs = parsed.data.timeoutMs ?? null;
  if (parsed.data.maxRetries !== undefined)
    updateValues.maxRetries = parsed.data.maxRetries ?? null;
  if (parsed.data.backoffStrategy !== undefined)
    updateValues.backoffStrategy = parsed.data.backoffStrategy ?? null;
  if (parsed.data.concurrency !== undefined)
    updateValues.concurrency = parsed.data.concurrency ?? null;
  if (parsed.data.status !== undefined)
    updateValues.status = parsed.data.status ?? null;
  if (parsed.data.isActive !== undefined)
    updateValues.isActive = parsed.data.isActive ?? false;
  if (parsed.data.bodyTemplate !== undefined)
    updateValues.bodyTemplate = parsed.data.bodyTemplate ?? null;

  await db
    .update(schema.webhooks)
    .set(updateValues)
    .where(eq(schema.webhooks.id, webhookId));

  return c.json({ id: webhookId });
});

app.delete("/api/admin/webhooks/:webhookId", async (c) => {
  const actor = await requireActor(c);
  if (actor instanceof Response) return actor;

  const webhookId = c.req.param("webhookId");
  const db = drizzle(c.env.DB, { schema });
  await db.delete(schema.webhooks).where(eq(schema.webhooks.id, webhookId));
  return c.body(null, 204);
});

app.post("/api/admin/webhooks/:webhookId/test", async (c) => {
  const actor = await requireActor(c);
  if (actor instanceof Response) return actor;

  const webhookId = c.req.param("webhookId");
  const db = drizzle(c.env.DB, { schema });
  const rows = await db
    .select()
    .from(schema.webhooks)
    .where(eq(schema.webhooks.id, webhookId))
    .limit(1);
  if (rows.length === 0) {
    return c.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404);
  }

  const requestId = (c.get as any)?.("requestId") as string | undefined;

  await dispatchWebhooks({
    db,
    env: c.env,
    eventType: "webhook.test",
    actor: { id: actor.id },
    resource: { kind: "webhook", id: webhookId },
    data: { message: "test" },
    context: { request_id: requestId ?? null },
    targetWebhookIds: [webhookId],
    ignoreEventFilters: true,
  });

  return c.json({ status: "queued" });
});

app.get("/api/admin/webhooks/:webhookId/logs", async (c) => {
  const actor = await requireActor(c);
  if (actor instanceof Response) return actor;

  const webhookId = c.req.param("webhookId");
  const db = drizzle(c.env.DB, { schema });

  const limit = clampInt(c.req.query("limit"), 50);
  const offset = clampInt(c.req.query("offset"), 0, { max: 10_000 });
  const status = c.req.query("status") ?? undefined;
  const dateFrom = c.req.query("dateFrom") ?? undefined;
  const dateTo = c.req.query("dateTo") ?? undefined;

  const conditions = [eq(schema.webhookDeliveryLogs.webhookId, webhookId)];
  if (status) conditions.push(eq(schema.webhookDeliveryLogs.status, status));
  if (dateFrom)
    conditions.push(gte(schema.webhookDeliveryLogs.createdAt, dateFrom));
  if (dateTo)
    conditions.push(lte(schema.webhookDeliveryLogs.createdAt, dateTo));

  const whereClause =
    conditions.length === 1
      ? conditions[0]
      : and(...(conditions as [any, any, ...any[]]));

  const [totalRow, items] = await Promise.all([
    db
      .select({ value: sql<number>`count(*)` })
      .from(schema.webhookDeliveryLogs)
      .where(whereClause),
    db
      .select({
        id: schema.webhookDeliveryLogs.id,
        eventId: schema.webhookDeliveryLogs.eventId,
        eventType: schema.webhookDeliveryLogs.eventType,
        status: schema.webhookDeliveryLogs.status,
        attempt: schema.webhookDeliveryLogs.attempt,
        responseCode: schema.webhookDeliveryLogs.responseCode,
        latencyMs: schema.webhookDeliveryLogs.latencyMs,
        error: schema.webhookDeliveryLogs.error,
        responseBody: schema.webhookDeliveryLogs.responseBody,
        createdAt: schema.webhookDeliveryLogs.createdAt,
      })
      .from(schema.webhookDeliveryLogs)
      .where(whereClause)
      .orderBy(desc(schema.webhookDeliveryLogs.createdAt))
      .limit(limit)
      .offset(offset),
  ]);

  return c.json({
    items,
    total: Number(totalRow?.[0]?.value ?? 0),
  });
});

export default app;
export type AdminWebhooksRoute = typeof app;
