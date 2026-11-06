import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import * as schema from "../../../../database/schema";
import type { AppContext } from "../../../../types";
import { collectEntryReferenceIds } from "../../../../utils/entry-reference";
import {
  createDeps,
  getDrizzleDb,
  handleDatabaseBindingError,
  isRecord,
  mapMediaFieldValue,
  mapSnapshotValue,
  mergeSheetFields,
  normalizeEntryFieldType,
  parseEntryIdsParam,
  requireActor,
  requirePermission,
  resolveDefaultLocaleCode,
  resolveEntryDisplayTitle,
  toDraftSheetFields,
  toSheetEntryFieldValue,
  type FieldType,
  type SheetFieldRow,
  type SheetMode,
  type StoredRevisionContent,
} from "./shared";
import { parseSheetSort, sortSheetItems } from "./sheet-sort";
import { entryPermission } from "../../_permissions";

const readRoutes = new Hono<AppContext>()
  .get("/api/admin/models/:modelId/entries", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const modelId = c.req.param("modelId");
    const permission = await requirePermission(
      c,
      actor,
      entryPermission(modelId, "read"),
    );
    if (permission instanceof Response) return permission;

    let db;
    try {
      db = getDrizzleDb(c);
    } catch (error) {
      return handleDatabaseBindingError(c, "entries list", error);
    }
    const model = (
      await db
        .select({
          id: schema.models.id,
          titleFieldId: schema.models.titleFieldId,
        })
        .from(schema.models)
        .where(eq(schema.models.id, modelId))
        .limit(1)
    )[0];

    if (!model) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Model not found" } },
        404,
      );
    }

    let displayTitleField: typeof schema.modelFields.$inferSelect | null = null;
    if (model.titleFieldId) {
      const field = (
        await db
          .select()
          .from(schema.modelFields)
          .where(eq(schema.modelFields.id, model.titleFieldId))
          .limit(1)
      )[0];
      if (field && field.modelId === model.id) {
        displayTitleField = field;
      }
    }

    const modelEntries = await db
      .select({
        id: schema.entries.id,
        modelId: schema.entries.modelId,
        status: schema.entries.status,
        createdAt: schema.entries.createdAt,
        updatedAt: schema.entries.updatedAt,
        updatedBy: schema.entries.updatedBy,
        updatedByName: schema.users.name,
        publishedAt: schema.entries.publishedAt,
        currentDraftRevisionId: schema.entries.currentDraftRevisionId,
        publishedRevisionId: schema.entries.publishedRevisionId,
      })
      .from(schema.entries)
      .leftJoin(schema.users, eq(schema.entries.updatedBy, schema.users.id))
      .where(eq(schema.entries.modelId, modelId))
      .orderBy(schema.entries.createdAt);

    const locales = await db
      .select({
        code: schema.locales.code,
        isDefault: schema.locales.isDefault,
      })
      .from(schema.locales);
    const defaultLocale = resolveDefaultLocaleCode(locales);

    const entryIdList = modelEntries.map((entry) => entry.id);
    const publishedTitleFieldsByEntry = new Map<
      string,
      ReturnType<typeof toSheetEntryFieldValue>[]
    >();

    if (displayTitleField && entryIdList.length > 0) {
      const publishedTitleFieldRows = await db
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
            inArray(schema.entryFields.entryId, entryIdList),
            eq(schema.entryFields.fieldId, displayTitleField.id),
          ),
        );

      for (const row of publishedTitleFieldRows as SheetFieldRow[]) {
        const list = publishedTitleFieldsByEntry.get(row.entryId) ?? [];
        list.push(toSheetEntryFieldValue(row));
        publishedTitleFieldsByEntry.set(row.entryId, list);
      }
    }

    const draftRevisionIds = modelEntries
      .map((entry) => entry.currentDraftRevisionId)
      .filter((id): id is string => typeof id === "string" && id.length > 0);

    const draftTitleFieldsByEntry = new Map<
      string,
      ReturnType<typeof toSheetEntryFieldValue>[]
    >();
    if (displayTitleField && draftRevisionIds.length > 0) {
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
        ).filter((field) => field.fieldId === displayTitleField.id);
        draftTitleFieldsByEntry.set(revision.entryId, fields);
      }
    }

    const entriesWithDisplayTitle = modelEntries.map((entry) => {
      const publishedTitleFields =
        publishedTitleFieldsByEntry.get(entry.id) ?? [];
      const draftTitleFields = draftTitleFieldsByEntry.get(entry.id) ?? [];
      const titleFields =
        draftTitleFields.length > 0
          ? mergeSheetFields(draftTitleFields, publishedTitleFields)
          : publishedTitleFields;

      return {
        ...entry,
        displayTitle: resolveEntryDisplayTitle({
          entryId: entry.id,
          fields: titleFields,
          titleFieldId: displayTitleField?.id,
          defaultLocale,
        }),
        hasDraft:
          typeof entry.currentDraftRevisionId === "string" &&
          entry.currentDraftRevisionId.length > 0,
      };
    });

    const query = c.req.query("q");
    const filtered =
      typeof query === "string" && query.trim().length > 0
        ? entriesWithDisplayTitle.filter((entry) => {
            const term = query.trim().toLowerCase();
            const displayTitleText =
              typeof entry.displayTitle === "string"
                ? entry.displayTitle.toLowerCase()
                : "";
            const idText =
              typeof entry.id === "string"
                ? entry.id.toLowerCase()
                : String(entry.id ?? "").toLowerCase();
            return displayTitleText.includes(term) || idText.includes(term);
          })
        : entriesWithDisplayTitle;

    return c.json(filtered);
  })
  .get("/api/admin/models/:modelId/entries/sheet", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const modelId = c.req.param("modelId");
    const permission = await requirePermission(
      c,
      actor,
      entryPermission(modelId, "read"),
    );
    if (permission instanceof Response) return permission;

    let db;
    try {
      db = getDrizzleDb(c);
    } catch (error) {
      return handleDatabaseBindingError(c, "entries sheet", error);
    }

    const modeRaw = c.req.query("mode");
    const mode: SheetMode = modeRaw === "published" ? "published" : "draft";
    const activeLocale = c.req.query("locale");
    const sort = parseSheetSort(
      c.req.query("sortBy"),
      c.req.query("sortOrder"),
    );
    const entryIds = parseEntryIdsParam(c.req.query("entryIds"));

    const [model] = await db
      .select()
      .from(schema.models)
      .where(eq(schema.models.id, modelId))
      .limit(1);

    if (!model) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Model not found" } },
        404,
      );
    }

    const modelFields = await db
      .select()
      .from(schema.modelFields)
      .where(eq(schema.modelFields.modelId, modelId))
      .orderBy(schema.modelFields.position);

    const locales = await db
      .select({
        code: schema.locales.code,
        isDefault: schema.locales.isDefault,
      })
      .from(schema.locales);
    const defaultLocale = resolveDefaultLocaleCode(locales);
    const locale = activeLocale?.trim().length ? activeLocale : defaultLocale;

    const entryConditions = [eq(schema.entries.modelId, modelId)];
    if (entryIds.length > 0) {
      entryConditions.push(inArray(schema.entries.id, entryIds));
    }

    const modelEntries = await db
      .select({
        id: schema.entries.id,
        modelId: schema.entries.modelId,
        status: schema.entries.status,
        createdAt: schema.entries.createdAt,
        updatedAt: schema.entries.updatedAt,
        updatedBy: schema.entries.updatedBy,
        updatedByName: schema.users.name,
        publishedAt: schema.entries.publishedAt,
        currentDraftRevisionId: schema.entries.currentDraftRevisionId,
        publishedRevisionId: schema.entries.publishedRevisionId,
      })
      .from(schema.entries)
      .leftJoin(schema.users, eq(schema.entries.updatedBy, schema.users.id))
      .where(and(...entryConditions))
      .orderBy(schema.entries.createdAt);

    const entryIdList = modelEntries.map((entry) => entry.id);
    if (entryIdList.length === 0) {
      return c.json({
        model: { ...model, fields: modelFields },
        locales,
        items: [],
      });
    }

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
      .where(inArray(schema.entryFields.entryId, entryIdList));

    const publishedFieldsByEntry = new Map<
      string,
      ReturnType<typeof toSheetEntryFieldValue>[]
    >();
    for (const row of publishedFieldRows as SheetFieldRow[]) {
      const list = publishedFieldsByEntry.get(row.entryId) ?? [];
      list.push(toSheetEntryFieldValue(row));
      publishedFieldsByEntry.set(row.entryId, list);
    }

    const draftRevisionIds = modelEntries
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
        draftFieldsByEntry.set(
          revision.entryId,
          toDraftSheetFields(
            (revision.content ?? null) as StoredRevisionContent | null,
          ),
        );
      }
    }

    const displayTitleField = model.titleFieldId
      ? (modelFields.find((field) => field.id === model.titleFieldId) ?? null)
      : null;

    const items = modelEntries.map((entry) => {
      const publishedFields = publishedFieldsByEntry.get(entry.id) ?? [];
      const draftFields = draftFieldsByEntry.get(entry.id) ?? [];
      const fields =
        mode === "published"
          ? publishedFields
          : draftFields.length > 0
            ? mergeSheetFields(draftFields, publishedFields)
            : publishedFields;

      return {
        ...entry,
        displayTitle: resolveEntryDisplayTitle({
          entryId: entry.id,
          fields,
          titleFieldId: displayTitleField?.id,
          defaultLocale,
        }),
        hasDraft:
          typeof entry.currentDraftRevisionId === "string" &&
          entry.currentDraftRevisionId.length > 0,
        fields,
      };
    });

    const query = c.req.query("q");
    const filteredItems =
      typeof query === "string" && query.trim().length > 0
        ? items.filter((entry) => {
            const term = query.trim().toLowerCase();
            const displayTitleText =
              typeof entry.displayTitle === "string"
                ? entry.displayTitle.toLowerCase()
                : "";
            const idText =
              typeof entry.id === "string"
                ? entry.id.toLowerCase()
                : String(entry.id ?? "").toLowerCase();
            return displayTitleText.includes(term) || idText.includes(term);
          })
        : items;

    const sortedItems = sortSheetItems(filteredItems, {
      sort,
      locale,
      defaultLocale,
      modelFields,
    });

    return c.json({
      model: { ...model, fields: modelFields },
      locales,
      items: sortedItems,
    });
  })
  .get("/api/admin/models/:modelId/entries/:entryId", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const modelId = c.req.param("modelId");
    const permission = await requirePermission(
      c,
      actor,
      entryPermission(modelId, "read"),
    );
    if (permission instanceof Response) return permission;

    let db;
    try {
      db = getDrizzleDb(c);
    } catch (error) {
      return handleDatabaseBindingError(c, "entry detail", error);
    }
    const entryId = c.req.param("entryId");

    const [entry] = await db
      .select({
        id: schema.entries.id,
        modelId: schema.entries.modelId,
        status: schema.entries.status,
        createdAt: schema.entries.createdAt,
        updatedAt: schema.entries.updatedAt,
        updatedBy: schema.entries.updatedBy,
        updatedByName: schema.users.name,
        publishedAt: schema.entries.publishedAt,
        currentDraftRevisionId: schema.entries.currentDraftRevisionId,
        publishedRevisionId: schema.entries.publishedRevisionId,
      })
      .from(schema.entries)
      .leftJoin(schema.users, eq(schema.entries.updatedBy, schema.users.id))
      .where(
        and(
          eq(schema.entries.id, entryId),
          eq(schema.entries.modelId, modelId),
        ),
      )
      .limit(1);

    if (!entry) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Entry not found" } },
        404,
      );
    }

    const fieldRows = await db
      .select({
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
      .where(eq(schema.entryFields.entryId, entryId));

    const fieldValues = fieldRows.map((row) => {
      const rawType =
        typeof row.fieldType === "string" ? row.fieldType : "text";
      const type: FieldType = normalizeEntryFieldType(rawType);
      const fieldId =
        typeof row.fieldId === "string"
          ? row.fieldId
          : String(row.fieldId ?? "");
      const locale =
        typeof row.locale === "string" ? row.locale : String(row.locale ?? "");
      let value: unknown = null;
      switch (type) {
        case "text":
          value = row.valueString ?? "";
          break;
        case "number":
          value = row.valueNumber ?? null;
          break;
        case "date":
          value = row.valueDate ?? null;
          break;
        case "boolean":
          value = Boolean(row.valueBoolean);
          break;
        case "media":
          value = mapMediaFieldValue(row.valueMedia, row.valueJson);
          break;
        case "relation":
          value = row.valueRelation ?? null;
          break;
        case "rich_text":
        case "json":
        case "list":
        case "custom":
        default:
          value = row.valueJson ?? null;
          break;
      }

      return {
        fieldId,
        locale,
        type,
        value,
      };
    });

    let draft: null | {
      revisionId: string;
      revisionNumber: number;
      status: string;
      createdAt: string;
      publishedAt: string | null;
      fields: Array<{
        fieldId: string;
        locale: string;
        type: string;
        value: unknown;
      }>;
    } = null;

    if (entry.currentDraftRevisionId) {
      const [draftRevision] = await db
        .select({
          id: schema.entryRevisions.id,
          revisionNumber: schema.entryRevisions.revisionNumber,
          status: schema.entryRevisions.status,
          content: schema.entryRevisions.content,
          createdAt: schema.entryRevisions.createdAt,
          publishedAt: schema.entryRevisions.publishedAt,
        })
        .from(schema.entryRevisions)
        .where(eq(schema.entryRevisions.id, entry.currentDraftRevisionId))
        .limit(1);

      if (draftRevision) {
        const content = (draftRevision.content ??
          null) as StoredRevisionContent | null;
        const draftFields = Array.isArray(content?.fields)
          ? content.fields.map((field) => ({
              fieldId: field.fieldId,
              locale: field.locale,
              type:
                typeof field.type === "string" && field.type.trim().length > 0
                  ? field.type
                  : "text",
              value: mapSnapshotValue(field),
            }))
          : [];
        draft = {
          revisionId: draftRevision.id,
          revisionNumber: draftRevision.revisionNumber,
          status: draftRevision.status,
          createdAt: draftRevision.createdAt,
          publishedAt: draftRevision.publishedAt ?? null,
          fields: draftFields,
        };
      }
    }

    const referencedEntryIds = new Set<string>();
    const collectReferences = (
      fields: Array<{ type: string; value: unknown }> | undefined,
    ) => {
      if (!fields) return;
      for (const field of fields) {
        if (field.type !== "rich_text") continue;
        const rawValue = field.value;
        const traversable =
          isRecord(rawValue) && "value" in rawValue ? rawValue.value : rawValue;
        const ids = collectEntryReferenceIds(traversable);
        for (const id of ids) {
          referencedEntryIds.add(id);
        }
      }
    };

    collectReferences(fieldValues);
    if (draft) {
      collectReferences(draft.fields);
    }

    return c.json({
      item: {
        id: entry.id,
        modelId: entry.modelId,
        status: entry.status,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        updatedBy: entry.updatedBy,
        updatedByName: entry.updatedByName,
        publishedAt: entry.publishedAt,
        fields: fieldValues,
        publishedRevisionId: entry.publishedRevisionId,
      },
      draft,
      referencedEntryIds: Array.from(referencedEntryIds),
    });
  })
  .get("/api/admin/models/:modelId/entries/:entryId/revisions", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const modelId = c.req.param("modelId");
    const permission = await requirePermission(
      c,
      actor,
      entryPermission(modelId, "read"),
    );
    if (permission instanceof Response) return permission;

    let deps;
    try {
      deps = createDeps(c);
    } catch (error) {
      return handleDatabaseBindingError(c, "revision list", error);
    }
    const entryId = c.req.param("entryId");

    const entry = await deps.repo.findEntryById(entryId);
    if (!entry || entry.modelId !== modelId) {
      return c.json(
        { error: { code: "ENTRY_NOT_FOUND", message: "Entry not found" } },
        404,
      );
    }

    const revisions = await deps.repo.listRevisions(entryId, 50);
    return c.json({
      items: revisions.map((revision) => ({
        id: revision.id,
        revisionNumber: revision.revisionNumber,
        status: revision.status,
        createdAt: revision.createdAt,
        publishedAt: revision.publishedAt,
        hasContent:
          !!revision.content &&
          Array.isArray((revision.content as any)?.fields) &&
          ((revision.content as any)?.fields?.length ?? 0) > 0,
      })),
    });
  });

export default readRoutes;
