import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./create-app";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("createApp v1 admin route", () => {
  it("rejects the hidden plugins config even when the list is empty", () => {
    expect(() =>
      createApp({
        config: { plugins: [] } as never,
      }),
    ).toThrow(/plugins/u);
  });

  it("serves Admin assets only from the fixed /admin path", async () => {
    const assetsFetch = vi.fn(async (request: Request) => {
      const pathname = new URL(request.url).pathname;
      if (pathname === "/assets/admin.js") {
        return new Response("asset", { status: 200 });
      }
      return new Response("missing", { status: 404 });
    });
    const env = {
      DB: {} as never,
      WORKER_ENV: "production" as const,
      ASSETS: { fetch: assetsFetch },
    } as never;
    const app = createApp();

    const redirect = await app.request("/admin", {}, env);
    expect(redirect.status).toBe(301);
    expect(redirect.headers.get("location")).toBe("/admin/");

    const asset = await app.request("/admin/assets/admin.js", {}, env);
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe("asset");
    expect(
      new URL(assetsFetch.mock.calls[0]?.[0].url ?? "http://localhost")
        .pathname,
    ).toBe("/assets/admin.js");

    assetsFetch.mockClear();
    const unsupportedBase = await app.request("/cms/assets/admin.js", {}, env);
    expect(unsupportedBase.status).toBe(404);
    expect(assetsFetch).not.toHaveBeenCalled();
  });

  it("uses the Admin index asset as the /admin SPA fallback", async () => {
    const assetsFetch = vi.fn(async (request: Request) => {
      const pathname = new URL(request.url).pathname;
      return pathname === "/index.html"
        ? new Response("admin-index", { status: 200 })
        : new Response("missing", { status: 404 });
    });
    const env = {
      DB: {} as never,
      WORKER_ENV: "production" as const,
      ASSETS: { fetch: assetsFetch },
    } as never;
    const app = createApp();

    const response = await app.request("/admin/settings/users", {}, env);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("admin-index");
    expect(
      assetsFetch.mock.calls.map(([request]) => new URL(request.url).pathname),
    ).toEqual(["/settings/users", "/index.html"]);
  });

  it("uses every admin.devServer option for the development proxy", async () => {
    const proxyFetch = vi
      .fn<(request: Request) => Promise<Response>>()
      .mockResolvedValue(new Response("proxied"));
    vi.stubGlobal("fetch", proxyFetch);
    const assetsFetch = vi.fn(async () => new Response("asset"));
    const app = createApp({
      config: {
        admin: {
          devServer: {
            enabled: true,
            host: "admin-dev.internal",
            port: 4321,
          },
        },
      },
    });

    const response = await app.request("/admin/models?locale=ja", {}, {
      DB: {} as never,
      WORKER_ENV: "development",
      ASSETS: { fetch: assetsFetch },
    } as never);

    expect(await response.text()).toBe("proxied");
    expect(proxyFetch).toHaveBeenCalledOnce();
    expect(proxyFetch.mock.calls[0]?.[0].url).toBe(
      "http://admin-dev.internal:4321/admin/models?locale=ja",
    );
    expect(assetsFetch).not.toHaveBeenCalled();
  });

  it("honors admin.devServer.enabled=false in development", async () => {
    const proxyFetch = vi
      .fn<(request: Request) => Promise<Response>>()
      .mockResolvedValue(new Response("proxied"));
    vi.stubGlobal("fetch", proxyFetch);
    const assetsFetch = vi.fn(async () => new Response("asset"));
    const app = createApp({
      config: {
        admin: {
          devServer: {
            enabled: false,
          },
        },
      },
    });

    const response = await app.request("/admin/index.html", {}, {
      DB: {} as never,
      WORKER_ENV: "development",
      ASSETS: { fetch: assetsFetch },
    } as never);

    expect(await response.text()).toBe("asset");
    expect(assetsFetch).toHaveBeenCalledOnce();
    expect(proxyFetch).not.toHaveBeenCalled();
  });
});

describe("createApp v1 observability config", () => {
  it("enables structured API logs explicitly in test runtime", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const app = createApp({
      config: {
        observability: {
          structuredLogs: {
            enabled: true,
          },
        },
      },
    });

    await app.request("/api/contents/unknown", {}, {
      WORKER_ENV: "test",
    } as never);

    expect(log).toHaveBeenCalledOnce();
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      event: "nabecms.api_request",
      scope: "contents-api",
    });
  });

  it("disables structured API logs explicitly in production", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const app = createApp({
      config: {
        observability: {
          structuredLogs: {
            enabled: false,
          },
        },
      },
    });

    await app.request("/api/contents/unknown", {}, {
      WORKER_ENV: "production",
    } as never);

    expect(log).not.toHaveBeenCalled();
  });
});
