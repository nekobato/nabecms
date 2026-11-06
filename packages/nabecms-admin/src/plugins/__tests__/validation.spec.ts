import { beforeAll, describe, expect, it } from "vitest";
import { validate } from "vee-validate";

import setupValidation from "../validation";

describe("validation rules", () => {
  beforeAll(() => {
    setupValidation();
  });

  it("fails relation_required when entry IDs are missing", async () => {
    const { valid } = await validate(null, "relation_required");
    expect(valid).toBe(false);
    const empty = await validate({ type: "many", entryIds: [] }, "relation_required");
    expect(empty.valid).toBe(false);
  });

  it("passes relation_required when entry IDs exist", async () => {
    const { valid } = await validate({ type: "one", entryIds: ["entry-1"] }, "relation_required");
    expect(valid).toBe(true);
  });
});
