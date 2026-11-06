import type { UiLocale, UserPreferences } from "@nekobato/nabecms-core/contracts";

export type { UiLocale, UserPreferences };

/**
 * Default Admin UI preferences applied when none are stored.
 */
export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  locale: "en",
};

/**
 * Resolve a locale value into a supported UI locale.
 */
const resolveLocale = (value: unknown): UiLocale => (value === "ja" || value === "en" ? value : DEFAULT_USER_PREFERENCES.locale);

/**
 * Normalize unknown preference data into a complete preferences object.
 */
export const resolveUserPreferences = (input: unknown): UserPreferences => {
  if (!input || typeof input !== "object") {
    return { ...DEFAULT_USER_PREFERENCES };
  }
  const record = input as Record<string, unknown>;
  return {
    locale: resolveLocale(record.locale),
  };
};
