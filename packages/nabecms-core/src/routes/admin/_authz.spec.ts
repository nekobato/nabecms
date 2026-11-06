import { beforeEach, describe, expect, it, vi } from "vitest";

const createContext = (envOverrides: Record<string, unknown> = {}) => {
  const json = vi.fn(
    (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );

  return {
    c: {
      env: {
        DB: { prepare: vi.fn() },
        WORKER_ENV: "development",
        JWT_SECRET: "jwt-secret",
        ...envOverrides,
      },
      req: {
        header: (name: string) =>
          name.toLowerCase() === "authorization" ? "Bearer token" : undefined,
      },
      json,
    },
    json,
  } as const;
};

describe("admin _authz", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("accepts a token with an active session", async () => {
    vi.doMock("drizzle-orm/d1", () => ({
      drizzle: vi.fn(() => ({
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => [
                {
                  id: "sess_1",
                  userId: "user_1",
                  expiresAt: new Date("2999-01-01T00:00:00.000Z"),
                },
              ],
            }),
          }),
        }),
      })),
    }));

    const authLib = await import("../../lib/auth");
    vi.spyOn(authLib, "verifyAccessToken").mockResolvedValue({
      sub: "user_1",
      sid: "sess_1",
      roles: ["system.super-admin"],
    } as any);

    const { requireActor } = await import("./_authz");
    const { c } = createContext();
    const result = await requireActor(c);

    expect(result).toEqual({
      id: "user_1",
      roleIds: ["system.super-admin"],
    });
  });

  it("rejects a session that no longer exists", async () => {
    vi.doMock("drizzle-orm/d1", () => ({
      drizzle: vi.fn(() => ({
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => [],
            }),
          }),
        }),
      })),
    }));

    const authLib = await import("../../lib/auth");
    vi.spyOn(authLib, "verifyAccessToken").mockResolvedValue({
      sub: "user_1",
      sid: "sess_1",
      roles: ["system.super-admin"],
    } as any);

    const { requireActor } = await import("./_authz");
    const { c } = createContext();
    const result = await requireActor(c);

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it("identifies only the reserved system super admin role as super admin", async () => {
    const { isSuperAdminActor } = await import("./_authz");

    expect(
      isSuperAdminActor({
        id: "user_1",
        roleIds: ["system.super-admin"],
      }),
    ).toBe(true);
    expect(
      isSuperAdminActor({
        id: "user_2",
        roleIds: ["role-with-wildcard-permissions"],
      }),
    ).toBe(false);
  });

  it("resolves concrete and wildcard role permissions while rejecting mismatches", async () => {
    let rolePermissions: string[] = [];
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => [
            {
              id: "role_limited",
              name: "Limited",
              description: null,
              permissions: { allow: rolePermissions },
              isSystem: false,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ]),
        })),
      })),
    };
    vi.doMock("drizzle-orm/d1", () => ({
      drizzle: vi.fn(() => db),
    }));

    const { requirePermission } = await import("./_authz");
    const { c, json } = createContext();
    const actor = { id: "user_1", roleIds: ["role_limited"] };
    const cases = [
      {
        allow: ["entries:model_1:read"],
        required: "entries:model_1:read",
        granted: true,
      },
      {
        allow: ["entries:*:*"],
        required: "entries:model_1:update",
        granted: true,
      },
      {
        allow: ["*"],
        required: "settings:media:write",
        granted: true,
      },
      {
        allow: ["entries:model_2:read"],
        required: "entries:model_1:read",
        granted: false,
      },
    ] as const;

    for (const permissionCase of cases) {
      rolePermissions = [...permissionCase.allow];
      json.mockClear();

      const result = await requirePermission(c, actor, permissionCase.required);

      if (permissionCase.granted) {
        expect(result).toBeUndefined();
        expect(json).not.toHaveBeenCalled();
      } else {
        expect(result).toBeInstanceOf(Response);
        expect((result as Response).status).toBe(403);
        expect(json).toHaveBeenCalledWith(
          { error: { code: "FORBIDDEN", message: "Missing permission" } },
          403,
        );
      }
    }
  });

  it("requires the reserved super admin role for super-admin-only operations", async () => {
    const { requireSuperAdmin } = await import("./_authz");
    const { c, json } = createContext();

    const wildcardOnly = requireSuperAdmin(c, {
      id: "user_1",
      roleIds: ["role-with-wildcard-permissions"],
    });

    expect(wildcardOnly).toBeInstanceOf(Response);
    expect((wildcardOnly as Response).status).toBe(403);
    expect(json).toHaveBeenCalledWith(
      { error: { code: "FORBIDDEN", message: "Super admin required" } },
      403,
    );

    const superAdmin = requireSuperAdmin(c, {
      id: "user_2",
      roleIds: ["system.super-admin"],
    });
    expect(superAdmin).toBeUndefined();
  });
});
