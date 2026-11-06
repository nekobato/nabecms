import { describe, it, expect, beforeEach, vi } from "vitest";
import { createApp } from "../../create-app";
import * as contentsService from "../../services/contents-delivery";

type Env = {
  DB: any;
  WORKER_ENV: "test";
  ASSETS: { fetch: () => Promise<Response> };
};

const app = createApp();

vi.mock("../../services/contents-delivery", async () => {
  const actual = await vi.importActual<
    typeof import("../../services/contents-delivery")
  >("../../services/contents-delivery");
  return {
    ...actual,
    authorizeApiKey: vi.fn(),
    listContentModels: vi.fn(),
    getContentModel: vi.fn(),
    listContentEntries: vi.fn(),
    getContentEntry: vi.fn(),
  };
});

describe("contents delivery routes", () => {
  const env: Env = {
    DB: {} as any,
    WORKER_ENV: "test",
    ASSETS: { fetch: vi.fn() },
  };

  const authorizeApiKeyMock = vi.mocked(contentsService.authorizeApiKey);
  const listModelsMock = vi.mocked(contentsService.listContentModels);
  const getModelMock = vi.mocked(contentsService.getContentModel);
  const listEntriesMock = vi.mocked(contentsService.listContentEntries);
  const getEntryMock = vi.mocked(contentsService.getContentEntry);

  beforeEach(() => {
    vi.restoreAllMocks();
    authorizeApiKeyMock.mockReset();
    listModelsMock.mockReset();
    getModelMock.mockReset();
    listEntriesMock.mockReset();
    getEntryMock.mockReset();
  });

  it("health endpoint responds without auth and verifies db access", async () => {
    env.DB = {
      prepare: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue({ ok: 1 }),
      }),
    } as any;

    const res = await app.request(
      "/api/contents/health",
      { method: "GET" },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.service).toBe("contents-api");
    expect(body.checks).toMatchObject({
      runtime: { ok: true },
      api: { ok: true },
      db: { ok: true },
    });
    expect(typeof body.checks.db.latencyMs).toBe("number");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("health endpoint returns 503 when db is unavailable", async () => {
    env.DB = {
      prepare: vi.fn().mockImplementation(() => {
        throw new Error("DB unavailable");
      }),
    } as any;

    const res = await app.request(
      "/api/contents/health",
      { method: "GET" },
      env,
    );

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe("error");
    expect(body.service).toBe("contents-api");
    expect(body.checks.runtime).toMatchObject({ ok: true });
    expect(body.checks.api).toMatchObject({ ok: true });
    expect(body.checks.db).toMatchObject({
      ok: false,
      code: "DB_UNAVAILABLE",
    });
  });

  it("requires bearer token for protected endpoints", async () => {
    const res = await app.request(
      "/api/contents/models",
      { method: "GET" },
      env,
    );
    expect(res.status).toBe(401);
  });

  it("lists models when authorized", async () => {
    authorizeApiKeyMock.mockResolvedValue({
      apiKey: { id: "key_1", permissions: ["contents:read"] },
      canPreview: false,
    } as any);

    listModelsMock.mockResolvedValue({
      items: [
        {
          id: "blog",
          name: "Blog",
          description: "",
          isPrivate: false,
          createdAt: "2025-01-01T00:00:00Z",
          updatedAt: "2025-01-02T00:00:00Z",
          fields: [],
        },
      ],
    });

    const res = await app.request(
      "/api/contents/models",
      {
        method: "GET",
        headers: { Authorization: "Bearer secret" },
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(listModelsMock).toHaveBeenCalled();
    const body = await res.json();
    expect(body.items).toHaveLength(1);
  });

  it("rejects draft access without preview permission", async () => {
    authorizeApiKeyMock.mockResolvedValue({
      apiKey: { id: "key_1", permissions: ["contents:read"] },
      canPreview: false,
    } as any);

    const res = await app.request(
      "/api/contents/models/blog/entries?draft=true",
      {
        method: "GET",
        headers: { Authorization: "Bearer secret" },
      },
      env,
    );

    expect(res.status).toBe(403);
  });

  it("returns entries when authorized with preview", async () => {
    authorizeApiKeyMock.mockResolvedValue({
      apiKey: {
        id: "key_1",
        permissions: ["contents:read", "contents:preview"],
      },
      canPreview: true,
      canRead: true,
    } as any);

    listEntriesMock.mockResolvedValue({
      items: [
        {
          id: "entry_pub",
          modelId: "blog",
          status: "published",
          locale: "en-US",
          createdAt: "2025-03-01T00:00:00Z",
          updatedAt: "2025-03-02T00:00:00Z",
          publishedAt: "2025-03-01T02:10:00Z",
          fields: { title: "Cafe" },
        },
      ],
      page: 1,
      limit: 10,
      total: 1,
      included: { entries: [], assets: [] },
      errors: [],
      lastUpdatedAt: "2025-03-02T00:00:00Z",
    } as any);

    const res = await app.request(
      "/api/contents/models/blog/entries?draft=true",
      {
        method: "GET",
        headers: { Authorization: "Bearer secret" },
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(listEntriesMock).toHaveBeenCalledWith(
      expect.any(Object),
      {
        modelId: "blog",
        includeDraft: true,
        includeMedia: true,
        includeRelations: true,
        page: 1,
        limit: 20,
        locales: undefined,
        fields: undefined,
        includeAssets: true,
        sort: ["-publishedAt"],
        since: null,
        filters: undefined,
      },
      null,
    );
    const body = await res.json();
    expect(body.included).toEqual({ entries: [], assets: [] });
    expect(body.assets).toBeUndefined();
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("ETag")).toMatch(/^W\/"[a-f0-9]{64}"$/u);
  });

  it("returns 404 when entry not found", async () => {
    authorizeApiKeyMock.mockResolvedValue({
      apiKey: { id: "key_1", permissions: ["contents:read"] },
      canPreview: false,
    } as any);
    getEntryMock.mockResolvedValue(null);

    const res = await app.request(
      "/api/contents/models/blog/entries/missing",
      {
        method: "GET",
        headers: { Authorization: "Bearer secret" },
      },
      env,
    );

    expect(res.status).toBe(404);
  });

  it("returns model detail when authorized", async () => {
    authorizeApiKeyMock.mockResolvedValue({
      apiKey: { id: "key_1", permissions: ["contents:read"] },
      canPreview: false,
      canRead: true,
      allowedModels: ["blog"],
    } as any);

    getModelMock.mockResolvedValue({
      id: "blog",
      name: "Blog",
      description: "",
      isPrivate: false,
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-02-01T00:00:00Z",
      fields: [],
    } as any);

    const res = await app.request(
      "/api/contents/models/blog",
      {
        method: "GET",
        headers: { Authorization: "Bearer secret" },
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(getModelMock).toHaveBeenCalledWith(expect.any(Object), "blog", [
      "blog",
    ]);
    const body = await res.json();
    expect(body.item.id).toBe("blog");
  });

  it("returns 404 when model is missing", async () => {
    authorizeApiKeyMock.mockResolvedValue({
      apiKey: { id: "key_1", permissions: ["contents:read"] },
      canPreview: false,
    } as any);
    getModelMock.mockResolvedValue(null);

    const res = await app.request(
      "/api/contents/models/missing",
      {
        method: "GET",
        headers: { Authorization: "Bearer secret" },
      },
      env,
    );

    expect(res.status).toBe(404);
  });

  it("passes query params to entries list and respects include=0", async () => {
    authorizeApiKeyMock.mockResolvedValue({
      apiKey: {
        id: "key_1",
        permissions: ["contents:read", "contents:preview"],
      },
      canPreview: true,
      canRead: true,
      allowedModels: ["blog"],
    } as any);

    listEntriesMock.mockResolvedValue({
      items: [],
      page: 2,
      limit: 5,
      total: 0,
      included: { entries: [], assets: [] },
      errors: [],
      lastUpdatedAt: null,
    } as any);

    const res = await app.request(
      "/api/contents/models/blog/entries?locale=ja-JP,en-US&fields=title,hero&include=0&sort=publishedAt&page=2&limit=5&since=2025-01-01T00:00:00Z",
      {
        method: "GET",
        headers: { Authorization: "Bearer secret" },
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(listEntriesMock).toHaveBeenCalledWith(
      expect.any(Object),
      {
        modelId: "blog",
        locales: ["ja-JP", "en-US"],
        fields: ["title", "hero"],
        includeDraft: false,
        includeMedia: false,
        includeRelations: false,
        includeAssets: false,
        page: 2,
        limit: 5,
        sort: ["publishedAt"],
        since: "2025-01-01T00:00:00Z",
        filters: undefined,
      },
      ["blog"],
    );
    const body = await res.json();
    expect(body.included).toEqual({ entries: [], assets: [] });
    expect(body.assets).toBeUndefined();
  });

  it("parses Strapi-style filters from the query string", async () => {
    authorizeApiKeyMock.mockResolvedValue({
      apiKey: {
        id: "key_1",
        permissions: ["contents:read", "contents:preview"],
      },
      canPreview: true,
      canRead: true,
      allowedModels: ["blog"],
    } as any);

    listEntriesMock.mockResolvedValue({
      items: [],
      page: 1,
      limit: 20,
      total: 0,
      included: { entries: [], assets: [] },
      errors: [],
      lastUpdatedAt: null,
    } as any);

    const res = await app.request(
      "/api/contents/models/blog/entries?filters[slug][$eq]=cafe-guide&filters[$or][0][title][$contains]=Cafe&filters[$or][1][title][$contains]=Coffee",
      {
        method: "GET",
        headers: { Authorization: "Bearer secret" },
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(listEntriesMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        filters: {
          slug: { $eq: "cafe-guide" },
          $or: [
            { title: { $contains: "Cafe" } },
            { title: { $contains: "Coffee" } },
          ],
        },
      }),
      ["blog"],
    );
  });

  it("requires preview permission for query endpoint when draft=true", async () => {
    authorizeApiKeyMock.mockResolvedValue({
      apiKey: { id: "key_1", permissions: ["contents:read"] },
      canPreview: false,
      canRead: true,
    } as any);

    const res = await app.request(
      "/api/contents/query?draft=true",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ modelId: "blog" }),
      },
      env,
    );

    expect(res.status).toBe(403);
    expect(listEntriesMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "request body only",
      path: "/api/contents/query",
    },
    {
      name: "request body and query string",
      path: "/api/contents/query?draft=true",
    },
  ])(
    "requires preview permission when draft is set in the $name",
    async ({ path }) => {
      authorizeApiKeyMock.mockResolvedValue({
        apiKey: { id: "key_1", permissions: ["contents:read"] },
        canPreview: false,
        canRead: true,
      } as any);
      listEntriesMock.mockResolvedValue({
        items: [],
        page: 1,
        limit: 20,
        total: 0,
        included: { entries: [], assets: [] },
        errors: [],
        lastUpdatedAt: null,
      } as any);

      const res = await app.request(
        path,
        {
          method: "POST",
          headers: {
            Authorization: "Bearer secret",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ modelId: "blog", draft: true }),
        },
        env,
      );

      expect(res.status).toBe(403);
      expect(listEntriesMock).not.toHaveBeenCalled();
    },
  );

  it("queries entries with payload options", async () => {
    authorizeApiKeyMock.mockResolvedValue({
      apiKey: {
        id: "key_1",
        permissions: ["contents:read", "contents:preview"],
      },
      canPreview: true,
      canRead: true,
      allowedModels: ["blog"],
    } as any);

    listEntriesMock.mockResolvedValue({
      items: [],
      page: 3,
      limit: 50,
      total: 0,
      included: { entries: [], assets: [] },
      errors: [],
      lastUpdatedAt: "2025-02-01T00:00:00Z",
    } as any);

    const res = await app.request(
      "/api/contents/query",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          modelId: "blog",
          draft: true,
          locales: ["ja-JP"],
          fields: ["title"],
          includeMedia: false,
          includeRelations: true,
          includeAssets: false,
          sort: ["-updatedAt"],
          page: 3,
          limit: 50,
          since: "2025-01-10T00:00:00Z",
        }),
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(listEntriesMock).toHaveBeenCalledWith(
      expect.any(Object),
      {
        modelId: "blog",
        locales: ["ja-JP"],
        fields: ["title"],
        includeDraft: true,
        includeMedia: false,
        includeRelations: true,
        includeAssets: false,
        sort: ["-updatedAt"],
        page: 3,
        limit: 50,
        since: "2025-01-10T00:00:00Z",
        filters: undefined,
      },
      ["blog"],
    );
  });

  it("isolates API-key-dependent responses from shared caches and preserves ETags", async () => {
    authorizeApiKeyMock.mockImplementation(
      async (_deps, token) =>
        ({
          apiKey: { id: `key_${token}`, permissions: ["contents:read"] },
          canPreview: false,
          canRead: true,
          allowedModels: token === "secret-blog" ? ["blog"] : ["docs"],
        }) as any,
    );
    listModelsMock.mockImplementation(async (_deps, allowedModels) => ({
      items: [
        {
          id: allowedModels?.[0] ?? "unknown",
          name: allowedModels?.[0] ?? "unknown",
          description: "",
          isPrivate: false,
          createdAt: "2025-01-01T00:00:00Z",
          updatedAt: "2025-01-02T00:00:00Z",
          fields: [],
        },
      ],
    }));

    const blogResponse = await app.request(
      "/api/contents/models",
      {
        method: "GET",
        headers: { Authorization: "Bearer secret-blog" },
      },
      env,
    );
    const docsResponse = await app.request(
      "/api/contents/models",
      {
        method: "GET",
        headers: { Authorization: "Bearer secret-docs" },
      },
      env,
    );
    const unauthorizedResponse = await app.request(
      "/api/contents/models",
      { method: "GET" },
      env,
    );

    expect(blogResponse.status).toBe(200);
    expect(docsResponse.status).toBe(200);
    expect(unauthorizedResponse.status).toBe(401);
    await expect(blogResponse.clone().json()).resolves.toMatchObject({
      items: [{ id: "blog" }],
    });
    await expect(docsResponse.clone().json()).resolves.toMatchObject({
      items: [{ id: "docs" }],
    });
    for (const response of [blogResponse, docsResponse, unauthorizedResponse]) {
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    }
    expect(blogResponse.headers.get("ETag")).toMatch(/^W\/"[a-f0-9]{64}"$/u);
    expect(docsResponse.headers.get("ETag")).toMatch(/^W\/"[a-f0-9]{64}"$/u);
    expect(blogResponse.headers.get("ETag")).not.toBe(
      docsResponse.headers.get("ETag"),
    );
  });

  it("returns 422 when filters are invalid", async () => {
    authorizeApiKeyMock.mockResolvedValue({
      apiKey: {
        id: "key_1",
        permissions: ["contents:read", "contents:preview"],
      },
      canPreview: true,
      canRead: true,
      allowedModels: ["blog"],
    } as any);

    listEntriesMock.mockRejectedValue(
      new contentsService.InvalidFilterError([
        {
          path: ["filters", "author"],
          message: "Field type 'relation' is not supported in filters",
        },
      ]),
    );

    const res = await app.request(
      "/api/contents/models/blog/entries?filters[author][$eq]=author_1",
      {
        method: "GET",
        headers: { Authorization: "Bearer secret" },
      },
      env,
    );

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.issues).toEqual([
      {
        path: ["filters", "author"],
        message: "Field type 'relation' is not supported in filters",
      },
    ]);
  });

  it("rejects query payload without modelId", async () => {
    authorizeApiKeyMock.mockResolvedValue({
      apiKey: {
        id: "key_1",
        permissions: ["contents:read", "contents:preview"],
      },
      canPreview: true,
      canRead: true,
    } as any);

    const res = await app.request(
      "/api/contents/query",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      },
      env,
    );

    expect(res.status).toBe(422);
  });
});
