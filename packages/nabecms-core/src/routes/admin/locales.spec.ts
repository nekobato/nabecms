import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createApp } from "../../create-app";
import * as authLib from "../../lib/auth";
import * as localesService from "../../services/locales";
import * as localeRepository from "../../repositories/locales";

const app = createApp();

const env = {
  DB: {} as any,
  WORKER_ENV: "test" as const,
  JWT_SECRET: "test-secret",
  ASSETS: { fetch: vi.fn() },
};

describe("admin locales routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(authLib, "verifyAccessToken").mockResolvedValue({
      sub: "user_1",
      sid: "sess_test",
      roles: ["system.super-admin"],
    } as any);
    vi.spyOn(localeRepository, "createLocaleRepository").mockReturnValue(
      {} as any,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("GET /api/admin/locales returns list", async () => {
    vi.spyOn(localesService, "listLocales").mockResolvedValue([
      {
        code: "en-US",
        isDefault: true,
        createdAt: "2025-09-01T00:00:00.000Z",
        updatedAt: "2025-09-01T00:00:00.000Z",
      },
    ]);

    const res = await app.request(
      "/api/admin/locales",
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
          code: "en-US",
          isDefault: true,
          createdAt: "2025-09-01T00:00:00.000Z",
          updatedAt: "2025-09-01T00:00:00.000Z",
        },
      ],
    });
  });

  it("POST /api/admin/locales creates locale", async () => {
    const createMock = vi
      .spyOn(localesService, "createLocale")
      .mockResolvedValue({
        code: "de",
        isDefault: false,
        createdAt: "2025-09-30T00:00:00.000Z",
        updatedAt: "2025-09-30T00:00:00.000Z",
      });

    const res = await app.request(
      "/api/admin/locales",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ code: "de" }),
      },
      env,
    );

    expect(res.status).toBe(201);
    expect(createMock).toHaveBeenCalledOnce();
  });

  it("POST /api/admin/locales handles conflict", async () => {
    vi.spyOn(localesService, "createLocale").mockRejectedValue(
      new localesService.LocaleAlreadyExistsError("de"),
    );

    const res = await app.request(
      "/api/admin/locales",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ code: "de" }),
      },
      env,
    );

    expect(res.status).toBe(409);
  });

  it("PATCH /api/admin/locales/:code sets default", async () => {
    const setDefaultMock = vi
      .spyOn(localesService, "setDefaultLocale")
      .mockResolvedValue({
        code: "de",
        isDefault: true,
        createdAt: "2025-09-30T00:00:00.000Z",
        updatedAt: "2025-09-30T00:00:01.000Z",
      });

    const res = await app.request(
      "/api/admin/locales/de",
      {
        method: "PATCH",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ isDefault: true }),
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(setDefaultMock).toHaveBeenCalledWith(expect.anything(), "de");
  });

  it("DELETE /api/admin/locales/:code removes locale", async () => {
    const deleteMock = vi
      .spyOn(localesService, "deleteLocale")
      .mockResolvedValue();

    const res = await app.request(
      "/api/admin/locales/de",
      {
        method: "DELETE",
        headers: { Authorization: "Bearer token" },
      },
      env,
    );

    expect(res.status).toBe(204);
    expect(deleteMock).toHaveBeenCalledWith(expect.anything(), "de");
  });
});
