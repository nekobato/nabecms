import type { LocaleRepository } from "../repositories/locales";
import type { RoleRepository } from "../repositories/roles";
import type { SettingsRepository } from "../repositories/settings";
import type { UserRepository } from "../repositories/users";
import { DEFAULT_USER_PREFERENCES } from "../lib/user-preferences";
import { SUPER_ADMIN_ROLE_ID } from "../lib/system-roles";
import { ensureSuperAdminRole } from "./system-roles";
import {
  createLocale,
  LocaleAlreadyExistsError,
  setDefaultLocale,
} from "./locales";

const SYSTEM_INITIALIZED_KEY = "system.initialized" as const;

export class InitializationAlreadyCompletedError extends Error {
  constructor() {
    super("System is already initialized");
    this.name = "InitializationAlreadyCompletedError";
  }
}

export type InitializeSsoDeps = {
  usersRepo: UserRepository;
  rolesRepo: RoleRepository;
  settingsRepo: SettingsRepository;
  localesRepo: LocaleRepository;
  now: () => Date;
};

export type InitializeSsoUser = {
  id: string;
  email: string;
  name: string;
};

export async function initializeFromSsoUser(
  deps: InitializeSsoDeps,
  params: {
    user: InitializeSsoUser;
    defaultLocale: string;
  },
): Promise<{ userId: string }> {
  const initialized = await deps.settingsRepo.findByKey(SYSTEM_INITIALIZED_KEY);
  if (initialized) {
    throw new InitializationAlreadyCompletedError();
  }

  const nowIso = deps.now().toISOString();

  await ensureSuperAdminRole({
    rolesRepo: deps.rolesRepo,
    now: deps.now,
  });

  const byId = await deps.usersRepo.findById(params.user.id);
  const byEmail = byId
    ? null
    : await deps.usersRepo.findByEmail(params.user.email);
  const targetUser = byId ?? byEmail;

  const userId = targetUser?.id ?? params.user.id;
  if (!targetUser) {
    await deps.usersRepo.insert({
      id: userId,
      email: params.user.email,
      password: "!",
      name: params.user.name,
      emailVerified: true,
      image: null,
      roleId: [SUPER_ADMIN_ROLE_ID],
      uiPreferences: DEFAULT_USER_PREFERENCES,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  } else {
    await deps.usersRepo.updateById(userId, {
      email: params.user.email,
      name: params.user.name,
      updatedAt: nowIso,
    });
  }

  await deps.usersRepo.replaceRoleIds(userId, [SUPER_ADMIN_ROLE_ID], nowIso);

  const localeDeps = {
    repo: deps.localesRepo,
    now: deps.now,
  };
  try {
    await createLocale(localeDeps, {
      code: params.defaultLocale,
      isDefault: true,
    });
  } catch (error) {
    if (error instanceof LocaleAlreadyExistsError) {
      await setDefaultLocale(localeDeps, params.defaultLocale);
    } else {
      throw error;
    }
  }

  await deps.settingsRepo.upsert(
    SYSTEM_INITIALIZED_KEY,
    {
      at: nowIso,
      by: userId,
      status: "completed",
    },
    nowIso,
  );

  return { userId };
}
