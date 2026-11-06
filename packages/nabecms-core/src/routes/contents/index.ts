import { Hono } from "hono";
import type { AppContext } from "../../types";
import {
  getContentEntry,
  getContentModel,
  listContentEntries,
  listContentModels,
  InvalidFilterError,
  ContentModelNotFoundError,
  type ListEntriesParams,
} from "../../services/contents-delivery";
import { requireContentsAccess } from "./_authz";

const CACHE_PRIVATE = "private, no-store";

const app = new Hono<AppContext>();

const encoder = new TextEncoder();
const HEALTH_CACHE_CONTROL = "no-store";
const MAX_FILTER_QUERY_DEPTH = 6;
const MAX_FILTER_QUERY_PARAMETERS = 100;
const MAX_FILTER_ARRAY_LENGTH = 50;
const requireAuth = requireContentsAccess;

/**
 * Mark every Contents API response as private before authentication or route
 * handling can return an API-key-dependent result.
 */
async function isolateContentsResponseCache(
  c: any,
  next: () => Promise<void>,
): Promise<void> {
  c.header("Cache-Control", CACHE_PRIVATE);
  await next();
}

app.use("/api/contents/*", isolateContentsResponseCache);

type D1StatementLike = {
  first?: <T = unknown>() => Promise<T | null>;
  run?: () => Promise<unknown>;
};

type D1BindingLike = {
  prepare: (query: string) => D1StatementLike;
};

async function hashString(input: string): Promise<string> {
  const bytes = encoder.encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function parseCsv(value: string | undefined | null): string[] | undefined {
  if (!value) return undefined;
  const parts = value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

function parseBoolean(
  value: string | undefined | null,
  fallback = false,
): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

/**
 * Resolve preview mode from both supported request locations.
 *
 * A truthy body value retains the existing request semantics while ensuring
 * that every path which enables draft delivery is authorized together.
 */
function resolveIncludeDraft(
  queryValue: string | undefined | null,
  bodyValue: unknown,
): boolean {
  return parseBoolean(queryValue, false) || Boolean(bodyValue);
}

function parseNumber(
  value: string | undefined | null,
  fallback: number,
): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function parseInclude(
  value: string | undefined | null,
): Pick<
  ListEntriesParams,
  "includeMedia" | "includeRelations" | "includeAssets"
> {
  if (!value)
    return { includeMedia: true, includeRelations: true, includeAssets: true };
  const trimmed = value.trim();
  if (trimmed === "0") {
    return {
      includeMedia: false,
      includeRelations: false,
      includeAssets: false,
    };
  }
  const parts = parseCsv(trimmed) ?? [];
  const includeMedia =
    parts.length === 0 ||
    parts.includes("media") ||
    parts.some((p) => p.startsWith("media"));
  const includeRelations =
    parts.length === 0 ||
    parts.includes("relations") ||
    parts.some((p) => p.startsWith("relations"));
  const includeAssets =
    includeMedia && (parts.length === 0 || parts.includes("media"));
  return { includeMedia, includeRelations, includeAssets };
}

function parseSort(value: string | undefined | null): string[] | undefined {
  if (!value) return undefined;
  const parts = value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

function isNumericPathSegment(value: string): boolean {
  return /^\d+$/.test(value);
}

function createFilterContainer(nextSegment: string | undefined): unknown {
  return nextSegment && isNumericPathSegment(nextSegment)
    ? []
    : Object.create(null);
}

function parseFilterPath(key: string): string[] | null {
  if (!key.startsWith("filters[")) return null;
  const path: string[] = [];
  let cursor = "filters".length;

  while (cursor < key.length) {
    if (key[cursor] !== "[") return null;
    const closeIndex = key.indexOf("]", cursor);
    if (closeIndex === -1) return null;
    const segment = key.slice(cursor + 1, closeIndex);
    if (!segment) return null;
    path.push(segment);
    cursor = closeIndex + 1;
  }

  return path;
}

function assignFilterValue(
  root: Record<string, unknown>,
  path: string[],
  value: string,
): void {
  if (path.length === 0) {
    throw new InvalidFilterError([
      { path: ["filters"], message: "filters must use nested keys" },
    ]);
  }
  if (path.length > MAX_FILTER_QUERY_DEPTH) {
    throw new InvalidFilterError([
      { path: ["filters"], message: "Filter nesting is too deep" },
    ]);
  }
  if (
    path.some((segment) =>
      ["__proto__", "constructor", "prototype"].includes(segment),
    )
  ) {
    throw new InvalidFilterError([
      { path: ["filters", ...path], message: "Reserved filter path segment" },
    ]);
  }

  let current: unknown = root;

  path.forEach((segment, index) => {
    const isLast = index === path.length - 1;
    const nextSegment = path[index + 1];

    if (Array.isArray(current)) {
      if (!isNumericPathSegment(segment)) {
        throw new InvalidFilterError([
          {
            path: ["filters", ...path.slice(0, index + 1)],
            message: "Array segments must use numeric indexes",
          },
        ]);
      }
      const arrayIndex = Number(segment);
      if (arrayIndex >= MAX_FILTER_ARRAY_LENGTH) {
        throw new InvalidFilterError([
          {
            path: ["filters", ...path.slice(0, index + 1)],
            message: "Filter array is too large",
          },
        ]);
      }

      if (isLast) {
        if (current[arrayIndex] !== undefined) {
          throw new InvalidFilterError([
            {
              path: ["filters", ...path],
              message: "Duplicate filter key is not allowed",
            },
          ]);
        }
        current[arrayIndex] = value;
        return;
      }

      const nextValue = current[arrayIndex];
      if (nextValue === undefined) {
        current[arrayIndex] = createFilterContainer(nextSegment);
      } else if (
        nextValue === null ||
        (typeof nextValue !== "object" && !Array.isArray(nextValue))
      ) {
        throw new InvalidFilterError([
          {
            path: ["filters", ...path.slice(0, index + 1)],
            message: "Conflicting filter structure",
          },
        ]);
      }
      current = current[arrayIndex];
      return;
    }

    if (!current || typeof current !== "object") {
      throw new InvalidFilterError([
        {
          path: ["filters", ...path.slice(0, index + 1)],
          message: "Conflicting filter structure",
        },
      ]);
    }

    const record = current as Record<string, unknown>;
    if (isLast) {
      if (record[segment] !== undefined) {
        throw new InvalidFilterError([
          {
            path: ["filters", ...path],
            message: "Duplicate filter key is not allowed",
          },
        ]);
      }
      record[segment] = value;
      return;
    }

    const nextValue = record[segment];
    if (nextValue === undefined) {
      record[segment] = createFilterContainer(nextSegment);
    } else if (
      nextValue === null ||
      (typeof nextValue !== "object" && !Array.isArray(nextValue))
    ) {
      throw new InvalidFilterError([
        {
          path: ["filters", ...path.slice(0, index + 1)],
          message: "Conflicting filter structure",
        },
      ]);
    }
    current = record[segment];
  });
}

function parseFiltersFromRequestUrl(requestUrl: string): unknown | undefined {
  const url = new URL(requestUrl);
  const filterEntries = Array.from(url.searchParams.entries()).filter(([key]) =>
    key.startsWith("filters["),
  );

  if (filterEntries.length === 0) return undefined;
  if (filterEntries.length > MAX_FILTER_QUERY_PARAMETERS) {
    throw new InvalidFilterError([
      {
        path: ["filters"],
        message: "Too many filter parameters",
      },
    ]);
  }

  const root: Record<string, unknown> = Object.create(null);
  for (const [key, value] of filterEntries) {
    const path = parseFilterPath(key);
    if (!path) {
      throw new InvalidFilterError([
        {
          path: ["filters"],
          message: "Invalid filter query syntax",
        },
      ]);
    }
    assignFilterValue(root, path, value);
  }

  return root;
}

function toValidationErrorResponse(c: any, error: InvalidFilterError) {
  return c.json(
    {
      error: {
        code: "VALIDATION_ERROR",
        message: error.message,
        issues: error.issues,
      },
    },
    422,
  );
}

function getNowIsoString(): string {
  return new Date().toISOString();
}

function getTimestampMs(): number {
  if (
    typeof globalThis.performance !== "undefined" &&
    typeof globalThis.performance.now === "function"
  ) {
    return globalThis.performance.now();
  }
  return Date.now();
}

async function checkDatabaseHealth(c: any): Promise<
  | { ok: true; latencyMs: number }
  | {
      ok: false;
      latencyMs: number;
      code: "DB_BINDING_MISSING" | "DB_UNAVAILABLE" | "DB_UNEXPECTED_RESULT";
      message: string;
    }
> {
  const start = getTimestampMs();
  const latencyMs = () => Number((getTimestampMs() - start).toFixed(2));
  const db = c.env?.DB as D1BindingLike | undefined;

  if (!db || typeof db.prepare !== "function") {
    return {
      ok: false,
      latencyMs: latencyMs(),
      code: "DB_BINDING_MISSING",
      message: "DB binding 'DB' is not configured",
    };
  }

  try {
    const statement = db.prepare("SELECT 1 AS ok");
    if (typeof statement.first === "function") {
      const row = await statement.first<{ ok?: number }>();
      if (row?.ok === 1) {
        return { ok: true, latencyMs: latencyMs() };
      }
      return {
        ok: false,
        latencyMs: latencyMs(),
        code: "DB_UNEXPECTED_RESULT",
        message: "Unexpected result from D1 health query",
      };
    }

    if (typeof statement.run === "function") {
      await statement.run();
      return { ok: true, latencyMs: latencyMs() };
    }

    return {
      ok: false,
      latencyMs: latencyMs(),
      code: "DB_UNAVAILABLE",
      message: "D1 statement is not executable",
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: latencyMs(),
      code: "DB_UNAVAILABLE",
      message: error instanceof Error ? error.message : "Failed to query D1",
    };
  }
}

/**
 * Apply private response metadata without making API-key-dependent data
 * eligible for shared caching.
 */
async function applyCaching(
  c: any,
  options: {
    lastUpdatedAt: string | null;
    etagInput?: unknown;
  },
) {
  c.header("Cache-Control", CACHE_PRIVATE);
  const requestId = c.get("requestId") ?? crypto.randomUUID();
  c.header("X-Request-Id", requestId);
  c.header("X-NABECMS-Request-Id", requestId);
  if (options.lastUpdatedAt) {
    const date = new Date(options.lastUpdatedAt);
    if (!Number.isNaN(date.getTime())) {
      c.header("Last-Modified", date.toUTCString());
    }
  }
  if (options.etagInput !== undefined) {
    const raw = JSON.stringify(options.etagInput);
    const hash = await hashString(raw);
    c.header("ETag", `W/"${hash}"`);
  }
}

/**
 * @description Health check endpoint (no auth)
 * @route GET /api/contents/health
 * @returns 200 JSON `{ status: "ok", checks: { runtime, api, db } }`
 * @returns 503 JSON `{ status: "error", checks: { runtime, api, db } }`
 */
app.get("/api/contents/health", async (c) => {
  const db = await checkDatabaseHealth(c);
  c.header("Cache-Control", HEALTH_CACHE_CONTROL);
  const requestId = c.get("requestId") ?? crypto.randomUUID();
  c.header("X-Request-Id", requestId);
  c.header("X-NABECMS-Request-Id", requestId);

  const body = {
    status: db.ok ? "ok" : "error",
    service: "contents-api",
    timestamp: getNowIsoString(),
    checks: {
      runtime: { ok: true },
      api: { ok: true },
      db,
    },
  } as const;

  return c.json(body, db.ok ? 200 : 503);
});

/**
 * @description 公開モデル一覧を取得します
 * @route GET /api/contents/models
 * @auth Bearer API Key（contents:read）
 * @returns 200 JSON `{ items: Model[] }`（非公開モデル・isPrivate フィールド除外）
 * @cache private/no-store, ETag/Last-Modified 付与
 */
app.get("/api/contents/models", async (c) => {
  const auth = await requireAuth(c);
  if ("error" in auth) return auth.error;
  const { deps } = auth;

  const result = await listContentModels(deps, auth.auth.allowedModels);
  const lastUpdatedAt = result.items.reduce<string | null>((latest, model) => {
    if (!latest || model.updatedAt > latest) return model.updatedAt;
    return latest;
  }, null);

  await applyCaching(c, { lastUpdatedAt, etagInput: result });
  return c.json(result);
});

/**
 * @description モデル詳細を取得します
 * @route GET /api/contents/models/:modelId
 * @auth Bearer API Key（contents:read）
 * @returns 200 JSON `{ item: Model }` / 404 モデル未存在
 * @cache private/no-store, ETag/Last-Modified 付与
 */
app.get("/api/contents/models/:modelId", async (c) => {
  const auth = await requireAuth(c);
  if ("error" in auth) return auth.error;
  const { deps } = auth;
  const modelId = c.req.param("modelId");

  const item = await getContentModel(deps, modelId, auth.auth.allowedModels);
  if (!item) {
    return c.json(
      { error: { code: "NOT_FOUND", message: "Model not found" } },
      404,
    );
  }

  await applyCaching(c, {
    lastUpdatedAt: item.updatedAt,
    etagInput: item,
  });
  return c.json({ item });
});

/**
 * @description モデルのエントリー一覧を取得します
 * @route GET /api/contents/models/:modelId/entries
 * @auth Bearer API Key（draft=true 時は contents:preview 必須）
 * @query locale, fields, include, sort, page, limit, since, draft
 * @returns 200 JSON `{ items, page, limit, total, included, lastUpdatedAt }`
 * @cache private/no-store, ETag/Last-Modified 付与
 */
app.get("/api/contents/models/:modelId/entries", async (c) => {
  const draft = parseBoolean(c.req.query("draft"), false);
  const auth = await requireAuth(c, {
    requirePreview: draft,
    targetModelId: c.req.param("modelId"),
  });
  if ("error" in auth) return auth.error;
  const { deps } = auth;

  const locales = parseCsv(c.req.query("locale"));
  const fields = parseCsv(c.req.query("fields"));
  const { includeMedia, includeRelations, includeAssets } = parseInclude(
    c.req.query("include"),
  );
  const sort = parseSort(c.req.query("sort")) ?? ["-publishedAt"];
  const page = parseNumber(c.req.query("page"), 1);
  const limit = parseNumber(c.req.query("limit"), 20);
  const sinceRaw = c.req.query("since");
  const since = sinceRaw && sinceRaw.trim().length > 0 ? sinceRaw : null;
  let filters: unknown;
  try {
    filters = parseFiltersFromRequestUrl(c.req.raw.url);
  } catch (error) {
    if (error instanceof InvalidFilterError) {
      return toValidationErrorResponse(c, error);
    }
    throw error;
  }

  const params: ListEntriesParams = {
    modelId: c.req.param("modelId"),
    locales,
    fields,
    includeDraft: draft,
    includeMedia,
    includeRelations,
    includeAssets,
    page,
    limit,
    sort,
    since,
    filters,
  };

  let result;
  try {
    result = await listContentEntries(deps, params, auth.auth.allowedModels);
  } catch (error) {
    if (error instanceof ContentModelNotFoundError) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Model not found" } },
        404,
      );
    }
    if (error instanceof InvalidFilterError) {
      return toValidationErrorResponse(c, error);
    }
    throw error;
  }
  await applyCaching(c, {
    lastUpdatedAt: result.lastUpdatedAt,
    etagInput: result,
  });

  return c.json(result);
});

/**
 * @description エントリー詳細を取得します
 * @route GET /api/contents/models/:modelId/entries/:entryId
 * @auth Bearer API Key（draft=true 時は contents:preview 必須）
 * @query locale, fields, include, draft
 * @returns 200 JSON `{ item, included, lastUpdatedAt }` / 404 when missing
 * @cache private/no-store, ETag/Last-Modified 付与
 */
app.get("/api/contents/models/:modelId/entries/:entryId", async (c) => {
  const draft = parseBoolean(c.req.query("draft"), false);
  const auth = await requireAuth(c, {
    requirePreview: draft,
    targetModelId: c.req.param("modelId"),
  });
  if ("error" in auth) return auth.error;
  const { deps } = auth;

  const locales = parseCsv(c.req.query("locale"));
  const fields = parseCsv(c.req.query("fields"));
  const { includeMedia, includeRelations, includeAssets } = parseInclude(
    c.req.query("include"),
  );

  const result = await getContentEntry(
    deps,
    {
      modelId: c.req.param("modelId"),
      entryId: c.req.param("entryId"),
      locales,
      fields,
      includeDraft: draft,
      includeMedia,
      includeRelations,
      includeAssets,
    },
    auth.auth.allowedModels,
  );

  if (!result) {
    return c.json(
      { error: { code: "NOT_FOUND", message: "Entry not found" } },
      404,
    );
  }

  await applyCaching(c, {
    lastUpdatedAt: result.lastUpdatedAt,
    etagInput: result,
  });

  return c.json(result);
});

/**
 * @description 複合検索 API（現状は 1 モデル限定の一覧エイリアス）
 * @route POST /api/contents/query
 * @auth Bearer API Key（draft=true 時は contents:preview 必須）
 * @body modelId (required), locales/locale, fields, includeMedia, includeRelations, includeAssets, sort, page, limit, since, draft
 * @returns 200 JSON（entries 一覧と同形式）
 * @cache private/no-store, ETag/Last-Modified 付与
 */
app.post("/api/contents/query", async (c) => {
  let payload: any;
  try {
    payload = await c.req.json();
  } catch (error) {
    return c.json({ error: { code: "INVALID_PAYLOAD" } }, 400);
  }

  if (!payload || typeof payload !== "object") {
    return c.json({ error: { code: "INVALID_PAYLOAD" } }, 400);
  }

  const includeDraft = resolveIncludeDraft(c.req.query("draft"), payload.draft);
  const auth = await requireAuth(c, { requirePreview: includeDraft });
  if ("error" in auth) return auth.error;
  const { deps } = auth;

  const modelId = typeof payload.modelId === "string" ? payload.modelId : null;
  if (!modelId) {
    return c.json(
      { error: { code: "VALIDATION_ERROR", message: "modelId is required" } },
      422,
    );
  }

  const locales = Array.isArray(payload.locales)
    ? (payload.locales as string[])
    : parseCsv(payload.locale ?? null);
  const fields = Array.isArray(payload.fields)
    ? (payload.fields as string[])
    : parseCsv(payload.fields ?? null);
  const sort = Array.isArray(payload.sort)
    ? (payload.sort as string[])
    : (parseSort(payload.sort ?? null) ?? ["-publishedAt"]);
  const filters = payload.filters;

  const params: ListEntriesParams = {
    modelId,
    locales,
    fields,
    includeDraft,
    includeMedia: payload.includeMedia !== false,
    includeRelations: payload.includeRelations !== false,
    includeAssets: payload.includeAssets !== false,
    page:
      typeof payload.page === "number" ? payload.page : parseNumber(null, 1),
    limit:
      typeof payload.limit === "number" ? payload.limit : parseNumber(null, 20),
    sort,
    since: typeof payload.since === "string" ? payload.since : null,
    filters,
  };

  let result;
  try {
    result = await listContentEntries(deps, params, auth.auth.allowedModels);
  } catch (error) {
    if (error instanceof ContentModelNotFoundError) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Model not found" } },
        404,
      );
    }
    if (error instanceof InvalidFilterError) {
      return toValidationErrorResponse(c, error);
    }
    throw error;
  }
  await applyCaching(c, {
    lastUpdatedAt: result.lastUpdatedAt,
    etagInput: result,
  });

  return c.json(result);
});

export default app;
export type ContentsAppType = typeof app;
