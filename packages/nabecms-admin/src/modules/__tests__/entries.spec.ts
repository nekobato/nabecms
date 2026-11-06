import { describe, it, expect } from "vitest";
import type { ModelField, EntryFieldValue } from "../entries";
import {
  buildEntryInitialValues,
  buildLocalizedEntryFieldValues,
  buildLocalizedEntryInitialValues,
  createEmptyRichTextValue,
  DEFAULT_CONTENT_LOCALE,
  normalizeEntryFields,
  resolveAvailableLocaleCodes,
  resolveDefaultLocaleCode,
  toEntryFieldValue,
  toLocaleItem,
  toModelField,
} from "../entries";

describe("buildEntryInitialValues", () => {
  const baseFields: ModelField[] = [
    {
      id: "f1",
      name: "title",
      fieldKey: "title",
      type: "text",
      required: true,
      hasLocales: true,
      isPrivate: false,
      variant: null,
      options: null,
      defaultValue: undefined,
      position: 0,
      isDisplayTitle: true,
    },
    {
      id: "f2",
      name: "content",
      fieldKey: "content",
      type: "rich_text",
      required: true,
      hasLocales: false,
      isPrivate: false,
      variant: null,
      options: null,
      defaultValue: undefined,
      position: 1,
      isDisplayTitle: false,
    },
    {
      id: "f3",
      name: "views",
      fieldKey: "views",
      type: "number",
      required: false,
      hasLocales: false,
      isPrivate: false,
      variant: null,
      options: null,
      defaultValue: undefined,
      position: 2,
      isDisplayTitle: false,
    },
    {
      id: "f4",
      name: "featured",
      fieldKey: "featured",
      type: "boolean",
      required: false,
      hasLocales: false,
      isPrivate: false,
      variant: null,
      options: null,
      defaultValue: undefined,
      position: 3,
      isDisplayTitle: false,
    },
  ];

  it("falls back to defaults when no entry field values are provided", () => {
    const result = buildEntryInitialValues(baseFields, { defaultLocale: "en" });
    expect(result.status).toBe("draft");
    expect(result.title).toBe("");
    expect(result.content).toEqual(createEmptyRichTextValue());
    expect(result.views).toBeNull();
    expect(result.featured).toBe(false);
  });

  it("prefers entry field values for the default locale", () => {
    const entryFields: EntryFieldValue[] = [
      { fieldId: "f1", locale: "en", type: "text", value: "Hello" },
      { fieldId: "f1", locale: "ja", type: "text", value: "こんにちは" },
      {
        fieldId: "f2",
        locale: "en",
        type: "rich_text",
        value: { type: "rich_text", value: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Body" }] }] } },
      },
      { fieldId: "f3", locale: "en", type: "number", value: 42 },
      { fieldId: "f4", locale: "en", type: "boolean", value: true },
    ];

    const result = buildEntryInitialValues(baseFields, {
      status: "published",
      defaultLocale: "en",
      entryFields,
    });

    expect(result.status).toBe("published");
    expect(result.title).toBe("Hello");
    expect(result.content).toEqual(entryFields[2].value);
    expect(result.views).toBe(42);
    expect(result.featured).toBe(true);
  });

  it("falls back to non-locale specific values when locale match is missing", () => {
    const entryFields: EntryFieldValue[] = [{ fieldId: "f1", locale: "ja", type: "text", value: "こんにちは" }];

    const result = buildEntryInitialValues(baseFields, {
      defaultLocale: "en",
      entryFields,
    });

    expect(result.title).toBe("こんにちは");
  });

  it("uses field defaultValue when provided", () => {
    const fieldsWithDefault: ModelField[] = [
      {
        ...baseFields[0],
        defaultValue: "Default title",
      },
    ];
    const result = buildEntryInitialValues(fieldsWithDefault, { defaultLocale: "en" });
    expect(result.title).toBe("Default title");
  });
});

describe("entry helpers", () => {
  it("normalizes locale items and resolves default locale", () => {
    const items = [
      toLocaleItem({ code: "ja", isDefault: false }),
      toLocaleItem({ code: "en", isDefault: true }),
      toLocaleItem({ code: "", isDefault: false }),
    ].filter((item): item is NonNullable<typeof item> => item !== null);

    expect(items).toEqual([
      { code: "ja", isDefault: false },
      { code: "en", isDefault: true },
    ]);
    expect(resolveDefaultLocaleCode(items)).toBe("en");
    expect(resolveAvailableLocaleCodes(items, [], "en")).toEqual(["en", "ja"]);
  });

  it("normalizes model fields with legacy aliases", () => {
    expect(
      toModelField({
        id: "field_title",
        name: "",
        fieldKey: "title",
        type: "text",
        is_unique: true,
        position: "3",
      }),
    ).toEqual(
      expect.objectContaining({
        id: "field_title",
        name: "title",
        fieldKey: "title",
        type: "text",
        isUnique: true,
        position: 3,
      }),
    );
  });

  it("normalizes entry field locale with default fallback", () => {
    expect(toEntryFieldValue({ fieldId: "field_title", type: "text", value: "hello" })).toEqual({
      fieldId: "field_title",
      locale: DEFAULT_CONTENT_LOCALE,
      type: "text",
      value: "hello",
    });
  });

  it("builds localized initial values without leaking the default locale into missing locales", () => {
    const fields: ModelField[] = [
      {
        id: "field_title",
        name: "title",
        fieldKey: "title",
        type: "text",
        required: true,
        hasLocales: true,
        isPrivate: false,
        isUnique: false,
        variant: null,
        options: null,
        defaultValue: undefined,
        position: 0,
        isDisplayTitle: true,
      },
    ];

    const entryFields: EntryFieldValue[] = [{ fieldId: "title", locale: "ja", type: "text", value: "こんにちは" }];

    expect(
      buildLocalizedEntryInitialValues(fields, entryFields, {
        localeCodes: ["en", "ja"],
        defaultLocale: "en",
        status: "draft",
      }),
    ).toEqual({
      status: "draft",
      title: {
        en: "",
        ja: "こんにちは",
      },
    });
  });

  it("can opt into default-locale fallback for localized initial values", () => {
    const fields: ModelField[] = [
      {
        id: "field_title",
        name: "title",
        fieldKey: "title",
        type: "text",
        required: true,
        hasLocales: true,
        isPrivate: false,
        isUnique: false,
        variant: null,
        options: null,
        defaultValue: undefined,
        position: 0,
        isDisplayTitle: true,
      },
    ];

    const entryFields: EntryFieldValue[] = [{ fieldId: "field_title", locale: "en", type: "text", value: "Hello" }];

    expect(
      buildLocalizedEntryInitialValues(fields, entryFields, {
        localeCodes: ["en", "ja"],
        defaultLocale: "en",
        status: "draft",
        fallbackToDefaultLocale: true,
      }),
    ).toEqual({
      status: "draft",
      title: {
        en: "Hello",
        ja: "Hello",
      },
    });
  });

  it("builds localized field payloads without injecting extra locales", () => {
    const fields: ModelField[] = [
      {
        id: "field_title",
        name: "title",
        fieldKey: "title",
        type: "text",
        required: true,
        hasLocales: true,
        isPrivate: false,
        isUnique: false,
        variant: null,
        options: null,
        defaultValue: undefined,
        position: 0,
        isDisplayTitle: true,
      },
      {
        id: "field_featured",
        name: "featured",
        fieldKey: "featured",
        type: "boolean",
        required: false,
        hasLocales: false,
        isPrivate: false,
        isUnique: false,
        variant: null,
        options: null,
        defaultValue: undefined,
        position: 1,
        isDisplayTitle: false,
      },
    ];

    expect(
      buildLocalizedEntryFieldValues(
        fields,
        {
          title: { ja: "こんにちは" },
          featured: true,
        },
        {
          localeCodes: ["ja"],
          defaultLocale: "en",
        },
      ),
    ).toEqual([
      { fieldId: "field_title", locale: "ja", type: "text", value: "こんにちは" },
      { fieldId: "field_featured", locale: "en", type: "boolean", value: true },
    ]);
  });

  it("normalizes sheet fields from sparse payloads", () => {
    const fields: ModelField[] = [
      {
        id: "field_title",
        name: "title",
        fieldKey: "title",
        type: "text",
        required: true,
        hasLocales: true,
        isPrivate: false,
        isUnique: false,
        variant: null,
        options: null,
        defaultValue: undefined,
        position: 0,
        isDisplayTitle: true,
      },
      {
        id: "field_featured",
        name: "featured",
        fieldKey: "featured",
        type: "boolean",
        required: false,
        hasLocales: false,
        isPrivate: false,
        isUnique: false,
        variant: null,
        options: null,
        defaultValue: undefined,
        position: 1,
        isDisplayTitle: false,
      },
    ];

    const sparse: EntryFieldValue[] = [{ fieldId: "title", locale: "ja", type: "text", value: "こんにちは" }];

    expect(normalizeEntryFields(sparse, fields, ["ja"], "en")).toEqual([
      { fieldId: "field_title", locale: "ja", type: "text", value: "こんにちは" },
      { fieldId: "field_featured", locale: "en", type: "boolean", value: false },
    ]);
  });
});
