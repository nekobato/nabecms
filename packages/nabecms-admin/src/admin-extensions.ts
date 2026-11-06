import { appAdminExtensions, type AdminSettingsPageExtension, type AdminSidebarPageExtension, type AdminThemeTokenOverrides } from "@app-admin-extensions";

let hasWarnedInternalAdminExtensions = false;

/**
 * One normalized top-level admin page contributed by the host app.
 */
export type ResolvedAdminSidebarPage = AdminSidebarPageExtension & {
  order: number;
};

/**
 * One normalized settings page contributed by the host app.
 */
export type ResolvedAdminSettingsPage = AdminSettingsPageExtension & {
  order: number;
  fullPath: `/settings/${string}`;
};

const BUILTIN_SIDEBAR_PAGE_IDS = new Set(["dashboard", "models", "contents", "media", "logs", "settings"]);

const BUILTIN_ROUTE_NAMES = new Set([
  "dashboard",
  "login",
  "logout",
  "invite-accept",
  "initialize",
  "reset-password",
  "models",
  "logs",
  "model-create",
  "model-detail",
  "contents",
  "model-entries",
  "entry-sheet",
  "entry-create",
  "entry-edit",
  "media",
  "media-detail",
  "settings",
  "settings-locales",
  "settings-users",
  "settings-roles",
  "settings-api-keys",
  "settings-logs",
  "settings-integrations",
  "settings-hooks",
]);

const BUILTIN_SETTINGS_PAGE_IDS = new Set([
  "settings-general",
  "settings-users",
  "settings-roles",
  "settings-locales",
  "settings-api-keys",
  "settings-logs",
  "settings-integrations",
  "settings-hooks",
]);

const BUILTIN_SETTINGS_PATHS = new Set(["", "users", "roles", "locales", "api-keys", "logs", "integrations", "hooks"]);

const SETTINGS_PATH_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/**
 * Sort extension entries by explicit order and then label for stability.
 */
const compareByOrderAndLabel = (left: { order: number; label: string }, right: { order: number; label: string }): number => {
  if (left.order !== right.order) {
    return left.order - right.order;
  }
  return left.label.localeCompare(right.label, "en");
};

/**
 * Validate a top-level sidebar page extension.
 */
const normalizeSidebarPage = (
  page: AdminSidebarPageExtension,
  seenIds: Set<string>,
  seenPaths: Set<string>,
  seenRouteNames: Set<string>,
): ResolvedAdminSidebarPage => {
  if (BUILTIN_SIDEBAR_PAGE_IDS.has(page.id) || seenIds.has(page.id)) {
    throw new Error(`Duplicate admin sidebar page id "${page.id}"`);
  }

  if (seenRouteNames.has(page.routeName) || BUILTIN_ROUTE_NAMES.has(page.routeName)) {
    throw new Error(`Duplicate admin route name "${page.routeName}"`);
  }

  if (page.path === "/" || page.path.startsWith("/settings") || page.path.startsWith("/auth")) {
    throw new Error(`Admin sidebar page "${page.id}" path "${page.path}" is reserved`);
  }

  if (seenPaths.has(page.path)) {
    throw new Error(`Duplicate admin sidebar page path "${page.path}"`);
  }

  seenIds.add(page.id);
  seenPaths.add(page.path);
  seenRouteNames.add(page.routeName);

  return {
    ...page,
    order: page.order ?? 0,
  };
};

/**
 * Validate a settings page extension and derive its full route path.
 */
const normalizeSettingsPage = (
  page: AdminSettingsPageExtension,
  seenIds: Set<string>,
  seenPaths: Set<string>,
  seenRouteNames: Set<string>,
): ResolvedAdminSettingsPage => {
  if (BUILTIN_SETTINGS_PAGE_IDS.has(page.id) || seenIds.has(page.id)) {
    throw new Error(`Duplicate admin settings page id "${page.id}"`);
  }

  if (seenRouteNames.has(page.routeName) || BUILTIN_ROUTE_NAMES.has(page.routeName)) {
    throw new Error(`Duplicate admin route name "${page.routeName}"`);
  }

  if (!SETTINGS_PATH_PATTERN.test(page.path) || BUILTIN_SETTINGS_PATHS.has(page.path)) {
    throw new Error(`Admin settings page "${page.id}" path "${page.path}" is reserved or invalid`);
  }

  const fullPath = `/settings/${page.path}` as const;
  if (seenPaths.has(fullPath)) {
    throw new Error(`Duplicate admin settings page path "${fullPath}"`);
  }

  seenIds.add(page.id);
  seenPaths.add(fullPath);
  seenRouteNames.add(page.routeName);

  return {
    ...page,
    order: page.order ?? 0,
    fullPath,
  };
};

/**
 * Normalize and validate host-owned admin extensions.
 */
const resolveAdminExtensions = () => {
  const seenSidebarIds = new Set<string>();
  const seenSettingsIds = new Set<string>();
  const seenPaths = new Set<string>([
    "/",
    "/models",
    "/contents",
    "/media",
    "/logs",
    "/settings",
    "/settings/users",
    "/settings/roles",
    "/settings/locales",
    "/settings/api-keys",
    "/settings/integrations",
    "/settings/hooks",
  ]);
  const seenRouteNames = new Set<string>();

  const sidebarPages = [...(appAdminExtensions.sidebarPages ?? [])]
    .map((page) => normalizeSidebarPage(page, seenSidebarIds, seenPaths, seenRouteNames))
    .sort(compareByOrderAndLabel);

  const settingsPages = [...(appAdminExtensions.settingsPages ?? [])]
    .map((page) => normalizeSettingsPage(page, seenSettingsIds, seenPaths, seenRouteNames))
    .sort(compareByOrderAndLabel);

  const themeTokens = Object.entries(appAdminExtensions.themeTokens ?? {}).reduce<Record<string, string>>((acc, [key, value]) => {
    if (!key.startsWith("--")) {
      throw new Error(`Admin theme token "${key}" must be a CSS custom property`);
    }
    acc[key] = value;
    return acc;
  }, {});

  if (!hasWarnedInternalAdminExtensions && (sidebarPages.length > 0 || settingsPages.length > 0 || Object.keys(themeTokens).length > 0)) {
    hasWarnedInternalAdminExtensions = true;
    console.warn("[nabecms-admin] Host app admin extensions are an internal prototype in v1 and are not covered by compatibility guarantees.");
  }

  return {
    sidebarPages,
    settingsPages,
    themeTokens,
  };
};

const resolvedAdminExtensions = resolveAdminExtensions();

/**
 * Normalized top-level sidebar pages from the host app.
 */
export const adminSidebarPageExtensions = resolvedAdminExtensions.sidebarPages;

/**
 * Normalized settings pages from the host app.
 */
export const adminSettingsPageExtensions = resolvedAdminExtensions.settingsPages;

/**
 * Theme token overrides contributed by the host app.
 */
export const adminThemeTokenOverrides = resolvedAdminExtensions.themeTokens satisfies AdminThemeTokenOverrides;

/**
 * Apply host-defined theme token overrides to the current document root.
 */
export const applyAdminThemeTokens = (style: CSSStyleDeclaration): void => {
  Object.entries(adminThemeTokenOverrides).forEach(([token, value]) => {
    style.setProperty(token, value);
  });
};
