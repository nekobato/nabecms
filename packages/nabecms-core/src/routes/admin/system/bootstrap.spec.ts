import { describe, expect, it } from "vitest";
import { isDatabaseNotInitializedError } from "./bootstrap";

describe("isDatabaseNotInitializedError", () => {
  it("returns true when the top-level message includes no such table", () => {
    const error = new Error("D1_ERROR: no such table: roles: SQLITE_ERROR");
    expect(isDatabaseNotInitializedError(error)).toBe(true);
  });

  it("returns true when a nested cause includes no such table", () => {
    const cause = new Error("D1_ERROR: no such table: settings: SQLITE_ERROR");
    const error = new Error(
      'Failed query: select "key" from "settings" where "settings"."key" = ?',
      { cause },
    );
    expect(isDatabaseNotInitializedError(error)).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    const error = new Error("Failed to sign access token");
    expect(isDatabaseNotInitializedError(error)).toBe(false);
  });
});
