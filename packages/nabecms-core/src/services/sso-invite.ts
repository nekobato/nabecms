import type { AuthInvitesRepository } from "../repositories/auth-invites";
import type { RoleRepository } from "../repositories/roles";
import type { UserRepository } from "../repositories/users";

const normalizeEmail = (value: string): string => value.trim().toLowerCase();

const normalizeRoleIds = (roleIds: string[]): string[] =>
  Array.from(
    new Set(
      roleIds
        .map((roleId) => roleId.trim())
        .filter((roleId) => roleId.length > 0),
    ),
  );

const sortedUnique = (values: string[]): string[] =>
  Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));

const isSameArray = (left: string[], right: string[]): boolean => {
  if (left.length !== right.length) {
    return false;
  }
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      return false;
    }
  }
  return true;
};

export class SsoInviteNotFoundError extends Error {
  constructor() {
    super("Invite not found");
    this.name = "SsoInviteNotFoundError";
  }
}

export class SsoInviteExpiredError extends Error {
  constructor() {
    super("Invite expired");
    this.name = "SsoInviteExpiredError";
  }
}

export class SsoInviteConsumedError extends Error {
  constructor() {
    super("Invite consumed");
    this.name = "SsoInviteConsumedError";
  }
}

export class SsoInviteRevokedError extends Error {
  constructor() {
    super("Invite revoked");
    this.name = "SsoInviteRevokedError";
  }
}

export class SsoInviteEmailMismatchError extends Error {
  constructor() {
    super("Invite email does not match social email");
    this.name = "SsoInviteEmailMismatchError";
  }
}

export class SsoInviteUserNotFoundError extends Error {
  constructor() {
    super("Social user not found after callback");
    this.name = "SsoInviteUserNotFoundError";
  }
}

export class SsoInviteRoleNotFoundError extends Error {
  constructor() {
    super("Invite references unknown role");
    this.name = "SsoInviteRoleNotFoundError";
  }
}

export type AcceptInviteFromSsoDeps = {
  invitesRepo: AuthInvitesRepository;
  usersRepo: UserRepository;
  rolesRepo: RoleRepository;
  now: () => Date;
};

export async function acceptInviteFromSsoUser(
  deps: AcceptInviteFromSsoDeps,
  params: {
    inviteTokenHash: string | null;
    user: {
      id: string;
      email: string;
    };
  },
): Promise<{ userId: string; inviteId: string; roleIds: string[] }> {
  if (!params.inviteTokenHash) {
    throw new SsoInviteNotFoundError();
  }

  const invite = await deps.invitesRepo.findByTokenHash(params.inviteTokenHash);
  if (!invite) {
    throw new SsoInviteNotFoundError();
  }

  const now = deps.now();
  const nowIso = now.toISOString();
  if (invite.status === "consumed") {
    throw new SsoInviteConsumedError();
  }
  if (invite.status === "revoked") {
    throw new SsoInviteRevokedError();
  }
  if (invite.status === "expired") {
    throw new SsoInviteExpiredError();
  }

  const expiresAtMs = new Date(invite.tokenExpiresAt).getTime();
  if (expiresAtMs <= now.getTime()) {
    await deps.invitesRepo.updateById(invite.id, {
      status: "expired",
      updatedAt: nowIso,
    });
    throw new SsoInviteExpiredError();
  }

  if (normalizeEmail(invite.email) !== normalizeEmail(params.user.email)) {
    throw new SsoInviteEmailMismatchError();
  }

  const userById = await deps.usersRepo.findById(params.user.id);
  const userByEmail = userById
    ? null
    : await deps.usersRepo.findByEmail(params.user.email);
  const user = userById ?? userByEmail;
  if (!user) {
    throw new SsoInviteUserNotFoundError();
  }

  const inviteRoleIds = normalizeRoleIds(
    Array.isArray(invite.roleIds) ? invite.roleIds : [],
  );
  if (inviteRoleIds.length > 0) {
    const roles = await deps.rolesRepo.findManyByIds(inviteRoleIds);
    if (roles.length !== inviteRoleIds.length) {
      throw new SsoInviteRoleNotFoundError();
    }
  }

  const currentRoleIds = await deps.usersRepo.listRoleIdsByUserId(user.id);
  const mergedRoleIds = sortedUnique([...currentRoleIds, ...inviteRoleIds]);
  const currentSortedRoleIds = sortedUnique(currentRoleIds);
  if (!isSameArray(currentSortedRoleIds, mergedRoleIds)) {
    await deps.usersRepo.replaceRoleIds(user.id, mergedRoleIds, nowIso);
  }

  await deps.invitesRepo.updateById(invite.id, {
    status: "consumed",
    consumedByUserId: user.id,
    updatedAt: nowIso,
  });

  return {
    userId: user.id,
    inviteId: invite.id,
    roleIds: mergedRoleIds,
  };
}
