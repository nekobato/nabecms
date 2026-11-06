import type { RolePermissions } from "../repositories/roles";
import type { RoleRecord } from "../repositories/roles";

/**
 * Escape a string for safe usage in a regular expression.
 * @param value - Raw string
 * @returns Escaped string
 */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Convert a permission pattern containing '*' wildcards to a RegExp.
 * @param pattern - Permission pattern
 * @returns Regular expression
 */
export function permissionPatternToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .split("*")
    .map((segment) => escapeRegExp(segment))
    .join(".*");
  return new RegExp(`^${escaped}$`);
}

/**
 * Check whether a permission pattern matches a target permission string.
 * @param pattern - Permission pattern (supports '*')
 * @param target - Required permission string
 * @returns True when pattern matches target
 */
export function matchesPermission(pattern: string, target: string): boolean {
  if (pattern === "*") return true;
  return permissionPatternToRegExp(pattern).test(target);
}

/**
 * Merge role permissions into a single allow set.
 * @param roles - Role records
 * @returns Merged permission rules
 */
export function mergeRolePermissions(roles: RoleRecord[]): RolePermissions {
  const allow: string[] = [];
  for (const role of roles) {
    const perms = role.permissions as RolePermissions | undefined;
    if (perms?.allow) allow.push(...perms.allow);
  }
  return { allow };
}

/**
 * Determine whether the permission set grants a required permission.
 * @param rules - Permission rules
 * @param required - Required permission
 * @returns True when allowed, false otherwise
 */
export function hasPermission(
  rules: RolePermissions,
  required: string,
): boolean {
  for (const allow of rules.allow) {
    if (matchesPermission(allow, required)) return true;
  }
  return false;
}
