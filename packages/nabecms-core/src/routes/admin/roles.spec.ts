import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createApp } from "../../create-app";
import * as authLib from "../../lib/auth";
import * as rolesService from "../../services/roles";
import * as rolesRepository from "../../repositories/roles";

const app = createApp();

const env = {
  DB: {} as any,
  WORKER_ENV: "test" as const,
  JWT_SECRET: "test-secret",
  ASSETS: { fetch: vi.fn() },
};

describe("admin roles routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(authLib, "verifyAccessToken").mockResolvedValue({
      sub: "user_1",
      sid: "sess_test",
      roles: ["system.super-admin"],
    } as any);
    vi.spyOn(rolesRepository, "createRoleRepository").mockReturnValue(
      {} as any,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("GET /api/admin/roles returns list", async () => {
    vi.spyOn(rolesService, "listRoles").mockResolvedValue([
      {
        id: "role_1",
        name: "Editor",
        description: "Can edit",
        permissions: { allow: ["models:*:write"] },
        isSystem: false,
        createdAt: "2025-10-14T10:00:00.000Z",
        updatedAt: "2025-10-14T10:00:00.000Z",
      },
    ]);

    const res = await app.request(
      "/api/admin/roles",
      {
        method: "GET",
        headers: { Authorization: "Bearer token" },
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      items: [
        {
          id: "role_1",
          name: "Editor",
          description: "Can edit",
          permissions: { allow: ["models:*:write"] },
          isSystem: false,
          createdAt: "2025-10-14T10:00:00.000Z",
          updatedAt: "2025-10-14T10:00:00.000Z",
        },
      ],
    });
  });

  it("POST /api/admin/roles creates role", async () => {
    const createMock = vi.spyOn(rolesService, "createRole").mockResolvedValue({
      id: "role_2",
      name: "Reviewer",
      description: null,
      permissions: { allow: [] },
      isSystem: false,
      createdAt: "2025-10-14T10:00:00.000Z",
      updatedAt: "2025-10-14T10:00:00.000Z",
    });

    const res = await app.request(
      "/api/admin/roles",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Reviewer",
          description: null,
          permissions: { allow: [] },
        }),
      },
      env,
    );

    expect(res.status).toBe(201);
    expect(createMock).toHaveBeenCalledOnce();
  });

  it("POST /api/admin/roles handles conflict", async () => {
    vi.spyOn(rolesService, "createRole").mockRejectedValue(
      new rolesService.RoleAlreadyExistsError("name"),
    );

    const res = await app.request(
      "/api/admin/roles",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Duplicate",
          description: null,
          permissions: { allow: [] },
        }),
      },
      env,
    );

    expect(res.status).toBe(409);
  });

  it("PUT /api/admin/roles/:id updates role", async () => {
    const updateMock = vi.spyOn(rolesService, "updateRole").mockResolvedValue({
      id: "role_1",
      name: "Updated",
      description: null,
      permissions: { allow: ["models:*"] },
      isSystem: false,
      createdAt: "2025-10-14T10:00:00.000Z",
      updatedAt: "2025-10-14T11:00:00.000Z",
    });

    const res = await app.request(
      "/api/admin/roles/role_1",
      {
        method: "PUT",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "Updated" }),
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(expect.anything(), "role_1", {
      name: "Updated",
    });
  });

  it("DELETE /api/admin/roles/:id removes role", async () => {
    const deleteMock = vi.spyOn(rolesService, "deleteRole").mockResolvedValue();

    const res = await app.request(
      "/api/admin/roles/role_1",
      {
        method: "DELETE",
        headers: { Authorization: "Bearer token" },
      },
      env,
    );

    expect(res.status).toBe(204);
    expect(deleteMock).toHaveBeenCalledWith(expect.anything(), "role_1");
  });
});
