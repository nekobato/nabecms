import { describe, expect, it } from "vitest";
import { SUPER_ADMIN_ROLE_ID, hasBootstrapAdminRole } from "./system-roles";

describe("system roles", () => {
  it("returns true for super admin role", () => {
    expect(hasBootstrapAdminRole([SUPER_ADMIN_ROLE_ID])).toBe(true);
  });

  it("returns true for legacy admin role", () => {
    expect(hasBootstrapAdminRole(["admin"])).toBe(true);
  });

  it("returns false for unrelated role", () => {
    expect(hasBootstrapAdminRole(["editor"])).toBe(false);
  });

  it("returns false for non-array values", () => {
    expect(hasBootstrapAdminRole(null)).toBe(false);
    expect(hasBootstrapAdminRole("admin")).toBe(false);
  });
});
