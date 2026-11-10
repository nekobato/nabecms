import { describe, it, expect, vi } from "vitest";
import { createApp } from "../create-app";

const app = createApp();

describe("API Server", () => {
  describe("GET /", () => {
    it("should return Hello Hono!", async () => {
      const res = await app.request("/");

      expect(res.status).toBe(200);
      expect(await res.text()).toBe("Hello Hono!");
    });
  });

  describe("ModelFields API", () => {
    describe("POST /api/admin/models/:modelId/fields", () => {
      it("should have create field endpoint", async () => {
        const res = await app.request("/api/admin/models/test-model/fields", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: "test-field",
            fieldKey: "test_field",
            type: "text",
            position: 1,
            required: false,
            hasLocales: false,
            isDisplayTitle: true,
          }),
        });

        expect(res.status).toBe(401);
      });
    });

    describe("PUT /api/admin/models/:modelId/fields/:fieldId", () => {
      it("should have update field endpoint", async () => {
        const res = await app.request(
          "/api/admin/models/test-model/fields/test-field",
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              name: "updated-field",
              fieldKey: "updated_field",
              type: "text",
              position: 1,
              required: false,
              hasLocales: false,
              isDisplayTitle: false,
            }),
          },
        );

        expect(res.status).toBe(401);
      });
    });

    describe("DELETE /api/admin/models/:modelId/fields/:fieldId", () => {
      it("should have delete field endpoint", async () => {
        const res = await app.request(
          "/api/admin/models/test-model/fields/test-field",
          {
            method: "DELETE",
          },
        );

        expect(res.status).toBe(401);
      });
    });
  });

  describe("Entries API", () => {
    describe("GET /api/admin/models/:modelId/entries", () => {
      it("should have entries list endpoint with display title support", async () => {
        const res = await app.request("/api/admin/models/test-model/entries");

        expect(res.status).toBe(401);
      });
    });
  });

  describe("404 handling", () => {
    it("should return 404 for unknown routes", async () => {
      const res = await app.request("/unknown-route");

      expect(res.status).toBe(404);
    });

    const testEnv = {
      DB: {},
      WORKER_ENV: "test" as const,
      ASSETS: { fetch: vi.fn() },
    };
    const ssoDisabledEnv = {
      ...testEnv,
      AUTH_SSO_ENABLED: undefined,
      AUTH_GOOGLE_ENABLED: undefined,
      BETTER_AUTH_SECRET: undefined,
      BETTER_AUTH_URL: undefined,
      GOOGLE_CLIENT_ID: undefined,
      GOOGLE_CLIENT_SECRET: undefined,
    };
    const publicationSchedulesEnv = { ...testEnv, JWT_SECRET: "secret" };

    it.each([
      ["GET", "/api/admin/auth/providers", [undefined, ssoDisabledEnv]],
      ["POST", "/api/admin/auth/sso/google/start", [undefined, ssoDisabledEnv]],
      ["GET", "/api/admin/auth/sso/google/callback", [ssoDisabledEnv]],
      ["GET", "/api/admin/auth/turnstile/config", [undefined]],
      ["GET", "/api/admin/settings/auth-security", [undefined]],
      ["GET", "/api/admin/webhooks", [undefined]],
      ["POST", "/api/admin/webhooks/webhook_1/test", [undefined]],
      [
        "GET",
        "/api/admin/publication-schedules",
        [undefined, publicationSchedulesEnv],
      ],
      [
        "POST",
        "/api/admin/publication-schedules/run-due",
        [publicationSchedulesEnv],
      ],
      [
        "POST",
        "/api/admin/models/model_1/entries/entry_1/schedules",
        [undefined, publicationSchedulesEnv],
      ],
    ] as const)(
      "does not mount unsupported v1 route %s %s",
      async (method, path, environments) => {
        for (const env of environments) {
          const res = await app.request(path, { method }, env);
          expect(
            res.status,
            env ? "with test bindings" : "without bindings",
          ).toBe(404);
        }
      },
    );
  });
});
