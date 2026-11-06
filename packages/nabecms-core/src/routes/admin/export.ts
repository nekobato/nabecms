import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, eq, max } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import * as schema from "../../database/schema";
import { sanitizeAuditSnapshot } from "../../lib/audit-log";
import type { AppContext } from "../../types";
import { requireActor, requireSuperAdmin } from "./_authz";

const app = new Hono<AppContext>();
const pageSize = 500;
const maxRowsPerTable = 50_000;
const maxDownloadBytes = 25 * 1024 * 1024;

/** Read every row with explicit pagination instead of silently truncating D1 results. */
async function allRows<T>(
  readPage: (offset: number) => Promise<T[]>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; offset <= maxRowsPerTable; offset += pageSize) {
    const page = await readPage(offset);
    rows.push(...page);
    if (rows.length > maxRowsPerTable) throw new Error("EXPORT_TOO_LARGE");
    if (page.length < pageSize) return rows;
  }
  throw new Error("EXPORT_TOO_LARGE");
}

/** Return a complete downloadable JSON response, or a clear error instead of a partial file. */
function download(c: any, value: unknown, kind: "content" | "logs"): Response {
  const body = JSON.stringify(value, null, 2);
  if (new TextEncoder().encode(body).byteLength > maxDownloadBytes) {
    return c.json(
      {
        error: {
          code: "EXPORT_TOO_LARGE",
          message: "Export exceeds 25 MiB; use D1 for larger datasets.",
        },
      },
      413,
    );
  }
  return c.body(body, 200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="nabecms-${kind}-${new Date().toISOString().slice(0, 10)}.json"`,
    "Cache-Control": "no-store",
  });
}

/** Normalize the current revision snapshot, leaving history metadata behind. */
function snapshot(content: unknown): unknown[] | null {
  if (
    !content ||
    typeof content !== "object" ||
    !Array.isArray((content as { fields?: unknown }).fields)
  )
    return null;
  return (content as { fields: unknown[] }).fields;
}

app.get("/api/admin/export/content", async (c) => {
  const actor = await requireActor(c);
  if (actor instanceof Response) return actor;
  const permission = requireSuperAdmin(c, actor);
  if (permission instanceof Response) return permission;

  const db = drizzle(c.env.DB, { schema });
  try {
    const publishedRevision = alias(
      schema.entryRevisions,
      "published_revision",
    );
    const draftRevision = alias(schema.entryRevisions, "draft_revision");
    const archivedRevision = alias(schema.entryRevisions, "archived_revision");
    const latestRevision = alias(schema.entryRevisions, "latest_revision");
    const latestRevisionNumber = db
      .select({ number: max(latestRevision.revisionNumber) })
      .from(latestRevision)
      .where(eq(latestRevision.entryId, schema.entries.id));
    const [models, fields, locales, entryRows, media] = await Promise.all([
      allRows((offset) =>
        db
          .select()
          .from(schema.models)
          .orderBy(schema.models.id)
          .limit(pageSize)
          .offset(offset),
      ),
      allRows((offset) =>
        db
          .select()
          .from(schema.modelFields)
          .orderBy(schema.modelFields.id)
          .limit(pageSize)
          .offset(offset),
      ),
      allRows((offset) =>
        db
          .select()
          .from(schema.locales)
          .orderBy(schema.locales.code)
          .limit(pageSize)
          .offset(offset),
      ),
      allRows((offset) =>
        db
          .select({
            entry: schema.entries,
            published: publishedRevision,
            draft: draftRevision,
            archived: archivedRevision,
          })
          .from(schema.entries)
          .leftJoin(
            publishedRevision,
            and(
              eq(publishedRevision.id, schema.entries.publishedRevisionId),
              eq(publishedRevision.entryId, schema.entries.id),
            ),
          )
          .leftJoin(
            draftRevision,
            and(
              eq(draftRevision.id, schema.entries.currentDraftRevisionId),
              eq(draftRevision.entryId, schema.entries.id),
            ),
          )
          .leftJoin(
            archivedRevision,
            and(
              eq(schema.entries.status, "archived"),
              eq(archivedRevision.entryId, schema.entries.id),
              eq(archivedRevision.revisionNumber, latestRevisionNumber),
            ),
          )
          .orderBy(schema.entries.id)
          .limit(pageSize)
          .offset(offset),
      ),
      allRows((offset) =>
        db
          .select()
          .from(schema.media)
          .orderBy(schema.media.id)
          .limit(pageSize)
          .offset(offset),
      ),
    ]);

    const warnings: string[] = [];
    const exportEntries = [];
    for (const { entry, published, draft, archived } of entryRows) {
      const publishedFields = published ? snapshot(published.content) : null;
      const draftFields = draft ? snapshot(draft.content) : null;
      const archivedFields = archived ? snapshot(archived.content) : null;
      if (entry.status === "published" && !publishedFields)
        warnings.push(`Entry ${entry.id}: published snapshot is missing.`);
      if (entry.status === "draft" && !draftFields)
        warnings.push(`Entry ${entry.id}: draft snapshot is missing.`);
      if (
        entry.status === "published" &&
        entry.currentDraftRevisionId &&
        !draftFields
      )
        warnings.push(`Entry ${entry.id}: latest draft snapshot is missing.`);
      if (entry.status === "archived" && !archivedFields)
        warnings.push(`Entry ${entry.id}: archived snapshot is missing.`);
      exportEntries.push({
        id: entry.id,
        modelId: entry.modelId,
        status: entry.status,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        publishedAt: entry.publishedAt,
        publishedFields: entry.status === "published" ? publishedFields : null,
        draftFields:
          draftFields ?? (entry.status === "draft" ? null : undefined),
        archivedFields:
          entry.status === "archived" ? archivedFields : undefined,
      });
    }

    const entryIds = new Set(entryRows.map(({ entry }) => entry.id));
    const mediaIds = new Set(media.map((item) => item.id));
    const fieldById = new Map(fields.map((field) => [field.id, field]));
    const localeCodes = new Set(locales.map((locale) => locale.code));
    for (const entry of exportEntries) {
      for (const value of [
        entry.publishedFields,
        entry.draftFields,
        entry.archivedFields,
      ]) {
        if (!Array.isArray(value)) continue;
        for (const item of value) {
          if (!item || typeof item !== "object") continue;
          const field = item as {
            fieldId?: string;
            locale?: string;
            valueJson?: unknown;
            valueMedia?: string;
            valueRelation?: unknown;
          };
          const fieldDefinition = field.fieldId
            ? fieldById.get(field.fieldId)
            : undefined;
          if (field.fieldId && !fieldDefinition)
            warnings.push(
              `Entry ${entry.id}: field ${field.fieldId} is missing.`,
            );
          if (field.locale && !localeCodes.has(field.locale))
            warnings.push(
              `Entry ${entry.id}: locale ${field.locale} is missing.`,
            );
          if (field.valueMedia && !mediaIds.has(field.valueMedia))
            warnings.push(
              `Entry ${entry.id}: media ${field.valueMedia} is missing.`,
            );
          if (
            fieldDefinition?.type === "media" &&
            fieldDefinition.variant === "multiple" &&
            Array.isArray(field.valueJson)
          ) {
            for (const mediaId of field.valueJson) {
              if (typeof mediaId === "string" && !mediaIds.has(mediaId))
                warnings.push(
                  `Entry ${entry.id}: media ${mediaId} is missing.`,
                );
            }
          }
          const relations = Array.isArray(field.valueRelation)
            ? field.valueRelation
            : field.valueRelation &&
                typeof field.valueRelation === "object" &&
                "entryIds" in field.valueRelation &&
                Array.isArray(field.valueRelation.entryIds)
              ? field.valueRelation.entryIds
              : [];
          for (const relatedId of relations)
            if (typeof relatedId === "string" && !entryIds.has(relatedId))
              warnings.push(
                `Entry ${entry.id}: related entry ${relatedId} is missing.`,
              );
        }
      }
    }

    return download(
      c,
      {
        format: "nabecms-content-export",
        version: 1,
        exportedAt: new Date().toISOString(),
        counts: {
          models: models.length,
          fields: fields.length,
          locales: locales.length,
          entries: exportEntries.length,
          media: media.length,
          warnings: warnings.length,
        },
        models: models.map((model) => ({
          ...model,
          fields: fields.filter((field) => field.modelId === model.id),
        })),
        locales,
        entries: exportEntries,
        media: media.map(
          ({ url: _storageKey, updatedBy: _updatedBy, ...item }) => ({
            ...item,
            downloadPath: `/api/admin/media/${encodeURIComponent(item.id)}/file`,
          }),
        ),
        warnings,
      },
      "content",
    );
  } catch (error) {
    if (error instanceof Error && error.message === "EXPORT_TOO_LARGE")
      return c.json(
        {
          error: {
            code: "EXPORT_TOO_LARGE",
            message: "A table exceeds 50,000 rows; use D1 for larger datasets.",
          },
        },
        413,
      );
    throw error;
  }
});

app.get("/api/admin/export/logs", async (c) => {
  const actor = await requireActor(c);
  if (actor instanceof Response) return actor;
  const permission = requireSuperAdmin(c, actor);
  if (permission instanceof Response) return permission;

  const db = drizzle(c.env.DB, { schema });
  try {
    const [audit, authentication] = await Promise.all([
      allRows((offset) =>
        db
          .select()
          .from(schema.auditLogs)
          .orderBy(schema.auditLogs.id)
          .limit(pageSize)
          .offset(offset),
      ),
      allRows((offset) =>
        db
          .select()
          .from(schema.authLoginEvents)
          .orderBy(schema.authLoginEvents.id)
          .limit(pageSize)
          .offset(offset),
      ),
    ]);
    return download(
      c,
      {
        format: "nabecms-log-export",
        version: 1,
        exportedAt: new Date().toISOString(),
        counts: {
          auditLogs: audit.length,
          authLoginEvents: authentication.length,
        },
        auditLogs: audit.map((row) => ({
          ...row,
          before: sanitizeAuditSnapshot(row.before),
          after: sanitizeAuditSnapshot(row.after),
        })),
        authLoginEvents: authentication,
      },
      "logs",
    );
  } catch (error) {
    if (error instanceof Error && error.message === "EXPORT_TOO_LARGE")
      return c.json(
        {
          error: {
            code: "EXPORT_TOO_LARGE",
            message: "A table exceeds 50,000 rows; use D1 for larger datasets.",
          },
        },
        413,
      );
    throw error;
  }
});

export default app;
