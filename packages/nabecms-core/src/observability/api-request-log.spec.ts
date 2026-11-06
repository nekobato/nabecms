import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppContext, Env } from "../types";
import {
  createApiRequestLogMiddleware,
  extractContentsModelId,
  resolveApiRequestScope,
  resolveRouteGroup,
  setApiRequestLogContext,
} from "./api-request-log";

const testEnv = {
  WORKER_ENV: "test",
  DB: {} as any,
  ASSETS: { fetch: vi.fn() },
  R2: {
    put: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
  },
} satisfies Env;

const readLoggedPayload = (log: ReturnType<typeof vi.spyOn>) => {
  const [line] = log.mock.calls.at(-1) ?? [];
  return JSON.parse(String(line)) as Record<string, unknown>;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("api request log helpers", () => {
  it("classifies only admin and contents API paths", () => {
    expect(resolveApiRequestScope("/api/contents/models")).toBe("contents-api");
    expect(resolveApiRequestScope("/api/admin/models")).toBe("admin-api");
    expect(resolveApiRequestScope("/api/auth/get-session")).toBeNull();
    expect(resolveApiRequestScope("/admin/")).toBeNull();
  });

  it("uses matched route patterns when available", () => {
    expect(
      resolveRouteGroup(
        "get",
        "/api/contents/models/blog/entries",
        "/api/contents/models/:modelId/entries",
      ),
    ).toBe("GET /api/contents/models/:modelId/entries");
  });

  it("normalizes contents fallback paths without keeping entry IDs", () => {
    expect(
      resolveRouteGroup("GET", "/api/contents/models/blog/entries/entry_123"),
    ).toBe("GET /api/contents/models/:modelId/entries/:entryId");
  });

  it("normalizes known admin fallback path parameters", () => {
    expect(
      resolveRouteGroup("PUT", "/api/admin/models/blog/fields/field_title"),
    ).toBe("PUT /api/admin/models/:modelId/fields/:fieldId");
  });

  it("extracts contents model IDs only from model-scoped paths", () => {
    expect(extractContentsModelId("/api/contents/models/blog/entries")).toBe(
      "blog",
    );
    expect(extractContentsModelId("/api/contents/query")).toBeUndefined();
  });
});

describe("api request log middleware", () => {
  it("adds request ID headers and writes structured API request logs", async () => {
    const app = new Hono<AppContext>();
    app.use("*", createApiRequestLogMiddleware({ enabled: true }));
    app.get("/api/contents/models/:modelId/entries", (c) => {
      setApiRequestLogContext(c, {
        apiKeyId: "apiKey_1",
        modelId: c.req.param("modelId"),
      });
      return c.json({ ok: true });
    });

    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const res = await app.request(
      "/api/contents/models/blog/entries",
      {},
      testEnv,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("X-NABECMS-Request-Id")).toMatch(/^req_/);
    expect(res.headers.get("X-Request-Id")).toBe(
      res.headers.get("X-NABECMS-Request-Id"),
    );

    const payload = readLoggedPayload(log);
    expect(payload).toMatchObject({
      event: "nabecms.api_request",
      requestId: res.headers.get("X-NABECMS-Request-Id"),
      scope: "contents-api",
      routeGroup: "GET /api/contents/models/:modelId/entries",
      status: 200,
      modelId: "blog",
      apiKeyId: "apiKey_1",
    });
    expect(typeof payload.durationMs).toBe("number");
  });

  it("does not log non API paths", async () => {
    const app = new Hono<AppContext>();
    app.use("*", createApiRequestLogMiddleware({ enabled: true }));
    app.get("/robots.txt", (c) => c.text("ok"));

    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await app.request("/robots.txt", {}, testEnv);

    expect(log).not.toHaveBeenCalled();
  });

  it("keeps structured logs disabled by default in test runtime", async () => {
    const app = new Hono<AppContext>();
    app.use("*", createApiRequestLogMiddleware());
    app.get("/api/admin/dashboard", (c) => c.json({ ok: true }));

    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await app.request("/api/admin/dashboard", {}, testEnv);

    expect(log).not.toHaveBeenCalled();
  });

  it("keeps API requests safe when bindings are omitted", async () => {
    const app = new Hono<AppContext>();
    app.use("*", createApiRequestLogMiddleware());
    app.get("/api/admin/dashboard", (c) => c.json({ ok: true }));

    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const res = await app.request("/api/admin/dashboard");

    expect(res.status).toBe(200);
    expect(res.headers.get("X-NABECMS-Request-Id")).toMatch(/^req_/);
    expect(log).not.toHaveBeenCalled();
  });
});
