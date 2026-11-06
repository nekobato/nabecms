import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AuthInviteRecord,
  AuthInvitesRepository,
} from "../repositories/auth-invites";
import type { RoleRepository } from "../repositories/roles";
import type { UserRepository } from "../repositories/users";
import {
  acceptInviteFromSsoUser,
  SsoInviteConsumedError,
  SsoInviteEmailMismatchError,
  SsoInviteExpiredError,
  SsoInviteNotFoundError,
  type AcceptInviteFromSsoDeps,
} from "./sso-invite";

describe("sso invite service", () => {
  const now = new Date("2026-02-02T00:00:00.000Z");
  const inviteBase: AuthInviteRecord = {
    id: "invite_1",
    email: "invited@example.com",
    roleIds: ["role.editor"],
    tokenHash: "hashed-token",
    tokenExpiresAt: "2026-02-02T01:00:00.000Z",
    status: "sent",
    sentAt: "2026-02-01T00:00:00.000Z",
    createdAt: "2026-02-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
    createdBy: "user_creator",
    consumedByUserId: null,
    metadata: null,
  };

  let invitesRepo: AuthInvitesRepository;
  let usersRepo: UserRepository;
  let rolesRepo: RoleRepository;
  let deps: AcceptInviteFromSsoDeps;

  beforeEach(() => {
    invitesRepo = {
      insert: vi.fn(),
      findById: vi.fn(),
      findByTokenHash: vi.fn(async () => ({ ...inviteBase })),
      findActiveByEmail: vi.fn(),
      updateById: vi.fn(async () => undefined),
      list: vi.fn(),
      countCreatedBySince: vi.fn(),
    };
    usersRepo = {
      list: vi.fn(),
      findById: vi.fn(async () => ({
        id: "user_1",
        email: "invited@example.com",
        password: "!",
        name: "Invited User",
        emailVerified: true,
        image: null,
        roleId: [],
        uiPreferences: null,
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-02-01T00:00:00.000Z",
      })),
      findByEmail: vi.fn(async () => null),
      findManyByIds: vi.fn(),
      listRoleIdsByUserId: vi.fn(async () => []),
      listRoleIdsByUserIds: vi.fn(),
      replaceRoleIds: vi.fn(async () => undefined),
      insert: vi.fn(),
      updateById: vi.fn(),
      deleteById: vi.fn(),
    } as unknown as UserRepository;
    rolesRepo = {
      list: vi.fn(),
      findById: vi.fn(),
      findByName: vi.fn(),
      findManyByIds: vi.fn(async (ids: string[]) =>
        ids.map((id) => ({
          id,
          name: id,
          description: null,
          permissions: { allow: ["*"] },
          isSystem: false,
          createdAt: "2026-02-01T00:00:00.000Z",
          updatedAt: "2026-02-01T00:00:00.000Z",
        })),
      ),
      insert: vi.fn(),
      updateById: vi.fn(),
      deleteById: vi.fn(),
    } as unknown as RoleRepository;

    deps = {
      invitesRepo,
      usersRepo,
      rolesRepo,
      now: () => now,
    };
  });

  it("consumes invite and merges role ids", async () => {
    (usersRepo.listRoleIdsByUserId as any).mockResolvedValue(["role.viewer"]);

    const result = await acceptInviteFromSsoUser(deps, {
      inviteTokenHash: "hashed-token",
      user: {
        id: "user_1",
        email: "invited@example.com",
      },
    });

    expect(result.userId).toBe("user_1");
    expect(result.inviteId).toBe("invite_1");
    expect(result.roleIds).toEqual(["role.editor", "role.viewer"]);
    expect((usersRepo.replaceRoleIds as any).mock.calls[0][1]).toEqual([
      "role.editor",
      "role.viewer",
    ]);
    expect((invitesRepo.updateById as any).mock.calls.at(-1)?.[1]).toEqual(
      expect.objectContaining({
        status: "consumed",
        consumedByUserId: "user_1",
      }),
    );
  });

  it("throws when invite email does not match social email", async () => {
    await expect(
      acceptInviteFromSsoUser(deps, {
        inviteTokenHash: "hashed-token",
        user: {
          id: "user_1",
          email: "other@example.com",
        },
      }),
    ).rejects.toBeInstanceOf(SsoInviteEmailMismatchError);
  });

  it("marks invite as expired when token is stale", async () => {
    (invitesRepo.findByTokenHash as any).mockResolvedValue({
      ...inviteBase,
      tokenExpiresAt: "2026-02-01T23:00:00.000Z",
    });

    await expect(
      acceptInviteFromSsoUser(deps, {
        inviteTokenHash: "hashed-token",
        user: {
          id: "user_1",
          email: "invited@example.com",
        },
      }),
    ).rejects.toBeInstanceOf(SsoInviteExpiredError);

    expect((invitesRepo.updateById as any).mock.calls[0][1]).toEqual(
      expect.objectContaining({ status: "expired" }),
    );
  });

  it("throws not found when flow state has no invite hash", async () => {
    await expect(
      acceptInviteFromSsoUser(deps, {
        inviteTokenHash: null,
        user: {
          id: "user_1",
          email: "invited@example.com",
        },
      }),
    ).rejects.toBeInstanceOf(SsoInviteNotFoundError);
  });

  it("keeps consumed state as consumed even when token is expired", async () => {
    (invitesRepo.findByTokenHash as any).mockResolvedValue({
      ...inviteBase,
      status: "consumed",
      tokenExpiresAt: "2026-02-01T23:00:00.000Z",
    });

    await expect(
      acceptInviteFromSsoUser(deps, {
        inviteTokenHash: "hashed-token",
        user: {
          id: "user_1",
          email: "invited@example.com",
        },
      }),
    ).rejects.toBeInstanceOf(SsoInviteConsumedError);
  });
});
