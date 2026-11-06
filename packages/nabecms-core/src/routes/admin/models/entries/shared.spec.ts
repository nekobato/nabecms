import { describe, expect, it } from "vitest";
import { EntryQueryBudgetExceededError } from "../../../../services/entries";
import {
  handleEntriesMutationError,
  mapListFieldValue,
  mapMediaFieldValue,
  mergeSheetFields,
  resolveEntryDisplayTitle,
} from "./shared";

describe("entry shared helpers", () => {
  it("resolves the configured title field from the default locale", () => {
    expect(
      resolveEntryDisplayTitle({
        entryId: "entry_1",
        titleFieldId: "field_title",
        defaultLocale: "ja",
        fields: [
          {
            fieldId: "field_title",
            locale: "en",
            type: "text",
            value: "English title",
          },
          {
            fieldId: "field_title",
            locale: "ja",
            type: "text",
            value: "Japanese title",
          },
        ],
      }),
    ).toBe("Japanese title");
  });

  it("uses draft title fields ahead of published title fields", () => {
    const publishedFields = [
      {
        fieldId: "field_title",
        locale: "ja",
        type: "text" as const,
        value: "Published title",
      },
    ];
    const draftFields = [
      {
        fieldId: "field_title",
        locale: "ja",
        type: "text" as const,
        value: "Draft title",
      },
    ];

    expect(
      resolveEntryDisplayTitle({
        entryId: "entry_1",
        titleFieldId: "field_title",
        defaultLocale: "ja",
        fields: mergeSheetFields(draftFields, publishedFields),
      }),
    ).toBe("Draft title");
  });

  it("falls back to the entry id when the title field is blank", () => {
    expect(
      resolveEntryDisplayTitle({
        entryId: "entry_1",
        titleFieldId: "field_title",
        defaultLocale: "ja",
        fields: [
          {
            fieldId: "field_title",
            locale: "ja",
            type: "text",
            value: " ",
          },
        ],
      }),
    ).toBe("entry_1");
  });

  it("resolves multiple media IDs from JSON snapshots", () => {
    expect(mapMediaFieldValue(null, ["media_1", "media_2"])).toEqual([
      "media_1",
      "media_2",
    ]);
  });

  it("falls back to the legacy single media column", () => {
    expect(mapMediaFieldValue("media_1", null)).toBe("media_1");
  });

  it("maps missing list values to empty arrays", () => {
    expect(mapListFieldValue(null)).toEqual([]);
    expect(mapListFieldValue(["a", "b"])).toEqual(["a", "b"]);
  });

  it("maps D1 query-budget failures to a stable 400 response", async () => {
    const response = handleEntriesMutationError(
      {
        json: (body: unknown, status: number) =>
          Response.json(body, { status }),
      },
      new EntryQueryBudgetExceededError(801, 800),
      {
        fallbackCode: "ENTRY_BULK_FAILED",
        fallbackMessage: "Bulk entry action failed",
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "ENTRY_QUERY_BUDGET_EXCEEDED",
        message:
          "Entry mutation requires an estimated 801 D1 queries; maximum is 800",
        estimatedQueries: 801,
        maxQueries: 800,
      },
    });
  });
});
