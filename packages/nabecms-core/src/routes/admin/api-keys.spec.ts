import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createApp } from "../../create-app";
import * as authLib from "../../lib/auth";
import * as apiKeysService from "../../services/api-keys";
import * as apiKeysRepository from "../../repositories/api-keys";

const app = createApp();

const env = {
  DB: {} as any,
  WORKER_ENV: "test" as const,
  JWT_SECRET: "test-secret",
  ASSETS: { fetch: vi.fn() },
};

describe("admin api-keys routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(authLib, "verifyAccessToken").mockResolvedValue({
      sub: "user_1",
      roles: ["system.super-admin"],
    } as any);
    vi.spyOn(apiKeysRepository, "createApiKeyRepository").mockReturnValue(
      {} as any,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("GET /api/admin/api-keys returns list", async () => {
    vi.spyOn(apiKeysService, "listApiKeys").mockResolvedValue({
      items: [
        {
          id: "key_1",
          name: "Public",
          description: null,
          permissions: ["contents:read"],
          allowedModels: null,
          isRevoked: false,
          createdBy: "user_1",
          revokedBy: null,
          revokedAt: null,
          lastUsedAt: null,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        },
      ],
    });

    const res = await app.request(
      "/api/admin/api-keys",
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
          id: "key_1",
          name: "Public",
          description: null,
          permissions: ["contents:read"],
          allowedModels: null,
          isRevoked: false,
          createdBy: "user_1",
          revokedBy: null,
          revokedAt: null,
          lastUsedAt: null,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        },
      ],
    });
  });

  it("POST /api/admin/api-keys creates key and returns secret", async () => {
    const createMock = vi
      .spyOn(apiKeysService, "createApiKey")
      .mockResolvedValue({
        key: {
          id: "key_1",
          name: "SDK",
          description: null,
          permissions: ["contents:read"],
          allowedModels: null,
          isRevoked: false,
          createdBy: "user_1",
          revokedBy: null,
          revokedAt: null,
          lastUsedAt: null,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        },
        secret: "plain-secret",
      });

    const res = await app.request(
      "/api/admin/api-keys",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "SDK", permissions: ["contents:read"] }),
      },
      env,
    );

    expect(res.status).toBe(201);
    expect(createMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorId: "user_1",
        name: "SDK",
        permissions: ["contents:read"],
      }),
    );
    const body = await res.json();
    expect(body.secret).toBe("plain-secret");
  });

  it("POST /api/admin/api-keys rejects missing permissions", async () => {
    const res = await app.request(
      "/api/admin/api-keys",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "SDK" }),
      },
      env,
    );

    expect(res.status).toBe(400);
  });

  it("PUT /api/admin/api-keys/:id rejects isRevoked changes", async () => {
    const updateMock = vi
      .spyOn(apiKeysService, "updateApiKey")
      .mockResolvedValue({} as any);

    const res = await app.request(
      "/api/admin/api-keys/key_1",
      {
        method: "PUT",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ isRevoked: false }),
      },
      env,
    );

    expect(res.status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("POST /api/admin/api-keys/:id/rotate returns secret", async () => {
    const rotateMock = vi
      .spyOn(apiKeysService, "rotateApiKey")
      .mockResolvedValue({
        key: {
          id: "key_1",
          name: "SDK",
          description: null,
          permissions: [],
          allowedModels: null,
          isRevoked: false,
          createdBy: "user_1",
          revokedBy: null,
          revokedAt: null,
          lastUsedAt: null,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-02T00:00:00.000Z",
        },
        secret: "new-secret",
      });

    const res = await app.request(
      "/api/admin/api-keys/key_1/rotate",
      {
        method: "POST",
        headers: { Authorization: "Bearer token" },
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(rotateMock).toHaveBeenCalledWith(
      expect.anything(),
      "key_1",
      "user_1",
    );
  });

  it("POST /api/admin/api-keys/:id/rotate rejects revoked keys", async () => {
    vi.spyOn(apiKeysService, "rotateApiKey").mockRejectedValue(
      new apiKeysService.ApiKeyConflictError(
        "Revoked API keys cannot be rotated",
      ),
    );

    const res = await app.request(
      "/api/admin/api-keys/key_1/rotate",
      {
        method: "POST",
        headers: { Authorization: "Bearer token" },
      },
      env,
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: {
        code: "CONFLICT",
        message: "Revoked API keys cannot be rotated",
      },
    });
  });

  it("DELETE /api/admin/api-keys/:id deletes", async () => {
    const deleteMock = vi
      .spyOn(apiKeysService, "deleteApiKey")
      .mockResolvedValue();
    const res = await app.request(
      "/api/admin/api-keys/key_1",
      { method: "DELETE", headers: { Authorization: "Bearer token" } },
      env,
    );
    expect(res.status).toBe(204);
    expect(deleteMock).toHaveBeenCalledWith(expect.anything(), "key_1");
  });
});
