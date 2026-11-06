import { describe, expect, it } from "vitest";
import { constantTimeEquals, getBootstrapSecret } from "./bootstrap-secret";

describe("bootstrap secret helpers", () => {
  it("normalizes configured bootstrap secret", () => {
    expect(getBootstrapSecret({ BOOTSTRAP_SECRET: "  secret  " })).toBe(
      "secret",
    );
    expect(getBootstrapSecret({ BOOTSTRAP_SECRET: " " })).toBeNull();
  });

  it("compares strings without accepting prefix matches", () => {
    expect(constantTimeEquals("secret", "secret")).toBe(true);
    expect(constantTimeEquals("secret", "secret-2")).toBe(false);
    expect(constantTimeEquals("secret", "sec")).toBe(false);
  });
});
