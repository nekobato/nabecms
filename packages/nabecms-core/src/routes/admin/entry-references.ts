import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq, inArray, and } from "drizzle-orm";
import * as schema from "../../database/schema";
import type { AppContext } from "../../types";
import { requireActor, requirePermission } from "./_authz";
import {
  mergeSheetFields,
  resolveDefaultLocaleCode,
  resolveEntryDisplayTitle,
  toDraftSheetFields,
  toSheetEntryFieldValue,
  type SheetEntryFieldValue,
  type SheetFieldRow,
  type StoredRevisionContent,
} from "./models/entries/shared";

const app = new Hono<AppContext>();

type EntryMetadata = {
  entryId: string;
  modelId: string;
  modelName: string;
  displayTitle: string;
  status: string;
};

const appRoutes = app.get("/api/admin/entry-references", async (c) => {
  const actor = await requireActor(c);
  if (actor instanceof Response) return actor;
  const permission = await requirePermission(c, actor, "entries:*:read");
  if (permission instanceof Response) return permission;

  const queries = c.req.queries();
  const collected: string[] = [];
  const addValues = (values: string[] | undefined) => {
    if (!values) return;
    for (const value of values) {
      if (!value) continue;
      const parts = value.split(",");
      for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed.length > 0) {
          collected.push(trimmed);
        }
      }
    }
  };

  addValues(queries.entryId);
  addValues(queries.entryIds);

  const singleEntryId = c.req.query("entryId");
  if (singleEntryId) {
    addValues([singleEntryId]);
  }
  const singleEntryIds = c.req.query("entryIds");
  if (singleEntryIds) {
    addValues([singleEntryIds]);
  }

  const uniqueIds = Array.from(new Set(collected));
  if (uniqueIds.length === 0) {
    return c.json({ items: [] });
  }

  const db = drizzle(c.env.DB, { schema });

  const entries = await db
    .select({
      entryId: schema.entries.id,
      modelId: schema.entries.modelId,
      modelName: schema.models.name,
      status: schema.entries.status,
      currentDraftRevisionId: schema.entries.currentDraftRevisionId,
    })
    .from(schema.entries)
    .innerJoin(schema.models, eq(schema.entries.modelId, schema.models.id))
    .where(inArray(schema.entries.id, uniqueIds));

  if (entries.length === 0) {
    return c.json({ items: [] });
  }

  const entryById = new Map(entries.map((entry) => [entry.entryId, entry]));
  const resolvedEntryIds = Array.from(entryById.keys());
  const modelIds = Array.from(new Set(entries.map((entry) => entry.modelId)));

  const modelTitleFields = await db
    .select({
      id: schema.models.id,
      titleFieldId: schema.models.titleFieldId,
    })
    .from(schema.models)
    .where(inArray(schema.models.id, modelIds));

  const titleFieldIds = modelTitleFields
    .map((row) => row.titleFieldId)
    .filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );

  const titleFieldDetails = titleFieldIds.length
    ? await db
        .select({
          id: schema.modelFields.id,
          modelId: schema.modelFields.modelId,
          type: schema.modelFields.type,
          hasLocales: schema.modelFields.hasLocales,
        })
        .from(schema.modelFields)
        .where(inArray(schema.modelFields.id, titleFieldIds))
    : [];

  const displayFieldByModel = new Map<string, string>();

  const fieldDetailsById = new Map(
    titleFieldDetails.map((field) => [field.id, field]),
  );
  for (const modelRow of modelTitleFields) {
    const fieldId = modelRow.titleFieldId;
    if (!fieldId) continue;
    const field = fieldDetailsById.get(fieldId);
    if (!field) continue;
    displayFieldByModel.set(modelRow.id, field.id);
  }

  const displayFieldIds = Array.from(new Set(displayFieldByModel.values()));

  const locales = await db
    .select({
      code: schema.locales.code,
      isDefault: schema.locales.isDefault,
    })
    .from(schema.locales);
  const defaultLocale = resolveDefaultLocaleCode(locales);

  let entryFieldRows: SheetFieldRow[] = [];
  if (displayFieldIds.length > 0) {
    entryFieldRows = await db
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
      .where(
        and(
          inArray(schema.entryFields.entryId, resolvedEntryIds),
          inArray(schema.entryFields.fieldId, displayFieldIds),
        ),
      );
  }

  const publishedFieldsByEntry = new Map<string, SheetEntryFieldValue[]>();
  for (const row of entryFieldRows) {
    const existing = publishedFieldsByEntry.get(row.entryId) ?? [];
    existing.push(toSheetEntryFieldValue(row));
    publishedFieldsByEntry.set(row.entryId, existing);
  }

  const draftRevisionIds = entries
    .map((entry) => entry.currentDraftRevisionId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  const draftFieldsByEntry = new Map<string, SheetEntryFieldValue[]>();
  if (displayFieldIds.length > 0 && draftRevisionIds.length > 0) {
    const draftRevisions = await db
      .select({
        id: schema.entryRevisions.id,
        entryId: schema.entryRevisions.entryId,
        content: schema.entryRevisions.content,
      })
      .from(schema.entryRevisions)
      .where(inArray(schema.entryRevisions.id, draftRevisionIds));

    for (const revision of draftRevisions) {
      const fields = toDraftSheetFields(
        (revision.content ?? null) as StoredRevisionContent | null,
      ).filter((field) => displayFieldIds.includes(field.fieldId));
      draftFieldsByEntry.set(revision.entryId, fields);
    }
  }

  const results: EntryMetadata[] = [];

  for (const entryId of resolvedEntryIds) {
    const entry = entryById.get(entryId);
    if (!entry) continue;

    const publishedFields = publishedFieldsByEntry.get(entryId) ?? [];
    const draftFields = draftFieldsByEntry.get(entryId) ?? [];
    const fields =
      draftFields.length > 0
        ? mergeSheetFields(draftFields, publishedFields)
        : publishedFields;

    results.push({
      entryId,
      modelId: entry.modelId,
      modelName: entry.modelName,
      displayTitle: resolveEntryDisplayTitle({
        entryId,
        fields,
        titleFieldId: displayFieldByModel.get(entry.modelId),
        defaultLocale,
      }),
      status: entry.status,
    });
  }

  return c.json({ items: results });
});

export default appRoutes;
