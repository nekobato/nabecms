import { Hono, type MiddlewareHandler } from "hono";
import { NABECMS_CORE_VERSION } from "./core-version";
import {
  normalizePluginsOrThrow,
  type ValidatedPluginApiAccess,
  type ValidatedPluginDefinition,
  type ValidatedPluginManifest,
} from "./plugin-validation";
import { requireActor } from "./routes/admin/_authz";
import { requireContentsAccess } from "./routes/contents/_authz";
import type { NabeCmsConfig } from "./config";
import type { AppContext } from "./types";

/**
 * Supported token boundary for the internal plugin prototype.
 *
 * @internal
 */
export type PluginApiAccess = ValidatedPluginApiAccess;

/**
 * Manifest for the internal plugin prototype kept for v2 design work.
 *
 * @internal
 */
export type NabeCmsPluginManifest = ValidatedPluginManifest;

/**
 * Context passed to internal plugin route registration.
 *
 * @internal
 */
export type PluginRouteContext = {
  config: NabeCmsConfig;
  manifest: NabeCmsPluginManifest;
};

/**
 * Internal plugin contract kept out of the v1 public root export.
 *
 * @internal
 */
export type NabeCmsPlugin = {
  manifest: NabeCmsPluginManifest;
  registerRoutes?: (app: Hono<AppContext>, context: PluginRouteContext) => void;
};

/**
 * Define an internal prototype plugin object with type inference.
 *
 * @internal
 */
export const definePlugin = <T extends NabeCmsPlugin>(plugin: T): T => plugin;

/**
 * Create auth middleware for the configured plugin API boundary.
 */
const createPluginAccessMiddleware = (
  apiAccess: PluginApiAccess,
): MiddlewareHandler<AppContext> => {
  if (apiAccess === "admin") {
    return async (c, next) => {
      const result = await requireActor(c);
      if (result instanceof Response) return result;
      await next();
    };
  }

  return async (c, next) => {
    const access = await requireContentsAccess(c);
    if ("error" in access) return access.error;
    await next();
  };
};

/**
 * Register plugins onto the provided Hono app instance.
 *
 * @internal
 */
export const registerPlugins = (
  app: Hono<AppContext>,
  plugins: readonly NabeCmsPlugin[],
  context: Omit<PluginRouteContext, "manifest">,
): void => {
  const normalized = normalizePluginsOrThrow(
    plugins,
    NABECMS_CORE_VERSION,
  ) as ValidatedPluginDefinition[];

  normalized.forEach((plugin) => {
    if (!plugin.registerRoutes) return;

    const pluginApp = new Hono<AppContext>();
    pluginApp.use("*", createPluginAccessMiddleware(plugin.manifest.apiAccess));
    plugin.registerRoutes(pluginApp, {
      ...context,
      manifest: plugin.manifest,
    });

    app.route(`/api/plugins/${plugin.manifest.routeNamespace}`, pluginApp);
  });
};
