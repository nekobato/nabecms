export const SUPER_ADMIN_ROLE_ID = "system.super-admin" as const;
export const LEGACY_ADMIN_ROLE_ID = "admin" as const;

const BOOTSTRAP_ADMIN_ROLE_IDS = new Set<string>([
  SUPER_ADMIN_ROLE_ID,
  LEGACY_ADMIN_ROLE_ID,
]);

/**
 * Determine whether provided role IDs include an admin-equivalent role.
 * Includes legacy `admin` for backward compatibility.
 */
export const hasBootstrapAdminRole = (roleIds: unknown): boolean => {
  if (!Array.isArray(roleIds)) return false;
  return roleIds.some(
    (roleId) =>
      typeof roleId === "string" && BOOTSTRAP_ADMIN_ROLE_IDS.has(roleId),
  );
};
