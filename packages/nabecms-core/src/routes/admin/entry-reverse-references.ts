import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import * as schema from "../../database/schema";
import type { AppContext } from "../../types";
import { collectEntryReferenceIds } from "../../utils/entry-reference";
import { requireActor, requirePermission } from "./_authz";

const app = new Hono<AppContext>();

type RelationValue = {
  type?: string;
  entryIds?: string[];
};

type BackRefRow = {
  entryId: string;
  fieldId: string;
  modelId: string;
  modelName: string;
  fieldName: string;
  fieldKey: string;
  status: string;
  valueRelation: RelationValue | null;
};

type TitleFieldMeta = {
  fieldId: string;
  type: string;
  hasLocales: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

app.get("/api/admin/entry-reverse-references", async (c) => {
  const actor = await requireActor(c);
  if (actor instanceof Response) return actor;
  const permission = await requirePermission(c, actor, "entries:*:read");
  if (permission instanceof Response) return permission;

  const targetEntryId = c.req.query("entryId");
  if (!targetEntryId) {
    return c.json(
      { error: { code: "BAD_REQUEST", message: "entryId is required" } },
      400,
    );
  }

  const db = drizzle(c.env.DB, { schema });

  const rows = await db
    .select({
      entryId: schema.entryFields.entryId,
      fieldId: schema.entryFields.fieldId,
      modelId: schema.entries.modelId,
      modelName: schema.models.name,
      fieldName: schema.modelFields.name,
      fieldKey: schema.modelFields.fieldKey,
      status: schema.entries.status,
      valueRelation: schema.entryFields.valueRelation,
    })
    .from(schema.entryFields)
    .innerJoin(
      schema.entries,
      eq(schema.entryFields.entryId, schema.entries.id),
    )
    .innerJoin(
      schema.modelFields,
      eq(schema.entryFields.fieldId, schema.modelFields.id),
    )
    .innerJoin(schema.models, eq(schema.entries.modelId, schema.models.id))
    .where(isNotNull(schema.entryFields.valueRelation));

  const extractEntryIds = (value: unknown): string[] => {
    if (!value) return [];
    let parsed: unknown = value;
    if (typeof value === "string") {
      try {
        parsed = JSON.parse(value);
      } catch {
        parsed = value;
      }
    }

    if (Array.isArray(parsed)) return parsed.map((id) => String(id));
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as { entryIds?: unknown }).entryIds)
    ) {
      return (parsed as { entryIds: unknown[] }).entryIds.map((id) =>
        String(id),
      );
    }
    return [];
  };

  const referencingRows: BackRefRow[] = rows.filter((row) => {
    const ids = extractEntryIds(row.valueRelation as RelationValue | null);
    return ids.includes(targetEntryId);
  });

  // Rich text references: scan value_json of rich_text fields for embedded entryIds
  const richTextRows = await db
    .select({
      entryId: schema.entryFields.entryId,
      fieldId: schema.entryFields.fieldId,
      modelId: schema.entries.modelId,
      modelName: schema.models.name,
      fieldName: schema.modelFields.name,
      fieldKey: schema.modelFields.fieldKey,
      status: schema.entries.status,
      valueJson: schema.entryFields.valueJson,
    })
    .from(schema.entryFields)
    .innerJoin(
      schema.entries,
      eq(schema.entryFields.entryId, schema.entries.id),
    )
    .innerJoin(
      schema.modelFields,
      eq(schema.entryFields.fieldId, schema.modelFields.id),
    )
    .innerJoin(schema.models, eq(schema.entries.modelId, schema.models.id))
    .where(
      and(
        eq(schema.modelFields.type, "rich_text"),
        isNotNull(schema.entryFields.valueJson),
      ),
    );

  const collectFromRichText = (value: unknown): string[] => {
    const traversable =
      isRecord(value) && "value" in value ? value.value : value;
    return collectEntryReferenceIds(traversable);
  };

  const richTextMatches: BackRefRow[] = [];
  const pushUnique = (target: BackRefRow[], row: BackRefRow) => {
    const key = `${row.entryId}:${row.fieldId}`;
    if (target.some((item) => `${item.entryId}:${item.fieldId}` === key)) {
      return;
    }
    target.push(row);
  };

  for (const row of richTextRows) {
    const ids = collectFromRichText(row.valueJson);
    if (ids.includes(targetEntryId)) {
      pushUnique(richTextMatches, {
        entryId: row.entryId,
        modelId: row.modelId,
        modelName: row.modelName,
        fieldId: row.fieldId,
        fieldName: row.fieldName,
        fieldKey: row.fieldKey,
        status: row.status,
        valueRelation: null,
      });
    }
  }

  const draftRevisionRows = await db
    .select({
      entryId: schema.entries.id,
      modelId: schema.entries.modelId,
      modelName: schema.models.name,
      status: schema.entries.status,
      content: schema.entryRevisions.content,
    })
    .from(schema.entries)
    .innerJoin(schema.models, eq(schema.entries.modelId, schema.models.id))
    .innerJoin(
      schema.entryRevisions,
      eq(schema.entries.currentDraftRevisionId, schema.entryRevisions.id),
    )
    .where(isNotNull(schema.entries.currentDraftRevisionId));

  for (const row of draftRevisionRows) {
    if (row.entryId === targetEntryId) continue;
    const content = isRecord(row.content) ? row.content : null;
    const fields = Array.isArray(content?.fields) ? content.fields : [];
    for (const field of fields) {
      if (!isRecord(field)) continue;
      const fieldId =
        typeof field.fieldId === "string" && field.fieldId.length > 0
          ? field.fieldId
          : "";
      if (!fieldId) continue;

      if (field.type === "relation") {
        const ids = extractEntryIds(field.valueRelation);
        if (ids.includes(targetEntryId)) {
          pushUnique(referencingRows, {
            entryId: row.entryId,
            modelId: row.modelId,
            modelName: row.modelName,
            fieldId,
            fieldName: fieldId,
            fieldKey: fieldId,
            status: row.status,
            valueRelation: null,
          });
        }
      }

      if (field.type === "rich_text") {
        const ids = collectFromRichText(field.valueJson);
        if (ids.includes(targetEntryId)) {
          pushUnique(richTextMatches, {
            entryId: row.entryId,
            modelId: row.modelId,
            modelName: row.modelName,
            fieldId,
            fieldName: fieldId,
            fieldKey: fieldId,
            status: row.status,
            valueRelation: null,
          });
        }
      }
    }
  }

  if (referencingRows.length === 0 && richTextMatches.length === 0) {
    return c.json({ relations: [], richText: [] });
  }

  const merged = [...referencingRows, ...richTextMatches];

  const entryIds = Array.from(new Set(merged.map((r) => r.entryId)));
  const modelIds = Array.from(new Set(merged.map((r) => r.modelId)));

  const titleFieldRows = await db
    .select({
      id: schema.models.id,
      titleFieldId: schema.models.titleFieldId,
    })
    .from(schema.models)
    .where(inArray(schema.models.id, modelIds));

  const titleFieldIds = titleFieldRows
    .map((row) => row.titleFieldId)
    .filter((v): v is string => typeof v === "string" && v.length > 0);

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

  const displayFieldByModel = new Map<string, TitleFieldMeta>();
  for (const detail of titleFieldDetails) {
    displayFieldByModel.set(detail.modelId, {
      fieldId: detail.id,
      type: detail.type,
      hasLocales: detail.hasLocales,
    });
  }

  let defaultLocale: string | null = null;
  const defaultLocaleRow = await db
    .select({ code: schema.locales.code })
    .from(schema.locales)
    .where(eq(schema.locales.isDefault, true))
    .limit(1);
  if (defaultLocaleRow.length > 0) {
    defaultLocale = defaultLocaleRow[0].code;
  }

  const displayFieldIds = Array.from(new Set(displayFieldByModel.values())).map(
    (f) => f.fieldId,
  );

  const fieldIds = Array.from(new Set(merged.map((r) => r.fieldId)));

  const fieldMetaRows = fieldIds.length
    ? await db
        .select({
          id: schema.modelFields.id,
          name: schema.modelFields.name,
          fieldKey: schema.modelFields.fieldKey,
        })
        .from(schema.modelFields)
        .where(inArray(schema.modelFields.id, fieldIds))
    : [];

  const fieldMetaById = new Map(
    fieldMetaRows.map((row) => [
      row.id,
      {
        name: row.name ?? row.id,
        fieldKey: row.fieldKey ?? row.id,
      },
    ]),
  );

  let displayFieldRows: {
    entryId: string;
    fieldId: string;
    locale: string;
    valueString: string | null;
    valueNumber: number | null;
    valueDate: string | null;
    valueBoolean: boolean | null;
    valueJson: any;
  }[] = [];
  if (displayFieldIds.length > 0) {
    displayFieldRows = await db
      .select({
        entryId: schema.entryFields.entryId,
        fieldId: schema.entryFields.fieldId,
        locale: schema.entryFields.locale,
        valueString: schema.entryFields.valueString,
        valueNumber: schema.entryFields.valueNumber,
        valueDate: schema.entryFields.valueDate,
        valueBoolean: schema.entryFields.valueBoolean,
        valueJson: schema.entryFields.valueJson,
      })
      .from(schema.entryFields)
      .where(
        and(
          inArray(schema.entryFields.entryId, entryIds),
          inArray(schema.entryFields.fieldId, displayFieldIds),
        ),
      );
  }

  const fieldRowsByEntry = new Map<string, typeof displayFieldRows>();
  for (const row of displayFieldRows) {
    const list = fieldRowsByEntry.get(row.entryId) ?? [];
    list.push(row);
    fieldRowsByEntry.set(row.entryId, list);
  }

  const resolveDisplayTitle = (row: BackRefRow): string => {
    const displayMeta = displayFieldByModel.get(row.modelId);
    if (!displayMeta) return row.entryId;

    const rowsForEntry = fieldRowsByEntry.get(row.entryId) ?? [];
    let chosen = rowsForEntry.find(
      (r) => r.fieldId === displayMeta.fieldId && r.locale === defaultLocale,
    );
    if (!chosen) {
      chosen = rowsForEntry.find((r) => r.fieldId === displayMeta.fieldId);
    }
    if (!chosen) return row.entryId;

    switch (displayMeta.type) {
      case "text":
      case "rich_text":
      case "media":
      case "json":
      case "list":
      case "custom": {
        if (
          typeof chosen.valueString === "string" &&
          chosen.valueString.trim().length > 0
        ) {
          return chosen.valueString;
        }
        if (
          chosen.valueJson &&
          typeof chosen.valueJson === "object" &&
          chosen.valueJson.value
        ) {
          try {
            return JSON.stringify(chosen.valueJson.value);
          } catch {
            return String(chosen.valueJson.value);
          }
        }
        return row.entryId;
      }
      case "number": {
        if (
          typeof chosen.valueNumber === "number" &&
          Number.isFinite(chosen.valueNumber)
        ) {
          return String(chosen.valueNumber);
        }
        return row.entryId;
      }
      case "date": {
        return chosen.valueDate ?? row.entryId;
      }
      case "boolean": {
        if (typeof chosen.valueBoolean === "boolean")
          return chosen.valueBoolean ? "true" : "false";
        return row.entryId;
      }
      case "relation": {
        if (chosen.valueJson && Array.isArray(chosen.valueJson.entryIds)) {
          return `Related: ${chosen.valueJson.entryIds.join(", ")}`;
        }
        return row.entryId;
      }
      default:
        return row.entryId;
    }
  };

  const toDisplay = (row: BackRefRow) => {
    const meta = fieldMetaById.get(row.fieldId);
    return {
      entryId: row.entryId,
      modelId: row.modelId,
      modelName: row.modelName,
      displayTitle: resolveDisplayTitle(row),
      status: row.status,
      fieldId: row.fieldId,
      fieldName: meta?.name ?? row.fieldName ?? row.fieldId,
      fieldKey: meta?.fieldKey ?? row.fieldKey ?? row.fieldId,
    };
  };

  const relations = referencingRows.map(toDisplay);
  const richText = richTextMatches.map(toDisplay);

  return c.json({ relations, richText });
});

export default app;
export type AdminEntryReverseReferencesRoute = typeof app;
