import { encodeResourceId } from "@/utils/resourceId";
/**
 * Shared view helpers for the entry sheet page.
 */

export type SheetMode = "draft" | "published";

export type SheetSortOrder = "asc" | "desc";

export type SheetSystemSortKey = "displayTitle" | "status" | "updatedAt" | "updatedBy";

export type SheetSortBy = SheetSystemSortKey | `field:${string}`;

export type SheetSortState = {
  sortBy: SheetSortBy;
  sortOrder: SheetSortOrder;
};

/**
 * Build the admin API request path for the current entry sheet state.
 */
export const buildEntrySheetRequestPath = (params: { modelId: string; mode: SheetMode; locale: string; sort: SheetSortState | null }): string => {
  const searchParams = new URLSearchParams();
  searchParams.set("mode", params.mode);
  searchParams.set("locale", params.locale);

  if (params.sort) {
    searchParams.set("sortBy", params.sort.sortBy);
    searchParams.set("sortOrder", params.sort.sortOrder);
  }

  return `/api/admin/models/${encodeResourceId(params.modelId)}/entries/sheet?${searchParams.toString()}`;
};

/**
 * Toggle the sort state for a header click.
 */
export const toggleSheetSort = (current: SheetSortState | null, sortBy: SheetSortBy): SheetSortState => {
  if (!current || current.sortBy !== sortBy) {
    return { sortBy, sortOrder: "asc" };
  }

  return {
    sortBy,
    sortOrder: current.sortOrder === "asc" ? "desc" : "asc",
  };
};

/**
 * Resolve whether the sheet currently has unsaved changes.
 */
export const hasEntrySheetUnsavedChanges = (dirtyEntryIds: ReadonlySet<string> | readonly string[], hasDirtyDialog: boolean): boolean =>
  hasDirtyDialog || ("size" in dirtyEntryIds ? dirtyEntryIds.size > 0 : dirtyEntryIds.length > 0);

/**
 * Resolve whether the current sort depends on a localized field.
 */
export const isLocalizedFieldSort = (sort: SheetSortState | null, fields: ReadonlyArray<{ id: string; hasLocales: boolean }>): boolean => {
  if (!sort || !sort.sortBy.startsWith("field:")) return false;
  const fieldId = sort.sortBy.slice("field:".length);
  return fields.some((field) => field.id === fieldId && field.hasLocales);
};
