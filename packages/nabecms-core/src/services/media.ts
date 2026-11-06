import { sanitizeFilename } from "../utils/strings";
import type {
  MediaRepository,
  MediaInsert,
  MediaRecord,
  ListParams as MediaListParams,
} from "../repositories/media";
import {
  MAX_MEDIA_FILES_PER_UPLOAD,
  MediaUploadValidationError,
  readAndValidateMediaFile,
} from "./media-validation";
import type { MediaFileLike } from "./media-validation";

type StreamLike =
  ReadableStream<Uint8Array> | ArrayBuffer | ArrayBufferView | string;

type R2BucketLike = {
  put:
    | ((
        key: string,
        value: StreamLike,
        options?: {
          httpMetadata?: {
            contentType?: string;
            contentDisposition?: string;
            cacheControl?: string;
          };
          customMetadata?: Record<string, string>;
        },
      ) => Promise<unknown>)
    | ((key: string, value: StreamLike) => Promise<unknown>);
};

type UploadMediaDeps = {
  repo: Pick<MediaRepository, "insert">;
  bucket: R2BucketLike;
  generateId: (prefix: "media" | "mediagroup") => string;
  now: () => Date;
  createPublicUrl: (input: { key: string; id: string }) => string;
};

type UploadMediaParams = {
  files: MediaFileLike[];
  actorId: string;
  descriptions?: (string | null | undefined)[];
};

type UploadResult = {
  items: MediaRecord[];
};

type ListMediaDeps = {
  repo: Pick<MediaRepository, "count" | "list">;
  createPublicUrl: (input: { key: string; id: string }) => string;
};

type ListResult = {
  items: MediaRecord[];
  total: number;
  limit?: number;
  offset?: number;
};

const MIME_TYPE_PREFIXES: ReadonlyArray<[string, string]> = [
  ["image/", "image"],
  ["video/", "video"],
  ["audio/", "audio"],
  ["text/", "text"],
];

const MIME_TYPE_FULL: Readonly<Record<string, string>> = {
  "application/pdf": "document",
};

/**
 * Infer the API media category from a validated MIME type.
 * @param mimeType - Canonical MIME type
 * @returns Media category
 */
function inferMediaType(mimeType: string | undefined): string {
  if (!mimeType) return "custom";
  const direct = MIME_TYPE_FULL[mimeType];
  if (direct) return direct;
  for (const [prefix, category] of MIME_TYPE_PREFIXES) {
    if (mimeType.startsWith(prefix)) return category;
  }
  return "custom";
}

/**
 * Build a deterministic R2 key for an uploaded media file.
 * @param args - Key components
 * @returns R2 object key
 */
function buildR2Key(args: {
  now: Date;
  groupId: string;
  originalName: string;
}) {
  const year = args.now.getUTCFullYear();
  const month = String(args.now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(args.now.getUTCDate()).padStart(2, "0");
  const sanitized = sanitizeFilename(args.originalName);
  return `media/${year}/${month}/${day}/${args.groupId}/${sanitized}`;
}

/**
 * Validate and persist one media file to R2 and the media repository.
 * @param deps - Storage and repository dependencies
 * @param params - Upload request
 * @returns Uploaded media record
 * @throws {MediaUploadValidationError} When the upload violates the v1 contract
 */
export async function uploadMediaFiles(
  deps: UploadMediaDeps,
  params: UploadMediaParams,
): Promise<UploadResult> {
  if (params.files?.length !== MAX_MEDIA_FILES_PER_UPLOAD) {
    throw new MediaUploadValidationError(
      "INVALID_FILE_COUNT",
      400,
      "Exactly one media file is required",
    );
  }

  const now = deps.now();
  const isoNow = now.toISOString();
  const groupId = deps.generateId("mediagroup");

  const results: MediaRecord[] = [];

  for (let index = 0; index < params.files.length; index += 1) {
    const file = params.files[index];
    const validated = await readAndValidateMediaFile(file, "source");
    const mediaId = deps.generateId("media");
    const key = buildR2Key({
      now,
      groupId,
      originalName: file.name,
    });

    const mimeType = validated.mimeType;
    const contentDisposition =
      mimeType === "application/pdf" ? "attachment" : "inline";

    await deps.bucket.put(key, validated.buffer, {
      httpMetadata: {
        contentType: mimeType,
        contentDisposition: `${contentDisposition}; filename="${sanitizeFilename(file.name)}"`,
        cacheControl: "private, no-store",
      },
      customMetadata: {
        mediaId,
        groupId,
      },
    });

    const record: MediaInsert = {
      id: mediaId,
      groupId,
      url: key,
      type: inferMediaType(mimeType),
      mimeType,
      name: file.name,
      description: params.descriptions?.[index] ?? null,
      width: null,
      height: null,
      size: validated.buffer.byteLength,
      status: "published",
      createdAt: isoNow,
      updatedAt: isoNow,
      updatedBy: params.actorId,
    };

    await deps.repo.insert(record);

    const enrichedRecord: MediaRecord = {
      id: record.id,
      groupId: record.groupId,
      url: deps.createPublicUrl({ key, id: mediaId }),
      type: record.type,
      mimeType: record.mimeType,
      name: record.name,
      description: record.description ?? null,
      width: record.width ?? null,
      height: record.height ?? null,
      size: record.size,
      status: record.status ?? "published",
      createdAt: record.createdAt ?? isoNow,
      updatedAt: record.updatedAt ?? isoNow,
      updatedBy: record.updatedBy,
    };

    results.push(enrichedRecord);
  }

  return { items: results };
}

/**
 * List media records with resolved public URLs.
 * @param deps - Repository and URL dependencies
 * @param params - List filters and pagination
 * @returns Paged media list
 */
export async function listMediaFiles(
  deps: ListMediaDeps,
  params: MediaListParams,
): Promise<ListResult> {
  const [rows, total] = await Promise.all([
    deps.repo.list(params),
    deps.repo.count(params),
  ]);
  return {
    items: rows.map((row) => ({
      ...row,
      url: deps.createPublicUrl({ key: row.url, id: row.id }),
    })),
    total,
    limit: params.limit,
    offset: params.offset,
  };
}
