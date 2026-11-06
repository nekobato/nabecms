import { describe, it, expect } from "vitest";
import {
  DEFAULT_USER_PREFERENCES,
  mergeUserPreferences,
  parseUserPreferencesPatch,
  resolveUserPreferences,
} from "./user-preferences";

describe("user-preferences", () => {
  it("returns defaults when input is missing", () => {
    expect(resolveUserPreferences(null)).toEqual(DEFAULT_USER_PREFERENCES);
  });

  it("preserves valid values and fills invalid ones", () => {
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
