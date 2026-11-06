import { describe, it, expect } from "vitest";
import { createMediaUrlResolver } from "./media-url";

describe("createMediaUrlResolver", () => {
  it("always resolves original media through the Worker endpoint", () => {
    const resolver = createMediaUrlResolver({
      fallbackPath: ({ id }) => `/api/admin/media/${id}/file`,
    });

    const url = resolver({ key: "media/file", id: "media_3" });
    expect(url).toBe("/api/admin/media/media_3/file");
  });

  it("supports a Worker endpoint for generated variants", () => {
    const resolver = createMediaUrlResolver({
      fallbackPath: ({ id }) => `/api/admin/media-variants/${id}/file`,
    });

    const url = resolver({ key: "media/variants/file", id: "variant_1" });
    expect(url).toBe("/api/admin/media-variants/variant_1/file");
  });

  it("uses the original media Worker endpoint by default", () => {
    const resolver = createMediaUrlResolver();

    const url = resolver({ key: "media/file", id: "media_4" });
    expect(url).toBe("/api/admin/media/media_4/file");
  });
});
