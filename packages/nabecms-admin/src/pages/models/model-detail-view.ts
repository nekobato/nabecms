import type { Router } from "vue-router";
import { formatJapaneseDateTime } from "@/utils/dateTime";

type BooleanRefLike = Readonly<{ value: boolean }>;

/**
 * Formats timestamps for the model detail page.
 */
export const formatDateTime = (value: string | null | undefined): string => {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return formatJapaneseDateTime(date);
};

/**
 * Creates a beforeunload handler that blocks navigation while edits are unsaved.
 */
export const createBeforeUnloadHandler =
  (hasUnsavedChanges: BooleanRefLike) =>
  (event: BeforeUnloadEvent): void => {
    if (!hasUnsavedChanges.value) return;
    event.preventDefault();
    event.returnValue = "";
  };

/**
 * Installs a router guard that confirms navigation when unsaved changes exist.
 */
export const installUnsavedChangesRouteGuard = (router: Router, hasUnsavedChanges: BooleanRefLike, confirmMessage: string): (() => void) | null => {
  if (typeof router.beforeEach !== "function") return null;

  return router.beforeEach((_, __, next) => {
    if (!hasUnsavedChanges.value) {
      next();
      return;
    }

    if (window.confirm(confirmMessage)) {
      next();
      return;
    }

    next(false);
  });
};
