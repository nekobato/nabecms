import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { sql, desc, eq, inArray } from "drizzle-orm";
import type { AppContext } from "../../types";
import * as schema from "../../database/schema";
import { requireActor, requirePermission } from "./_authz";
import { LOGS_READ_PERMISSION } from "./_permissions";
import {
  mergeSheetFields,
  resolveDefaultLocaleCode,
  resolveFieldValueForLocale,
  toDisplayTitle,
  toDraftSheetFields,
  toSheetEntryFieldValue,
  type SheetFieldRow,
  type StoredRevisionContent,
} from "./models/entries/shared";

const app = new Hono<AppContext>();

type DashboardRecentEntryRow = {
  id: string;
  modelId: string;
  modelName: string | null;
  titleFieldId: string | null;
  status: string;
  updatedAt: string;
  updatedBy: string;
  updatedByName: string | null;
  currentDraftRevisionId: string | null;
};

/**
 * Resolve dashboard display titles from the model title field, preferring draft values over persisted fields.
 */
const resolveDashboardEntryTitles = async (
  db: ReturnType<typeof drizzle>,
  entries: DashboardRecentEntryRow[],
): Promise<Map<string, string>> => {
  const titles = new Map(entries.map((entry) => [entry.id, entry.id]));
  const entryIds = entries.map((entry) => entry.id);
  const titleFieldIds = Array.from(
    new Set(
      entries
        .map((entry) => entry.titleFieldId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  );

  if (entryIds.length === 0 || titleFieldIds.length === 0) return titles;

  const locales = await db
    .select({
      code: schema.locales.code,
      isDefault: schema.locales.isDefault,
    })
    .from(schema.locales);
  const defaultLocale = resolveDefaultLocaleCode(locales);

  const titleFields = await db
    .select()
    .from(schema.modelFields)
    .where(inArray(schema.modelFields.id, titleFieldIds));
  const titleFieldByModel = new Map(
    titleFields.map((field) => [`${field.modelId}:${field.id}`, field]),
  );

  const publishedFieldRows = await db
    .select({
      entryId: schema.entryFields.entryId,
      fieldId: schema.entryFields.fieldId,
      locale: schema.entryFields.locale,
      valueString: schema.entryFields.valueString,
      valueNumber: schema.entryFields.valueNumber,
      valueDate: schema.entryFields.valueDate,
      valueBoolean: schema.entryFields.valueBoolean,
      valueJson: schema.entryFields.valueJson,
      valueMedia: schema.entryFields.valueMedia,
      valueRelation: schema.entryFields.valueRelation,
      fieldType: schema.modelFields.type,
    })
    .from(schema.entryFields)
    .innerJoin(
      schema.modelFields,
      eq(schema.entryFields.fieldId, schema.modelFields.id),
    )
    .where(inArray(schema.entryFields.entryId, entryIds));

  const publishedFieldsByEntry = new Map<
    string,
    ReturnType<typeof toSheetEntryFieldValue>[]
  >();
  for (const row of publishedFieldRows as SheetFieldRow[]) {
    if (!titleFieldIds.includes(row.fieldId)) continue;
    const list = publishedFieldsByEntry.get(row.entryId) ?? [];
    list.push(toSheetEntryFieldValue(row));
    publishedFieldsByEntry.set(row.entryId, list);
  }

  const draftRevisionIds = entries
    .map((entry) => entry.currentDraftRevisionId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  const draftFieldsByEntry = new Map<
    string,
    ReturnType<typeof toSheetEntryFieldValue>[]
  >();
  if (draftRevisionIds.length > 0) {
    const draftRevisions = await db
      .select({
        id: schema.entryRevisions.id,
        entryId: schema.entryRevisions.entryId,
        content: schema.entryRevisions.content,
      })
      .from(schema.entryRevisions)
      .where(inArray(schema.entryRevisions.id, draftRevisionIds));

    for (const revision of draftRevisions) {
      const titleFields = toDraftSheetFields(
        (revision.content ?? null) as StoredRevisionContent | null,
      ).filter((field) => titleFieldIds.includes(field.fieldId));
      draftFieldsByEntry.set(revision.entryId, titleFields);
    }
  }

  for (const entry of entries) {
    if (!entry.titleFieldId) continue;
    const titleField = titleFieldByModel.get(
      `${entry.modelId}:${entry.titleFieldId}`,
    );
    if (!titleField) continue;

    const publishedFields = publishedFieldsByEntry.get(entry.id) ?? [];
    const draftFields = draftFieldsByEntry.get(entry.id) ?? [];
    const fields =
      draftFields.length > 0
        ? mergeSheetFields(draftFields, publishedFields)
        : publishedFields;
    const resolved = resolveFieldValueForLocale(
      fields,
      titleField.id,
      defaultLocale,
    );
    if (!resolved) continue;

    const titleText = toDisplayTitle(resolved.type, resolved.value).trim();
    if (titleText.length > 0) titles.set(entry.id, titleText);
  }

  return titles;
};

app.get("/api/admin/dashboard", async (c) => {
  const actor = await requireActor(c);
  if (actor instanceof Response) return actor;
  const permission = await requirePermission(c, actor, LOGS_READ_PERMISSION);
  if (permission instanceof Response) return permission;

  const db = drizzle(c.env.DB, { schema });

  const [modelsCount] = await db
    .select({ value: sql<number>`count(*)` })
    .from(schema.models);
  const [entriesCount] = await db
    .select({ value: sql<number>`count(*)` })
    .from(schema.entries);
  const [mediaCount] = await db
    .select({ value: sql<number>`count(*)` })
    .from(schema.media);
  const [usersCount] = await db
    .select({ value: sql<number>`count(*)` })
    .from(schema.users);

  const recentEntries = await db
    .select({
      id: schema.entries.id,
      modelId: schema.entries.modelId,
      modelName: schema.models.name,
      titleFieldId: schema.models.titleFieldId,
      status: schema.entries.status,
      updatedAt: schema.entries.updatedAt,
      updatedBy: schema.entries.updatedBy,
      updatedByName: schema.users.name,
      currentDraftRevisionId: schema.entries.currentDraftRevisionId,
    })
    .from(schema.entries)
    .leftJoin(schema.models, eq(schema.entries.modelId, schema.models.id))
    .leftJoin(schema.users, eq(schema.entries.updatedBy, schema.users.id))
    .orderBy(desc(schema.entries.updatedAt))
    .limit(5);
  const recentEntryTitles = await resolveDashboardEntryTitles(
    db,
    recentEntries,
  );

  const recentMedia = await db
    .select({
      id: schema.media.id,
      name: schema.media.name,
      type: schema.media.type,
      size: schema.media.size,
      updatedAt: schema.media.updatedAt,
    })
    .from(schema.media)
    .orderBy(desc(schema.media.updatedAt))
    .limit(5);

  const auditLogs = await db
    .select({
      id: schema.auditLogs.id,
      userId: schema.auditLogs.userId,
      userName: schema.users.name,
      action: schema.auditLogs.action,
      targetTable: schema.auditLogs.targetTable,
      targetId: schema.auditLogs.targetId,
      createdAt: schema.auditLogs.createdAt,
    })
    .from(schema.auditLogs)
    .leftJoin(schema.users, eq(schema.auditLogs.userId, schema.users.id))
    .orderBy(desc(schema.auditLogs.createdAt))
    .limit(10);

  const response = {
    stats: {
      models: Number(modelsCount?.value ?? 0),
      entries: Number(entriesCount?.value ?? 0),
      mediaFiles: Number(mediaCount?.value ?? 0),
      users: Number(usersCount?.value ?? 0),
    },
    recentEntries: recentEntries.map((item) => ({
      id: item.id,
      modelId: item.modelId,
      modelName: item.modelName ?? "",
      displayTitle: recentEntryTitles.get(item.id) ?? item.id,
      status: item.status,
      updatedAt: item.updatedAt,
      updatedBy: item.updatedBy,
      updatedByName: item.updatedByName,
    })),
    recentMedia: recentMedia.map((item) => ({
      id: item.id,
      name: item.name,
      type: item.type,
      size: item.size,
      updatedAt: item.updatedAt,
    })),
    auditLogs: auditLogs.map((log) => ({
      id: log.id,
      userId: log.userId ?? null,
      userName: log.userName ?? null,
      action: log.action,
      targetTable: log.targetTable,
      targetId: log.targetId,
      createdAt: log.createdAt,
    })),
  };

  return c.json(response);
});

export default app;
export type AdminDashboardRoute = typeof app;
