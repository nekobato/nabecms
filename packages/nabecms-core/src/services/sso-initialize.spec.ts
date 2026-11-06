import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LocaleRecord, LocaleRepository } from "../repositories/locales";
import type { RoleRepository, RoleRecord } from "../repositories/roles";
import type { SettingsRepository } from "../repositories/settings";
import type { UserRecord, UserRepository } from "../repositories/users";
import {
  initializeFromSsoUser,
  InitializationAlreadyCompletedError,
  type InitializeSsoDeps,
} from "./sso-initialize";

class MockLocaleRepository implements LocaleRepository {
  private records: LocaleRecord[];

  constructor(initial: LocaleRecord[] = []) {
    this.records = [...initial];
  }

  async list(): Promise<LocaleRecord[]> {
    return [...this.records];
  }

  async findByCode(code: string): Promise<LocaleRecord | null> {
    return this.records.find((record) => record.code === code) ?? null;
  }

  async getDefault(): Promise<LocaleRecord | null> {
    return this.records.find((record) => record.isDefault) ?? null;
  }

  async insert(record: LocaleRecord): Promise<void> {
    this.records.push(record);
  }

  async clearDefault(updatedAt: string): Promise<void> {
    this.records = this.records.map((record) =>
      record.isDefault ? { ...record, isDefault: false, updatedAt } : record,
    );
  }

  async updateByCode(
    code: string,
    values: Partial<Pick<LocaleRecord, "isDefault" | "updatedAt">>,
  ): Promise<void> {
    this.records = this.records.map((record) =>
      record.code === code ? { ...record, ...values } : record,
    );
  }

  async deleteByCode(code: string): Promise<void> {
    this.records = this.records.filter((record) => record.code !== code);
  }
}

describe("sso initialize service", () => {
  const now = new Date("2026-02-01T00:00:00.000Z");

  let usersRepo: UserRepository;
  let rolesRepo: RoleRepository;
  let settingsRepo: SettingsRepository;
  let localesRepo: MockLocaleRepository;
  let deps: InitializeSsoDeps;

  beforeEach(() => {
    usersRepo = {
      list: vi.fn(),
      findById: vi.fn(async () => null),
      findByEmail: vi.fn(async () => null),
      findManyByIds: vi.fn(),
      listRoleIdsByUserId: vi.fn(),
      listRoleIdsByUserIds: vi.fn(),
      replaceRoleIds: vi.fn(async () => undefined),
      insert: vi.fn(async () => undefined),
      updateById: vi.fn(async () => undefined),
      deleteById: vi.fn(async () => undefined),
    } as unknown as UserRepository;

    rolesRepo = {
      list: vi.fn(),
      findById: vi.fn(async () => null),
      findByName: vi.fn(),
      findManyByIds: vi.fn(),
      insert: vi.fn(async () => undefined),
      updateById: vi.fn(),
      deleteById: vi.fn(),
    } as unknown as RoleRepository;

    settingsRepo = {
      findByKey: vi.fn(async () => null),
      upsert: vi.fn(async () => undefined),
    };

    localesRepo = new MockLocaleRepository();

    deps = {
      usersRepo,
      rolesRepo,
      settingsRepo,
      localesRepo,
      now: () => now,
    };
  });

  it("initializes system and creates first super admin", async () => {
    const result = await initializeFromSsoUser(deps, {
      user: {
        id: "user_1",
        email: "admin@example.com",
        name: "Admin",
      },
      defaultLocale: "ja",
    });

    expect(result.userId).toBe("user_1");
    expect((rolesRepo.insert as any).mock.calls).toHaveLength(1);
    expect((usersRepo.insert as any).mock.calls).toHaveLength(1);
    expect((usersRepo.replaceRoleIds as any).mock.calls[0][1]).toEqual([
      "system.super-admin",
    ]);
    expect((settingsRepo.upsert as any).mock.calls).toHaveLength(1);
  });

  it("throws when initialization has already completed", async () => {
    (settingsRepo.findByKey as any).mockResolvedValue({
      key: "system.initialized",
      value: { at: now.toISOString(), by: "existing" },
      updatedAt: now.toISOString(),
    });

    await expect(
      initializeFromSsoUser(deps, {
        user: {
          id: "user_1",
          email: "admin@example.com",
          name: "Admin",
        },
        defaultLocale: "ja",
      }),
    ).rejects.toBeInstanceOf(InitializationAlreadyCompletedError);
  });

  it("reuses existing user and updates role/default locale", async () => {
    (usersRepo.findByEmail as any).mockResolvedValue({
      id: "user_existing",
      email: "admin@example.com",
      password: "!",
      name: "Old",
      emailVerified: true,
      image: null,
      roleId: [],
      uiPreferences: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    } as UserRecord);

    localesRepo = new MockLocaleRepository([
      {
        code: "ja",
        isDefault: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    deps = { ...deps, localesRepo };

    const result = await initializeFromSsoUser(deps, {
      user: {
        id: "user_social",
        email: "admin@example.com",
        name: "Admin",
      },
      defaultLocale: "ja",
    });

    expect(result.userId).toBe("user_existing");
    expect((usersRepo.insert as any).mock.calls).toHaveLength(0);
    expect((usersRepo.updateById as any).mock.calls).toHaveLength(1);
    expect((usersRepo.replaceRoleIds as any).mock.calls[0][0]).toBe(
      "user_existing",
    );
  });
});
