import { describe, it, expect, beforeEach } from "vitest";
import {
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  UserAlreadyExistsError,
  UserNotFoundError,
  InvalidUserRoleError,
  InvalidUserUpdateError,
  UserEmailAuthorizationError,
  SystemUserModificationError,
  type UsersServiceDeps,
  type PublicUser,
} from "./users";
import type {
  UserRepository,
  UserRecord,
  ManagedUserUpdate,
} from "../repositories/users";
import type {
  AuthAccountInsert,
  AuthAccountRecord,
  AuthRepository,
} from "../repositories/auth";
import type { RoleRepository, RoleRecord } from "../repositories/roles";

class MockUserRepository implements UserRepository {
  records: UserRecord[] = [];
  roleByUserId = new Map<string, string[]>();
  revokedSessionsFor: string[] = [];

  constructor(
    initial: UserRecord[] = [],
    roleByUserId: Record<string, string[]> = {},
  ) {
    this.records = [...initial];
    this.roleByUserId = new Map(Object.entries(roleByUserId));
  }

  async list(): Promise<UserRecord[]> {
    return [...this.records].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
  }

  async findById(id: string): Promise<UserRecord | null> {
    return this.records.find((record) => record.id === id) ?? null;
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    return (
      this.records.find(
        (record) => record.email.toLowerCase() === email.toLowerCase(),
      ) ?? null
    );
  }

  async findManyByIds(ids: string[]): Promise<UserRecord[]> {
    return this.records.filter((record) => ids.includes(record.id));
  }

  async listRoleIdsByUserId(userId: string): Promise<string[]> {
    return [...(this.roleByUserId.get(userId) ?? [])];
  }

  async listRoleIdsByUserIds(
    userIds: string[],
  ): Promise<Record<string, string[]>> {
    return Object.fromEntries(
      userIds.map((userId) => [
        userId,
        [...(this.roleByUserId.get(userId) ?? [])],
      ]),
    );
  }

  async replaceRoleIds(
    userId: string,
    roleIds: string[],
    updatedAt: string,
  ): Promise<void> {
    this.roleByUserId.set(userId, [...roleIds]);
    this.records = this.records.map((record) =>
      record.id === userId
        ? { ...record, roleId: [...roleIds], updatedAt }
        : record,
    );
  }

  async insert(record: UserRecord): Promise<void> {
    this.records.push(record);
  }

  async updateById(
    id: string,
    values: Partial<
      Pick<
        UserRecord,
        "name" | "email" | "password" | "uiPreferences" | "updatedAt"
      >
    >,
  ): Promise<void> {
    this.records = this.records.map((record) =>
      record.id === id ? { ...record, ...values } : record,
    );
  }

  async deleteById(id: string): Promise<void> {
    this.records = this.records.filter((record) => record.id !== id);
    this.roleByUserId.delete(id);
  }

  async updateManagedUser(
    id: string,
    update: ManagedUserUpdate,
  ): Promise<boolean> {
    const target = await this.findById(id);
    if (!target) return false;
    if (update.values.email !== undefined && update.actorId !== id)
      return false;
    const roles = await this.listRoleIdsByUserId(id);
    const protectedTarget =
      roles.includes("system.super-admin") ||
      target.roleId.includes("system.super-admin");
    if (
      protectedTarget &&
      (!update.canModifySystemUser ||
        (update.roleIds !== undefined &&
          !update.roleIds.includes("system.super-admin")))
    )
      return false;
    await this.updateById(id, {
      ...update.values,
      updatedAt: update.updatedAt,
    });
    if (update.roleIds !== undefined)
      await this.replaceRoleIds(id, update.roleIds, update.updatedAt);
    if (update.revokeSessions) this.revokedSessionsFor.push(id);
    return true;
  }

  async deleteManagedUser(id: string): Promise<boolean> {
    const target = await this.findById(id);
    if (!target) return false;
    const roles = await this.listRoleIdsByUserId(id);
    if (
      roles.includes("system.super-admin") ||
      target.roleId.includes("system.super-admin")
    )
      return false;
    await this.deleteById(id);
    this.revokedSessionsFor.push(id);
    return true;
  }
}

class MockRoleRepository implements RoleRepository {
  constructor(private records: RoleRecord[]) {}

  async list(): Promise<RoleRecord[]> {
    return [...this.records];
  }

  async findById(id: string): Promise<RoleRecord | null> {
    return this.records.find((record) => record.id === id) ?? null;
  }

  async findByName(): Promise<RoleRecord | null> {
    return null;
  }

  async findManyByIds(ids: string[]): Promise<RoleRecord[]> {
    return this.records.filter((record) => ids.includes(record.id));
  }

  async insert(): Promise<void> {
    throw new Error("not implemented");
  }

  async updateById(): Promise<void> {
    throw new Error("not implemented");
  }

  async deleteById(): Promise<void> {
    throw new Error("not implemented");
  }
}

class MockAuthRepository implements AuthRepository {
  accountsByUserId = new Map<string, AuthAccountRecord>();
  revokedSessionsFor: string[] = [];

  async findCredentialAccountByUserId(userId: string) {
    return this.accountsByUserId.get(userId) ?? null;
  }

  async createCredentialAccount(record: AuthAccountInsert) {
    this.accountsByUserId.set(record.userId, {
      id: record.id,
      userId: record.userId,
      providerId: record.providerId,
      accountId: record.accountId,
      password: record.password ?? null,
      accessToken: record.accessToken ?? null,
      refreshToken: record.refreshToken ?? null,
      idToken: record.idToken ?? null,
      scope: record.scope ?? null,
      accessTokenExpiresAt: record.accessTokenExpiresAt ?? null,
      refreshTokenExpiresAt: record.refreshTokenExpiresAt ?? null,
      createdAt: record.createdAt ?? fixedNow(),
      updatedAt: record.updatedAt ?? fixedNow(),
    });
  }

  async updateCredentialPassword(
    id: string,
    password: string,
    updatedAt: Date,
  ) {
    for (const [userId, account] of this.accountsByUserId.entries()) {
      if (account.id === id) {
        this.accountsByUserId.set(userId, {
          ...account,
          password,
          updatedAt,
        });
      }
    }
  }

  async deleteSessionsByUserId(userId: string) {
    this.revokedSessionsFor.push(userId);
  }
}

const fixedNow = () => new Date("2025-10-14T20:00:00.000Z");

describe("users service", () => {
  let usersRepo: MockUserRepository;
  let rolesRepo: MockRoleRepository;
  let authRepo: MockAuthRepository;
  let deps: UsersServiceDeps;
  let idSeq = 0;

  const generateId = (prefix: "user" | "authacct") => `${prefix}_${++idSeq}`;

  beforeEach(() => {
    idSeq = 0;
    usersRepo = new MockUserRepository(
      [
        {
          id: "user_root",
          email: "root@example.com",
          password: "!",
          name: "Root",
          emailVerified: true,
          image: null,
          roleId: ["system.super-admin"],
          uiPreferences: null,
          createdAt: "2025-10-10T00:00:00.000Z",
          updatedAt: "2025-10-10T00:00:00.000Z",
        },
      ],
      { user_root: ["system.super-admin"] },
    );
    rolesRepo = new MockRoleRepository([
      {
        id: "system.super-admin",
        name: "Super Admin",
        description: "",
        permissions: { allow: ["*"] },
        isSystem: true,
        createdAt: "",
        updatedAt: "",
      },
      {
        id: "editor",
        name: "Editor",
        description: "",
        permissions: { allow: ["models:*"] },
        isSystem: false,
        createdAt: "",
        updatedAt: "",
      },
    ]);
    authRepo = new MockAuthRepository();
    deps = {
      repo: usersRepo,
      rolesRepo,
      authRepo,
      now: fixedNow,
      generateId,
      hashPassword: async (input: string) => `hashed:${input}`,
    } satisfies UsersServiceDeps;
  });

  it("lists users with roles from user_roles", async () => {
    const list = await listUsers(deps);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: "user_root",
      roleIds: ["system.super-admin"],
      isSystemUser: true,
    } satisfies Partial<PublicUser>);
  });

  it("creates user with hashed password and credential account", async () => {
    const created = await createUser(deps, {
      name: "Alice",
      email: "alice@example.com",
      password: "Secret123",
      roleIds: ["editor"],
    });

    expect(created.email).toBe("alice@example.com");
    const stored = await usersRepo.findById(created.id);
    expect(stored?.password).toBe("!");
    expect(await usersRepo.listRoleIdsByUserId(created.id)).toEqual(["editor"]);
    expect(authRepo.accountsByUserId.get(created.id)?.providerId).toBe(
      "credential",
    );
  });

  it("creates user without password", async () => {
    const created = await createUser(deps, {
      name: "Social User",
      email: "social@example.com",
      roleIds: ["editor"],
    });

    const stored = await usersRepo.findById(created.id);
    expect(stored?.password).toBe("!");
    expect(authRepo.accountsByUserId.has(created.id)).toBe(false);
  });

  it("prevents duplicate emails", async () => {
    await expect(
      createUser(deps, {
        name: "Root",
        email: "root@example.com",
        password: "Secret123",
        roleIds: ["editor"],
      }),
    ).rejects.toBeInstanceOf(UserAlreadyExistsError);
  });

  it("validates role existence", async () => {
    await expect(
      createUser(deps, {
        name: "Bob",
        email: "bob@example.com",
        password: "Secret123",
        roleIds: ["missing"],
      }),
    ).rejects.toBeInstanceOf(InvalidUserRoleError);
  });

  it("updates profile and roles without changing credentials", async () => {
    const created = await createUser(deps, {
      name: "Alice",
      email: "alice@example.com",
      password: "Secret123",
      roleIds: ["editor"],
    });

    const updated = await updateUser(
      { ...deps, canModifySystemUser: true },
      created.id,
      {
        name: "Alice Updated",
        roleIds: ["editor", "system.super-admin"],
      },
    );

    expect(updated.name).toBe("Alice Updated");
    expect(updated.roleIds).toEqual(["editor", "system.super-admin"]);
    const stored = await usersRepo.findById(created.id);
    expect(stored?.password).toBe("!");
    expect(authRepo.accountsByUserId.get(created.id)?.password).toBe(
      "hashed:Secret123",
    );
    expect(usersRepo.revokedSessionsFor).toContain(created.id);
  });

  it.each(["NewSecret123", "", null, undefined])(
    "rejects a removed password field before any mutation: %j",
    async (password) => {
      const created = await createUser(deps, {
        name: "Alice",
        email: "alice@example.com",
        password: "Secret123",
        roleIds: ["editor"],
      });
      const before = { ...(await usersRepo.findById(created.id)) };
      await expect(
        updateUser(deps, created.id, {
          name: "Unwanted change",
          ...{ password },
        }),
      ).rejects.toBeInstanceOf(InvalidUserUpdateError);
      expect(await usersRepo.findById(created.id)).toEqual(before);
      expect(authRepo.accountsByUserId.get(created.id)?.password).toBe(
        "hashed:Secret123",
      );
      expect(usersRepo.revokedSessionsFor).toEqual([]);
    },
  );

  it("updates only roles in user_roles", async () => {
    const created = await createUser(deps, {
      name: "Alice",
      email: "alice@example.com",
      roleIds: ["editor"],
    });

    await updateUser({ ...deps, canModifySystemUser: true }, created.id, {
      roleIds: ["system.super-admin"],
    });
    expect(await usersRepo.listRoleIdsByUserId(created.id)).toEqual([
      "system.super-admin",
    ]);
    expect(usersRepo.revokedSessionsFor).toContain(created.id);
  });

  it.each([false, true])(
    "rejects changing another user's reset address, super admin=%s",
    async (canModifySystemUser) => {
      const user = await createUser(deps, {
        name: "Alice",
        email: "alice@example.com",
        password: "Secret123",
        roleIds: ["editor"],
      });
      const before = { ...(await usersRepo.findById(user.id)) };
      await expect(
        updateUser(
          { ...deps, actorId: "user_root", canModifySystemUser },
          user.id,
          {
            name: "Must not save",
            email: "replacement@example.com",
            roleIds: ["editor"],
          },
        ),
      ).rejects.toBeInstanceOf(UserEmailAuthorizationError);
      expect(await usersRepo.findById(user.id)).toEqual(before);
      expect(usersRepo.revokedSessionsFor).toEqual([]);
    },
  );

  it("allows a legacy client to resend an unchanged email without writing it", async () => {
    const user = await createUser(deps, {
      name: "Alice",
      email: "alice@example.com",
      roleIds: ["editor"],
    });
    const updated = await updateUser(deps, user.id, {
      name: "Alice Updated",
      email: "ALICE@example.com",
    });
    expect(updated.name).toBe("Alice Updated");
    expect(updated.email).toBe("alice@example.com");
    expect(usersRepo.revokedSessionsFor).toEqual([]);
  });

  it("allows the authenticated user to change their own email and revokes sessions", async () => {
    const user = await createUser(deps, {
      name: "Alice",
      email: "alice@example.com",
      roleIds: ["editor"],
    });
    const updated = await updateUser({ ...deps, actorId: user.id }, user.id, {
      email: "alice-new@example.com",
    });
    expect(updated.email).toBe("alice-new@example.com");
    expect(usersRepo.revokedSessionsFor).toContain(user.id);
  });

  it("prevents updating non-existent user", async () => {
    await expect(
      updateUser(deps, "missing", { name: "x" }),
    ).rejects.toBeInstanceOf(UserNotFoundError);
  });

  it("prevents removing system role from root user", async () => {
    await expect(
      updateUser(deps, "user_root", {
        roleIds: ["editor"],
      }),
    ).rejects.toBeInstanceOf(SystemUserModificationError);
  });

  it("deletes users", async () => {
    const created = await createUser(deps, {
      name: "Alice",
      email: "alice@example.com",
      roleIds: ["editor"],
    });

    await deleteUser(deps, created.id);
    expect(await usersRepo.findById(created.id)).toBeNull();
    expect(await usersRepo.listRoleIdsByUserId(created.id)).toEqual([]);
    expect(usersRepo.revokedSessionsFor).toContain(created.id);
  });

  it("prevents deleting system users", async () => {
    await expect(deleteUser(deps, "user_root")).rejects.toBeInstanceOf(
      SystemUserModificationError,
    );
  });

  it("throws when deleting missing user", async () => {
    await expect(deleteUser(deps, "missing")).rejects.toBeInstanceOf(
      UserNotFoundError,
    );
  });
});
