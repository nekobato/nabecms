import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type MockInstance,
} from "vitest";
import { createApp } from "../../create-app";
import * as authLib from "../../lib/auth";
import { uploadMediaFiles, listMediaFiles } from "../../services/media";
import * as mediaRepository from "../../repositories/media";
import * as mediaVariantRepository from "../../repositories/media-variants";
import * as settingsRepository from "../../repositories/settings";
import * as userRepository from "../../repositories/users";
import { MAX_MEDIA_REQUEST_SIZE_BYTES } from "../../services/media-validation";

const app = createApp();

vi.mock("../../services/media", () => ({
  uploadMediaFiles: vi.fn(),
  listMediaFiles: vi.fn(),
}));

const uploadMediaFilesMock = vi.mocked(uploadMediaFiles);
const listMediaFilesMock = vi.mocked(listMediaFiles);

type MockFn = MockInstance<(...args: unknown[]) => unknown>;

type MediaRepositoryMock = {
  insert: MockFn;
  list: MockFn;
  count: MockFn;
  findById: MockFn;
  findByIds: MockFn;
  updateById: MockFn;
  deleteById: MockFn;
};

type UserRepositoryMock = {
  findManyByIds: MockFn;
};

describe("admin media routes", () => {
  const env = {
    DB: {} as any,
    R2: { put: vi.fn(), get: vi.fn(), delete: vi.fn() } as any,
    WORKER_ENV: "test" as const,
    JWT_SECRET: "test-secret",
    ASSETS: { fetch: vi.fn() },
  };

  let repoMock: MediaRepositoryMock;
  let userRepoMock: UserRepositoryMock;
  let settingsRepoMock: { findByKey: MockFn; upsert: MockFn };
  let variantRepoMock: {
    insert: MockFn;
    insertMany: MockFn;
    findById: MockFn;
    findByMediaIdAndTemplateKey: MockFn;
    list: MockFn;
    updateById: MockFn;
  };
  const userRecord = {
    id: "user_123",
    email: "user@example.com",
    password: "hashed",
    name: "Test User",
    roleId: ["admin"],
    createdAt: "2025-09-24T00:00:00.000Z",
    updatedAt: "2025-09-24T00:00:00.000Z",
  } as const;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(authLib, "verifyAccessToken").mockResolvedValue({
      sub: "user_123",
      sid: "sess_test",
      roles: ["system.super-admin"],
    } as any);
    uploadMediaFilesMock.mockReset();
    listMediaFilesMock.mockReset();
    (env.R2.put as MockFn).mockReset?.();
    (env.R2.get as MockFn).mockReset?.();
    (env.R2.delete as MockFn).mockReset?.();
    repoMock = {
      insert: vi.fn(),
      list: vi.fn(),
      count: vi.fn(),
      findById: vi.fn(),
      findByIds: vi.fn(),
      updateById: vi.fn(),
      deleteById: vi.fn(),
    };
    vi.spyOn(mediaRepository, "createMediaRepository").mockReturnValue(
      repoMock as any,
    );
    userRepoMock = {
      findManyByIds: vi.fn().mockResolvedValue([userRecord]),
    };
    vi.spyOn(userRepository, "createUserRepository").mockReturnValue(
      userRepoMock as any,
    );
    settingsRepoMock = {
      findByKey: vi.fn().mockResolvedValue(null),
      upsert: vi.fn(),
    };
    vi.spyOn(settingsRepository, "createSettingsRepository").mockReturnValue(
      settingsRepoMock as any,
    );
    variantRepoMock = {
      insert: vi.fn(),
      insertMany: vi.fn(),
      findById: vi.fn(),
      findByMediaIdAndTemplateKey: vi.fn(),
      list: vi.fn(),
      updateById: vi.fn(),
    };
    vi.spyOn(
      mediaVariantRepository,
      "createMediaVariantRepository",
    ).mockReturnValue(variantRepoMock as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POST /api/admin/media uploads via service", async () => {
    uploadMediaFilesMock.mockResolvedValue({
      items: [
        {
          id: "media_1",
          groupId: "group_1",
          url: "/api/admin/media/media_1/file",
          type: "image",
          mimeType: "image/png",
          name: "photo.png",
          description: null,
          width: null,
          height: null,
          size: 5,
          status: "published",
          updatedBy: "user_123",
          createdAt: "2025-09-22T00:00:00.000Z",
          updatedAt: "2025-09-22T00:00:00.000Z",
        },
      ],
    });

    const form = new FormData();
    form.append(
      "files",
      new Blob(
        [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
        { type: "image/png" },
      ),
      "photo.png",
    );

    const res = await app.request(
      "/api/admin/media",
      {
        method: "POST",
        body: form,
        headers: { Authorization: "Bearer token" },
      },
      env,
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(userRepoMock.findManyByIds).toHaveBeenCalledWith(["user_123"]);
    expect(body.items[0].updatedBy).toEqual({
      id: "user_123",
      name: "Test User",
    });
    expect(uploadMediaFilesMock).toHaveBeenCalled();
    const args = uploadMediaFilesMock.mock.calls[0];
    expect(args[1]).toMatchObject({ actorId: "user_123" });
    expect(args[1]).not.toHaveProperty("locale");
  });

  it("POST /api/admin/media rejects multiple source files", async () => {
    const form = new FormData();
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    form.append("files[]", new Blob([png], { type: "image/png" }), "one.png");
    form.append("files[]", new Blob([png], { type: "image/png" }), "two.png");

    const res = await app.request(
      "/api/admin/media",
      {
        method: "POST",
        body: form,
        headers: { Authorization: "Bearer token" },
      },
      env,
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "INVALID_FILE_COUNT" },
    });
    expect(uploadMediaFilesMock).not.toHaveBeenCalled();
  });

  it("POST /api/admin/media rejects an oversized request before parsing it", async () => {
    const request = new Request("http://localhost/api/admin/media", {
      method: "POST",
      body: "small",
      headers: {
        Authorization: "Bearer token",
        "Content-Type": "multipart/form-data; boundary=test",
        "Content-Length": String(MAX_MEDIA_REQUEST_SIZE_BYTES + 1),
      },
    });

    const res = await app.request(request, undefined, env);

    expect(res.status).toBe(413);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "REQUEST_TOO_LARGE" },
    });
    expect(uploadMediaFilesMock).not.toHaveBeenCalled();
  });

  it("GET /api/admin/media lists via service", async () => {
    listMediaFilesMock.mockResolvedValue({
      items: [
        {
          id: "media_1",
          groupId: "group_1",
          url: "media/sample.jpg",
          type: "image",
          mimeType: "image/jpeg",
          name: "sample.jpg",
          description: null,
          width: null,
          height: null,
          size: 100,
          status: "published",
          updatedBy: "user_123",
          createdAt: "2025-09-24T00:00:00.000Z",
          updatedAt: "2025-09-24T00:00:00.000Z",
        },
      ],
      total: 42,
      limit: 25,
      offset: 50,
    });

    const res = await app.request(
      "/api/admin/media?limit=25&offset=50",
      {
        method: "GET",
        headers: { Authorization: "Bearer token" },
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(listMediaFilesMock).toHaveBeenCalledWith(expect.any(Object), {
      limit: 25,
      offset: 50,
    });
    expect(userRepoMock.findManyByIds).toHaveBeenCalledWith(["user_123"]);
    const body = await res.json();
    expect(body.total).toBe(42);
    expect(body.limit).toBe(25);
    expect(body.offset).toBe(50);
    expect(body.items[0].updatedBy).toEqual({
      id: "user_123",
      name: "Test User",
    });
  });

  it("GET /api/admin/media/:mediaId returns media", async () => {
    const mediaRecord = {
      id: "media_1",
      groupId: "group_1",
      url: "media/ja-jp/2025/09/24/group_1/sample.jpg",
      type: "image",
      mimeType: "image/jpeg",
      name: "sample.jpg",
      description: "desc",
      width: 800,
      height: 600,
      size: 1024,
      status: "published",
      createdAt: "2025-09-24T00:00:00.000Z",
      updatedAt: "2025-09-24T00:00:00.000Z",
      updatedBy: "user_123",
    };
    repoMock.findById.mockResolvedValue(mediaRecord);

    const res = await app.request(
      "/api/admin/media/media_1",
      {
        method: "GET",
        headers: { Authorization: "Bearer token" },
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.item).toMatchObject({
      id: "media_1",
      url: "/api/admin/media/media_1/file",
      name: "sample.jpg",
      description: "desc",
      updatedBy: { id: "user_123", name: "Test User" },
    });
    expect(userRepoMock.findManyByIds).toHaveBeenCalledWith(["user_123"]);
  });

  it("PUT /api/admin/media/:mediaId updates media", async () => {
    const existing = {
      id: "media_1",
      groupId: "group_1",
      url: "media/ja/sample.jpg",
      type: "image",
      mimeType: "image/jpeg",
      name: "sample.jpg",
      description: "desc",
      width: 800,
      height: 600,
      size: 1024,
      status: "published",
      createdAt: "2025-09-24T00:00:00.000Z",
      updatedAt: "2025-09-24T00:00:00.000Z",
      updatedBy: "user_123",
    };
    const updated = {
      ...existing,
      name: "updated.jpg",
      description: "updated",
      status: "draft",
    };
    repoMock.findById
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(updated);
    repoMock.updateById.mockResolvedValue(undefined);

    const res = await app.request(
      "/api/admin/media/media_1",
      {
        method: "PUT",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "updated.jpg",
          description: "updated",
          status: "draft",
        }),
      },
      env,
    );

    expect(repoMock.updateById).toHaveBeenCalledWith(
      "media_1",
      expect.objectContaining({
        name: "updated.jpg",
        description: "updated",
        status: "draft",
        updatedBy: "user_123",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.item).toMatchObject({
      name: "updated.jpg",
      status: "draft",
      updatedBy: { id: "user_123", name: "Test User" },
    });
    expect(userRepoMock.findManyByIds).toHaveBeenCalledWith(["user_123"]);
  });

  it("GET /api/admin/media/:mediaId/file serves published media without token", async () => {
    const mediaRecord = {
      id: "media_1",
      groupId: "group_1",
      url: "media/ja/sample.jpg",
      type: "image",
      mimeType: "image/jpeg",
      name: "sample.jpg",
      description: "desc",
      width: 800,
      height: 600,
      size: 1024,
      status: "published",
      createdAt: "2025-09-24T00:00:00.000Z",
      updatedAt: "2025-09-24T00:00:00.000Z",
      updatedBy: "user_123",
    };

    repoMock.findById.mockResolvedValue(mediaRecord);
    const body = new Blob(["hello"], { type: "image/jpeg" }).stream();
    (env.R2.get as MockFn).mockResolvedValue({
      body,
      httpMetadata: {
        contentType: "image/jpeg",
        cacheControl: "public, max-age=31536000, immutable",
        contentDisposition: 'inline; filename="sample.jpg"',
      },
    });

    const res = await app.request(
      "/api/admin/media/media_1/file",
      { method: "GET" },
      env,
    );

    expect(res.status).toBe(200);
    expect(new TextDecoder().decode(await res.arrayBuffer())).toBe("hello");
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Content-Disposition")).toBe(
      'inline; filename="sample.jpg"',
    );
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(authLib.verifyAccessToken).not.toHaveBeenCalled();
    expect(repoMock.findById).toHaveBeenCalledWith("media_1");
  });

  it.each(["draft", "archived"])(
    "GET /api/admin/media/:mediaId/file rejects unauthenticated %s media",
    async (status) => {
      repoMock.findById.mockResolvedValue({
        id: "media_private",
        groupId: "group_1",
        url: "media/private/sample.jpg",
        type: "image",
        mimeType: "image/jpeg",
        name: "sample.jpg",
        description: null,
        width: null,
        height: null,
        size: 4,
        status,
        createdAt: "2025-09-24T00:00:00.000Z",
        updatedAt: "2025-09-24T00:00:00.000Z",
        updatedBy: "user_123",
      });

      const res = await app.request(
        "/api/admin/media/media_private/file",
        { method: "GET" },
        env,
      );

      expect(res.status).toBe(401);
      expect(env.R2.get).not.toHaveBeenCalled();
    },
  );

  it("GET /api/admin/media/:mediaId/file serves authenticated draft media without caching", async () => {
    repoMock.findById.mockResolvedValue({
      id: "media_draft",
      groupId: "group_1",
      url: "media/private/sample.jpg",
      type: "image",
      mimeType: "image/jpeg",
      name: "sample.jpg",
      description: null,
      width: null,
      height: null,
      size: 4,
      status: "draft",
      createdAt: "2025-09-24T00:00:00.000Z",
      updatedAt: "2025-09-24T00:00:00.000Z",
      updatedBy: "user_123",
    });
    (env.R2.get as MockFn).mockResolvedValue({
      body: new Blob(["data"]).stream(),
      httpMetadata: {
        contentType: "text/html",
        contentDisposition: "inline",
        cacheControl: "public, max-age=31536000, immutable",
      },
    });

    const res = await app.request(
      "/api/admin/media/media_draft/file",
      {
        method: "GET",
        headers: { Authorization: "Bearer token" },
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("GET /api/admin/media/:mediaId/file forces legacy active content to download", async () => {
    repoMock.findById.mockResolvedValue({
      id: "media_legacy",
      groupId: "group_1",
      url: "media/legacy/payload.html",
      type: "text",
      mimeType: "text/html",
      name: 'payload".html',
      description: null,
      width: null,
      height: null,
      size: 6,
      status: "published",
      createdAt: "2025-09-24T00:00:00.000Z",
      updatedAt: "2025-09-24T00:00:00.000Z",
      updatedBy: "user_123",
    });
    (env.R2.get as MockFn).mockResolvedValue({
      body: new Blob(["<html>"]).stream(),
      httpMetadata: {
        contentType: "text/html",
        contentDisposition: "inline",
      },
    });

    const res = await app.request(
      "/api/admin/media/media_legacy/file",
      { method: "GET" },
      env,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="payload.html"',
    );
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("GET /api/admin/media/:mediaId/file rejects invalid tokens", async () => {
    const error = new Error("invalid token");
    vi.mocked(authLib.verifyAccessToken).mockRejectedValueOnce(error);

    const mediaRecord = {
      id: "media_1",
      groupId: "group_1",
      url: "media/ja/sample.jpg",
      type: "image",
      mimeType: "image/jpeg",
      name: "sample.jpg",
      description: "desc",
      width: 800,
      height: 600,
      size: 1024,
      status: "published",
      createdAt: "2025-09-24T00:00:00.000Z",
      updatedAt: "2025-09-24T00:00:00.000Z",
      updatedBy: "user_123",
    };

    repoMock.findById.mockResolvedValue(mediaRecord);

    const res = await app.request(
      "/api/admin/media/media_1/file",
      {
        method: "GET",
        headers: { Authorization: "Bearer invalid" },
      },
      env,
    );

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error?.code).toBe("UNAUTHORIZED");
    expect(env.R2.get).not.toHaveBeenCalled();
    expect(repoMock.findById).not.toHaveBeenCalled();
  });

  describe("DELETE /api/admin/media/:mediaId", () => {
    const sourceKey = "media/ja/sample.jpg";
    const variantKey = "media/variants/media_1/thumbnail.webp";
    const deleteMedia = () =>
      app.request(
        "/api/admin/media/media_1",
        {
          method: "DELETE",
          headers: { Authorization: "Bearer token" },
        },
        env,
      );

    beforeEach(() => {
      repoMock.findById.mockResolvedValue({
        id: "media_1",
        url: sourceKey,
        status: "published",
      });
      variantRepoMock.list.mockResolvedValue([
        { url: variantKey },
        { url: null, status: "pending" },
        { url: "", status: "failed" },
        { url: variantKey },
        { url: sourceKey },
      ]);
      repoMock.deleteById.mockResolvedValue(undefined);
    });

    it("waits for DB deletion before deleting the source and unique variant keys", async () => {
      let finishDelete!: () => void;
      let deletionStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        deletionStarted = resolve;
      });
      repoMock.deleteById.mockImplementation(() => {
        expect(variantRepoMock.list).toHaveBeenCalledWith({
          mediaId: "media_1",
        });
        deletionStarted();
        return new Promise<void>((resolve) => {
          finishDelete = resolve;
        });
      });

      const pending = deleteMedia();
      await started;
      expect(env.R2.delete).not.toHaveBeenCalled();
      finishDelete();

      expect((await pending).status).toBe(204);
      expect(repoMock.deleteById).toHaveBeenCalledWith("media_1");
      expect(env.R2.delete.mock.calls).toEqual([[sourceKey], [variantKey]]);
    });

    it("deletes a source with no variants", async () => {
      variantRepoMock.list.mockResolvedValue([]);
      expect((await deleteMedia()).status).toBe(204);
      expect(env.R2.delete.mock.calls).toEqual([[sourceKey]]);
    });

    it.each(["variant lookup", "DB deletion"])(
      "does not touch R2 when %s fails",
      async (failure) => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const operation =
          failure === "variant lookup"
            ? variantRepoMock.list
            : repoMock.deleteById;
        operation.mockRejectedValue(new Error(failure));

        expect((await deleteMedia()).status).toBe(500);
        expect(env.R2.delete).not.toHaveBeenCalled();
        if (failure === "variant lookup") {
          expect(repoMock.deleteById).not.toHaveBeenCalled();
        }
      },
    );

    it.each([sourceKey, variantKey])(
      "keeps delivery blocked and attempts all objects when R2 deletion fails for %s",
      async (failedKey) => {
        const error = new Error("R2 unavailable");
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        repoMock.deleteById.mockImplementation(async () => {
          repoMock.findById.mockResolvedValue(null);
          variantRepoMock.findById.mockResolvedValue(null);
        });
        env.R2.delete.mockImplementation(async (key: string) => {
          if (key === failedKey) throw error;
        });

        expect((await deleteMedia()).status).toBe(204);
        expect(env.R2.delete.mock.calls).toEqual([[sourceKey], [variantKey]]);
        expect(log).toHaveBeenCalledWith(
          "Failed to delete media object from R2",
          {
            mediaId: "media_1",
            key: failedKey,
            error,
          },
        );
        for (const path of [
          "/api/admin/media/media_1/file",
          "/api/admin/media-variants/variant_1/file",
        ]) {
          expect((await app.request(path, {}, env)).status).toBe(404);
        }
        expect(env.R2.get).not.toHaveBeenCalled();

        // Repeating the request cannot retry cleanup once the DB record is gone.
        expect((await deleteMedia()).status).toBe(404);
        expect(env.R2.delete).toHaveBeenCalledTimes(2);
        expect(repoMock.deleteById).toHaveBeenCalledTimes(1);
      },
    );

    it("returns 404 for a missing media without deleting objects", async () => {
      repoMock.findById.mockResolvedValue(null);
      expect((await deleteMedia()).status).toBe(404);
      expect(variantRepoMock.list).not.toHaveBeenCalled();
      expect(repoMock.deleteById).not.toHaveBeenCalled();
      expect(env.R2.delete).not.toHaveBeenCalled();
    });
  });
});
