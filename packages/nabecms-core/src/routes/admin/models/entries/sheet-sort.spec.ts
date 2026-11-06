import { describe, expect, it } from "vitest";
import { parseSheetSort, sortSheetItems } from "./sheet-sort";

describe("sheet-sort helpers", () => {
  it("parses supported system and field sort keys", () => {
    expect(parseSheetSort("updatedAt", "desc")).toEqual({
      sortBy: "updatedAt",
      sortOrder: "desc",
    });
    expect(parseSheetSort("field:title", null)).toEqual({
      sortBy: "field:title",
      sortOrder: "asc",
    });
    expect(parseSheetSort("field:", "asc")).toBeNull();
    expect(parseSheetSort("unknown", "asc")).toBeNull();
  });

  it("sorts system columns by updatedBy display name", () => {
    const items = [
      {
        id: "entry_b",
        displayTitle: "Second",
        status: "draft",
        updatedAt: "2025-01-02T00:00:00.000Z",
        updatedBy: "user_z",
        updatedByName: "Zed",
        fields: [],
      },
      {
        id: "entry_a",
        displayTitle: "First",
        status: "draft",
        updatedAt: "2025-01-01T00:00:00.000Z",
        updatedBy: "user_a",
        updatedByName: "Alice",
        fields: [],
      },
    ];

    expect(
      sortSheetItems(items, {
        sort: { sortBy: "updatedBy", sortOrder: "asc" },
        locale: "ja",
        defaultLocale: "en",
        modelFields: [],
      }).map((item) => item.id),
    ).toEqual(["entry_a", "entry_b"]);
  });

  it("sorts localized fields by active locale with default-locale fallback", () => {
    const items = [
      {
        id: "entry_1",
        displayTitle: "One",
        status: "draft",
        updatedAt: "2025-01-01T00:00:00.000Z",
        updatedBy: "user_1",
        updatedByName: null,
        fields: [
          {
            fieldId: "title",
            locale: "en",
            type: "text" as const,
            value: "Banana",
          },
        ],
      },
      {
        id: "entry_2",
        displayTitle: "Two",
        status: "draft",
        updatedAt: "2025-01-01T00:00:00.000Z",
        updatedBy: "user_2",
        updatedByName: null,
        fields: [
          {
            fieldId: "title",
            locale: "en",
            type: "text" as const,
            value: "Apple",
          },
          {
            fieldId: "title",
            locale: "ja",
            type: "text" as const,
            value: "Orange",
          },
        ],
      },
    ];

    expect(
      sortSheetItems(items, {
        sort: { sortBy: "field:title", sortOrder: "asc" },
        locale: "ja",
        defaultLocale: "en",
        modelFields: [{ id: "title", type: "text", hasLocales: true }],
      }).map((item) => item.id),
    ).toEqual(["entry_1", "entry_2"]);
  });

  it("sorts number fields descending and keeps empty values last", () => {
    const items = [
      {
        id: "entry_1",
        displayTitle: "One",
        status: "draft",
        updatedAt: "2025-01-01T00:00:00.000Z",
        updatedBy: "user_1",
        updatedByName: null,
        fields: [
          {
            fieldId: "views",
            locale: "en",
            type: "number" as const,
            value: 10,
          },
        ],
      },
      {
        id: "entry_2",
        displayTitle: "Two",
        status: "draft",
        updatedAt: "2025-01-01T00:00:00.000Z",
        updatedBy: "user_2",
        updatedByName: null,
        fields: [
          {
            fieldId: "views",
            locale: "en",
            type: "number" as const,
            value: null,
          },
        ],
      },
      {
        id: "entry_3",
        displayTitle: "Three",
        status: "draft",
        updatedAt: "2025-01-01T00:00:00.000Z",
        updatedBy: "user_3",
        updatedByName: null,
        fields: [
          {
            fieldId: "views",
            locale: "en",
            type: "number" as const,
            value: 42,
          },
        ],
      },
    ];

    expect(
      sortSheetItems(items, {
        sort: { sortBy: "field:views", sortOrder: "desc" },
        locale: "en",
        defaultLocale: "en",
        modelFields: [{ id: "views", type: "number", hasLocales: false }],
      }).map((item) => item.id),
    ).toEqual(["entry_3", "entry_1", "entry_2"]);
  });
});
