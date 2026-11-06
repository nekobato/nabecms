import { describe, expect, it } from "vitest";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../database/schema";
import {
  IdempotencyKeyRequiredError,
  InvalidIdempotencyKeyError,
  isIdempotencyRecordConflict,
  prepareIdempotencyRequest,
  serializeIdempotencyResponseBody,
} from "./idempotency";

const unusedDb = {} as DrizzleD1Database<typeof schema>;

describe("idempotency", () => {
  it("rejects a missing key before accessing D1", async () => {
    await expect(
      prepareIdempotencyRequest(unusedDb, {
        key: undefined,
        principalId: "user_1",
        operation: "entry.create",
        request: {},
      }),
    ).rejects.toBeInstanceOf(IdempotencyKeyRequiredError);
  });

  it.each(["short", "contains space", "å-invalid-key"])(
    "rejects malformed key %s before accessing D1",
    async (key) => {
      await expect(
        prepareIdempotencyRequest(unusedDb, {
          key,
          principalId: "user_1",
          operation: "entry.create",
          request: {},
        }),
      ).rejects.toBeInstanceOf(InvalidIdempotencyKeyError);
    },
  );

  it("serializes response objects with stable key ordering", () => {
    expect(
      serializeIdempotencyResponseBody({
        z: 1,
        nested: { b: true, a: false },
        a: 2,
      }),
    ).toBe('{"a":2,"nested":{"a":false,"b":true},"z":1}');
  });

  it("recognizes only idempotency unique conflicts", () => {
    expect(
      isIdempotencyRecordConflict(
        new Error("UNIQUE constraint failed: idempotency_records.principal_id"),
      ),
    ).toBe(true);
    expect(
      isIdempotencyRecordConflict(
        new Error("UNIQUE constraint failed: entries.id"),
      ),
    ).toBe(false);
  });
});
