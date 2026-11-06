import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../create-app";
import * as mediaRepository from "../../repositories/media";
import * as mediaVariantRepository from "../../repositories/media-variants";

const app = createApp();

describe("admin media variant delivery", () => {
  const env = {
    DB: {} as any,
    R2: { get: vi.fn() } as any,
    WORKER_ENV: "test" as const,
    JWT_SECRET: "test-secret",
    ASSETS: { fetch: vi.fn() },
  };
  const variant = {
    id: "variant_1",
    mediaId: "media_1",
    templateKey: "thumbnail",
    provider: "frontend",
    status: "succeeded",
    url: "media/variants/media_1/thumbnail.webp",
    width: 320,
    height: 180,
    size: 12,
    mimeType: "image/webp",
    format: "webp",
    error: null,
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
  } as const;
  const media = {
    id: "media_1",
    groupId: "group_1",
    url: "media/source.png",
    type: "image",
    mimeType: "image/png",
    name: "source.png",
    description: null,
    width: null,
    height: null,
    size: 8,
    status: "published",
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
    updatedBy: "user_1",
  } as const;

  beforeEach(() => {
    vi.restoreAllMocks();
    env.R2.get = vi.fn();
    vi.spyOn(
      mediaVariantRepository,
      "createMediaVariantRepository",
    ).mockReturnValue({ findById: vi.fn().mockResolvedValue(variant) } as any);
    vi.spyOn(mediaRepository, "createMediaRepository").mockReturnValue({
      findById: vi.fn().mockResolvedValue(media),
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("serves a published variant only through a non-cacheable nosniff response", async () => {
    env.R2.get.mockResolvedValue({
      body: new Blob(["variant"]).stream(),
      httpEtag: '"etag-1"',
      httpMetadata: {
        contentType: "text/html",
        contentDisposition: "inline",
        cacheControl: "public, max-age=31536000, immutable",
      },
    });

    const response = await app.request(
      "/api/admin/media-variants/variant_1/file",
      { method: "GET" },
      env,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/webp");
    expect(response.headers.get("Content-Disposition")).toBe(
      'inline; filename="thumbnail.webp"',
    );
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("ETag")).toBe('"etag-1"');
  });

  it("does not read an unauthenticated draft variant from R2", async () => {
    vi.spyOn(mediaRepository, "createMediaRepository").mockReturnValue({
      findById: vi.fn().mockResolvedValue({ ...media, status: "draft" }),
    } as any);

    const response = await app.request(
      "/api/admin/media-variants/variant_1/file",
      { method: "GET" },
      env,
    );

    expect(response.status).toBe(401);
    expect(env.R2.get).not.toHaveBeenCalled();
  });
});
