import { beforeEach, describe, expect, it, vi } from "vitest";
import { authorizedFetch, setUnauthorizedHandler, type AuthStore } from "./http";

const createAuthStore = (overrides: Partial<AuthStore> = {}): AuthStore =>
  ({
    accessToken: "access-token",
    refresh: vi.fn().mockResolvedValue(false),
    ...overrides,
  }) as AuthStore;

describe("authorizedFetch idempotency", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setUnauthorizedHandler(null);
  });

  it("adds an idempotency key to mutation requests", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));

    await authorizedFetch(createAuthStore(), "/api/admin/example", {
      method: "POST",
    });

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("Idempotency-Key")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("reuses the same key when retrying after token refresh", async () => {
    const seenKeys: Array<string | null> = [];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      seenKeys.push(new Headers(init?.headers).get("Idempotency-Key"));
      return new Response(null, {
        status: seenKeys.length === 1 ? 401 : 200,
      });
    });
    const authStore = createAuthStore({
      refresh: vi.fn().mockResolvedValue(true),
    });

    await authorizedFetch(authStore, "/api/admin/example", {
      method: "PUT",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(seenKeys[0]).toBeTruthy();
    expect(seenKeys[1]).toBe(seenKeys[0]);
  });

  it("preserves an explicitly supplied key", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));

    await authorizedFetch(createAuthStore(), "/api/admin/example", {
      method: "DELETE",
      headers: { "Idempotency-Key": "operation-key-123" },
    });

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("Idempotency-Key")).toBe("operation-key-123");
  });

  it("does not add a key to safe requests", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));

    await authorizedFetch(createAuthStore(), "/api/admin/example");

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.has("Idempotency-Key")).toBe(false);
  });
});
