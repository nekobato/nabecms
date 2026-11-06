import { describe, it, expect } from "vitest";
import { buildVariantKey, sanitizeTemplateKey } from "./media-variants";

describe("media variants helpers", () => {
  it("sanitizes template keys", () => {
    expect(sanitizeTemplateKey("Thumb 01")).toBe("thumb-01");
  });

  it("builds variant key with media id and template key", () => {
    const key = buildVariantKey({
      mediaId: "media_123",
      templateKey: "Thumb 01",
      format: "webp",
    });
    expect(key).toBe("media/variants/media_123/thumb-01.webp");
  });
});
