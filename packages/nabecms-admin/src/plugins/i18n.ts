import { createI18n } from "vue-i18n";
import en from "../locales/en.json";
import ja from "../locales/ja.json";

const stored = typeof window !== "undefined" ? localStorage.getItem("locale") : null;
const locale = stored || "en";

export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale,
  fallbackLocale: "en",
  messages: { en, ja },
});

export const setLocale = (next: "en" | "ja") => {
  i18n.global.locale.value = next;
  if (typeof window !== "undefined") localStorage.setItem("locale", next);
};

export default i18n;
