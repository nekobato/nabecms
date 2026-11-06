/**
 * User preference normalization helpers for the Admin UI.
 */
import { z } from "zod";
import type { UiLocale, UserPreferences } from "../contracts";

/**
 * Default Admin UI preferences applied when none are stored.
 */
export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  locale: "en",
};

const userPreferencesPatchSchema = z
  .object({
    locale: z.enum(["en", "ja"]).optional(),
  })
  .strict();

export type UserPreferencesPatch = z.infer<typeof userPreferencesPatchSchema>;

/**
 * Type guard for supported locale values.
 */
export const isUiLocale = (value: unknown): value is UiLocale =>
  value === "en" || value === "ja";

/**
 * Parse a user preference patch payload, raising on invalid input.
 */
export const parseUserPreferencesPatch = (
  input: unknown,
): UserPreferencesPatch => userPreferencesPatchSchema.parse(input);

/**
 * Normalize stored preference data into a complete preferences object.
 */
export const resolveUserPreferences = (input: unknown): UserPreferences => {
  if (!input || typeof input !== "object") {
    return { ...DEFAULT_USER_PREFERENCES };
  }
  const record = input as Record<string, unknown>;
  const locale = isUiLocale(record.locale)
    ? record.locale
    : DEFAULT_USER_PREFERENCES.locale;
  return { locale };
};

/**
 * Merge a stored preference object with a validated patch.
 */
export const mergeUserPreferences = (
  base: unknown,
  patch: UserPreferencesPatch,
): UserPreferences => {
  const resolved = resolveUserPreferences(base);
  return { ...resolved, ...patch };
};
