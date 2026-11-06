import { describe, expect, it } from "vitest";

import { resolveDocumentMetadata, syncDocumentMetadata } from "./documentMetadata";
import { adminThemeColor } from "../theme/palette";

const enMessages: Record<string, string> = {
  "app.title": "NabeCMS Admin",
  "app.meta_description": "Administrative console for managing NabeCMS content, media, users, and settings.",
  "auth.login.title": "NabeCMS Admin",
  "auth.login.description": "Sign in",
  "contents.entries.title_suffix": "Entries",
};

const jaMessages: Record<string, string> = {
  "app.title": "NabeCMS",
  "app.meta_description": "NabeCMS のコンテンツ、メディア、ユーザー、設定を扱う管理コンソールです。",
  "auth.login.title": "NabeCMS",
  "auth.login.description": "サインイン",
  "settings.users.title": "ユーザー管理",
  "settings.users.description": "Admin Web のユーザーを管理します",
};

const createTranslator =
  (messages: Record<string, string>) =>
  (key: string): string =>
    messages[key] ?? key;

const readMeta = (doc: Document, name: string) => doc.head.querySelector(`meta[name="${name}"]`)?.getAttribute("content");

describe("documentMetadata", () => {
  it("deduplicates the app title when the page title is identical", () => {
    const metadata = resolveDocumentMetadata({
      routeName: "login",
      routeParams: {},
      locale: "en",
      t: createTranslator(enMessages),
    });

    expect(metadata.title).toBe("NabeCMS Admin");
    expect(metadata.description).toBe("Sign in");
    expect(metadata.lang).toBe("en");
  });

  it("avoids appending the app title when the page title already includes it", () => {
    const metadata = resolveDocumentMetadata({
      routeName: "login",
      routeParams: {},
      locale: "ja",
      t: createTranslator(jaMessages),
    });

    expect(metadata.title).toBe("NabeCMS");
    expect(metadata.description).toBe("サインイン");
  });

  it("includes route parameters for scoped content pages", () => {
    const metadata = resolveDocumentMetadata({
      routeName: "model-entries",
      routeParams: { modelId: "articles" },
      locale: "en",
      t: createTranslator(enMessages),
    });

    expect(metadata.title).toBe("articles | Entries | NabeCMS Admin");
    expect(metadata.description).toBe(enMessages["app.meta_description"]);
  });

  it("syncs title, lang, and meta tags into the document", () => {
    const doc = document.implementation.createHTMLDocument("metadata");

    syncDocumentMetadata(
      {
        routeName: "settings-users",
        routeParams: {},
        locale: "ja",
        t: createTranslator(jaMessages),
      },
      doc,
    );

    expect(doc.title).toBe("ユーザー管理 | NabeCMS");
    expect(doc.documentElement.lang).toBe("ja");
    expect(readMeta(doc, "application-name")).toBe("NabeCMS");
    expect(readMeta(doc, "description")).toBe("Admin Web のユーザーを管理します");
    expect(readMeta(doc, "robots")).toBe("noindex, nofollow");
    expect(readMeta(doc, "color-scheme")).toBe("light");
    expect(readMeta(doc, "theme-color")).toBe(adminThemeColor);
  });
});
