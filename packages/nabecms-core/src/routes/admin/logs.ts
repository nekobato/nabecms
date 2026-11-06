import { sanitizeAuditSnapshot } from "../../lib/audit-log";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { LogsResponse, AuthLogsResponse } from "../../contracts/logs";
import type { AppContext } from "../../types";
import * as schema from "../../database/schema";
import { requireActor, requirePermission } from "./_authz";
import { LOGS_READ_PERMISSION } from "./_permissions";

const app = new Hono<AppContext>();

const clampInt = (
  input: string | undefined,
  fallback: number,
  { min = 0, max = 200 } = {},
) => {
  const value = Number.parseInt(input ?? "", 10);
  if (!Number.isFinite(value) || value < min) return fallback;
  return Math.min(value, max);
};

/** Normalize legacy UTC timestamps and validate real calendar dates before querying. */
const parseBoundary = (value: string): string | null => {
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? value.replace(" ", "T") + "Z"
    : value;
  if (z.iso.date().safeParse(normalized).success)
    return normalized + "T00:00:00.000Z";
  return z.iso.datetime({ offset: true }).safeParse(normalized).success
    ? normalized
    : null;
};

/** Dates compare as instants even when persisted rows use different timestamp formats. */
const dateConditions = (
  column: SQL,
  from?: string,
  to?: string,
): SQL[] | null => {
  const start = from ? parseBoundary(from) : undefined;
  const end = to ? parseBoundary(to) : undefined;
  if (
    start === null ||
    end === null ||
    (start && end && Date.parse(start) > Date.parse(end))
  )
    return null;
  const conditions: SQL[] = [];
  if (start) conditions.push(sql`julianday(${column}) >= julianday(${start})`);
  if (end) conditions.push(sql`julianday(${column}) <= julianday(${end})`);
  return conditions;
};

const invalidDates = {
  error: {
    code: "INVALID_LOG_DATE_RANGE",
    message: "Use valid dates with dateFrom at or before dateTo.",
  },
};

app.get("/api/admin/logs", async (c) => {
  const actor = await requireActor(c);
  if (actor instanceof Response) return actor;
  const permission = await requirePermission(c, actor, LOGS_READ_PERMISSION);
  if (permission instanceof Response) return permission;

  const db = drizzle(c.env.DB, { schema });

  const auditLimit = clampInt(c.req.query("auditLimit"), 50);
  const auditOffset = clampInt(c.req.query("auditOffset"), 0, {
    max: Number.MAX_SAFE_INTEGER,
  });
  const revisionLimit = clampInt(c.req.query("revisionLimit"), 50);
  const revisionOffset = clampInt(c.req.query("revisionOffset"), 0, {
    max: Number.MAX_SAFE_INTEGER,
  });

  const conditions = dateConditions(
    sql`${schema.auditLogs.createdAt}`,
    c.req.query("dateFrom"),
    c.req.query("dateTo"),
  );
  if (!conditions) return c.json(invalidDates, 400);
  const action = c.req.query("action")?.trim();
  const targetId = c.req.query("targetId")?.trim();
  if (action) conditions.push(eq(schema.auditLogs.action, action));
  if (targetId) conditions.push(eq(schema.auditLogs.targetId, targetId));
  const auditWhere = and(...conditions);

  const [auditTotalRow] = await db
    .select({ value: sql<number>`count(*)` })
    .from(schema.auditLogs)
    .where(auditWhere);

  const auditLogs = await db
    .select({
      id: schema.auditLogs.id,
      userId: schema.auditLogs.userId,
      userName: schema.users.name,
      action: schema.auditLogs.action,
      targetTable: schema.auditLogs.targetTable,
      targetId: schema.auditLogs.targetId,
      before: schema.auditLogs.before,
      after: schema.auditLogs.after,
      createdAt: schema.auditLogs.createdAt,
    })
    .from(schema.auditLogs)
    .leftJoin(schema.users, eq(schema.auditLogs.userId, schema.users.id))
    .where(auditWhere)
    .orderBy(
      desc(sql`julianday(${schema.auditLogs.createdAt})`),
      desc(schema.auditLogs.id),
    )
    .limit(auditLimit)
    .offset(auditOffset);

  const [revisionTotalRow] = await db
    .select({ value: sql<number>`count(*)` })
    .from(schema.entryRevisions);

  const entryRevisions = await db
    .select({
      id: schema.entryRevisions.id,
      entryId: schema.entryRevisions.entryId,
      revisionNumber: schema.entryRevisions.revisionNumber,
      status: schema.entryRevisions.status,
      createdBy: schema.entryRevisions.createdBy,
      createdByName: schema.users.name,
      createdAt: schema.entryRevisions.createdAt,
      publishedAt: schema.entryRevisions.publishedAt,
      modelId: schema.entries.modelId,
      modelName: schema.models.name,
      entryStatus: schema.entries.status,
    })
    .from(schema.entryRevisions)
    .leftJoin(
      schema.entries,
      eq(schema.entryRevisions.entryId, schema.entries.id),
    )
    .leftJoin(schema.models, eq(schema.entries.modelId, schema.models.id))
    .leftJoin(
      schema.users,
      eq(schema.entryRevisions.createdBy, schema.users.id),
    )
    .orderBy(
      desc(sql`julianday(${schema.entryRevisions.createdAt})`),
      desc(schema.entryRevisions.id),
    )
    .limit(revisionLimit)
    .offset(revisionOffset);

  return c.json({
    auditLogs: {
      items: auditLogs.map((log) => ({
        ...log,
        before:
          log.targetTable === "entries"
            ? sanitizeAuditSnapshot(log.before)
            : null,
        after:
          log.targetTable === "entries"
            ? sanitizeAuditSnapshot(log.after)
            : null,
      })),
      total: Number(auditTotalRow?.value ?? 0),
    },
    entryRevisions: {
      items: entryRevisions,
      total: Number(revisionTotalRow?.value ?? 0),
    },
  } satisfies LogsResponse);
});

app.get("/api/admin/logs/auth", async (c) => {
  const actor = await requireActor(c);
  if (actor instanceof Response) return actor;
  const permission = await requirePermission(c, actor, LOGS_READ_PERMISSION);
  if (permission instanceof Response) return permission;

  const db = drizzle(c.env.DB, { schema });

  const limit = clampInt(c.req.query("limit"), 50);
  const offset = clampInt(c.req.query("offset"), 0, {
    max: Number.MAX_SAFE_INTEGER,
  });
  const result = c.req.query("result") ?? undefined;
  const reason = c.req.query("reason") ?? undefined;
  const userId = c.req.query("userId") ?? undefined;
  const dateFrom = c.req.query("dateFrom") ?? undefined;
  const dateTo = c.req.query("dateTo") ?? undefined;

  const conditions = dateConditions(
    sql`${schema.authLoginEvents.createdAt}`,
    dateFrom,
    dateTo,
  );
  if (!conditions) return c.json(invalidDates, 400);
  if (result) conditions.push(eq(schema.authLoginEvents.result, result));
  if (reason) conditions.push(eq(schema.authLoginEvents.reason, reason));
  if (userId) conditions.push(eq(schema.authLoginEvents.userId, userId.trim()));
  const whereClause = and(...conditions);
  const baseTotal = db
    .select({ value: sql<number>`count(*)` })
    .from(schema.authLoginEvents);
  const baseItems = db
    .select({
      id: schema.authLoginEvents.id,
      userId: schema.authLoginEvents.userId,
      userName: schema.users.name,
      provider: schema.authLoginEvents.provider,
      result: schema.authLoginEvents.result,
      reason: schema.authLoginEvents.reason,
      createdAt: schema.authLoginEvents.createdAt,
    })
    .from(schema.authLoginEvents)
    .leftJoin(schema.users, eq(schema.authLoginEvents.userId, schema.users.id))
    .orderBy(
      desc(sql`julianday(${schema.authLoginEvents.createdAt})`),
      desc(schema.authLoginEvents.id),
    )
    .limit(limit)
    .offset(offset);

  const totalQuery = whereClause ? baseTotal.where(whereClause) : baseTotal;
  const itemsQuery = whereClause ? baseItems.where(whereClause) : baseItems;

  const [totalRow, items] = await Promise.all([totalQuery, itemsQuery]);

  return c.json({
    authLogs: {
      items,
      total: Number(totalRow?.[0]?.value ?? 0),
    },
  } satisfies AuthLogsResponse);
});

export default app;
export type AdminLogsRoute = typeof app;
