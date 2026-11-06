import { describe, expect, it } from "vitest";
import { buildEntrySheetRequestPath, hasEntrySheetUnsavedChanges, isLocalizedFieldSort, toggleSheetSort, type SheetSortState } from "../entry-sheet-view";

describe("entry-sheet-view helpers", () => {
  it("builds an API path with mode, locale, and sort parameters", () => {
    expect(
      buildEntrySheetRequestPath({
        modelId: "posts",
        mode: "draft",
        locale: "ja",
        sort: {
          sortBy: "field:title",
          sortOrder: "desc",
        },
      }),
    ).toBe("/api/admin/models/posts/entries/sheet?mode=draft&locale=ja&sortBy=field%3Atitle&sortOrder=desc");
  });

  it("toggles sort direction for the same header", () => {
    const initial = toggleSheetSort(null, "displayTitle");
    expect(initial).toEqual<SheetSortState>({
      sortBy: "displayTitle",
      sortOrder: "asc",
    });

    expect(toggleSheetSort(initial, "displayTitle")).toEqual<SheetSortState>({
      sortBy: "displayTitle",
      sortOrder: "desc",
    });
  });

  it("resets to ascending when switching columns", () => {
    expect(toggleSheetSort({ sortBy: "displayTitle", sortOrder: "desc" }, "field:summary")).toEqual<SheetSortState>({
      sortBy: "field:summary",
      sortOrder: "asc",
    });
  });

  it("detects unsaved changes from rows or the detail dialog", () => {
    expect(hasEntrySheetUnsavedChanges(new Set<string>(), false)).toBe(false);
    expect(hasEntrySheetUnsavedChanges(new Set(["entry_1"]), false)).toBe(true);
    expect(hasEntrySheetUnsavedChanges([], true)).toBe(true);
  });

  it("detects localized field sorting", () => {
    const fields = [
      { id: "title", hasLocales: true },
      { id: "slug", hasLocales: false },
    ];

    expect(isLocalizedFieldSort({ sortBy: "field:title", sortOrder: "asc" }, fields)).toBe(true);
    expect(isLocalizedFieldSort({ sortBy: "field:slug", sortOrder: "asc" }, fields)).toBe(false);
    expect(isLocalizedFieldSort({ sortBy: "updatedAt", sortOrder: "asc" }, fields)).toBe(false);
  });
});
