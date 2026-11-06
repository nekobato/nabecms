import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createApp } from "../../create-app";
import * as authLib from "../../lib/auth";
import * as usersService from "../../services/users";
import * as usersRepository from "../../repositories/users";
import * as rolesRepository from "../../repositories/roles";
import * as authRepository from "../../repositories/auth";

const app = createApp();

const env = {
  DB: {} as any,
  WORKER_ENV: "test" as const,
  JWT_SECRET: "test-secret",
  ASSETS: { fetch: vi.fn() },
};

describe("admin users routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(authLib, "verifyAccessToken").mockResolvedValue({
      sub: "user_1",
      sid: "sess_test",
      roles: ["system.super-admin"],
    } as any);
    vi.spyOn(usersRepository, "createUserRepository").mockReturnValue(
      {} as any,
    );
    vi.spyOn(rolesRepository, "createRoleRepository").mockReturnValue(
      {} as any,
    );
    vi.spyOn(authRepository, "createAuthRepository").mockReturnValue({} as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("GET /api/admin/users returns list", async () => {
    vi.spyOn(usersService, "listUsers").mockResolvedValue([
      {
        id: "user_1",
        email: "admin@@example.com",
        name: "Admin",
        roleIds: ["system.super-admin"],
        createdAt: "2025-10-14T00:00:00.000Z",
        updatedAt: "2025-10-14T00:00:00.000Z",
        isSystemUser: true,
      },
    ]);

    const res = await app.request(
      "/api/admin/users",
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
          id: "user_1",
          email: "admin@@example.com",
          name: "Admin",
          roleIds: ["system.super-admin"],
          createdAt: "2025-10-14T00:00:00.000Z",
          updatedAt: "2025-10-14T00:00:00.000Z",
          isSystemUser: true,
        },
      ],
    });
  });

  it("POST /api/admin/users creates user", async () => {
    const createMock = vi.spyOn(usersService, "createUser").mockResolvedValue({
      id: "user_2",
      email: "editor@example.com",
      name: "Editor",
      roleIds: ["editor"],
      createdAt: "2025-10-14T10:00:00.000Z",
      updatedAt: "2025-10-14T10:00:00.000Z",
      isSystemUser: false,
    });

    const res = await app.request(
      "/api/admin/users",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Editor",
          email: "editor@example.com",
          password: "Password123",
          roleIds: ["editor"],
        }),
      },
      env,
    );

    expect(res.status).toBe(201);
    expect(createMock).toHaveBeenCalledOnce();
  });

  it("POST /api/admin/users allows creating social-only user", async () => {
    const createMock = vi.spyOn(usersService, "createUser").mockResolvedValue({
      id: "user_3",
      email: "social@example.com",
      name: "Social",
      roleIds: ["editor"],
      createdAt: "2025-10-14T10:00:00.000Z",
      updatedAt: "2025-10-14T10:00:00.000Z",
      isSystemUser: false,
    });

    const res = await app.request(
      "/api/admin/users",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Social",
          email: "social@example.com",
          roleIds: ["editor"],
        }),
      },
      env,
    );

    expect(res.status).toBe(201);
    expect(createMock).toHaveBeenCalledWith(expect.anything(), {
      name: "Social",
      email: "social@example.com",
      roleIds: ["editor"],
    });
  });

  it("POST /api/admin/users handles conflict", async () => {
    vi.spyOn(usersService, "createUser").mockRejectedValue(
      new usersService.UserAlreadyExistsError("email"),
    );

    const res = await app.request(
      "/api/admin/users",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Editor",
          email: "editor@example.com",
          password: "Password123",
          roleIds: ["editor"],
        }),
      },
      env,
    );

    expect(res.status).toBe(409);
  });

  it("PUT /api/admin/users/:id updates user", async () => {
    const updateMock = vi.spyOn(usersService, "updateUser").mockResolvedValue({
      id: "user_2",
      email: "editor@example.com",
      name: "Editor",
      roleIds: ["editor"],
      createdAt: "2025-10-14T10:00:00.000Z",
      updatedAt: "2025-10-14T11:00:00.000Z",
      isSystemUser: false,
    });

    const res = await app.request(
      "/api/admin/users/user_2",
      {
        method: "PUT",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "Editor" }),
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(expect.anything(), "user_2", {
      name: "Editor",
    });
  });

  it.each([
    { password: "Replacement123!" },
    { password: "" },
    { password: null },
    { name: "Unwanted change", password: "Replacement123!" },
    { passwordHash: "not-a-supported-field" },
  ])(
    "PUT rejects removed credential fields without calling the service: %j",
    async (payload) => {
      const updateMock = vi.spyOn(usersService, "updateUser");
      const response = await app.request(
        "/api/admin/users/user_2",
        {
          method: "PUT",
          headers: {
            Authorization: "Bearer token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
        env,
      );
      expect(response.status).toBe(400);
      expect(updateMock).not.toHaveBeenCalled();
    },
  );

  it("DELETE /api/admin/users/:id removes user", async () => {
    const deleteMock = vi.spyOn(usersService, "deleteUser").mockResolvedValue();

    const res = await app.request(
      "/api/admin/users/user_2",
      {
        method: "DELETE",
        headers: { Authorization: "Bearer token" },
      },
      env,
    );

    expect(res.status).toBe(204);
    expect(deleteMock).toHaveBeenCalledWith(expect.anything(), "user_2");
  });
});
