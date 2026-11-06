import { describe, expect, it } from "vitest";
import {
  collectEntryReferenceIds,
  removeEntryReferences,
} from "./entry-reference";

describe("collectEntryReferenceIds", () => {
  it("returns empty array for non-object inputs", () => {
    expect(collectEntryReferenceIds(null)).toEqual([]);
    expect(collectEntryReferenceIds(undefined)).toEqual([]);
    expect(collectEntryReferenceIds(42)).toEqual([]);
    expect(collectEntryReferenceIds("plain text")).toEqual([]);
  });

  it("collects entryReference ids from nested rich text nodes", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Hello" },
            { type: "entryReference", attrs: { entryId: "entry_1" } },
          ],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [
                    { type: "entryReference", attrs: { entryId: "entry_2" } },
                    { type: "entryReference", attrs: { entryId: "entry_1" } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    expect(collectEntryReferenceIds(doc)).toEqual(["entry_1", "entry_2"]);
  });

  it("attempts to parse stringified JSON values", () => {
    const value = JSON.stringify({
      type: "doc",
      content: [{ type: "entryReference", attrs: { entryId: "entry_3" } }],
    });

    expect(collectEntryReferenceIds(value)).toEqual(["entry_3"]);
  });

  it("ignores malformed nodes without entry ids", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "entryReference" },
        { type: "entryReference", attrs: { entryId: 123 } },
        { type: "paragraph", content: [{ type: "text", text: "No refs" }] },
      ],
    };

    expect(collectEntryReferenceIds(doc)).toEqual([]);
  });

  it("removes entryReference nodes for a target entry id", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "entryReference", attrs: { entryId: "entry_remove" } },
        { type: "entryReference", attrs: { entryId: "entry_keep" } },
      ],
    };

    const result = removeEntryReferences(doc, "entry_remove");

    expect(result.removed).toBe(true);
    expect(collectEntryReferenceIds(result.value)).toEqual(["entry_keep"]);
  });

  it("preserves stringified rich text values when removing references", () => {
    const value = JSON.stringify({
      type: "rich_text",
      value: {
        type: "doc",
        content: [
          { type: "entryReference", attrs: { entryId: "entry_remove" } },
          { type: "paragraph", content: [{ type: "text", text: "Body" }] },
        ],
      },
    });

    const result = removeEntryReferences(value, "entry_remove");

    expect(result.removed).toBe(true);
    expect(typeof result.value).toBe("string");
    expect(collectEntryReferenceIds(result.value)).toEqual([]);
  });
});
