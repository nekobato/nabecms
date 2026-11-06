import { describe, expect, it, vi } from "vitest";
import {
  MAX_MEDIA_FILE_SIZE_BYTES,
  MediaUploadValidationError,
  readAndValidateMediaFile,
} from "./media-validation";

/**
 * Convert an ASCII marker into bytes.
 * @param value - ASCII input
 * @returns Encoded bytes
 */
const ascii = (value: string): Uint8Array => new TextEncoder().encode(value);

/**
 * Concatenate byte arrays into one payload.
 * @param chunks - Byte arrays
 * @returns Concatenated bytes
 */
const concatBytes = (...chunks: Uint8Array[]): Uint8Array => {
  const result = new Uint8Array(
    chunks.reduce((length, chunk) => length + chunk.byteLength, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
};

/**
 * Create a file-like object backed by exact bytes.
 * @param input - File properties
 * @returns File-like object
 */
const createFile = (input: {
  name: string;
  type: string;
  bytes: Uint8Array;
  size?: number;
}) => ({
  name: input.name,
  type: input.type,
  size: input.size ?? input.bytes.byteLength,
  arrayBuffer: vi.fn(async (): Promise<ArrayBuffer> => {
    const copy = new Uint8Array(input.bytes.byteLength);
    copy.set(input.bytes);
    return copy.buffer;
  }),
});

const sourceCases = [
  {
    mimeType: "image/jpeg",
    name: "photo.jpg",
    bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
  },
  {
    mimeType: "image/png",
    name: "photo.png",
    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  { mimeType: "image/gif", name: "photo.gif", bytes: ascii("GIF89a") },
  {
    mimeType: "application/pdf",
    name: "document.pdf",
    bytes: ascii("%PDF-1.7"),
  },
  {
    mimeType: "video/mp4",
    name: "movie.mp4",
    bytes: concatBytes(
      new Uint8Array([0x00, 0x00, 0x00, 0x18]),
      ascii("ftypisom"),
    ),
  },
  {
    mimeType: "video/webm",
    name: "movie.webm",
    bytes: concatBytes(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]), ascii("webm")),
  },
  {
    mimeType: "video/quicktime",
    name: "movie.mov",
    bytes: concatBytes(
      new Uint8Array([0x00, 0x00, 0x00, 0x14]),
      ascii("ftypqt  "),
    ),
  },
  { mimeType: "audio/mpeg", name: "audio.mp3", bytes: ascii("ID3") },
  {
    mimeType: "audio/wav",
    name: "audio.wav",
    bytes: concatBytes(ascii("RIFF"), new Uint8Array(4), ascii("WAVE")),
  },
  {
    mimeType: "audio/mp4",
    name: "audio.m4a",
    bytes: concatBytes(
      new Uint8Array([0x00, 0x00, 0x00, 0x18]),
      ascii("ftypM4A "),
    ),
  },
] as const;

describe("readAndValidateMediaFile", () => {
  it.each(sourceCases)(
    "accepts supported $mimeType source files with matching magic bytes",
    async ({ name, mimeType, bytes }) => {
      const result = await readAndValidateMediaFile(
        createFile({ name, type: mimeType, bytes }),
        "source",
      );

      expect(result.mimeType).toBe(mimeType);
      expect(new Uint8Array(result.buffer)).toEqual(bytes);
    },
  );

  it.each([
    { name: "payload.html", type: "text/html", bytes: ascii("<html>") },
    {
      name: "payload.svg",
      type: "image/svg+xml",
      bytes: ascii("<svg xmlns='http://www.w3.org/2000/svg'>"),
    },
  ])("rejects active content type $type", async ({ name, type, bytes }) => {
    await expect(
      readAndValidateMediaFile(createFile({ name, type, bytes }), "source"),
    ).rejects.toMatchObject({
      code: "UNSUPPORTED_MEDIA_TYPE",
      status: 415,
    } satisfies Partial<MediaUploadValidationError>);
  });

  it("rejects a declared image MIME whose bytes are HTML", async () => {
    await expect(
      readAndValidateMediaFile(
        createFile({
          name: "payload.png",
          type: "image/png",
          bytes: ascii("<html><script>alert(1)</script>"),
        }),
        "source",
      ),
    ).rejects.toMatchObject({
      code: "MEDIA_TYPE_MISMATCH",
      status: 415,
    } satisfies Partial<MediaUploadValidationError>);
  });

  it("rejects declared files larger than 50 MiB before reading them", async () => {
    const file = createFile({
      name: "large.png",
      type: "image/png",
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      size: MAX_MEDIA_FILE_SIZE_BYTES + 1,
    });

    await expect(
      readAndValidateMediaFile(file, "source"),
    ).rejects.toMatchObject({
      code: "FILE_TOO_LARGE",
      status: 413,
    } satisfies Partial<MediaUploadValidationError>);
    expect(file.arrayBuffer).not.toHaveBeenCalled();
  });

  it("rejects an inaccurate declared file size", async () => {
    await expect(
      readAndValidateMediaFile(
        createFile({
          name: "photo.png",
          type: "image/png",
          bytes: new Uint8Array([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
          ]),
          size: 7,
        }),
        "source",
      ),
    ).rejects.toMatchObject({
      code: "INVALID_FILE_SIZE",
      status: 400,
    } satisfies Partial<MediaUploadValidationError>);
  });

  it.each([
    {
      mimeType: "image/webp",
      bytes: concatBytes(ascii("RIFF"), new Uint8Array(4), ascii("WEBP")),
    },
    {
      mimeType: "image/avif",
      bytes: concatBytes(
        new Uint8Array([0x00, 0x00, 0x00, 0x18]),
        ascii("ftypavif"),
      ),
    },
  ])(
    "accepts safe generated variant type $mimeType",
    async ({ mimeType, bytes }) => {
      await expect(
        readAndValidateMediaFile(
          createFile({ name: "variant", type: mimeType, bytes }),
          "variant",
        ),
      ).resolves.toMatchObject({ mimeType });
    },
  );
});
