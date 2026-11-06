import type { Hono } from "hono";
import { z } from "zod";
import type { AppContext } from "./types";
import { parseVersionRange, versionSatisfiesRange } from "./version-range";

const RESERVED_ROUTE_NAMESPACES = new Set([
  "admin",
  "auth",
  "contents",
  "mcp",
  "plugins",
]);

const routeNamespacePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/**
 * Supported token boundary for plugin routes.
 */
export type ValidatedPluginApiAccess = "admin" | "contents";

/**
 * Manifest shape used by plugin validation and diagnostics.
 */
export type ValidatedPluginManifest = {
  name: string;
  version: string;
  supportedCoreRange: string;
  routeNamespace: string;
  apiAccess: ValidatedPluginApiAccess;
};

/**
 * Normalized plugin definition used internally after validation.
 */
export type ValidatedPluginDefinition = {
  manifest: ValidatedPluginManifest;
  registerRoutes?: (app: Hono<AppContext>, context: unknown) => void;
};

/**
 * Structured issue produced while validating plugin definitions.
 */
export type PluginValidationIssue = {
  code:
    | "PLUGIN_OBJECT_INVALID"
    | "PLUGIN_MANIFEST_INVALID"
    | "PLUGIN_REGISTER_ROUTES_INVALID"
    | "PLUGIN_SUPPORTED_CORE_RANGE_INVALID"
    | "PLUGIN_SUPPORTED_CORE_RANGE_INCOMPATIBLE"
    | "PLUGIN_ROUTE_NAMESPACE_DUPLICATE";
  message: string;
  pluginName?: string;
};

const pluginManifestSchema = z.object({
  name: z.string().trim().min(1),
  version: z.string().trim().min(1),
  supportedCoreRange: z.string().trim().min(1),
  routeNamespace: z
    .string()
    .trim()
    .min(1)
    .regex(routeNamespacePattern, "routeNamespace must be lowercase kebab-case")
    .refine(
      (value) => !RESERVED_ROUTE_NAMESPACES.has(value),
      "routeNamespace is reserved",
    ),
  apiAccess: z.enum(["admin", "contents"]),
});

/**
 * Normalize one plugin definition and collect local manifest issues.
 */
const normalizePlugin = (
  value: unknown,
  index: number,
): {
  normalizedPlugin?: ValidatedPluginDefinition;
  issues: PluginValidationIssue[];
} => {
  if (!value || typeof value !== "object") {
    return {
      issues: [
        {
          code: "PLUGIN_OBJECT_INVALID",
          message: `Plugin at index ${index} must be an object`,
        },
      ],
    };
  }

  const record = value as {
    manifest?: unknown;
    registerRoutes?: ValidatedPluginDefinition["registerRoutes"] | unknown;
  };
  const manifestResult = pluginManifestSchema.safeParse(record.manifest);
  if (!manifestResult.success) {
    const manifestName =
      typeof (record.manifest as { name?: unknown } | undefined)?.name ===
      "string"
        ? ((record.manifest as { name?: string }).name ?? undefined)
        : undefined;

    return {
      issues: manifestResult.error.issues.map((issue) => ({
        code: "PLUGIN_MANIFEST_INVALID",
        pluginName: manifestName,
        message: `Plugin "${manifestName ?? `#${index}`}" has invalid manifest: ${issue.message}`,
      })),
    };
  }

  const manifest = manifestResult.data;
  if (
    record.registerRoutes !== undefined &&
    typeof record.registerRoutes !== "function"
  ) {
    return {
      issues: [
        {
          code: "PLUGIN_REGISTER_ROUTES_INVALID",
          pluginName: manifest.name,
          message: `Plugin "${manifest.name}" registerRoutes must be a function`,
        },
      ],
    };
  }

  return {
    normalizedPlugin: {
      manifest,
      registerRoutes:
        record.registerRoutes as ValidatedPluginDefinition["registerRoutes"],
    },
    issues: [],
  };
};

/**
 * Validate cross-plugin constraints after local manifest parsing.
 */
const validatePluginSet = (
  plugins: readonly ValidatedPluginDefinition[],
  coreVersion: string,
): PluginValidationIssue[] => {
  const issues: PluginValidationIssue[] = [];
  const seenNamespaces = new Map<string, string>();

  plugins.forEach((plugin) => {
    if (!parseVersionRange(plugin.manifest.supportedCoreRange)) {
      issues.push({
        code: "PLUGIN_SUPPORTED_CORE_RANGE_INVALID",
        pluginName: plugin.manifest.name,
        message: `Plugin "${plugin.manifest.name}" has invalid supportedCoreRange "${plugin.manifest.supportedCoreRange}"`,
      });
    } else if (
      !versionSatisfiesRange(coreVersion, plugin.manifest.supportedCoreRange)
    ) {
      issues.push({
        code: "PLUGIN_SUPPORTED_CORE_RANGE_INCOMPATIBLE",
        pluginName: plugin.manifest.name,
        message: `Plugin "${plugin.manifest.name}" supports core range "${plugin.manifest.supportedCoreRange}" but current core version is "${coreVersion}"`,
      });
    }

    const previous = seenNamespaces.get(plugin.manifest.routeNamespace);
    if (previous) {
      issues.push({
        code: "PLUGIN_ROUTE_NAMESPACE_DUPLICATE",
        pluginName: plugin.manifest.name,
        message: `Duplicate routeNamespace "${plugin.manifest.routeNamespace}" for plugins "${previous}" and "${plugin.manifest.name}"`,
      });
      return;
    }

    seenNamespaces.set(plugin.manifest.routeNamespace, plugin.manifest.name);
  });

  return issues;
};

/**
 * Inspect plugin definitions and return both normalized plugins and issues.
 */
export const inspectPlugins = (
  plugins: readonly unknown[],
  coreVersion: string,
): {
  normalizedPlugins: ValidatedPluginDefinition[];
  issues: PluginValidationIssue[];
} => {
  const issues: PluginValidationIssue[] = [];
  const normalizedPlugins: ValidatedPluginDefinition[] = [];

  plugins.forEach((plugin, index) => {
    const result = normalizePlugin(plugin, index);
    issues.push(...result.issues);
    if (result.normalizedPlugin) {
      normalizedPlugins.push(result.normalizedPlugin);
    }
  });

  issues.push(...validatePluginSet(normalizedPlugins, coreVersion));

  return { normalizedPlugins, issues };
};

/**
 * Normalize plugins or throw a single aggregated validation error.
 */
export const normalizePluginsOrThrow = (
  plugins: readonly unknown[],
  coreVersion: string,
): ValidatedPluginDefinition[] => {
  const result = inspectPlugins(plugins, coreVersion);
  if (result.issues.length === 0) {
    return result.normalizedPlugins;
  }

  throw new Error(result.issues.map((issue) => issue.message).join("; "));
};
