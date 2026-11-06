import { describe, it, expect } from "vitest";
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
    describe("GET /api/admin/models/:modelId/fields", () => {
      it("should return model fields endpoint structure", async () => {
        const res = await app.request("/api/admin/models/test-model/fields");

        expect(res.status).toBe(401);
      });
    });

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

    it.each([
      ["GET", "/api/admin/auth/providers"],
      ["POST", "/api/admin/auth/sso/google/start"],
      ["GET", "/api/admin/auth/turnstile/config"],
      ["GET", "/api/admin/settings/auth-security"],
      ["GET", "/api/admin/webhooks"],
      ["POST", "/api/admin/webhooks/webhook_1/test"],
      ["GET", "/api/admin/publication-schedules"],
      ["POST", "/api/admin/models/model_1/entries/entry_1/schedules"],
    ])("does not mount unsupported v1 route %s %s", async (method, path) => {
      const res = await app.request(path, { method });

      expect(res.status).toBe(404);
    });
  });
});
