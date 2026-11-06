import type { UserRepository } from "../repositories/users";

export class SignupNotAllowedError extends Error {
  constructor() {
    super("Signup is not allowed in login flow");
    this.name = "SignupNotAllowedError";
  }
}

export type SsoLoginDeps = {
  usersRepo: UserRepository;
};

export async function resolveSsoLoginUser(
  deps: SsoLoginDeps,
  params: {
    user: {
      id: string;
      email: string;
    };
  },
): Promise<{ userId: string; roleIds: string[] }> {
  const userById = await deps.usersRepo.findById(params.user.id);
  const userByEmail = userById
    ? null
    : await deps.usersRepo.findByEmail(params.user.email);
  const targetUser = userById ?? userByEmail;
  if (!targetUser) {
    throw new SignupNotAllowedError();
  }

  const roleIds = await deps.usersRepo.listRoleIdsByUserId(targetUser.id);
  if (roleIds.length === 0) {
    throw new SignupNotAllowedError();
  }

  return {
    userId: targetUser.id,
    roleIds,
  };
}
