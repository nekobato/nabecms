import { describe, it, expect } from "vitest";
import { buildVariantKey } from "./media-variants";

describe("media variants helpers", () => {
  it("builds variant key with media id and template key", () => {
    const key = buildVariantKey({
      mediaId: "media_123",
      templateKey: "Thumb 01",
      format: "webp",
    });
    expect(key).toBe("media/variants/media_123/thumb-01.webp");
  });
});
