import { describe, expect, it, vi } from "vitest";
import { SUPER_ADMIN_ROLE_ID } from "../lib/system-roles";
import { ensureSuperAdminRole } from "./system-roles";

describe("system roles service", () => {
  const now = new Date("2026-05-20T00:00:00.000Z");

  it("creates the Super Admin role when it is missing", async () => {
    const rolesRepo = {
      findById: vi.fn(async () => null),
      insert: vi.fn(async () => undefined),
    };

    await ensureSuperAdminRole({
      rolesRepo,
      now: () => now,
    });

    expect(rolesRepo.findById).toHaveBeenCalledWith(SUPER_ADMIN_ROLE_ID);
    expect(rolesRepo.insert).toHaveBeenCalledWith({
      id: SUPER_ADMIN_ROLE_ID,
      name: "Super Admin",
      description: "System reserved role with full privileges",
      permissions: { allow: ["*"] },
      isSystem: true,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
  });

  it("does not insert the Super Admin role when it already exists", async () => {
    const rolesRepo = {
      findById: vi.fn(async () => ({
        id: SUPER_ADMIN_ROLE_ID,
        name: "Super Admin",
        description: "System reserved role with full privileges",
        permissions: { allow: ["*"] },
        isSystem: true,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      })),
      insert: vi.fn(async () => undefined),
    };

    await ensureSuperAdminRole({
      rolesRepo,
      now: () => now,
    });

    expect(rolesRepo.insert).not.toHaveBeenCalled();
  });
});
