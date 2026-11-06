import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq, inArray, and } from "drizzle-orm";
import * as schema from "../../database/schema";
import type { AppContext } from "../../types";
import { requireActor, requirePermission } from "./_authz";
import { MEDIA_READ_PERMISSIONS } from "./_permissions";

const app = new Hono<AppContext>();

const createPublicMediaUrl = ({ id }: { id: string; key: string }) =>
  `/api/admin/media/${id}/file`;

const appRoutes = app.get("/api/admin/media-references", async (c) => {
  const actor = await requireActor(c);
  if (actor instanceof Response) return actor;
  const permission = await requirePermission(c, actor, MEDIA_READ_PERMISSIONS);
  if (permission instanceof Response) return permission;

  const queries = c.req.queries();
  const mediaIds: string[] = [];
  const entryIds: string[] = [];

  const collect = (values: string[] | undefined, target: string[]) => {
    if (!values) return;
    for (const value of values) {
      if (!value) continue;
      const parts = value.split(",");
      for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed.length > 0) target.push(trimmed);
      }
    }
  };

  collect(queries.mediaId, mediaIds);
  collect(queries.mediaIds, mediaIds);
  collect(queries.entryId, entryIds);
  collect(queries.entryIds, entryIds);

  const db = drizzle(c.env.DB, { schema });

  const collectMediaFieldValue = (
    valueMedia: string | null,
    valueJson: unknown,
  ): void => {
    if (valueMedia) {
      mediaIds.push(valueMedia);
    }
    if (Array.isArray(valueJson)) {
      for (const item of valueJson) {
        if (typeof item === "string" && item.trim().length > 0) {
          mediaIds.push(item.trim());
        }
      }
    }
  };

  // If entryIds are provided, derive mediaIds from media entry fields.
  if (entryIds.length > 0) {
    const rows = await db
      .select({
        mediaId: schema.entryFields.valueMedia,
        mediaIds: schema.entryFields.valueJson,
      })
      .from(schema.entryFields)
      .innerJoin(
        schema.modelFields,
        eq(schema.entryFields.fieldId, schema.modelFields.id),
      )
      .where(
        and(
          inArray(schema.entryFields.entryId, Array.from(new Set(entryIds))),
          eq(schema.modelFields.type, "media"),
        ),
      );
    for (const row of rows) {
      collectMediaFieldValue(row.mediaId ?? null, row.mediaIds);
    }
  }

  const uniqueMediaIds = Array.from(new Set(mediaIds));
  if (uniqueMediaIds.length === 0) {
    return c.json({ items: [] });
  }

  const mediaRows = await db
    .select({
      id: schema.media.id,
      urlKey: schema.media.url,
      name: schema.media.name,
      description: schema.media.description,
      mimeType: schema.media.mimeType,
      width: schema.media.width,
      height: schema.media.height,
      size: schema.media.size,
      status: schema.media.status,
      updatedAt: schema.media.updatedAt,
    })
    .from(schema.media)
    .where(inArray(schema.media.id, uniqueMediaIds));

  const items = mediaRows.map((row) => ({
    id: row.id,
    url: createPublicMediaUrl({ id: row.id, key: row.urlKey }),
    name: row.name,
    description: row.description ?? null,
    mimeType: row.mimeType,
    width: row.width ?? null,
    height: row.height ?? null,
    size: row.size ?? null,
    status: row.status ?? null,
    updatedAt: row.updatedAt ?? null,
  }));

  return c.json({ items });
});

export default appRoutes;
