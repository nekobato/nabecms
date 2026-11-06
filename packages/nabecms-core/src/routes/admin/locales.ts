import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import * as schema from "../../database/schema";
import { createLocaleRepository } from "../../repositories/locales";
import { requireActor, requirePermission } from "./_authz";
import {
  LOCALES_READ_PERMISSIONS,
  LOCALES_WRITE_PERMISSION,
} from "./_permissions";
import {
  CannotDeleteDefaultLocaleError,
  LocaleAlreadyExistsError,
  LocaleNotFoundError,
  createLocale,
  deleteLocale,
  listLocales,
  setDefaultLocale,
  type LocalesServiceDeps,
} from "../../services/locales";
import type { AppContext } from "../../types";

const createLocaleSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(32)
    .regex(/^[A-Za-z0-9-]+$/u, "Invalid locale code"),
  isDefault: z.boolean().optional(),
});

const updateLocaleSchema = z.object({
  isDefault: z.literal(true),
});

function createDeps(c: any): LocalesServiceDeps {
  const db = drizzle(c.env.DB, { schema });
  return {
    repo: createLocaleRepository(db),
    now: () => new Date(),
  };
}

const app = new Hono<AppContext>()
  .get("/api/admin/locales", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const permission = await requirePermission(
      c,
      actor,
      LOCALES_READ_PERMISSIONS,
    );
    if (permission instanceof Response) return permission;

    const deps = createDeps(c);
    const items = await listLocales(deps);
    return c.json({ items });
  })
  .post("/api/admin/locales", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const permission = await requirePermission(
      c,
      actor,
      LOCALES_WRITE_PERMISSION,
    );
    if (permission instanceof Response) return permission;

    const body = await c.req.json().catch(() => null);
    const parsed = createLocaleSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: { code: "BAD_REQUEST", message: "Invalid payload" } },
        400,
      );
    }

    try {
      const deps = createDeps(c);
      const locale = await createLocale(deps, parsed.data);
      return c.json({ locale }, 201);
    } catch (error) {
      if (error instanceof LocaleAlreadyExistsError) {
        return c.json(
          { error: { code: "CONFLICT", message: "Locale already exists" } },
          409,
        );
      }
      console.error("Failed to create locale", error);
      return c.json(
        {
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to create locale",
          },
        },
        500,
      );
    }
  })
  .patch("/api/admin/locales/:code", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const permission = await requirePermission(
      c,
      actor,
      LOCALES_WRITE_PERMISSION,
    );
    if (permission instanceof Response) return permission;

    const body = await c.req.json().catch(() => null);
    const parsed = updateLocaleSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: { code: "BAD_REQUEST", message: "Invalid payload" } },
        400,
      );
    }

    try {
      const deps = createDeps(c);
      const locale = await setDefaultLocale(deps, c.req.param("code"));
      return c.json({ locale }, 200);
    } catch (error) {
      if (error instanceof LocaleNotFoundError) {
        return c.json(
          { error: { code: "NOT_FOUND", message: "Locale not found" } },
          404,
        );
      }
      console.error("Failed to update locale", error);
      return c.json(
        {
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to update locale",
          },
        },
        500,
      );
    }
  })
  .delete("/api/admin/locales/:code", async (c) => {
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;
    const permission = await requirePermission(
      c,
      actor,
      LOCALES_WRITE_PERMISSION,
    );
    if (permission instanceof Response) return permission;

    try {
      const deps = createDeps(c);
      await deleteLocale(deps, c.req.param("code"));
      return c.body(null, 204);
    } catch (error) {
      if (error instanceof LocaleNotFoundError) {
        return c.json(
          { error: { code: "NOT_FOUND", message: "Locale not found" } },
          404,
        );
      }
      if (error instanceof CannotDeleteDefaultLocaleError) {
        return c.json(
          {
            error: {
              code: "BAD_REQUEST",
              message: "Cannot delete default locale",
            },
          },
          400,
        );
      }
      console.error("Failed to delete locale", error);
      return c.json(
        {
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to delete locale",
          },
        },
        500,
      );
    }
  });

export default app;
