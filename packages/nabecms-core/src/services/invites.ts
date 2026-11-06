import { z } from "zod";
import { isInvitableRole } from "../contracts/invites";
import type { RoleRepository } from "../repositories/roles";
import type { UserRepository } from "../repositories/users";
import type { AuthRepository } from "../repositories/auth";
import type {
  AuthInvitesRepository,
  AuthInviteRecord,
} from "../repositories/auth-invites";
import {
  createUser,
  InvalidUserRoleError,
  UserAlreadyExistsError,
  UsersServiceDeps,
} from "./users";

const INVITE_TOKEN_TTL_MS = 72 * 60 * 60 * 1000; // 72h fixed
const INVITE_PER_MINUTE_LIMIT = 5;

export type InviteStatus = AuthInviteRecord["status"];

export class InviteAlreadyExistsError extends Error {}
export class InviteNotFoundError extends Error {}
export class InviteExpiredError extends Error {}
export class InviteConsumedError extends Error {}
export class InviteRevokedError extends Error {}
export class InviteRateLimitError extends Error {}
export class InviteRoleAssignmentError extends Error {}

export type InviteServiceDeps = {
  invitesRepo: AuthInvitesRepository;
  rolesRepo: RoleRepository;
  usersRepo: UserRepository;
  authRepo: AuthRepository;
  now: () => Date;
  generateId: (
    prefix: "invite" | "user" | "authacct" | "authid" | "cred" | "sess" | "rft",
  ) => string;
  randomToken: () => string;
  hashToken: (token: string) => Promise<string>;
  hashPassword: (password: string) => Promise<string>;
  sealToken?: (
    inviteId: string,
    token: string,
    expiresAt: string,
  ) => Promise<string>;
};

const emailSchema = z.string().trim().email();

const normalizeEmail = (email: string) =>
  emailSchema.parse(email).toLowerCase();

const normalizeRoleIds = (roleIds: string[] | undefined): string[] => {
  const unique = Array.from(
    new Set(
      (roleIds ?? [])
        .map((roleId) => roleId.trim())
        .filter((roleId) => roleId.length > 0),
    ),
  );
  if (unique.length === 0) {
    throw new InvalidUserRoleError("At least one role is required");
  }
  return unique;
};

export const ensureInviteRolesAllowed = async (
  deps: Pick<InviteServiceDeps, "rolesRepo">,
  roleIds: string[],
) => {
  roleIds = normalizeRoleIds(roleIds);
  if (roleIds.some((id) => !isInvitableRole({ id, isSystem: false }))) {
    throw new InviteRoleAssignmentError(
      "Invitations cannot assign Super Admin",
    );
  }
  const roles = await deps.rolesRepo.findManyByIds(roleIds);
  if (roles.length !== roleIds.length) {
    throw new InvalidUserRoleError("Unknown role specified");
  }
  if (roles.some((role) => !isInvitableRole(role))) {
    throw new InviteRoleAssignmentError(
      "Invitations cannot assign system roles",
    );
  }
};

const generateExpiry = (now: Date) =>
  new Date(now.getTime() + INVITE_TOKEN_TTL_MS).toISOString();

export async function createInvite(
  deps: InviteServiceDeps,
  params: {
    email: string;
    roleIds?: string[];
    createdBy: string;
    metadata?: Record<string, any>;
  },
) {
  const email = normalizeEmail(params.email);
  const roleIds = normalizeRoleIds(params.roleIds);

  await ensureInviteRolesAllowed(deps, roleIds);

  const existingUser = await deps.usersRepo.findByEmail(email);
  if (existingUser) {
    throw new UserAlreadyExistsError(email);
  }

  const now = deps.now();
  const since = new Date(now.getTime() - 60 * 1000).toISOString();
  const count = await deps.invitesRepo.countCreatedBySince(
    params.createdBy,
    since,
  );
  if (count >= INVITE_PER_MINUTE_LIMIT) {
    throw new InviteRateLimitError("Invite creation rate limit exceeded");
  }

  // If existing active invite and not expired, reject
  const active = await deps.invitesRepo.findActiveByEmail(email);
  if (active) {
    const expires = new Date(active.tokenExpiresAt).getTime();
    if (expires > now.getTime() && active.status !== "expired") {
      throw new InviteAlreadyExistsError();
    }
  }

  const token = deps.randomToken();
  const tokenHash = await deps.hashToken(token);
  const expiresAt = generateExpiry(now);
  const id = deps.generateId("invite");
  const timestamp = now.toISOString();

  await deps.invitesRepo.insert({
    id,
    email,
    roleIds,
    tokenHash,
    tokenExpiresAt: expiresAt,
    status: "sent",
    sentAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    createdBy: params.createdBy,
    metadata: {
      ...params.metadata,
      ...(deps.sealToken
        ? { emailToken: await deps.sealToken(id, token, expiresAt) }
        : {}),
    },
  });

  return { inviteId: id, token, expiresAt };
}

export async function regenerateInvite(
  deps: InviteServiceDeps,
  inviteId: string,
  actorId: string,
) {
  const invite = await deps.invitesRepo.findById(inviteId);
  if (!invite) throw new InviteNotFoundError();
  if (!["pending", "sent"].includes(invite.status)) {
    throw new InviteConsumedError();
  }
  await ensureInviteRolesAllowed(deps, invite.roleIds ?? []);

  const now = deps.now();
  const token = deps.randomToken();
  const tokenHash = await deps.hashToken(token);
  const expiresAt = generateExpiry(now);
  const timestamp = now.toISOString();

  await deps.invitesRepo.updateById(inviteId, {
    tokenHash,
    tokenExpiresAt: expiresAt,
    status: "sent",
    sentAt: timestamp,
    updatedAt: timestamp,
    createdBy: actorId,
    metadata: {
      ...invite.metadata,
      emailDelivery: null,
      emailToken: deps.sealToken
        ? await deps.sealToken(inviteId, token, expiresAt)
        : null,
    },
  });

  return { inviteId, token, expiresAt };
}

export async function listInvites(
  deps: InviteServiceDeps,
  filter?: { status?: InviteStatus[]; email?: string; limit?: number },
) {
  const normalizedEmail = filter?.email
    ? normalizeEmail(filter.email)
    : undefined;
  return deps.invitesRepo.list({
    status: filter?.status,
    email: normalizedEmail,
    limit: filter?.limit ?? 100,
  });
}

type InviteResolution =
  | { ok: true; invite: AuthInviteRecord }
  | { ok: false; reason: "not_found" | "expired" | "revoked" | "consumed" };

export async function resolveInviteByToken(
  deps: InviteServiceDeps,
  token: string,
): Promise<InviteResolution> {
  const tokenHash = await deps.hashToken(token);
  const invite = await deps.invitesRepo.findByTokenHash(tokenHash);
  if (!invite) return { ok: false, reason: "not_found" };
  await ensureInviteRolesAllowed(deps, invite.roleIds ?? []);

  const nowMs = deps.now().getTime();
  const expMs = new Date(invite.tokenExpiresAt).getTime();
  if (expMs <= nowMs) {
    await deps.invitesRepo.updateById(invite.id, {
      status: "expired",
      updatedAt: deps.now().toISOString(),
    });
    return { ok: false, reason: "expired" };
  }
  if (invite.status === "revoked") return { ok: false, reason: "revoked" };
  if (invite.status === "consumed") return { ok: false, reason: "consumed" };

  return { ok: true, invite };
}

export async function consumeInvite(
  deps: InviteServiceDeps,
  params: { token: string; name: string; password: string },
) {
  const resolution = await resolveInviteByToken(deps, params.token);
  if (!resolution.ok) {
    switch (resolution.reason) {
      case "expired":
        throw new InviteExpiredError();
      case "revoked":
        throw new InviteRevokedError();
      case "consumed":
        throw new InviteConsumedError();
      default:
        throw new InviteNotFoundError();
    }
  }

  const { invite } = resolution;

  // Create user via existing user service to reuse validation
  const userDeps: UsersServiceDeps = {
    repo: deps.usersRepo,
    rolesRepo: deps.rolesRepo,
    authRepo: deps.authRepo,
    now: deps.now,
    generateId: deps.generateId,
    hashPassword: deps.hashPassword,
  };

  const user = await createUser(userDeps, {
    name: params.name,
    email: invite.email,
    password: params.password,
    roleIds: Array.isArray(invite.roleIds) ? (invite.roleIds as string[]) : [],
  });

  await deps.invitesRepo.updateById(invite.id, {
    status: "consumed",
    updatedAt: deps.now().toISOString(),
  });

  return { user, invite };
}
