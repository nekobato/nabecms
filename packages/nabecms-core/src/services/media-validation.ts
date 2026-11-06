/**
 * Validation primitives for media uploaded to R2.
 *
 * Browser-provided MIME types are treated only as declarations. Every accepted
 * file must also match a small, explicit set of file signatures before it is
 * persisted or served inline.
 *
 * @module
 */

/** Maximum supported source or variant file size (50 MiB). */
export const MAX_MEDIA_FILE_SIZE_BYTES = 50 * 1024 * 1024;

/**
 * Maximum multipart request size. The extra MiB leaves room for multipart
 * headers while retaining a strict upper bound before `formData()` buffers the
 * request.
 */
export const MAX_MEDIA_REQUEST_SIZE_BYTES =
  MAX_MEDIA_FILE_SIZE_BYTES + 1024 * 1024;

/** Maximum number of source files accepted by a single upload request. */
export const MAX_MEDIA_FILES_PER_UPLOAD = 1;

/** Validation profile for user uploads and generated image variants. */
export type MediaValidationProfile = "source" | "variant";

/** File-like input accepted by the media validator. */
export type MediaFileLike = {
  name: string;
  type?: string;
  size: number;
  stream?: () => ReadableStream<Uint8Array>;
  arrayBuffer?: () => Promise<ArrayBuffer>;
};

/** Stable API error codes for rejected media uploads. */
export type MediaUploadValidationCode =
  | "INVALID_FILE_COUNT"
  | "INVALID_FILE_SIZE"
  | "INVALID_MEDIA_FILE"
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "MEDIA_TYPE_MISMATCH";

/** HTTP statuses returned for media validation failures. */
export type MediaUploadValidationStatus = 400 | 413 | 415;

/** Result returned after a file has passed size, MIME, and signature checks. */
export type ValidatedMediaFile = {
  buffer: ArrayBuffer;
  mimeType: string;
};

const SOURCE_MIME_ALIASES: Readonly<Record<string, string>> = {
  "audio/x-m4a": "audio/mp4",
  "audio/x-wav": "audio/wav",
};

const VARIANT_MIME_ALIASES: Readonly<Record<string, string>> = {
  "image/jpg": "image/jpeg",
};

const SOURCE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "application/pdf",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "audio/mpeg",
  "audio/wav",
  "audio/mp4",
]);

const VARIANT_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
]);

const MP4_VIDEO_BRANDS = new Set([
  "avc1",
  "dash",
  "iso2",
  "iso5",
  "iso6",
  "isom",
  "mmp4",
  "mp41",
  "mp42",
  "M4V ",
  "MSNV",
]);

const MP4_AUDIO_BRANDS = new Set([
  "iso2",
  "iso5",
  "iso6",
  "isom",
  "mp41",
  "mp42",
  "M4A ",
  "M4B ",
]);

/**
 * Error raised when an upload does not satisfy the stable media contract.
 */
export class MediaUploadValidationError extends Error {
  /**
   * Create a media validation error.
   * @param code - Stable response code
   * @param status - HTTP response status
   * @param message - Safe response message
   */
  constructor(
    public readonly code: MediaUploadValidationCode,
    public readonly status: MediaUploadValidationStatus,
    message: string,
  ) {
    super(message);
    this.name = "MediaUploadValidationError";
  }
}

/**
 * Normalize a MIME declaration without accepting parameters as part of it.
 * @param value - Raw browser MIME declaration
 * @returns Lower-case MIME string
 */
const normalizeMimeDeclaration = (value: string | undefined): string =>
  value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";

/**
 * Resolve an allowed canonical MIME type for a validation profile.
 * @param value - Raw MIME declaration
 * @param profile - Validation profile
 * @returns Canonical MIME type, or null when unsupported
 */
export function resolveSupportedMediaMimeType(
  value: string | undefined,
  profile: MediaValidationProfile,
): string | null {
  const normalized = normalizeMimeDeclaration(value);
  const aliases =
    profile === "source" ? SOURCE_MIME_ALIASES : VARIANT_MIME_ALIASES;
  const canonical = aliases[normalized] ?? normalized;
  const allowed = profile === "source" ? SOURCE_MIME_TYPES : VARIANT_MIME_TYPES;
  return allowed.has(canonical) ? canonical : null;
}

/**
 * Compare bytes with an expected signature at a fixed offset.
 * @param bytes - Candidate bytes
 * @param signature - Expected signature
 * @param offset - Byte offset
 * @returns Whether the signature matches
 */
function matchesBytes(
  bytes: Uint8Array,
  signature: readonly number[],
  offset = 0,
): boolean {
  if (bytes.byteLength < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}

/**
 * Compare an ASCII marker at a fixed byte offset.
 * @param bytes - Candidate bytes
 * @param value - Expected ASCII marker
 * @param offset - Byte offset
 * @returns Whether the marker matches
 */
function matchesAscii(bytes: Uint8Array, value: string, offset = 0): boolean {
  if (bytes.byteLength < offset + value.length) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (bytes[offset + index] !== value.charCodeAt(index)) return false;
  }
  return true;
}

/**
 * Read a four-byte ISO Base Media File Format brand.
 * @param bytes - Candidate bytes
 * @param offset - Brand offset
 * @returns Four-character brand or null
 */
function readBrand(bytes: Uint8Array, offset: number): string | null {
  if (bytes.byteLength < offset + 4) return null;
  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  );
}

/**
 * Validate an ISO BMFF `ftyp` box against accepted brands.
 * @param bytes - Candidate bytes
 * @param brands - Accepted major or compatible brands
 * @returns Whether a supported brand is present
 */
function hasIsoBrand(bytes: Uint8Array, brands: ReadonlySet<string>): boolean {
  if (!matchesAscii(bytes, "ftyp", 4)) return false;
  const inspectionLimit = Math.min(bytes.byteLength, 64);
  for (let offset = 8; offset + 4 <= inspectionLimit; offset += 4) {
    const brand = readBrand(bytes, offset);
    if (brand && brands.has(brand)) return true;
  }
  return false;
}

/**
 * Find a short ASCII marker in a bounded prefix.
 * @param bytes - Candidate bytes
 * @param marker - Expected marker
 * @param limit - Maximum prefix length
 * @returns Whether the marker is present
 */
function containsAscii(
  bytes: Uint8Array,
  marker: string,
  limit: number,
): boolean {
  const end = Math.min(bytes.byteLength, limit) - marker.length;
  for (let offset = 0; offset <= end; offset += 1) {
    if (matchesAscii(bytes, marker, offset)) return true;
  }
  return false;
}

/**
 * Validate a JPEG signature.
 * @param bytes - Candidate bytes
 * @returns Whether the signature matches
 */
function isJpeg(bytes: Uint8Array): boolean {
  return matchesBytes(bytes, [0xff, 0xd8, 0xff]);
}

/**
 * Validate a PNG signature.
 * @param bytes - Candidate bytes
 * @returns Whether the signature matches
 */
function isPng(bytes: Uint8Array): boolean {
  return matchesBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

/**
 * Validate a GIF signature.
 * @param bytes - Candidate bytes
 * @returns Whether the signature matches
 */
function isGif(bytes: Uint8Array): boolean {
  return matchesAscii(bytes, "GIF87a") || matchesAscii(bytes, "GIF89a");
}

/**
 * Validate a PDF header.
 * @param bytes - Candidate bytes
 * @returns Whether the signature matches
 */
function isPdf(bytes: Uint8Array): boolean {
  return matchesAscii(bytes, "%PDF-");
}

/**
 * Validate a WebP RIFF header.
 * @param bytes - Candidate bytes
 * @returns Whether the signature matches
 */
function isWebp(bytes: Uint8Array): boolean {
  return matchesAscii(bytes, "RIFF") && matchesAscii(bytes, "WEBP", 8);
}

/**
 * Validate an AVIF ISO BMFF header.
 * @param bytes - Candidate bytes
 * @returns Whether the signature matches
 */
function isAvif(bytes: Uint8Array): boolean {
  return hasIsoBrand(bytes, new Set(["avif", "avis"]));
}

/**
 * Validate an MP4 video ISO BMFF header.
 * @param bytes - Candidate bytes
 * @returns Whether the signature matches
 */
function isMp4Video(bytes: Uint8Array): boolean {
  return hasIsoBrand(bytes, MP4_VIDEO_BRANDS);
}

/**
 * Validate an M4A/MP4 audio ISO BMFF header.
 * @param bytes - Candidate bytes
 * @returns Whether the signature matches
 */
function isMp4Audio(bytes: Uint8Array): boolean {
  return hasIsoBrand(bytes, MP4_AUDIO_BRANDS);
}

/**
 * Validate a WebM EBML header and DocType marker.
 * @param bytes - Candidate bytes
 * @returns Whether the signature matches
 */
function isWebm(bytes: Uint8Array): boolean {
  return (
    matchesBytes(bytes, [0x1a, 0x45, 0xdf, 0xa3]) &&
    containsAscii(bytes, "webm", 4096)
  );
}

/**
 * Validate a QuickTime container header.
 * @param bytes - Candidate bytes
 * @returns Whether the signature matches
 */
function isQuickTime(bytes: Uint8Array): boolean {
  if (hasIsoBrand(bytes, new Set(["qt  "]))) return true;
  const firstAtom = readBrand(bytes, 4);
  return Boolean(
    firstAtom &&
    new Set(["free", "mdat", "moov", "skip", "wide"]).has(firstAtom),
  );
}

/**
 * Validate an MP3 ID3 tag or MPEG audio frame sync.
 * @param bytes - Candidate bytes
 * @returns Whether the signature matches
 */
function isMp3(bytes: Uint8Array): boolean {
  if (matchesAscii(bytes, "ID3")) return true;
  const first = bytes[0];
  const second = bytes[1];
  return first === 0xff && second !== undefined && (second & 0xe0) === 0xe0;
}

/**
 * Validate a WAV RIFF/WAVE header.
 * @param bytes - Candidate bytes
 * @returns Whether the signature matches
 */
function isWav(bytes: Uint8Array): boolean {
  return matchesAscii(bytes, "RIFF") && matchesAscii(bytes, "WAVE", 8);
}

const MIME_MAGIC_VALIDATORS: Readonly<
  Record<string, (bytes: Uint8Array) => boolean>
> = {
  "application/pdf": isPdf,
  "audio/mp4": isMp4Audio,
  "audio/mpeg": isMp3,
  "audio/wav": isWav,
  "image/avif": isAvif,
  "image/gif": isGif,
  "image/jpeg": isJpeg,
  "image/png": isPng,
  "image/webp": isWebp,
  "video/mp4": isMp4Video,
  "video/quicktime": isQuickTime,
  "video/webm": isWebm,
};

/**
 * Join bounded stream chunks into one exact ArrayBuffer.
 * @param chunks - Stream chunks
 * @param size - Total byte length
 * @returns Combined buffer
 */
function joinChunks(chunks: readonly Uint8Array[], size: number): ArrayBuffer {
  const combined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined.buffer;
}

/**
 * Read a file into memory without allowing a stream to exceed the file cap.
 * @param file - File-like input
 * @returns Exact file buffer
 */
async function readBoundedFile(file: MediaFileLike): Promise<ArrayBuffer> {
  if (file.arrayBuffer) {
    const buffer = await file.arrayBuffer();
    if (buffer.byteLength > MAX_MEDIA_FILE_SIZE_BYTES) {
      throw new MediaUploadValidationError(
        "FILE_TOO_LARGE",
        413,
        "Media files must not exceed 50 MiB",
      );
    }
    return buffer;
  }

  if (!file.stream) {
    throw new MediaUploadValidationError(
      "INVALID_MEDIA_FILE",
      400,
      "Media file content is missing",
    );
  }

  const reader = file.stream().getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_MEDIA_FILE_SIZE_BYTES) {
        await reader.cancel("Media file exceeds the size limit");
        throw new MediaUploadValidationError(
          "FILE_TOO_LARGE",
          413,
          "Media files must not exceed 50 MiB",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return joinChunks(chunks, size);
}

/**
 * Read and validate a source media file or generated image variant.
 * @param file - File-like input
 * @param profile - Validation profile
 * @returns Exact validated bytes and canonical MIME type
 * @throws {MediaUploadValidationError} When the file violates the contract
 */
export async function readAndValidateMediaFile(
  file: MediaFileLike,
  profile: MediaValidationProfile,
): Promise<ValidatedMediaFile> {
  if (!Number.isSafeInteger(file.size) || file.size < 0) {
    throw new MediaUploadValidationError(
      "INVALID_FILE_SIZE",
      400,
      "Media file size is invalid",
    );
  }
  if (file.size > MAX_MEDIA_FILE_SIZE_BYTES) {
    throw new MediaUploadValidationError(
      "FILE_TOO_LARGE",
      413,
      "Media files must not exceed 50 MiB",
    );
  }

  const mimeType = resolveSupportedMediaMimeType(file.type, profile);
  if (!mimeType) {
    throw new MediaUploadValidationError(
      "UNSUPPORTED_MEDIA_TYPE",
      415,
      "Media type is not supported",
    );
  }

  const buffer = await readBoundedFile(file);
  if (buffer.byteLength !== file.size) {
    throw new MediaUploadValidationError(
      "INVALID_FILE_SIZE",
      400,
      "Declared media file size does not match its content",
    );
  }

  const validator = MIME_MAGIC_VALIDATORS[mimeType];
  if (!validator || !validator(new Uint8Array(buffer))) {
    throw new MediaUploadValidationError(
      "MEDIA_TYPE_MISMATCH",
      415,
      "Media content does not match its declared type",
    );
  }

  return { buffer, mimeType };
}
