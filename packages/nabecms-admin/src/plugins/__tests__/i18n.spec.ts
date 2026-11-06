import { describe, expect, it } from "vitest";
import { createI18n } from "vue-i18n";
import en from "../../locales/en.json";
import ja from "../../locales/ja.json";

describe("i18n messages", () => {
  it.each(["en", "ja"] as const)("compiles literal at-sign messages for %s", (locale) => {
    const i18n = createI18n({
      legacy: false,
      locale,
      fallbackLocale: "en",
      messages: { en, ja },
    });

    expect(i18n.global.t("settings.invites.email_placeholder")).toBe("user@example.com");
  });
});
