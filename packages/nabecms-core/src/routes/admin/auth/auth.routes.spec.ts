import { describe, it, expect } from "vitest";
import app from "../../index";

describe("admin auth routes", () => {
  it("POST /api/admin/auth/login returns 400 for invalid payload", async () => {
    const res = await app.request("/api/admin/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error?.code).toBe("BAD_REQUEST");
  });

  it("GET /api/admin/auth/me returns 401 without token", async () => {
    const res = await app.request("/api/admin/auth/me");
    expect(res.status).toBe(401);
  });

  it("POST /api/admin/auth/refresh returns 401 without cookie", async () => {
    const res = await app.request("/api/admin/auth/refresh", {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });

  it("POST /api/admin/auth/logout returns 204", async () => {
    const res = await app.request("/api/admin/auth/logout", { method: "POST" });
    expect(res.status).toBe(204);
  });

  it("POST /api/admin/auth/request-password-reset rejects an invalid payload", async () => {
    const res = await app.request("/api/admin/auth/request-password-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/admin/auth/reset-password rejects an invalid payload", async () => {
    const res = await app.request("/api/admin/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
