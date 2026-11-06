import { describe, expect, it } from "vitest";
import { runDoctor } from "./doctor";

/**
 * Build a minimal wrangler config for doctor tests.
 */
const createWranglerConfig = (overrides?: Record<string, unknown>) => ({
  assets: {
    binding: "ASSETS",
    not_found_handling: "single-page-application",
    run_worker_first: true,
  },
  vars: {
    WORKER_ENV: "development",
    ADMIN_DEV_PROXY: "true",
    ADMIN_DEV_PORT: "2525",
  },
  env: {
    production: {
      vars: {
        WORKER_ENV: "production",
      },
      ratelimits: [
        {
          name: "AUTH_LOGIN_RATE_LIMITER",
          namespace_id: "11001",
          simple: { limit: 10, period: 60 },
        },
        {
          name: "AUTH_SENSITIVE_RATE_LIMITER",
          namespace_id: "11002",
          simple: { limit: 5, period: 60 },
        },
      ],
    },
  },
  d1_databases: [{ binding: "DB", migrations_dir: "./migrations" }],
  r2_buckets: [{ binding: "R2" }],
  ratelimits: [
    {
      name: "AUTH_LOGIN_RATE_LIMITER",
      namespace_id: "10001",
      simple: { limit: 10, period: 60 },
    },
    {
      name: "AUTH_SENSITIVE_RATE_LIMITER",
      namespace_id: "10002",
      simple: { limit: 5, period: 60 },
    },
  ],
  ...overrides,
});

describe("runDoctor", () => {
  it("does not inspect hidden prototype plugins", () => {
    const report = runDoctor({
      config: {
        plugins: [
          {
            manifest: {
              name: "@nekobato/incompatible-plugin",
              version: "0.0.1",
              supportedCoreRange: "^999.0.0",
              routeNamespace: "incompatible",
              apiAccess: "contents",
            },
          },
        ],
      } as never,
      wranglerConfig: createWranglerConfig(),
    });

    expect(report.ok).toBe(true);
    expect(report.issues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "PLUGIN_SUPPORTED_CORE_RANGE_INCOMPATIBLE",
        }),
      ]),
    );
  });

  it("reports success for a compatible config and wrangler bindings", () => {
    const report = runDoctor({
      config: {},
      wranglerConfig: createWranglerConfig(),
      envState: {
        devVars: {
          JWT_SECRET: "local-secret",
        },
        devVarsExample: {
          JWT_SECRET: "replace-me",
        },
      },
    });

    expect(report.ok).toBe(true);
    expect(report.summary.errors).toBe(0);
    expect(report.issues).toEqual([
      {
        severity: "info",
        code: "CONFIG_OK",
        message: "No configuration issues found",
      },
    ]);
  });

  it("requires the Admin static assets binding to use the SPA fallback", () => {
    const report = runDoctor({
      config: {},
      wranglerConfig: createWranglerConfig({
        assets: { binding: "ASSETS" },
      }),
    });

    expect(report.ok).toBe(false);
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          code: "WRANGLER_ASSETS_SPA_FALLBACK_MISSING",
        }),
      ]),
    );
  });

  it("requires all requests to run the Worker before the SPA fallback", () => {
    const report = runDoctor({
      config: {},
      wranglerConfig: createWranglerConfig({
        assets: {
          binding: "ASSETS",
          not_found_handling: "single-page-application",
          run_worker_first: ["/admin", "/admin/*"],
        },
      }),
    });

    expect(report.ok).toBe(false);
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          code: "WRANGLER_ASSETS_WORKER_FIRST_REQUIRED",
        }),
      ]),
    );
  });

  it("reports binding errors and migrations_dir warnings from wrangler config", () => {
    const report = runDoctor({
      config: {},
      wranglerConfig: createWranglerConfig({
        assets: undefined,
        d1_databases: [
          { binding: "DB", migrations_dir: "./custom-migrations" },
        ],
        r2_buckets: undefined,
      }),
    });

    expect(report.ok).toBe(false);
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          code: "WRANGLER_ASSETS_BINDING_MISSING",
        }),
        expect.objectContaining({
          severity: "error",
          code: "WRANGLER_R2_BINDING_MISSING",
        }),
        expect.objectContaining({
          severity: "warning",
          code: "WRANGLER_MIGRATIONS_DIR_UNEXPECTED",
        }),
      ]),
    );
  });

  it("requires both auth rate limit bindings in root and production environments", () => {
    const report = runDoctor({
      config: {},
      wranglerConfig: createWranglerConfig({
        ratelimits: [],
        env: {
          production: {
            vars: { WORKER_ENV: "production" },
            ratelimits: [],
          },
        },
      }),
    });

    expect(report.ok).toBe(false);
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          code: "WRANGLER_RATE_LIMIT_BINDING_MISSING",
          message: expect.stringContaining(
            'root rate limit binding "AUTH_LOGIN_RATE_LIMITER"',
          ),
        }),
        expect.objectContaining({
          severity: "error",
          code: "WRANGLER_RATE_LIMIT_BINDING_MISSING",
          message: expect.stringContaining(
            'production rate limit binding "AUTH_SENSITIVE_RATE_LIMITER"',
          ),
        }),
      ]),
    );
  });

  it("reports mismatched auth rate limit thresholds and shared namespaces", () => {
    const invalidRateLimits = [
      {
        name: "AUTH_LOGIN_RATE_LIMITER",
        namespace_id: "10001",
        simple: { limit: 11, period: 60 },
      },
      {
        name: "AUTH_SENSITIVE_RATE_LIMITER",
        namespace_id: "10001",
        simple: { limit: 5, period: 10 },
      },
    ];
    const report = runDoctor({
      config: {},
      wranglerConfig: createWranglerConfig({
        ratelimits: invalidRateLimits,
        env: {
          production: {
            vars: { WORKER_ENV: "production" },
            ratelimits: invalidRateLimits,
          },
        },
      }),
    });

    expect(report.ok).toBe(false);
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          code: "WRANGLER_RATE_LIMIT_CONFIG_INVALID",
          message: expect.stringContaining("expected 10/60s"),
        }),
        expect.objectContaining({
          severity: "error",
          code: "WRANGLER_RATE_LIMIT_CONFIG_INVALID",
          message: expect.stringContaining("expected 5/60s"),
        }),
        expect.objectContaining({
          severity: "error",
          code: "WRANGLER_RATE_LIMIT_NAMESPACE_SHARED",
        }),
      ]),
    );
  });

  it("does not require ADMIN_DEV_PORT when admin dev proxy is disabled", () => {
    const report = runDoctor({
      config: {},
      wranglerConfig: createWranglerConfig({
        vars: {
          WORKER_ENV: "development",
          ADMIN_DEV_PROXY: "false",
        },
      }),
    });

    expect(report.issues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "WRANGLER_VAR_MISSING",
          message: 'wrangler root vars is missing "ADMIN_DEV_PORT"',
        }),
      ]),
    );
  });

  it("reports a local secret warning when optional Better Auth sessions are configured", () => {
    const report = runDoctor({
      config: {},
      wranglerConfig: createWranglerConfig({
        vars: {
          WORKER_ENV: "development",
          ADMIN_DEV_PROXY: "true",
          ADMIN_DEV_PORT: "2525",
          BETTER_AUTH_URL: "http://localhost:8787",
        },
      }),
      envState: {
        devVarsExample: {
          JWT_SECRET: "replace-me",
        },
      },
    });

    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "warning",
          code: "LOCAL_ENV_TEMPLATE_KEY_MISSING",
        }),
        expect.objectContaining({
          severity: "warning",
          code: "LOCAL_DEV_VARS_FILE_MISSING",
        }),
      ]),
    );
  });
});
