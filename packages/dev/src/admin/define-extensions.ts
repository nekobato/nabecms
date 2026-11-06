/**
 * One top-level admin page contributed by the host app.
 *
 * @internal Internal v2 prototype. Not part of the v1 public contract.
 */
export type AdminSidebarPageExtension = {
  id: string;
  label: string;
  icon: string;
  path: `/${string}`;
  routeName: string;
  component: unknown;
  order?: number;
};

/**
 * One settings page contributed by the host app.
 *
 * @internal Internal v2 prototype. Not part of the v1 public contract.
 */
export type AdminSettingsPageExtension = {
  id: string;
  label: string;
  icon: string;
  path: string;
  routeName: string;
  component: unknown;
  order?: number;
};

/**
 * CSS custom properties overridden by the host app.
 *
 * @internal Internal v2 prototype. Not part of the v1 public contract.
 */
export type AdminThemeTokenOverrides = Readonly<Record<`--${string}`, string>>;

/**
 * Admin extension surface owned by the host app.
 *
 * @internal Internal v2 prototype. Not part of the v1 public contract.
 */
export type AppAdminExtensions = {
  sidebarPages?: readonly AdminSidebarPageExtension[];
  settingsPages?: readonly AdminSettingsPageExtension[];
  themeTokens?: AdminThemeTokenOverrides;
};

/**
 * Define host-owned admin extensions for the internal v2 prototype.
 *
 * @internal Internal v2 prototype. Not part of the v1 public contract.
 */
export const defineAdminExtensions = (
  extensions: AppAdminExtensions,
): AppAdminExtensions => extensions;
