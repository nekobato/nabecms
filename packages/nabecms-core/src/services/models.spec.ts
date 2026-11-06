import { describe, it, expect, vi, type Mock } from "vitest";
import {
  createModel,
  listModels,
  getModelById,
  getModelDependencies,
  updateModel,
  deleteModel,
  ModelDeletionBlockedError,
  ModelNotFoundError,
  ModelTitleFieldInvalidError,
  type CreateModelParams,
  type ModelsServiceDeps,
} from "./models";

type InsertArgs = Parameters<ModelsServiceDeps["repo"]["insert"]>[0];

describe("models service", () => {
  const baseDeps = ({
    repoOverrides,
    generateId = vi.fn().mockReturnValue("model_123"),
    now = () => new Date("2025-09-24T12:00:00.000Z"),
  }: {
    repoOverrides?: Partial<ModelsServiceDeps["repo"]>;
    generateId?: ModelsServiceDeps["generateId"];
    now?: ModelsServiceDeps["now"];
  }) => {
    const repo: ModelsServiceDeps["repo"] = {
      insert: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
      findById: vi.fn().mockResolvedValue(null),
      updateById: vi.fn().mockResolvedValue(undefined),
      findFieldById: vi.fn().mockResolvedValue(null),
      countFieldsByModelIds: vi.fn().mockResolvedValue(new Map()),
      countEntriesByModelIds: vi.fn().mockResolvedValue(new Map()),
      deleteById: vi.fn(),
      listFieldsForDependencyCheck: vi.fn().mockResolvedValue([]),
      ...repoOverrides,
    };
    return {
      repo,
      generateId,
      now,
      logAuditEvent: vi.fn().mockResolvedValue(undefined),
    } satisfies ModelsServiceDeps;
  };

  it("creates a model using repository and returns public payload", async () => {
    const deps = baseDeps({});

    const params: CreateModelParams = {
      name: "Articles",
      description: "Blog articles",
      isPublic: true,
    };

    const result = await createModel(deps, params);

    const insertArg = (deps.repo.insert as unknown as Mock).mock
      .calls[0][0] as InsertArgs;
    expect(insertArg).toMatchObject({
      id: "model_123",
      name: "Articles",
      description: "Blog articles",
      isPrivate: false,
      titleFieldId: null,
      createdAt: "2025-09-24T12:00:00.000Z",
      updatedAt: "2025-09-24T12:00:00.000Z",
    });

    expect(result).toEqual({
      id: "model_123",
      name: "Articles",
      description: "Blog articles",
      isPublic: true,
      titleFieldId: null,
      createdAt: "2025-09-24T12:00:00.000Z",
      updatedAt: "2025-09-24T12:00:00.000Z",
      fieldsCount: 0,
      entriesCount: 0,
    });
  });

  it("lists models with aggregated field count", async () => {
    const deps = baseDeps({
      repoOverrides: {
        list: vi.fn().mockResolvedValue([
          {
            id: "model_1",
            name: "Articles",
            description: "Blog",
            isPrivate: false,
            createdAt: "2025-09-20T00:00:00.000Z",
            updatedAt: "2025-09-21T00:00:00.000Z",
          },
          {
            id: "model_2",
            name: "Drafts",
            description: null,
            isPrivate: true,
            createdAt: "2025-09-22T00:00:00.000Z",
            updatedAt: "2025-09-23T00:00:00.000Z",
          },
        ]),
        countFieldsByModelIds: vi.fn().mockResolvedValue(
          new Map<string, number>([
            ["model_1", 3],
            ["model_2", 1],
          ]),
        ),
        countEntriesByModelIds: vi.fn().mockResolvedValue(
          new Map<string, number>([
            ["model_1", 5],
            ["model_2", 2],
          ]),
        ),
      },
    });

    const result = await listModels(deps);

    expect(result).toEqual([
      {
        id: "model_1",
        name: "Articles",
        description: "Blog",
        isPublic: true,
        titleFieldId: null,
        createdAt: "2025-09-20T00:00:00.000Z",
        updatedAt: "2025-09-21T00:00:00.000Z",
        fieldsCount: 3,
        entriesCount: 5,
      },
      {
        id: "model_2",
        name: "Drafts",
        description: null,
        isPublic: false,
        titleFieldId: null,
        createdAt: "2025-09-22T00:00:00.000Z",
        updatedAt: "2025-09-23T00:00:00.000Z",
        fieldsCount: 1,
        entriesCount: 2,
      },
    ]);

    expect(deps.repo.countFieldsByModelIds).toHaveBeenCalledWith([
      "model_1",
      "model_2",
    ]);
    expect(deps.repo.countEntriesByModelIds).toHaveBeenCalledWith([
      "model_1",
      "model_2",
    ]);
  });

  it("returns null when model is missing", async () => {
    const deps = baseDeps({});
    const model = await getModelById(deps, "missing");
    expect(model).toBeNull();
  });

  it("returns model when present", async () => {
    const deps = baseDeps({
      repoOverrides: {
        findById: vi.fn().mockResolvedValue({
          id: "model_9",
          name: "News",
          description: "Latest news",
          isPrivate: false,
          createdAt: "2025-09-10T00:00:00.000Z",
          updatedAt: "2025-09-11T00:00:00.000Z",
        }),
      },
    });

    const model = await getModelById(deps, "model_9");
    expect(model).toEqual({
      id: "model_9",
      name: "News",
      description: "Latest news",
      isPublic: true,
      titleFieldId: null,
      createdAt: "2025-09-10T00:00:00.000Z",
      updatedAt: "2025-09-11T00:00:00.000Z",
      fieldsCount: 0,
      entriesCount: 0,
    });
  });

  it("updates model and returns public payload", async () => {
    const findById = vi
      .fn()
      .mockResolvedValueOnce({
        id: "model_10",
        name: "Old",
        description: "Before",
        isPrivate: true,
        titleFieldId: null,
        createdAt: "2025-08-01T00:00:00.000Z",
        updatedAt: "2025-08-02T00:00:00.000Z",
      })
      .mockResolvedValueOnce({
        id: "model_10",
        name: "Articles",
        description: "Updated description",
        isPrivate: false,
        titleFieldId: "field_title",
        createdAt: "2025-08-01T00:00:00.000Z",
        updatedAt: "2025-09-24T12:00:00.000Z",
      });

    const deps = baseDeps({
      repoOverrides: {
        findById,
        findFieldById: vi.fn().mockResolvedValue({
          id: "field_title",
          modelId: "model_10",
        }),
        countFieldsByModelIds: vi
          .fn()
          .mockResolvedValue(new Map([["model_10", 5]])),
        countEntriesByModelIds: vi
          .fn()
          .mockResolvedValue(new Map([["model_10", 12]])),
      },
    });

    const result = await updateModel(deps, {
      id: "model_10",
      name: "Articles",
      description: "Updated description",
      isPublic: true,
      titleFieldId: "field_title",
      actorId: "user_7",
    });

    expect(deps.repo.updateById).toHaveBeenCalledWith("model_10", {
      name: "Articles",
      description: "Updated description",
      isPrivate: false,
      titleFieldId: "field_title",
      updatedAt: "2025-09-24T12:00:00.000Z",
    });

    expect(result).toEqual({
      id: "model_10",
      name: "Articles",
      description: "Updated description",
      isPublic: true,
      titleFieldId: "field_title",
      createdAt: "2025-08-01T00:00:00.000Z",
      updatedAt: "2025-09-24T12:00:00.000Z",
      fieldsCount: 5,
      entriesCount: 12,
    });

    expect(deps.logAuditEvent).toHaveBeenCalledWith({
      actorId: "user_7",
      action: "update",
      targetTable: "models",
      targetId: "model_10",
      before: null,
      after: null,
    });
  });

  it("throws when title field does not belong to model", async () => {
    const deps = baseDeps({
      repoOverrides: {
        findById: vi.fn().mockResolvedValue({
          id: "model_11",
          name: "Articles",
          description: "",
          isPrivate: false,
          titleFieldId: null,
          createdAt: "2025-08-01T00:00:00.000Z",
          updatedAt: "2025-08-02T00:00:00.000Z",
        }),
        findFieldById: vi.fn().mockResolvedValue({
          id: "field_other",
          modelId: "another_model",
        }),
      },
    });

    await expect(
      updateModel(deps, {
        id: "model_11",
        name: "Articles",
        description: "",
        isPublic: true,
        titleFieldId: "field_other",
        actorId: "user_1",
      }),
    ).rejects.toBeInstanceOf(ModelTitleFieldInvalidError);
    expect(deps.repo.updateById).not.toHaveBeenCalled();
  });

  it("throws when model does not exist on update", async () => {
    const deps = baseDeps({});

    await expect(
      updateModel(deps, {
        id: "missing",
        name: "Articles",
        description: "",
        isPublic: true,
        titleFieldId: null,
        actorId: "user_1",
      }),
    ).rejects.toBeInstanceOf(ModelNotFoundError);
    expect(deps.repo.updateById).not.toHaveBeenCalled();
  });

  it("collects dependencies from relation fields", async () => {
    const deps = baseDeps({
      repoOverrides: {
        listFieldsForDependencyCheck: vi.fn().mockResolvedValue([
          {
            field: {
              id: "field_relation",
              modelId: "model_articles",
              name: "Author",
              type: "relation",
              variant: "many",
              options: {
                allowedModels: ["model_target"],
              },
            },
            model: {
              id: "model_articles",
              name: "Articles",
            },
          },
          {
            field: {
              id: "field_list",
              modelId: "model_gallery",
              name: "Items",
              type: "list",
              variant: undefined,
              options: {
                item: {
                  type: "text",
                },
              },
            },
            model: {
              id: "model_gallery",
              name: "Gallery",
            },
          },
          {
            field: {
              id: "field_irrelevant",
              modelId: "model_tags",
              name: "Label",
              type: "text",
              variant: undefined,
              options: undefined,
            },
            model: {
              id: "model_tags",
              name: "Tags",
            },
          },
        ]),
      },
    });

    const depsResult = await getModelDependencies(deps, "model_target");

    expect(depsResult).toEqual([
      {
        modelId: "model_articles",
        modelName: "Articles",
        fieldId: "field_relation",
        fieldName: "Author",
        dependencyType: "relation",
        relationVariant: "many",
      },
    ]);
  });

  it("throws when deleting a model that has dependencies", async () => {
    const deps = baseDeps({
      repoOverrides: {
        listFieldsForDependencyCheck: vi.fn().mockResolvedValue([
          {
            field: {
              id: "field_relation",
              modelId: "model_articles",
              name: "Author",
              type: "relation",
              variant: "many",
              options: {
                allowedModels: ["model_target"],
              },
            },
            model: {
              id: "model_articles",
              name: "Articles",
            },
          },
        ]),
      },
    });

    await expect(
      deleteModel(deps, { id: "model_target", actorId: "user_1" }),
    ).rejects.toBeInstanceOf(ModelDeletionBlockedError);
    expect(deps.repo.deleteById).not.toHaveBeenCalled();
  });

  it("deletes model and logs audit event when no dependencies", async () => {
    const deps = baseDeps({});

    await deleteModel(deps, { id: "model_target", actorId: "user_1" });

    expect(deps.repo.deleteById).toHaveBeenCalledWith("model_target");
    expect(deps.logAuditEvent).toHaveBeenCalledWith({
      actorId: "user_1",
      action: "delete",
      targetTable: "models",
      targetId: "model_target",
      after: null,
      before: null,
    });
  });
});
