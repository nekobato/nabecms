import { describe, it, expect, vi } from "vitest";
import { listMediaFiles, uploadMediaFiles } from "./media";
import type { MediaRecord } from "../repositories/media";

const createTestFile = (name: string, type: string, bytes: Uint8Array) => {
  const copyBuffer = (): ArrayBuffer => {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer;
  };
  return {
    name,
    type,
    size: bytes.byteLength,
    stream: () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
    arrayBuffer: async () => copyBuffer(),
  };
};

describe("uploadMediaFiles", () => {
  it("stores one validated R2 object and its media row", async () => {
    const bucket = { put: vi.fn().mockResolvedValue(undefined) } as any;
    const inserted: any[] = [];
    const repo = {
      insert: vi.fn(async (record: any) => {
        inserted.push(record);
      }),
      list: vi.fn(async () => []),
      findById: vi.fn(async () => null),
      updateById: vi.fn(async () => {}),
      deleteById: vi.fn(async () => {}),
    };

    let mediaCounter = 1;
    const idGen = vi
      .fn<(prefix: "media" | "mediagroup") => string>()
      .mockImplementation((prefix) => {
        if (prefix === "mediagroup") return "group_001";
        const id = `media_${String(mediaCounter).padStart(3, "0")}`;
        mediaCounter += 1;
        return id;
      });

    const now = new Date("2025-09-22T12:34:56.000Z");
    const publicUrl = ({ key }: { key: string; id: string }) =>
      `https://cdn.example/${key}`;

    const files = [
      createTestFile(
        "photo.png",
        "image/png",
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ];

    const result = await uploadMediaFiles(
      {
        repo,
        bucket,
        generateId: idGen,
        now: () => now,
        createPublicUrl: publicUrl,
      },
      {
        files,
        actorId: "user_123",
      },
    );

    expect(bucket.put).toHaveBeenCalledTimes(1);
    expect(repo.insert).toHaveBeenCalledTimes(1);

    expect(result.items).toHaveLength(1);
    const [first] = result.items;
    expect(first.groupId).toBe("group_001");
    expect(first.url).toBe(
      "https://cdn.example/media/2025/09/22/group_001/photo.png",
    );
    expect(first.type).toBe("image");
    expect(first.mimeType).toBe("image/png");
    expect(first.size).toBe(8);
    expect(first.updatedBy).toBe("user_123");
    expect(inserted[0]).toMatchObject({
      id: "media_001",
      groupId: "group_001",
      status: "published",
      updatedBy: "user_123",
    });
    expect(bucket.put).toHaveBeenCalledWith(
      expect.stringContaining("/photo.png"),
      expect.any(ArrayBuffer),
      expect.objectContaining({
        httpMetadata: expect.objectContaining({
          contentType: "image/png",
          contentDisposition: 'inline; filename="photo.png"',
          cacheControl: "private, no-store",
        }),
      }),
    );
  });

  it("rejects multiple source files before writing to R2", async () => {
    const bucket = { put: vi.fn().mockResolvedValue(undefined) } as any;
    const repo = { insert: vi.fn() };
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);

    await expect(
      uploadMediaFiles(
        {
          repo: repo as any,
          bucket,
          generateId: (prefix) => prefix,
          now: () => new Date("2025-09-22T00:00:00.000Z"),
          createPublicUrl: ({ key }) => key,
        },
        {
          files: [
            createTestFile("one.png", "image/png", png),
            createTestFile("two.png", "image/png", png),
          ],
          actorId: "user_1",
        },
      ),
    ).rejects.toMatchObject({ code: "INVALID_FILE_COUNT", status: 400 });
    expect(bucket.put).not.toHaveBeenCalled();
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it("uploads media without requiring content locales", async () => {
    const bucket = { put: vi.fn().mockResolvedValue(undefined) } as any;
    const repo = {
      insert: vi.fn(async () => {}),
      list: vi.fn(async () => []),
      findById: vi.fn(async () => null),
      updateById: vi.fn(async () => {}),
      deleteById: vi.fn(async () => {}),
    };

    const result = await uploadMediaFiles(
      {
        repo,
        bucket,
        generateId: (prefix: "media" | "mediagroup") =>
          prefix === "mediagroup" ? "group" : "media",
        now: () => new Date("2025-09-22T00:00:00.000Z"),
        createPublicUrl: ({ key }) => `https://cdn.example/${key}`,
      },
      {
        files: [
          createTestFile(
            "document.pdf",
            "application/pdf",
            new TextEncoder().encode("%PDF-1.7"),
          ),
        ],
        actorId: "user_1",
      },
    );

    expect(repo.insert).toHaveBeenCalledWith(
      expect.not.objectContaining({ locale: expect.anything() }),
    );
    expect(bucket.put).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(ArrayBuffer),
      expect.objectContaining({
        httpMetadata: expect.objectContaining({
          contentDisposition: 'attachment; filename="document.pdf"',
        }),
      }),
    );
    expect(result.items[0]).not.toHaveProperty("locale");
  });
});

describe("listMediaFiles", () => {
  it("returns paged media rows with a total count", async () => {
    const mediaRecord = {
      id: "media_1",
      groupId: "group_1",
      url: "media/2026/05/07/group_1/sample.jpg",
      type: "image",
      mimeType: "image/jpeg",
      name: "sample.jpg",
      description: null,
      width: null,
      height: null,
      size: 1024,
      status: "published",
      updatedBy: "user_1",
      createdAt: "2026-05-07T00:00:00.000Z",
      updatedAt: "2026-05-07T00:00:00.000Z",
    } satisfies MediaRecord;
    const repo = {
      list: vi.fn(async () => [mediaRecord]),
      count: vi.fn(async () => 24),
    };

    const result = await listMediaFiles(
      {
        repo,
        createPublicUrl: ({ id, key }) => `/media/${id}/${key}`,
      },
      { type: "image", limit: 12, offset: 12 },
    );

    expect(repo.list).toHaveBeenCalledWith({
      type: "image",
      limit: 12,
      offset: 12,
    });
    expect(repo.count).toHaveBeenCalledWith({
      type: "image",
      limit: 12,
      offset: 12,
    });
    expect(result.total).toBe(24);
    expect(result.limit).toBe(12);
    expect(result.offset).toBe(12);
    expect(result.items[0].url).toBe(
      "/media/media_1/media/2026/05/07/group_1/sample.jpg",
    );
  });
});
