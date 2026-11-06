/** Persistent idempotency support for Admin API mutations. */
import { and, eq, lte } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../database/schema";
import { generateIdWithPrefix } from "../utils/id";

export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";
export const IDEMPOTENCY_REPLAYED_HEADER = "Idempotency-Replayed";
export const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1000;

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,255}$/;

/** Raised when a protected mutation omits Idempotency-Key. */
export class IdempotencyKeyRequiredError extends Error {
  constructor() {
    super(`${IDEMPOTENCY_KEY_HEADER} header is required`);
    this.name = "IdempotencyKeyRequiredError";
  }
}

/** Raised when Idempotency-Key does not match the public key format. */
export class InvalidIdempotencyKeyError extends Error {
  constructor() {
    super(
      `${IDEMPOTENCY_KEY_HEADER} must be 8-255 ASCII letters, numbers, or -_.:`,
    );
    this.name = "InvalidIdempotencyKeyError";
  }
}

/** Raised when one key is reused for a different request fingerprint. */
export class IdempotencyKeyReusedError extends Error {
  constructor() {
    super(`${IDEMPOTENCY_KEY_HEADER} was already used for another request`);
    this.name = "IdempotencyKeyReusedError";
  }
}

export type IdempotencyRecordInput = {
  id: string;
  principalId: string;
  operation: string;
  keyHash: string;
  requestHash: string;
  createdAt: string;
  expiresAt: string;
};

export type IdempotencyReplay = {
  kind: "replay";
  responseStatus: number;
  responseBody: unknown;
};

export type PreparedIdempotencyRequest =
  | {
      kind: "execute";
      record: IdempotencyRecordInput;
    }
  | IdempotencyReplay;

type StoredIdempotencyRecord = typeof schema.idempotencyRecords.$inferSelect;

const normalizeJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) =>
      item === undefined ? null : normalizeJsonValue(item),
    );
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (
        item !== undefined &&
        typeof item !== "function" &&
        typeof item !== "symbol"
      ) {
        result[key] = normalizeJsonValue(item);
      }
    }
    return result;
  }
  return value;
};

const serializeCanonicalJson = (value: unknown): string => {
  const serialized = JSON.stringify(normalizeJsonValue(value));
  return serialized ?? "null";
};

const sha256 = async (value: string): Promise<string> => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
};

const parseResponseBody = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const toReplay = (record: StoredIdempotencyRecord): IdempotencyReplay => ({
  kind: "replay",
  responseStatus: record.responseStatus,
  responseBody: parseResponseBody(record.responseBody),
});

const findStoredRecord = async (
  db: DrizzleD1Database<typeof schema>,
  record: Pick<IdempotencyRecordInput, "principalId" | "operation" | "keyHash">,
): Promise<StoredIdempotencyRecord | null> => {
  const [stored] = await db
    .select()
    .from(schema.idempotencyRecords)
    .where(
      and(
        eq(schema.idempotencyRecords.principalId, record.principalId),
        eq(schema.idempotencyRecords.operation, record.operation),
        eq(schema.idempotencyRecords.keyHash, record.keyHash),
      ),
    )
    .limit(1);
  return stored ?? null;
};

/**
 * Validate and fingerprint a request before its domain write begins.
 *
 * Expired records for the same scope are removed lazily. The returned execute
 * record must be inserted in the same D1 batch as the protected mutation.
 */
export async function prepareIdempotencyRequest(
  db: DrizzleD1Database<typeof schema>,
  input: {
    key: string | undefined;
    principalId: string;
    operation: string;
    request: unknown;
    now?: Date;
  },
): Promise<PreparedIdempotencyRequest> {
  if (!input.key) {
    throw new IdempotencyKeyRequiredError();
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(input.key)) {
    throw new InvalidIdempotencyKeyError();
  }

  const now = input.now ?? new Date();
  const createdAt = now.toISOString();
  const keyHash = await sha256(input.key);
  const requestHash = await sha256(
    serializeCanonicalJson({
      operation: input.operation,
      request: input.request,
    }),
  );
  const scope = {
    principalId: input.principalId,
    operation: input.operation,
    keyHash,
  };

  await db
    .delete(schema.idempotencyRecords)
    .where(
      and(
        eq(schema.idempotencyRecords.principalId, scope.principalId),
        eq(schema.idempotencyRecords.operation, scope.operation),
        eq(schema.idempotencyRecords.keyHash, scope.keyHash),
        lte(schema.idempotencyRecords.expiresAt, createdAt),
      ),
    );

  const stored = await findStoredRecord(db, scope);
  if (stored) {
    if (stored.requestHash !== requestHash) {
      throw new IdempotencyKeyReusedError();
    }
    return toReplay(stored);
  }

  return {
    kind: "execute",
    record: {
      id: generateIdWithPrefix("idempotency"),
      ...scope,
      requestHash,
      createdAt,
      expiresAt: new Date(
        now.getTime() + IDEMPOTENCY_RETENTION_MS,
      ).toISOString(),
    },
  };
}

/**
 * Load a concurrently committed result after the local batch loses the unique
 * key race. A mismatched fingerprint remains a key-reuse conflict.
 */
export async function resolveCommittedIdempotencyReplay(
  db: DrizzleD1Database<typeof schema>,
  record: IdempotencyRecordInput,
): Promise<IdempotencyReplay | null> {
  const stored = await findStoredRecord(db, record);
  if (!stored) return null;
  if (stored.requestHash !== record.requestHash) {
    throw new IdempotencyKeyReusedError();
  }
  return toReplay(stored);
}

/** Serialize a response body for the atomic idempotency insert. */
export const serializeIdempotencyResponseBody = (body: unknown): string =>
  serializeCanonicalJson(body);

/** Detect the D1 unique-constraint error produced by a concurrent same-key write. */
export const isIdempotencyRecordConflict = (error: unknown): boolean => {
  const messages: string[] = [];
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current && !seen.has(current)) {
    seen.add(current);
    messages.push(current instanceof Error ? current.message : String(current));
    current =
      current instanceof Error && "cause" in current ? current.cause : null;
  }
  const message = messages.join(" ");
  return (
    /unique constraint failed/i.test(message) &&
    /idempotency_records/i.test(message)
  );
};
