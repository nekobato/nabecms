import { describe, it, expect } from "vitest";
import {
  mergeUserPreferences,
  parseUserPreferencesPatch,
  resolveUserPreferences,
} from "./user-preferences";

describe("user-preferences", () => {
  it("preserves valid values and fills missing or invalid ones", () => {
    expect(resolveUserPreferences(null)).toEqual({ locale: "en" });

    expect(
      resolveUserPreferences({ locale: "ja", appearance: "dark" }),
    ).toEqual({
      locale: "ja",
    });

    expect(
      resolveUserPreferences({ locale: "fr", appearance: "dark" }),
    ).toEqual({
      locale: "en",
    });
  });

  it("parses valid preference patches", () => {
    expect(parseUserPreferencesPatch({ locale: "ja" })).toEqual({
      locale: "ja",
    });
  });

  it("merges patches onto defaults", () => {
    const merged = mergeUserPreferences(null, { locale: "ja" });
    expect(merged).toEqual({
      locale: "ja",
    });
  });
});
