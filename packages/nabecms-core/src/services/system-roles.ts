import type { RoleRepository } from "../repositories/roles";
import { SUPER_ADMIN_ROLE_ID } from "../lib/system-roles";

export type SystemRolesDeps = {
  rolesRepo: Pick<RoleRepository, "findById" | "insert">;
  now: () => Date;
};

/**
 * Ensure the reserved Super Admin role exists before assigning it to a user.
 *
 * @param deps - Role repository and clock dependencies
 * @returns Promise that resolves after the role is present
 */
export async function ensureSuperAdminRole(
  deps: SystemRolesDeps,
): Promise<void> {
  const existingRole = await deps.rolesRepo.findById(SUPER_ADMIN_ROLE_ID);
  if (existingRole) return;

  const nowIso = deps.now().toISOString();
  await deps.rolesRepo.insert({
    id: SUPER_ADMIN_ROLE_ID,
    name: "Super Admin",
    description: "System reserved role with full privileges",
    permissions: { allow: ["*"] },
    isSystem: true,
    createdAt: nowIso,
    updatedAt: nowIso,
  });
}
