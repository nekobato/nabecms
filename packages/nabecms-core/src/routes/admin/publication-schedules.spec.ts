import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../create-app";

const env = {
  DB: {} as any,
  WORKER_ENV: "test" as const,
  JWT_SECRET: "secret",
  ASSETS: { fetch: vi.fn() },
};

const app = createApp();

describe("admin publication schedules routes", () => {
  it("rejects the removed scheduled publishing config", () => {
    expect(() =>
      createApp({
        config: {
          publishing: { scheduled: { enabled: true } },
        } as never,
      }),
    ).toThrow();
  });

  it.each([
    ["GET", "/api/admin/publication-schedules"],
    ["POST", "/api/admin/publication-schedules/run-due"],
    ["POST", "/api/admin/models/model_1/entries/entry_1/schedules"],
  ])("keeps %s %s outside the v1 route surface", async (method, path) => {
    const res = await app.request(path, { method }, env);

    expect(res.status).toBe(404);
  });
});
