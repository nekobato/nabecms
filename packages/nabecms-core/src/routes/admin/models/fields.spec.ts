import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { createApp } from "../../../create-app";
import * as authLib from "../../../lib/auth";
import * as usersRepository from "../../../repositories/users";
import * as rolesRepository from "../../../repositories/roles";

vi.mock("drizzle-orm/d1", () => ({
  drizzle: vi.fn(),
}));

const app = createApp();
const drizzleMock = vi.mocked(drizzle);

const env = {
  DB: {} as any,
  WORKER_ENV: "test" as const,
  JWT_SECRET: "test-secret",
  ASSETS: { fetch: vi.fn() },
};

type FieldPostDbMockOptions = {
  modelTitleFieldId?: string | null;
  existingFieldIds?: string[];
  relationModelIds?: string[];
};

/**
 * Mock the minimal Drizzle chain used by the field creation route.
 */
const createFieldPostDbMock = (options: FieldPostDbMockOptions = {}) => {
  const modelTitleFieldId = options.modelTitleFieldId ?? null;
  const existingFieldIds = options.existingFieldIds ?? [];
  const insertedValues: unknown[] = [];
  const modelUpdates: unknown[] = [];
  let selectCallCount = 0;

  const nextRows = () => {
    selectCallCount += 1;
    if (selectCallCount === 1) {
      return [{ id: "model_1", titleFieldId: modelTitleFieldId }];
    }
    if (options.relationModelIds !== undefined && selectCallCount === 2) {
      return options.relationModelIds.map((id) => ({ id }));
    }
    if (selectCallCount === 2) {
      return existingFieldIds.slice(0, 1).map((id) => ({ id }));
    }
    if (options.relationModelIds !== undefined && selectCallCount === 3) {
      return existingFieldIds.slice(0, 1).map((id) => ({ id }));
    }
    return [];
  };

  const createWhereResult = () => ({
    limit: vi.fn(async () => nextRows()),
    then: <TResult1 = unknown[], TResult2 = never>(
      onfulfilled?:
        ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?:
        ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) => Promise.resolve(nextRows()).then(onfulfilled, onrejected),
  });

  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => createWhereResult()),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(async (value: unknown) => {
        insertedValues.push(value);
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((value: unknown) => ({
        where: vi.fn(async () => {
          modelUpdates.push(value);
        }),
      })),
    })),
  };

  return { db, insertedValues, modelUpdates };
};

type FieldDeleteDbMockOptions = {
  model?: { id: string; titleFieldId: string | null } | null;
  field?: { id: string; position: number } | null;
  remainingFieldIds?: string[];
};

/**
 * Mock the minimal Drizzle chain used by the field deletion route.
 */
const createFieldDeleteDbMock = (options: FieldDeleteDbMockOptions = {}) => {
  const model =
    options.model === undefined
      ? { id: "model_1", titleFieldId: null }
      : options.model;
  const field =
    options.field === undefined
      ? { id: "field_title", position: 0 }
      : options.field;
  const remainingFieldIds = options.remainingFieldIds ?? [];
  const deleteCalls: unknown[] = [];
  const updateValues: unknown[] = [];
  let selectCallCount = 0;

  const nextRows = () => {
    selectCallCount += 1;
    if (selectCallCount === 1) return model ? [model] : [];
    if (selectCallCount === 2) return field ? [field] : [];
    if (selectCallCount === 3) {
      return remainingFieldIds.map((id) => ({ id }));
    }
    return [];
  };

  const createWhereResult = () => ({
    limit: vi.fn(async () => nextRows()),
    orderBy: vi.fn(async () => nextRows()),
    then: <TResult1 = unknown[], TResult2 = never>(
      onfulfilled?:
        ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?:
        ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) => Promise.resolve(nextRows()).then(onfulfilled, onrejected),
  });

  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => createWhereResult()),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(async (value: unknown) => {
        deleteCalls.push(value);
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((value: unknown) => ({
        where: vi.fn(async () => {
          updateValues.push(value);
        }),
      })),
    })),
    batch: vi.fn(async (statements: Array<Promise<unknown>>) => {
      await Promise.all(statements);
    }),
  };

  return { db, deleteCalls, updateValues };
};

/**
 * Mock a user whose roles allow model field writes.
 */
const mockModelFieldWritePermission = () => {
  vi.spyOn(usersRepository, "createUserRepository").mockReturnValue({
    findById: vi.fn().mockResolvedValue({
      id: "user_1",
      roleId: ["role_model_writer"],
    }),
  } as any);
  vi.spyOn(rolesRepository, "createRoleRepository").mockReturnValue({
    findManyByIds: vi.fn().mockResolvedValue([
      {
        id: "role_model_writer",
        permissions: { allow: ["models:*:write"] },
      },
    ]),
  } as any);
};

const validFieldPayload = {
  name: "Title",
  fieldKey: "title",
  type: "text",
  variant: "shortText",
  required: true,
  hasLocales: false,
};

describe("admin model fields route authorization", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    drizzleMock.mockReset();
    vi.spyOn(authLib, "verifyAccessToken").mockResolvedValue({
      sub: "user_1",
      sid: "sess_test",
      roles: ["system.super-admin"],
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    { name: "with test bindings", modelId: "model_1", bindings: env },
    { name: "without bindings", modelId: "test-model", bindings: undefined },
  ])(
    "GET /api/admin/models/:modelId/fields returns 401 without token ($name)",
    async ({ modelId, bindings }) => {
      const res = await app.request(
        `/api/admin/models/${modelId}/fields`,
        { method: "GET" },
        bindings,
      );

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({
        error: { code: "UNAUTHORIZED", message: "Missing token" },
      });
    },
  );

  it("GET /api/admin/models/:modelId/fields returns 403 when read permission is missing", async () => {
    vi.mocked(authLib.verifyAccessToken).mockResolvedValue({
      sub: "user_1",
      sid: "sess_test",
      roles: ["role_settings_admin"],
    } as any);
    vi.spyOn(usersRepository, "createUserRepository").mockReturnValue({
      findById: vi.fn().mockResolvedValue({
        id: "user_1",
        roleId: ["role_settings_admin"],
      }),
    } as any);
    vi.spyOn(rolesRepository, "createRoleRepository").mockReturnValue({
      findManyByIds: vi.fn().mockResolvedValue([
        {
          id: "role_settings_admin",
          permissions: { allow: ["settings:media:write"] },
        },
      ]),
    } as any);

    const res = await app.request(
      "/api/admin/models/model_1/fields",
      {
        method: "GET",
        headers: { Authorization: "Bearer token" },
      },
      env,
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: "FORBIDDEN", message: "Missing permission" },
    });
  });

  it("POST /api/admin/models/:modelId/fields returns 403 when write permission is missing", async () => {
    vi.mocked(authLib.verifyAccessToken).mockResolvedValue({
      sub: "user_1",
      sid: "sess_test",
      roles: ["role_viewer"],
    } as any);
    vi.spyOn(usersRepository, "createUserRepository").mockReturnValue({
      findById: vi.fn().mockResolvedValue({
        id: "user_1",
        roleId: ["role_viewer"],
      }),
    } as any);
    vi.spyOn(rolesRepository, "createRoleRepository").mockReturnValue({
      findManyByIds: vi.fn().mockResolvedValue([
        {
          id: "role_viewer",
          permissions: { allow: ["models:*:read"] },
        },
      ]),
    } as any);

    const res = await app.request(
      "/api/admin/models/model_1/fields",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      },
      env,
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: "FORBIDDEN", message: "Missing permission" },
    });
  });

  it("DELETE /api/admin/models/:modelId/fields/:fieldId returns 403 when write permission is missing", async () => {
    vi.mocked(authLib.verifyAccessToken).mockResolvedValue({
      sub: "user_1",
      sid: "sess_test",
      roles: ["role_viewer"],
    } as any);
    vi.spyOn(usersRepository, "createUserRepository").mockReturnValue({
      findById: vi.fn().mockResolvedValue({
        id: "user_1",
        roleId: ["role_viewer"],
      }),
    } as any);
    vi.spyOn(rolesRepository, "createRoleRepository").mockReturnValue({
      findManyByIds: vi.fn().mockResolvedValue([
        {
          id: "role_viewer",
          permissions: { allow: ["models:*:read"] },
        },
      ]),
    } as any);

    const res = await app.request(
      "/api/admin/models/model_1/fields/field_title",
      {
        method: "DELETE",
        headers: { Authorization: "Bearer token" },
      },
      env,
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: "FORBIDDEN", message: "Missing permission" },
    });
  });

  it("POST /api/admin/models/:modelId/fields marks the first field as display title automatically", async () => {
    mockModelFieldWritePermission();
    const { db, modelUpdates } = createFieldPostDbMock();
    drizzleMock.mockReturnValue(db as any);

    const res = await app.request(
      "/api/admin/models/model_1/fields",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(validFieldPayload),
      },
      env,
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      id: string;
      isDisplayTitle: boolean;
    };
    expect(body.isDisplayTitle).toBe(true);
    expect(modelUpdates).toContainEqual({ titleFieldId: body.id });
  });

  it("POST /api/admin/models/:modelId/fields does not auto-mark later fields as display title", async () => {
    mockModelFieldWritePermission();
    const { db, modelUpdates } = createFieldPostDbMock({
      existingFieldIds: ["field_existing"],
    });
    drizzleMock.mockReturnValue(db as any);

    const res = await app.request(
      "/api/admin/models/model_1/fields",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...validFieldPayload,
          name: "Summary",
          fieldKey: "summary",
        }),
      },
      env,
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { isDisplayTitle: boolean };
    expect(body.isDisplayTitle).toBe(false);
    expect(modelUpdates).toHaveLength(0);
  });

  it("POST /api/admin/models/:modelId/fields rejects custom field creation in v1", async () => {
    mockModelFieldWritePermission();
    const { db, insertedValues } = createFieldPostDbMock();
    drizzleMock.mockReturnValue(db as any);

    const res = await app.request(
      "/api/admin/models/model_1/fields",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...validFieldPayload,
          type: "custom",
          variant: null,
          options: { customTypeId: "geo.point" },
        }),
      },
      env,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: {
        code: "UNSUPPORTED_FIELD_TYPE",
        message: "Custom fields are not supported in v1",
      },
    });
    expect(insertedValues).toHaveLength(0);
  });

  it("POST /api/admin/models/:modelId/fields rejects relation fields with unknown allowed models", async () => {
    mockModelFieldWritePermission();
    const { db, insertedValues } = createFieldPostDbMock({
      relationModelIds: ["model_known"],
    });
    drizzleMock.mockReturnValue(db as any);

    const res = await app.request(
      "/api/admin/models/model_1/fields",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Author",
          fieldKey: "author",
          type: "relation",
          variant: "many",
          required: false,
          hasLocales: false,
          options: {
            allowedModels: ["model_known", "model_missing"],
          },
        }),
      },
      env,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Relation allowedModels contains unknown model id: model_missing",
    });
    expect(insertedValues).toHaveLength(0);
  });

  it("DELETE /api/admin/models/:modelId/fields/:fieldId deletes a field and clears the display title", async () => {
    mockModelFieldWritePermission();
    const { db, deleteCalls, updateValues } = createFieldDeleteDbMock({
      model: { id: "model_1", titleFieldId: "field_title" },
      field: { id: "field_title", position: 0 },
      remainingFieldIds: ["field_body"],
    });
    drizzleMock.mockReturnValue(db as any);

    const res = await app.request(
      "/api/admin/models/model_1/fields/field_title",
      {
        method: "DELETE",
        headers: { Authorization: "Bearer token" },
      },
      env,
    );

    expect(res.status).toBe(204);
    expect(deleteCalls).toHaveLength(1);
    expect(updateValues).toContainEqual({
      position: 0,
      updatedAt: expect.any(String),
    });
    expect(updateValues).toContainEqual({
      titleFieldId: null,
      updatedAt: expect.any(String),
    });
    expect(db.batch).toHaveBeenCalledTimes(1);
  });

  it("DELETE /api/admin/models/:modelId/fields/:fieldId returns 404 when the field does not exist", async () => {
    mockModelFieldWritePermission();
    const { db, deleteCalls } = createFieldDeleteDbMock({
      field: null,
    });
    drizzleMock.mockReturnValue(db as any);

    const res = await app.request(
      "/api/admin/models/model_1/fields/missing_field",
      {
        method: "DELETE",
        headers: { Authorization: "Bearer token" },
      },
      env,
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Field not found" });
    expect(deleteCalls).toHaveLength(0);
  });
});
