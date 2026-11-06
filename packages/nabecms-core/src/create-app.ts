import { Hono } from "hono";
import appRoutes from "./routes";
import {
  loadConfig,
  type DatabaseMigrationsConfig,
  type NabeCmsConfig,
} from "./config";
import { runRuntimeMigrations } from "./migrations";
import { createApiRequestLogMiddleware } from "./observability/api-request-log";
import type { AppContext, Env } from "./types";

const ROBOTS_HEADER_VALUE = "noindex, nofollow";
const ADMIN_BASE_PATH = "/admin" as const;

/**
 * Options for creating the NabeCMS Hono application.
 */
export type CreateAppOptions = {
  config?: NabeCmsConfig;
};

/**
 * Strip a base path prefix from a request pathname.
 */
const stripBasePath = (pathname: string, basePath: string): string => {
  if (!basePath || basePath === "/") return pathname;
  if (pathname === basePath) return "/";
  if (pathname.startsWith(`${basePath}/`))
    return pathname.slice(basePath.length);
  return pathname;
};

/**
 * Decide whether the admin dev server proxy should be enabled.
 */
const resolveProxyEnabled = (
  configEnabled: boolean | undefined,
  envValue: string | undefined,
): boolean => {
  if (typeof configEnabled === "boolean") return configEnabled;
  return (envValue ?? "true") !== "false";
};

/**
 * Resolve the dev server port with config/env fallbacks.
 */
const resolveDevServerPort = (
  configPort: number | undefined,
  envPort: string | undefined,
): string => {
  if (typeof configPort === "number" && Number.isFinite(configPort)) {
    return String(configPort);
  }
  return envPort ?? "2525";
};

/**
 * Resolve the dev server host with a default fallback.
 */
const resolveDevServerHost = (configHost: string | undefined): string =>
  configHost?.trim() || "127.0.0.1";

type RuntimeMigrationDatabaseLike = {
  prepare: (query: string) => {
    all: <T = unknown>() => Promise<{ results?: T[] } | T[]>;
    run: <T = unknown>() => Promise<{ results?: T[] } | T[]>;
  };
  exec: (query: string) => Promise<unknown>;
};

/**
 * Decide whether the current binding looks like a D1 runtime binding.
 */
const isRuntimeMigrationDatabase = (
  value: unknown,
): value is RuntimeMigrationDatabaseLike =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as RuntimeMigrationDatabaseLike).prepare === "function" &&
  typeof (value as RuntimeMigrationDatabaseLike).exec === "function";

/**
 * Decide whether request-time migrations should run for the current runtime.
 */
const shouldRunRuntimeMigrations = (
  config: DatabaseMigrationsConfig | undefined,
  env: Env,
): boolean => {
  if (config?.enabled !== undefined) return config.enabled;
  return env.WORKER_ENV !== "production";
};

/**
 * Create a NabeCMS Hono app with routing and assets wired.
 */
export const createApp = ({
  config,
}: CreateAppOptions = {}): Hono<AppContext> => {
  const resolvedConfig = loadConfig(config);
  const adminBasePath = ADMIN_BASE_PATH;
  const runtimeMigrationConfig = resolvedConfig.database?.migrations;
  const runtimeMigrationBindingName = "DB";
  const runtimeMigrationRuns = new WeakMap<object, Promise<void>>();

  const app = new Hono<AppContext>();

  app.use("*", async (c, next) => {
    c.set("config", resolvedConfig);
    await next();
  });

  // 全レスポンスに noindex/nofollow を付与
  app.use("*", async (c, next) => {
    await next();
    const res = c.res;
    const headers = new Headers(res.headers);
    headers.set("X-Robots-Tag", ROBOTS_HEADER_VALUE);
    c.res = new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  });

  app.use(
    "*",
    createApiRequestLogMiddleware({
      enabled: resolvedConfig.observability?.structuredLogs?.enabled,
    }),
  );

  if ((runtimeMigrationConfig?.app?.length ?? 0) > 0) {
    app.use("*", async (c, next) => {
      if (!shouldRunRuntimeMigrations(runtimeMigrationConfig, c.env)) {
        await next();
        return;
      }

      const runtimeBinding = (c.env as Record<string, unknown>)[
        runtimeMigrationBindingName
      ];

      if (!isRuntimeMigrationDatabase(runtimeBinding)) {
        throw new Error(
          `Database binding "${runtimeMigrationBindingName}" is required for runtime migrations`,
        );
      }

      const existing = runtimeMigrationRuns.get(runtimeBinding);
      if (!existing) {
        const pending = runRuntimeMigrations({
          db: runtimeBinding,
          tableName: runtimeMigrationConfig?.tableName,
          appMigrations: runtimeMigrationConfig?.app,
        })
          .then(() => undefined)
          .catch((error: unknown) => {
            runtimeMigrationRuns.delete(runtimeBinding);
            throw error;
          });
        runtimeMigrationRuns.set(runtimeBinding, pending);
        await pending;
        await next();
        return;
      }

      await existing;
      await next();
    });
  }

  // 全面クロール拒否の robots.txt
  app.get("/robots.txt", (c) =>
    c.text("User-agent: *\nDisallow: /\n", 200, {
      "Content-Type": "text/plain; charset=utf-8",
    }),
  );

  app.use(`${adminBasePath}/auth/*`, async (c, next) => {
    c.header("Referrer-Policy", "no-referrer");
    c.header("Cache-Control", "no-store");
    await next();
  });

  // Admin static/app router under adminBasePath
  app.get(adminBasePath, (c) => c.redirect(`${adminBasePath}/`, 301));
  app.all(`${adminBasePath}/*`, async (c) => {
    const env = c.env as Env;
    const url = new URL(c.req.url);

    const shouldProxyAdmin =
      env.WORKER_ENV === "development" &&
      resolveProxyEnabled(
        resolvedConfig.admin?.devServer?.enabled,
        env.ADMIN_DEV_PROXY,
      );

    // Development: proxy to Vite dev server when enabled
    if (shouldProxyAdmin) {
      const devPort = resolveDevServerPort(
        resolvedConfig.admin?.devServer?.port,
        env.ADMIN_DEV_PORT,
      );
      const devHost = resolveDevServerHost(
        resolvedConfig.admin?.devServer?.host,
      );
      const target = new URL(
        url.pathname + url.search,
        `http://${devHost}:${devPort}`,
      );
      // Reuse original request with rewritten URL
      const req = new Request(target.toString(), c.req.raw);
      return fetch(req);
    }

    // Production: serve from bound assets; strip admin prefix
    const assetPath = stripBasePath(url.pathname, adminBasePath) || "/";
    const assetUrl = new URL(c.req.url);
    assetUrl.pathname = assetPath;

    // Try the requested asset first
    const assetReq = new Request(assetUrl.toString(), c.req.raw);
    const res = await env.ASSETS.fetch(assetReq);
    if (res.status !== 404) return res;

    // SPA fallback to index.html for client-side routes
    const indexUrl = new URL(c.req.url);
    indexUrl.pathname = "/index.html";
    const indexReq = new Request(indexUrl.toString(), c.req.raw);
    return env.ASSETS.fetch(indexReq);
  });

  app.route("/", appRoutes);

  return app;
};
