import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { createApp } from "../../../create-app";
import * as authLib from "../../../lib/auth";
import * as modelsService from "../../../services/models";

const app = createApp();

vi.mock("../../../services/models", async () => {
  const actual = await vi.importActual<
    typeof import("../../../services/models")
  >("../../../services/models");
  return {
    ...actual,
    listModels: vi.fn(),
    createModel: vi.fn(),
    getModelById: vi.fn(),
    getModelDependencies: vi.fn(),
    updateModel: vi.fn(),
    deleteModel: vi.fn(),
  };
});

describe("admin models routes", () => {
  const env = {
    DB: {} as any,
    WORKER_ENV: "test" as const,
    JWT_SECRET: "secret",
    ASSETS: { fetch: vi.fn() },
  };

  const listModelsMock = vi.mocked(modelsService.listModels);
  const createModelMock = vi.mocked(modelsService.createModel);
  const getModelByIdMock = vi.mocked(modelsService.getModelById);
  const getModelDependenciesMock = vi.mocked(
    modelsService.getModelDependencies,
  );
  const updateModelMock = vi.mocked(modelsService.updateModel);
  const deleteModelMock = vi.mocked(modelsService.deleteModel);

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(authLib, "verifyAccessToken").mockResolvedValue({
      sub: "user_42",
      sid: "sess_test",
      roles: ["system.super-admin"],
    } as any);
    listModelsMock.mockReset();
    createModelMock.mockReset();
    getModelByIdMock.mockReset();
    getModelDependenciesMock.mockReset();
    updateModelMock.mockReset();
    deleteModelMock.mockReset();
  });

  it("GET /api/admin/models returns models", async () => {
    listModelsMock.mockResolvedValue([
      {
        id: "model_1",
        name: "Articles",
        description: "Blog posts",
        isPublic: true,
        createdAt: "2025-09-20T00:00:00.000Z",
        updatedAt: "2025-09-21T00:00:00.000Z",
        fieldsCount: 2,
        entriesCount: 5,
        titleFieldId: "field_title",
      },
    ]);

    const res = await app.request(
      "/api/admin/models",
      {
        method: "GET",
        headers: { Authorization: "Bearer token" },
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(listModelsMock).toHaveBeenCalledOnce();
    const body = await res.json();
    expect(body.items[0]).toMatchObject({ id: "model_1", fieldsCount: 2 });
  });

  it("POST /api/admin/models creates model", async () => {
    createModelMock.mockResolvedValue({
      id: "model_99",
      name: "Docs",
      description: null,
      isPublic: false,
      createdAt: "2025-09-24T12:00:00.000Z",
      updatedAt: "2025-09-24T12:00:00.000Z",
      fieldsCount: 0,
      entriesCount: 0,
      titleFieldId: null,
    });

    const res = await app.request(
      "/api/admin/models",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Docs",
          description: "All docs",
          isPublic: false,
        }),
      },
      env,
    );

    expect(res.status).toBe(201);
    expect(createModelMock).toHaveBeenCalled();
    const [, payload] = (createModelMock as unknown as Mock).mock.calls[0];
    expect(payload).toMatchObject({ name: "Docs", isPublic: false });
  });

  it("GET /api/admin/models/:modelId returns detail", async () => {
    getModelByIdMock.mockResolvedValue({
      id: "model_5",
      name: "Components",
      description: "Reusable",
      isPublic: true,
      createdAt: "2025-09-18T00:00:00.000Z",
      updatedAt: "2025-09-23T00:00:00.000Z",
      fieldsCount: 4,
      entriesCount: 10,
      titleFieldId: null,
    });

    const res = await app.request(
      "/api/admin/models/model_5",
      {
        method: "GET",
        headers: { Authorization: "Bearer token" },
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.item).toMatchObject({ id: "model_5", fieldsCount: 4 });
    expect(getModelByIdMock).toHaveBeenCalledWith(
      expect.any(Object),
      "model_5",
    );
  });

  it("GET /api/admin/models/:modelId returns 404 when missing", async () => {
    getModelByIdMock.mockResolvedValue(null);

    const res = await app.request(
      "/api/admin/models/model_missing",
      {
        method: "GET",
        headers: { Authorization: "Bearer token" },
      },
      env,
    );

    expect(res.status).toBe(404);
  });

  it("PUT /api/admin/models/:modelId updates model", async () => {
    updateModelMock.mockResolvedValue({
      id: "model_5",
      name: "Articles",
      description: "Updated",
      isPublic: true,
      titleFieldId: "field_title",
      createdAt: "2025-09-18T00:00:00.000Z",
      updatedAt: "2025-09-25T00:00:00.000Z",
      fieldsCount: 4,
      entriesCount: 10,
    });

    const res = await app.request(
      "/api/admin/models/model_5",
      {
        method: "PUT",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Articles",
          description: "Updated",
          isPublic: true,
          titleFieldId: "field_title",
        }),
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(updateModelMock).toHaveBeenCalledWith(expect.any(Object), {
      id: "model_5",
      name: "Articles",
      description: "Updated",
      isPublic: true,
      titleFieldId: "field_title",
      actorId: "user_42",
    });
    const body = await res.json();
    expect(body.item).toMatchObject({
      id: "model_5",
      titleFieldId: "field_title",
    });
  });

  it("PUT /api/admin/models/:modelId returns 400 for invalid title field", async () => {
    updateModelMock.mockRejectedValue(
      new modelsService.ModelTitleFieldInvalidError(),
    );

    const res = await app.request(
      "/api/admin/models/model_5",
      {
        method: "PUT",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Articles",
          description: "Updated",
          isPublic: true,
          titleFieldId: "field_other",
        }),
      },
      env,
    );

    expect(res.status).toBe(400);
  });

  it("PUT /api/admin/models/:modelId returns 404 when model not found", async () => {
    updateModelMock.mockRejectedValue(new modelsService.ModelNotFoundError());

    const res = await app.request(
      "/api/admin/models/model_missing",
      {
        method: "PUT",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Articles",
          isPublic: true,
          titleFieldId: null,
        }),
      },
      env,
    );

    expect(res.status).toBe(404);
  });

  it("GET /api/admin/models/:modelId/dependencies returns dependencies", async () => {
    getModelByIdMock.mockResolvedValue({
      id: "model_target",
      name: "Target",
      description: null,
      isPublic: true,
      createdAt: "2025-09-24T00:00:00.000Z",
      updatedAt: "2025-09-24T00:00:00.000Z",
      fieldsCount: 0,
      entriesCount: 0,
      titleFieldId: null,
    });
    getModelDependenciesMock.mockResolvedValue([
      {
        modelId: "model_articles",
        modelName: "Articles",
        fieldId: "field_relation",
        fieldName: "Author",
        dependencyType: "relation",
        relationVariant: "many",
      },
    ]);

    const res = await app.request(
      "/api/admin/models/model_target/dependencies",
      {
        method: "GET",
        headers: { Authorization: "Bearer token" },
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dependencies).toHaveLength(1);
    expect(getModelDependenciesMock).toHaveBeenCalledWith(
      expect.any(Object),
      "model_target",
    );
  });

  it("DELETE /api/admin/models/:modelId deletes model", async () => {
    getModelByIdMock.mockResolvedValue({
      id: "model_target",
      name: "Target",
      description: null,
      isPublic: true,
      createdAt: "2025-09-24T00:00:00.000Z",
      updatedAt: "2025-09-24T00:00:00.000Z",
      fieldsCount: 0,
      entriesCount: 0,
      titleFieldId: null,
    });
    deleteModelMock.mockResolvedValue();

    const res = await app.request(
      "/api/admin/models/model_target",
      {
        method: "DELETE",
        headers: { Authorization: "Bearer token" },
      },
      env,
    );

    expect(res.status).toBe(204);
    expect(deleteModelMock).toHaveBeenCalledWith(expect.any(Object), {
      id: "model_target",
      actorId: "user_42",
    });
  });

  it("DELETE /api/admin/models/:modelId returns 409 when dependencies exist", async () => {
    getModelByIdMock.mockResolvedValue({
      id: "model_target",
      name: "Target",
      description: null,
      isPublic: true,
      createdAt: "2025-09-24T00:00:00.000Z",
      updatedAt: "2025-09-24T00:00:00.000Z",
      fieldsCount: 0,
      entriesCount: 0,
      titleFieldId: null,
    });
    deleteModelMock.mockRejectedValue(
      new modelsService.ModelDeletionBlockedError([
        {
          modelId: "model_articles",
          modelName: "Articles",
          fieldId: "field_relation",
          fieldName: "Author",
          dependencyType: "relation",
          relationVariant: "many",
        },
      ]),
    );

    const res = await app.request(
      "/api/admin/models/model_target",
      {
        method: "DELETE",
        headers: { Authorization: "Bearer token" },
      },
      env,
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("MODEL_HAS_DEPENDENCIES");
    expect(body.dependencies).toHaveLength(1);
  });
});
