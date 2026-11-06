import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRepository } from "../repositories/users";
import {
  resolveSsoLoginUser,
  SignupNotAllowedError,
  type SsoLoginDeps,
} from "./sso-login";

describe("sso login service", () => {
  let usersRepo: UserRepository;
  let deps: SsoLoginDeps;

  beforeEach(() => {
    usersRepo = {
      list: vi.fn(),
      findById: vi.fn(async () => null),
      findByEmail: vi.fn(async () => null),
      findManyByIds: vi.fn(),
      listRoleIdsByUserId: vi.fn(async () => []),
      listRoleIdsByUserIds: vi.fn(),
      replaceRoleIds: vi.fn(),
      insert: vi.fn(),
      updateById: vi.fn(),
      deleteById: vi.fn(),
    } as unknown as UserRepository;

    deps = {
      usersRepo,
    };
  });

  it("resolves an existing user with assigned roles", async () => {
    (usersRepo.findById as any).mockResolvedValue({
      id: "user_1",
      email: "member@example.com",
      password: "!",
      name: "Member",
      emailVerified: true,
      image: null,
      roleId: ["role.editor"],
      uiPreferences: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    (usersRepo.listRoleIdsByUserId as any).mockResolvedValue(["role.editor"]);

    const result = await resolveSsoLoginUser(deps, {
      user: {
        id: "user_1",
        email: "member@example.com",
      },
    });

    expect(result).toEqual({
      userId: "user_1",
      roleIds: ["role.editor"],
    });
  });

  it("throws SIGNUP_NOT_ALLOWED when user is missing", async () => {
    await expect(
      resolveSsoLoginUser(deps, {
        user: {
          id: "user_404",
          email: "new@example.com",
        },
      }),
    ).rejects.toBeInstanceOf(SignupNotAllowedError);
  });

  it("throws SIGNUP_NOT_ALLOWED when user has no roles", async () => {
    (usersRepo.findByEmail as any).mockResolvedValue({
      id: "user_2",
      email: "member@example.com",
      password: "!",
      name: "Member",
      emailVerified: true,
      image: null,
      roleId: [],
      uiPreferences: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    await expect(
      resolveSsoLoginUser(deps, {
        user: {
          id: "external_id",
          email: "member@example.com",
        },
      }),
    ).rejects.toBeInstanceOf(SignupNotAllowedError);
  });
});
