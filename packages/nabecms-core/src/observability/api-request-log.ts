import type { Context, MiddlewareHandler } from "hono";
import { routePath } from "hono/route";
import type { ApiRequestLogContext, AppContext, Env } from "../types";

const API_REQUEST_EVENT = "nabecms.api_request";
const REQUEST_ID_HEADER = "X-NABECMS-Request-Id";
const LEGACY_REQUEST_ID_HEADER = "X-Request-Id";

type ApiRequestScope = "admin-api" | "contents-api";

export type ApiRequestLogPayload = {
  event: typeof API_REQUEST_EVENT;
  requestId: string;
  scope: ApiRequestScope;
  routeGroup: string;
  status: number;
  durationMs: number;
  modelId?: string;
  apiKeyId?: string;
};

export type StructuredApiRequestLogOptions = {
  enabled?: boolean;
};

/**
 * Generate a request ID for response headers, webhook context, and log correlation.
 */
export const generateRequestId = (): string => `req_${crypto.randomUUID()}`;

/**
 * Merge API request log metadata into the current Hono request context.
 */
export const setApiRequestLogContext = (
  c: Context<AppContext>,
  patch: ApiRequestLogContext,
): void => {
  const current = c.get("apiRequestLog") ?? {};
  c.set("apiRequestLog", { ...current, ...patch });
};

/**
 * Classify a request path into the NabeCMS API scope that should be logged.
 */
export const resolveApiRequestScope = (
  pathname: string,
): ApiRequestScope | null => {
  if (pathname === "/api/contents" || pathname.startsWith("/api/contents/")) {
    return "contents-api";
  }
  if (pathname === "/api/admin" || pathname.startsWith("/api/admin/")) {
    return "admin-api";
  }
  return null;
};

/**
 * Extract the model ID from Contents API paths that carry it as a route parameter.
 */
export const extractContentsModelId = (
  pathname: string,
): string | undefined => {
  const segments = pathname.split("/").filter(Boolean);
  if (
    segments[0] !== "api" ||
    segments[1] !== "contents" ||
    segments[2] !== "models"
  ) {
    return undefined;
  }
  const modelId = segments[3];
  return modelId ? decodeURIComponent(modelId) : undefined;
};

const cleanRoutePath = (path: string): string | null => {
  const trimmed = path.trim();
  if (!trimmed || trimmed === "*" || trimmed === "/*") return null;
  return trimmed;
};

/**
 * Resolve the route pattern used for structured logging.
 */
export const resolveRouteGroup = (
  method: string,
  pathname: string,
  matchedRoutePath?: string,
): string => {
  const matched = matchedRoutePath ? cleanRoutePath(matchedRoutePath) : null;
  const route = matched ?? normalizeFallbackRoutePath(pathname);
  return `${method.toUpperCase()} ${route}`;
};

const normalizeFallbackRoutePath = (pathname: string): string => {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] === "api" && segments[1] === "contents") {
    return normalizeContentsFallbackPath(segments);
  }
  if (segments[0] === "api" && segments[1] === "admin") {
    return normalizeAdminFallbackPath(segments);
  }
  return pathname;
};

const normalizeContentsFallbackPath = (segments: string[]): string => {
  if (segments.length === 3 && segments[2] === "health") {
    return "/api/contents/health";
  }
  if (segments.length === 3 && segments[2] === "models") {
    return "/api/contents/models";
  }
  if (segments.length === 4 && segments[2] === "models") {
    return "/api/contents/models/:modelId";
  }
  if (
    segments.length === 5 &&
    segments[2] === "models" &&
    segments[4] === "entries"
  ) {
    return "/api/contents/models/:modelId/entries";
  }
  if (
    segments.length === 6 &&
    segments[2] === "models" &&
    segments[4] === "entries"
  ) {
    return "/api/contents/models/:modelId/entries/:entryId";
  }
  if (segments.length === 3 && segments[2] === "query") {
    return "/api/contents/query";
  }
  return `/${segments.join("/")}`;
};

const adminParamAfterSegment: Record<string, string> = {
  models: "modelId",
  fields: "fieldId",
  entries: "entryId",
  revisions: "revisionId",
  media: "mediaId",
  "media-variants": "variantId",
  locales: "localeCode",
  roles: "roleId",
  users: "userId",
  "api-keys": "apiKeyId",
  webhooks: "webhookId",
  invites: "inviteId",
  sso: "provider",
};

const staticAdminSegments = new Set([
  "accept-invite",
  "api-keys",
  "auth",
  "auth-security",
  "bootstrap",
  "bulk",
  "callback",
  "config",
  "dashboard",
  "dependencies",
  "entry-references",
  "entry-reverse-references",
  "fields",
  "file",
  "invites",
  "locales",
  "login",
  "logout",
  "logs",
  "media",
  "media-references",
  "media-variants",
  "me",
  "models",
  "order",
  "password-reset",
  "providers",
  "publish",
  "refresh",
  "retry",
  "revoke",
  "roles",
  "rotate",
  "security",
  "settings",
  "signup",
  "sso",
  "start",
  "system",
  "test",
  "transform",
  "turnstile",
  "unpublish",
  "user-preferences",
  "users",
  "validate",
  "variants",
  "webhooks",
]);

const normalizeAdminFallbackPath = (segments: string[]): string => {
  const normalized = segments.map((segment, index) => {
    if (index < 3 || staticAdminSegments.has(segment)) return segment;
    const previous = segments[index - 1] ?? "";
    const paramName = adminParamAfterSegment[previous];
    return paramName ? `:${paramName}` : segment;
  });
  return `/${normalized.join("/")}`;
};

/**
 * Decide whether a request should emit structured API logs.
 */
const shouldLogStructuredApiRequest = (
  env: Env | undefined,
  options: StructuredApiRequestLogOptions,
): boolean => {
  if (typeof options.enabled === "boolean") return options.enabled;
  if (!env) return false;
  return env.WORKER_ENV !== "test";
};

const setRequestIdHeaders = (
  c: Context<AppContext>,
  requestId: string,
): void => {
  c.header(REQUEST_ID_HEADER, requestId);
  c.header(LEGACY_REQUEST_ID_HEADER, requestId);
};

/**
 * Create lightweight structured logging middleware for NabeCMS API requests.
 */
export const createApiRequestLogMiddleware = (
  options: StructuredApiRequestLogOptions = {},
): MiddlewareHandler<AppContext> => {
  return async (c, next) => {
    const requestId = generateRequestId();
    c.set("requestId", requestId);

    const startedAt = performance.now();
    let thrown: unknown;

    try {
      await next();
    } catch (error) {
      thrown = error;
      throw error;
    } finally {
      setRequestIdHeaders(c, requestId);

      const url = new URL(c.req.url);
      const scope = resolveApiRequestScope(url.pathname);
      if (scope && shouldLogStructuredApiRequest(c.env, options)) {
        const metadata = c.get("apiRequestLog") ?? {};
        const modelId =
          metadata.modelId ??
          (scope === "contents-api"
            ? extractContentsModelId(url.pathname)
            : undefined);
        const matched = thrown ? undefined : routePath(c, -1);
        const status = c.res?.status ?? (thrown ? 500 : 404);
        const payload: ApiRequestLogPayload = {
          event: API_REQUEST_EVENT,
          requestId,
          scope,
          routeGroup: resolveRouteGroup(c.req.method, url.pathname, matched),
          status,
          durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
          ...(modelId ? { modelId } : {}),
          ...(metadata.apiKeyId ? { apiKeyId: metadata.apiKeyId } : {}),
        };

        console.log(JSON.stringify(payload));
      }
    }
  };
};
