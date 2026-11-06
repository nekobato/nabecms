import { z } from "zod";
import type { RoleRepository } from "../repositories/roles";
import type {
  UserRepository,
  UserRecord,
  UserInsert,
} from "../repositories/users";
import type { AuthRepository } from "../repositories/auth";
import { DEFAULT_USER_PREFERENCES } from "../lib/user-preferences";

const CREDENTIAL_PROVIDER_ID = "credential";
const LEGACY_PASSWORD_PLACEHOLDER = "!";

export type UsersServiceDeps = {
  repo: UserRepository;
  rolesRepo: RoleRepository;
  authRepo: AuthRepository;
  now: () => Date;
  generateId: (prefix: "user" | "authacct") => string;
  hashPassword: (password: string) => Promise<string>;
  /** Set only from the authenticated actor; defaults to denying system user changes. */
  canModifySystemUser?: boolean;
  /** Authenticated actor identity; never taken from the update payload. */
  actorId?: string;
};

export type PublicUser = {
  id: string;
  email: string;
  name: string;
  roleIds: string[];
  createdAt: string;
  updatedAt: string;
  isSystemUser: boolean;
};

export type CreateUserParams = {
  name: string;
  email: string;
  password?: string;
  roleIds: string[];
};

export type UpdateUserParams = Partial<{
  name: string;
  email: string;
  roleIds: string[];
}>;

const emailSchema = z.string().trim().email();
const passwordSchema = z.string().min(8);

const normalizeEmail = (email: string) =>
  emailSchema.parse(email).toLowerCase();
const normalizeName = (name: string) => {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error("Name must not be empty");
  }
  return trimmed;
};

const normalizeRoleIds = (roleIds: string[]): string[] => {
  const unique = Array.from(
    new Set(
      roleIds
        .map((roleId) => roleId.trim())
        .filter((roleId) => roleId.length > 0),
    ),
  );
  if (unique.length === 0) {
    throw new InvalidUserRoleError("At least one role is required");
  }
  return unique;
};

/** Keep privileged targets protected while either persisted role form claims it. */
const hasSuperAdminRole = (record: UserRecord, roleIds: string[]): boolean =>
  roleIds.includes("system.super-admin") ||
  record.roleId?.includes("system.super-admin") === true;

const toPublicUser = (record: UserRecord, roleIds: string[]): PublicUser => ({
  id: record.id,
  email: record.email,
  name: record.name,
  roleIds,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  isSystemUser: hasSuperAdminRole(record, roleIds),
});

const normalizePasswordInput = async (
  deps: UsersServiceDeps,
  password: string | undefined,
) => {
  if (password === undefined) {
    return null;
  }
  const trimmed = password.trim();
  passwordSchema.parse(trimmed);
  return await deps.hashPassword(trimmed);
};

export class UserAlreadyExistsError extends Error {
  constructor(public readonly email: string) {
    super(`User with email '${email}' already exists`);
  }
}

export class UserNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`User '${id}' not found`);
  }
}

export class InvalidUserRoleError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export class InvalidUserUpdateError extends Error {}
export class UserEmailAuthorizationError extends Error {}

export class SystemUserModificationError extends Error {
  constructor() {
    super("System user cannot be modified");
  }
}

export class SystemUserAuthorizationError extends SystemUserModificationError {}

const ensureRolesExist = async (
  deps: UsersServiceDeps,
  roleIds: string[],
): Promise<void> => {
  const records = await deps.rolesRepo.findManyByIds(roleIds);
  if (records.length !== roleIds.length) {
    throw new InvalidUserRoleError("Unknown role specified");
  }
};

const ensureEmailAvailable = async (
  deps: UsersServiceDeps,
  email: string,
  excludeUserId?: string,
) => {
  const existing = await deps.repo.findByEmail(email);
  if (existing && existing.id !== excludeUserId) {
    throw new UserAlreadyExistsError(email);
  }
};

const upsertCredentialAccount = async (
  deps: UsersServiceDeps,
  userId: string,
  passwordHash: string,
  now: Date,
) => {
  const existing = await deps.authRepo.findCredentialAccountByUserId(userId);
  if (existing) {
    await deps.authRepo.updateCredentialPassword(
      existing.id,
      passwordHash,
      now,
    );
    return;
  }
  await deps.authRepo.createCredentialAccount({
    id: deps.generateId("authacct"),
    userId,
    providerId: CREDENTIAL_PROVIDER_ID,
    accountId: userId,
    password: passwordHash,
    createdAt: now,
    updatedAt: now,
  });
};

export async function listUsers(deps: UsersServiceDeps): Promise<PublicUser[]> {
  const records = await deps.repo.list();
  const roleMap = await deps.repo.listRoleIdsByUserIds(
    records.map((record) => record.id),
  );
  return records.map((record) =>
    toPublicUser(record, roleMap[record.id] ?? []),
  );
}

export async function createUser(
  deps: UsersServiceDeps,
  params: CreateUserParams,
): Promise<PublicUser> {
  const name = normalizeName(params.name);
  const email = normalizeEmail(params.email);
  const roleIds = normalizeRoleIds(params.roleIds ?? []);
  const now = deps.now();
  const nowIso = now.toISOString();

  await ensureRolesExist(deps, roleIds);
  await ensureEmailAvailable(deps, email);

  const passwordHash = await normalizePasswordInput(deps, params.password);
  const userId = deps.generateId("user");

  await deps.repo.insert({
    id: userId,
    email,
    password: LEGACY_PASSWORD_PLACEHOLDER,
    name,
    roleId: [],
    uiPreferences: DEFAULT_USER_PREFERENCES,
    createdAt: nowIso,
    updatedAt: nowIso,
  } as UserInsert);
  await deps.repo.replaceRoleIds(userId, roleIds, nowIso);

  if (passwordHash) {
    await upsertCredentialAccount(deps, userId, passwordHash, now);
  }

  const created = await deps.repo.findById(userId);
  if (!created) {
    throw new Error("Failed to create user");
  }

  return toPublicUser(created, roleIds);
}

export async function updateUser(
  deps: UsersServiceDeps,
  userId: string,
  params: UpdateUserParams,
): Promise<PublicUser> {
  if ("password" in params) {
    throw new InvalidUserUpdateError("Use the email password reset flow");
  }
  const target = await deps.repo.findById(userId);
  if (!target) {
    throw new UserNotFoundError(userId);
  }

  const currentRoles = await deps.repo.listRoleIdsByUserId(target.id);
  const isSystemUser = hasSuperAdminRole(target, currentRoles);
  if (isSystemUser && !deps.canModifySystemUser) {
    throw new SystemUserAuthorizationError();
  }
  const now = deps.now();
  const nowIso = now.toISOString();
  const updates: Partial<Pick<UserRecord, "name" | "email">> = {};

  if (params.name !== undefined) {
    updates.name = normalizeName(params.name);
  }
  if (params.email !== undefined) {
    const email = normalizeEmail(params.email);
    if (email !== target.email) {
      if (deps.actorId !== target.id) {
        throw new UserEmailAuthorizationError(
          "Only the user can change their email",
        );
      }
      await ensureEmailAvailable(deps, email, target.id);
      updates.email = email;
    }
  }

  let nextRoles = currentRoles;
  if (params.roleIds !== undefined) {
    nextRoles = normalizeRoleIds(params.roleIds);
    await ensureRolesExist(deps, nextRoles);
    if (nextRoles.includes("system.super-admin") && !deps.canModifySystemUser) {
      throw new SystemUserAuthorizationError();
    }
  }

  if (
    params.roleIds !== undefined &&
    isSystemUser &&
    !nextRoles.includes("system.super-admin")
  ) {
    throw new SystemUserModificationError();
  }

  const saved = await deps.repo.updateManagedUser(target.id, {
    values: updates,
    roleIds: params.roleIds === undefined ? undefined : nextRoles,
    updatedAt: nowIso,
    canModifySystemUser: deps.canModifySystemUser === true,
    actorId: deps.actorId,
    revokeSessions: params.roleIds !== undefined || updates.email !== undefined,
  });
  if (!saved) {
    if (!(await deps.repo.findById(target.id))) {
      throw new UserNotFoundError(target.id);
    }
    if (!deps.canModifySystemUser) {
      throw new SystemUserAuthorizationError();
    }
    throw new SystemUserModificationError();
  }

  const updated = await deps.repo.findById(target.id);
  if (!updated) {
    throw new Error("Failed to fetch updated user");
  }
  const updatedRoleIds = await deps.repo.listRoleIdsByUserId(target.id);
  return toPublicUser(updated, updatedRoleIds);
}

export async function deleteUser(
  deps: UsersServiceDeps,
  userId: string,
): Promise<void> {
  const target = await deps.repo.findById(userId);
  if (!target) {
    throw new UserNotFoundError(userId);
  }
  const roleIds = await deps.repo.listRoleIdsByUserId(target.id);
  if (hasSuperAdminRole(target, roleIds)) {
    throw new SystemUserModificationError();
  }

  if (!(await deps.repo.deleteManagedUser(userId))) {
    if (!(await deps.repo.findById(userId))) {
      throw new UserNotFoundError(userId);
    }
    throw new SystemUserModificationError();
  }
}
