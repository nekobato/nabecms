import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { NABECMS_CORE_VERSION } from "./core-version";
import {
  definePlugin,
  type NabeCmsPlugin,
  type PluginRouteContext,
  registerPlugins,
} from "./plugins";
import type { AppContext } from "./types";

/**
 * Build a minimal plugin for route registration tests.
 */
const createTestPlugin = (overrides?: {
  routeNamespace?: string;
  apiAccess?: "admin" | "contents";
  supportedCoreRange?: string;
}) =>
  definePlugin({
    manifest: {
      name: "@nekobato/test-plugin",
      version: "0.0.1",
      supportedCoreRange: overrides?.supportedCoreRange ?? NABECMS_CORE_VERSION,
      routeNamespace: overrides?.routeNamespace ?? "test-plugin",
      apiAccess: overrides?.apiAccess ?? "contents",
    },
    registerRoutes(app) {
      app.get("/health", (c) => c.json({ ok: true }));
    },
  });

/**
 * Build an isolated host for internal prototype utility tests.
 */
const createInternalPluginHost = (
  plugins: readonly NabeCmsPlugin[],
): Hono<AppContext> => {
  const app = new Hono<AppContext>();
  registerPlugins(app, plugins, { config: {} });
  return app;
};

describe("internal plugin utilities", () => {
  it("mounts plugin routes under /api/plugins/:routeNamespace", async () => {
    const app = createInternalPluginHost([createTestPlugin()]);

    const namespaced = await app.request("/api/plugins/test-plugin/health");
    const root = await app.request("/health");

    expect(namespaced.status).toBe(401);
    expect(root.status).toBe(404);
  });

  it("requires admin tokens for admin plugins", async () => {
    const app = createInternalPluginHost([
      createTestPlugin({ apiAccess: "admin" }),
    ]);

    const res = await app.request("/api/plugins/test-plugin/health");

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({
      error: { code: "UNAUTHORIZED", message: "Missing token" },
    });
  });

  it("requires contents bearer tokens for contents plugins", async () => {
    const app = createInternalPluginHost([
      createTestPlugin({ apiAccess: "contents" }),
    ]);

    const res = await app.request("/api/plugins/test-plugin/health");

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({
      error: { code: "UNAUTHORIZED", message: "Missing bearer token" },
    });
  });

  it("passes the manifest to registerRoutes", () => {
    let seenRouteNamespace = "";

    createInternalPluginHost([
      definePlugin({
        manifest: {
          name: "@nekobato/context-plugin",
          version: "0.0.1",
          supportedCoreRange: NABECMS_CORE_VERSION,
          routeNamespace: "context-plugin",
          apiAccess: "contents",
        },
        registerRoutes(_app: Hono<AppContext>, context: PluginRouteContext) {
          seenRouteNamespace = context.manifest.routeNamespace;
        },
      }),
    ]);

    expect(seenRouteNamespace).toBe("context-plugin");
  });

  it("accepts plugins whose supportedCoreRange matches the current core version", () => {
    expect(() =>
      createInternalPluginHost([
        createTestPlugin({
          supportedCoreRange: `>=${NABECMS_CORE_VERSION} <1.0.0`,
        }),
      ]),
    ).not.toThrow();
  });

  it("rejects plugins whose supportedCoreRange does not match the current core version", () => {
    expect(() =>
      createInternalPluginHost([
        createTestPlugin({ supportedCoreRange: "^999.0.0" }),
      ]),
    ).toThrowError(
      new RegExp(
        `Plugin "@nekobato/test-plugin" supports core range "\\^999\\.0\\.0" but current core version is "${NABECMS_CORE_VERSION.replace(/\./gu, "\\.")}"`,
        "u",
      ),
    );
  });

  it("rejects invalid supportedCoreRange syntax", () => {
    expect(() =>
      createInternalPluginHost([
        createTestPlugin({
          supportedCoreRange: "definitely-not-a-semver-range",
        }),
      ]),
    ).toThrowError(
      /Plugin "@nekobato\/test-plugin" has invalid supportedCoreRange/u,
    );
  });

  it("rejects reserved route namespaces", () => {
    expect(() =>
      createInternalPluginHost([createTestPlugin({ routeNamespace: "admin" })]),
    ).toThrowError(/routeNamespace is reserved/u);
  });

  it("rejects duplicate route namespaces", () => {
    expect(() =>
      createInternalPluginHost([
        createTestPlugin({ routeNamespace: "duplicate" }),
        definePlugin({
          manifest: {
            name: "@nekobato/other-plugin",
            version: "0.0.1",
            supportedCoreRange: NABECMS_CORE_VERSION,
            routeNamespace: "duplicate",
            apiAccess: "contents",
          },
          registerRoutes(app) {
            app.get("/another", (c) => c.text("ok"));
          },
        }),
      ]),
    ).toThrowError(/Duplicate routeNamespace "duplicate"/u);
  });
});
