import { SUPER_ADMIN_ROLE_ID } from "../lib/system-roles";

/** Invitation targets are user-defined roles, independent of the inviter. */
export const isInvitableRole = (role: {
  id: string;
  isSystem: boolean;
}): boolean => role.id !== SUPER_ADMIN_ROLE_ID && !role.isSystem;
