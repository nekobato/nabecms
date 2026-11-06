import {
  defineAdminExtensions,
  type AppAdminExtensions,
  type AdminSettingsPageExtension,
  type AdminSidebarPageExtension,
  type AdminThemeTokenOverrides,
} from "./define-extensions";

/**
 * Host-owned admin extension bundle consumed by the admin application build.
 *
 * @internal Internal v2 prototype. Not part of the v1 public contract.
 */
export const appAdminExtensions = defineAdminExtensions({});

export type {
  AppAdminExtensions,
  AdminSettingsPageExtension,
  AdminSidebarPageExtension,
  AdminThemeTokenOverrides,
};
