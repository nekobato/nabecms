import { beforeEach, describe, expect, it, vi } from "vitest";
import { BOOTSTRAP_SECRET_HEADER } from "../../../lib/bootstrap-secret";

const createEnv = (overrides: Record<string, unknown> = {}) =>
  ({
    DB: { prepare: vi.fn() } as any,
    WORKER_ENV: "development",
    BCRYPT_COST: "4",
    BOOTSTRAP_SECRET: "bootstrap-secret",
    ASSETS: { fetch: vi.fn() },
    ...overrides,
  }) as any;

const createDbMock = (options?: {
  initialized?: boolean;
  hasUsers?: boolean;
}) => {
  const initialized = Boolean(options?.initialized);
  const hasUsers = Boolean(options?.hasUsers);
  const insertedSettings: Array<Record<string, unknown>> = [];
  const insertedUsers: Array<Record<string, unknown>> = [];

  let selectCount = 0;

  return {
    db: {
      select: vi.fn(() => ({
        from: () => {
          selectCount += 1;
          const rows =
            selectCount === 1
              ? initialized
                ? [{ key: "system.initialized" }]
                : []
              : hasUsers
                ? [{ id: "user_1" }]
                : [];

          return {
            where: async () => rows,
            then: (resolve: (value: unknown[]) => unknown) =>
              Promise.resolve(rows).then(resolve),
          };
        },
      })),
      insert: vi.fn((table: unknown) => ({
        values: async (record: Record<string, unknown>) => {
          if (String(table).includes("settings")) insertedSettings.push(record);
          if (String(table).includes("users")) insertedUsers.push(record);
        },
      })),
      update: vi.fn(() => ({
        set: () => ({
          where: async () => {},
        }),
      })),
      delete: vi.fn(() => ({
        where: async () => {},
        catch: () => {},
      })),
    },
    insertedSettings,
    insertedUsers,
  };
};

describe("admin auth initialize route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("requires BOOTSTRAP_SECRET to be configured", async () => {
    const { db } = createDbMock();
    vi.doMock("drizzle-orm/d1", () => ({
      drizzle: vi.fn(() => db),
    }));

    const { default: app } = await import("./initialize");
    const res = await app.request(
      "/api/admin/auth/initialize",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [BOOTSTRAP_SECRET_HEADER]: "bootstrap-secret",
        },
        body: JSON.stringify({
          email: "admin@example.com",
          password: "Password123",
          name: "Admin",
          defaultLocale: "ja-JP",
        }),
      },
      createEnv({ BOOTSTRAP_SECRET: "" }),
    );

    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error?.code).toBe("BOOTSTRAP_SECRET_NOT_CONFIGURED");
  });

  it("rejects initialize without bootstrap secret header", async () => {
    const { db } = createDbMock();
    vi.doMock("drizzle-orm/d1", () => ({
      drizzle: vi.fn(() => db),
    }));

    const { default: app } = await import("./initialize");
    const res = await app.request(
      "/api/admin/auth/initialize",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "admin@example.com",
          password: "Password123",
          name: "Admin",
          defaultLocale: "ja-JP",
        }),
      },
      createEnv(),
    );

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error?.code).toBe("INVALID_BOOTSTRAP_SECRET");
  });

  it("returns 409 when system is already initialized", async () => {
    const { db } = createDbMock({ initialized: true });
    vi.doMock("drizzle-orm/d1", () => ({
      drizzle: vi.fn(() => db),
    }));

    const { default: app } = await import("./initialize");
    const res = await app.request(
      "/api/admin/auth/initialize",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [BOOTSTRAP_SECRET_HEADER]: "bootstrap-secret",
        },
        body: JSON.stringify({
          email: "admin@example.com",
          password: "Password123",
          name: "Admin",
          defaultLocale: "ja-JP",
        }),
      },
      createEnv(),
    );

    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error?.code).toBe("ALREADY_INITIALIZED");
  });

  it("rate limits initialize with a route-global key before database work", async () => {
    const { db } = createDbMock();
    const drizzle = vi.fn(() => db);
    vi.doMock("drizzle-orm/d1", () => ({ drizzle }));
    const limit = vi.fn(async (_input: { key: string }) => ({
      success: false,
    }));

    const { default: app } = await import("./initialize");
    const res = await app.request(
      "/api/admin/auth/initialize",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [BOOTSTRAP_SECRET_HEADER]: "bootstrap-secret",
        },
        body: JSON.stringify({
          email: "admin@example.com",
          password: "Password123",
          name: "Admin",
          defaultLocale: "ja-JP",
        }),
      },
      createEnv({
        JWT_SECRET: "rate-limit-test-secret",
        AUTH_SENSITIVE_RATE_LIMITER: { limit },
      }),
    );

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(drizzle).not.toHaveBeenCalled();
    expect(limit).toHaveBeenCalledWith({
      key: expect.stringMatching(/^v1:initialize:[0-9a-f]{64}$/u),
    });
    expect(String(limit.mock.calls[0]?.[0]?.key)).not.toContain(
      "admin@example.com",
    );
  });

  it("delegates bootstrap writes to the atomic canonical lifecycle", async () => {
    const { db } = createDbMock();
    const initializeAuthLifecycle = vi.fn(async () => {});
    const hash = vi.fn(async () => "canonical-password-hash");
    vi.doMock("bcryptjs", () => ({ default: { hash } }));
    vi.doMock("drizzle-orm/d1", () => ({
      drizzle: vi.fn(() => db),
    }));
    vi.doMock("../../../services/auth-lifecycle", () => ({
      initializeAuthLifecycle,
    }));

    const { default: app } = await import("./initialize");
    const res = await app.request(
      "/api/admin/auth/initialize",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [BOOTSTRAP_SECRET_HEADER]: "bootstrap-secret",
        },
        body: JSON.stringify({
          email: "ADMIN@example.com",
          password: "Password123",
          name: "Admin",
          defaultLocale: "ja-JP",
        }),
      },
      createEnv(),
    );

    expect(res.status).toBe(201);
    expect(hash).toHaveBeenCalledWith("Password123", 4);
    expect(initializeAuthLifecycle).toHaveBeenCalledTimes(1);
    expect(initializeAuthLifecycle).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        email: "admin@example.com",
        name: "Admin",
        passwordHash: "canonical-password-hash",
        defaultLocale: "ja-JP",
        now: expect.any(Date),
      }),
    );
  });
});
