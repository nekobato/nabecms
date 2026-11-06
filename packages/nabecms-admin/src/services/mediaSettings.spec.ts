import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthStore } from "@/utils/http";
import { fetchMediaSettings, updateMediaSettings } from "./mediaSettings";

const authorizedFetchMock = vi.fn();

vi.mock("@/utils/http", () => ({
  authorizedFetch: (...args: unknown[]) => authorizedFetchMock(...args),
}));

const authStore = {
  accessToken: "token",
  refresh: vi.fn(),
} as unknown as AuthStore;

describe("mediaSettings service", () => {
  beforeEach(() => {
    authorizedFetchMock.mockReset();
  });

  it("falls back to frontend mode when Cloudflare transforms are unavailable", async () => {
    authorizedFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        item: {
          transformMode: "cloudflare",
          templates: [{ key: "thumb", width: 320 }],
          cloudflare: { enabled: false },
        },
      }),
    });

    const result = await fetchMediaSettings(authStore);

    expect(result).toMatchObject({
      transformMode: "frontend",
      cloudflare: { enabled: false },
    });
  });

  it("sends a frontend payload when Cloudflare transforms are unavailable", async () => {
    authorizedFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        item: {
          transformMode: "cloudflare",
          templates: [],
          cloudflare: { enabled: false },
        },
      }),
      text: async () => "",
    });

    await updateMediaSettings(authStore, {
      transformMode: "cloudflare",
      templates: [],
      cloudflare: { enabled: false },
    });

    expect(authorizedFetchMock).toHaveBeenCalledWith(
      authStore,
      "/api/admin/settings/media",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          transformMode: "frontend",
          templates: [],
          cloudflare: { enabled: false },
        }),
      }),
    );
  });
});
