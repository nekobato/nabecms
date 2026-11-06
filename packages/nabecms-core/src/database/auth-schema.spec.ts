import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { authAccounts, authSessions, users } from "./schema";

/**
 * Return the physical column names declared by a Drizzle SQLite table.
 */
const getColumnNames = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).columns.map((column) => column.name);

describe("canonical Better Auth schema", () => {
  it("declares only the canonical v1 user columns and safe defaults", () => {
    const config = getTableConfig(users);
    expect(config.columns.map((column) => column.name)).toEqual([
      "id",
      "email",
      "password",
      "name",
      "email_verified",
      "image",
      "role_id",
      "ui_preferences",
      "created_at",
      "updated_at",
    ]);

    const columnDefaults = Object.fromEntries(
      config.columns.map((column) => [column.name, column.default]),
    );
    expect(columnDefaults.password).toBe("!");
    expect(columnDefaults.name).toBe("");
    expect(columnDefaults.role_id).toBeDefined();
  });

  it("declares the Better Auth 1.6 account fields with independent expiries", () => {
    expect(Object.keys(authAccounts)).toEqual(
      expect.arrayContaining([
        "id",
        "userId",
        "accountId",
        "providerId",
        "password",
        "accessToken",
        "refreshToken",
        "idToken",
        "accessTokenExpiresAt",
        "refreshTokenExpiresAt",
        "scope",
        "createdAt",
        "updatedAt",
      ]),
    );
    expect(Object.keys(authAccounts)).not.toContain("passwordHash");
    expect(getColumnNames(authAccounts)).toEqual(
      expect.arrayContaining([
        "password_hash",
        "access_token_expires_at",
        "refresh_token_expires_at",
      ]),
    );
  });

  it("declares the Better Auth 1.6 session fields and unique token", () => {
    expect(Object.keys(authSessions)).toEqual(
      expect.arrayContaining([
        "id",
        "userId",
        "token",
        "expiresAt",
        "ipAddress",
        "userAgent",
        "createdAt",
        "updatedAt",
      ]),
    );
    expect(Object.keys(authSessions)).not.toEqual(
      expect.arrayContaining(["identityId", "refreshTokenHash", "revokedAt"]),
    );

    const config = getTableConfig(authSessions);
    const uniqueToken = config.indexes.find(
      (index) => index.config.name === "auth_sessions_token_unique",
    );
    expect(uniqueToken?.config.unique).toBe(true);
  });
});
