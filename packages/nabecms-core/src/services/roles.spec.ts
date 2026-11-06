import { describe, it, expect, beforeEach } from "vitest";
import {
  listRoles,
  createRole,
  updateRole,
  deleteRole,
  RoleAlreadyExistsError,
  RoleNotFoundError,
  SystemRoleModificationError,
  type RolesServiceDeps,
} from "./roles";
import type {
  RoleRepository,
  RoleRecord,
  RolePermissions,
} from "../repositories/roles";

class MockRoleRepository implements RoleRepository {
  private records: RoleRecord[] = [];

  constructor(initial: RoleRecord[] = []) {
    this.records = [...initial];
  }

  list(): Promise<RoleRecord[]> {
    const sorted = [...this.records].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
    return Promise.resolve(sorted);
  }

  findById(id: string): Promise<RoleRecord | null> {
    return Promise.resolve(
      this.records.find((record) => record.id === id) ?? null,
    );
  }

  findByName(name: string): Promise<RoleRecord | null> {
    return Promise.resolve(
      this.records.find(
        (record) => record.name.toLowerCase() === name.toLowerCase(),
      ) ?? null,
    );
  }

  async insert(record: RoleRecord): Promise<void> {
    this.records.push(record);
  }

  async findManyByIds(ids: string[]): Promise<RoleRecord[]> {
    const set = new Set(ids);
    return this.records.filter((record) => set.has(record.id));
  }

  async updateById(
    id: string,
    values: Partial<
      Pick<RoleRecord, "name" | "description" | "permissions" | "updatedAt">
    >,
  ): Promise<void> {
    this.records = this.records.map((record) =>
      record.id === id ? { ...record, ...values } : record,
    );
  }

  async deleteById(id: string): Promise<void> {
    this.records = this.records.filter((record) => record.id !== id);
  }
}

const fixedNow = () => new Date("2025-10-14T18:30:00.000Z");

describe("roles service", () => {
  let repo: MockRoleRepository;
  let deps: RolesServiceDeps;

  beforeEach(() => {
    repo = new MockRoleRepository([
      {
        id: "system.super-admin",
        name: "Super Admin",
        description: "Full access",
        permissions: { allow: ["*"] } satisfies RolePermissions,
        isSystem: true,
        createdAt: "2025-10-14T00:00:00.000Z",
        updatedAt: "2025-10-14T00:00:00.000Z",
      },
      {
        id: "role_editor",
        name: "Editor",
        description: "Can edit content",
        permissions: { allow: ["models:*:read", "models:*:write"] },
        isSystem: false,
        createdAt: "2025-10-14T10:00:00.000Z",
        updatedAt: "2025-10-14T10:00:00.000Z",
      },
    ]);

    let sequence = 0;
    deps = {
      repo,
      now: fixedNow,
      generateId: () => `role_${++sequence}`,
    };
  });

  it("lists roles", async () => {
    const roles = await listRoles(deps);
    expect(roles).toHaveLength(2);
    expect(roles[0].id).toBe("system.super-admin");
  });

  it("creates role with sanitized permissions", async () => {
    const created = await createRole(deps, {
      name: " Content Reviewer ",
      description: "Reviews content",
      permissions: {
        allow: [" models:review ", ""],
      },
    });

    expect(created.id).toBe("role_1");
    expect(created.name).toBe("Content Reviewer");
    expect(created.permissions).toEqual({
      allow: ["models:review"],
    });

    const roles = await listRoles(deps);
    expect(roles.find((role) => role.id === created.id)).toBeTruthy();
  });

  it("prevents duplicate role names", async () => {
    await expect(
      createRole(deps, {
        name: "Editor",
        description: "Duplicate",
        permissions: { allow: [] },
      }),
    ).rejects.toBeInstanceOf(RoleAlreadyExistsError);
  });

  it("updates role metadata", async () => {
    const updated = await updateRole(deps, "role_editor", {
      name: "Content Editor",
      description: "Updated description",
      permissions: { allow: ["models:*:write"] },
    });

    expect(updated.name).toBe("Content Editor");
    expect(updated.updatedAt).toBe("2025-10-14T18:30:00.000Z");
  });

  it("prevents renaming to existing role name", async () => {
    await expect(
      updateRole(deps, "role_editor", { name: "Super Admin" }),
    ).rejects.toBeInstanceOf(RoleAlreadyExistsError);
  });

  it("throws when role not found for update", async () => {
    await expect(
      updateRole(deps, "unknown", { name: "New" }),
    ).rejects.toBeInstanceOf(RoleNotFoundError);
  });

  it("prevents updating system roles", async () => {
    await expect(
      updateRole(deps, "system.super-admin", { name: "Root" }),
    ).rejects.toBeInstanceOf(SystemRoleModificationError);
  });

  it("deletes roles", async () => {
    await deleteRole(deps, "role_editor");
    const roles = await listRoles(deps);
    expect(roles.some((role) => role.id === "role_editor")).toBe(false);
  });

  it("prevents deleting system roles", async () => {
    await expect(deleteRole(deps, "system.super-admin")).rejects.toBeInstanceOf(
      SystemRoleModificationError,
    );
  });

  it("throws when deleting non-existent role", async () => {
    await expect(deleteRole(deps, "role_missing")).rejects.toBeInstanceOf(
      RoleNotFoundError,
    );
  });
});
