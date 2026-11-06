/**
 * User interface preference types for the Admin UI.
 */
export type UiLocale = "en" | "ja";

/**
 * Persisted Admin UI preferences for a user.
 */
export type UserPreferences = {
  locale: UiLocale;
};
