/// <reference types="@cloudflare/vitest-plugin/types" />

/**
 * Real D1 coverage for forwarding a populated v0 schema through migration 0007.
 */
import { applyD1Migrations, env, type D1Migration } from "cloudflare:test";
import { expect, it } from "vitest";

type MigrationDatabase = Parameters<typeof applyD1Migrations>[0];

type MigrationTestEnv = {
  LEGACY_DB: MigrationDatabase;
  NABECMS_001_MIGRATIONS: D1Migration[];
  TEST_MIGRATIONS: D1Migration[];
};

const bindings = env as unknown as MigrationTestEnv;

/** Read a scalar count from a real D1 database. */
const readCount = async (
  db: MigrationDatabase,
  query: string,
): Promise<number> => (await db.prepare(query).first<number>("count")) ?? 0;

/** Assert that SQLite reports no broken foreign-key references. */
const expectForeignKeysValid = async (db: MigrationDatabase): Promise<void> => {
  const result = await db.prepare("PRAGMA foreign_key_check").all();
  expect(result.results).toEqual([]);
};

it("upgrades a populated 0006 database without losing users, credentials, or active sessions", async () => {
  const db = bindings.LEGACY_DB;
  const legacyMigrations = bindings.NABECMS_001_MIGRATIONS;
  const forwardMigration = bindings.TEST_MIGRATIONS.find(({ name }) =>
    name.startsWith("0007_"),
  );
  expect(legacyMigrations.map(({ name }) => name)).toEqual([
    "0000_wide_imperial_guard.sql",
    "0001_auth_foundation.sql",
    "0002_melodic_misty_knight.sql",
    "0003_early_avengers.sql",
    "0004_align_users_auth_columns.sql",
    "0005_cuddly_ogun.sql",
    "0006_windy_cardiac.sql",
  ]);
  expect(forwardMigration).toBeDefined();

  await applyD1Migrations(db, legacyMigrations);
  await db.batch([
    db.prepare(
      `INSERT INTO users (
         id, email, password_hash, display_name, is_owner, email_verified,
         password, name, role_id, ui_preferences
       ) VALUES
         ('account-user', 'account@example.test',
          'account-password-hash-fallback', 'Account User', 0, 1,
          'account-users-password', 'Account User', '[]', 'null'),
         ('credential-user', 'credential@example.test',
          'credential-password-hash-fallback', 'Credential User', 0, 1,
          'credential-users-password', 'Credential User', '[]', 'null'),
         ('password-user', 'password@example.test',
          'password-hash-fallback', 'Password User', 0, 1,
          'users-password-hash', 'Password User', '[]', 'null'),
         ('legacy-only-user', 'legacy-only@example.test',
          'legacy-only-password-hash', 'Legacy Only User', 1, 1,
          '!', '', '["custom.editor"]', 'null')`,
    ),
    db.prepare(
      `INSERT INTO roles (id, name, description, permissions, is_system)
       VALUES (
         'custom.editor', 'Custom editor', 'Existing v0 role',
         '{"allow":["entries:read"]}', 0
       )`,
    ),
    db.prepare(
      `INSERT INTO user_roles (user_id, role_id)
       VALUES ('legacy-only-user', 'custom.editor')`,
    ),
    db.prepare(
      `INSERT INTO auth_identities (
         id, user_id, provider, subject, email, email_verified
       ) VALUES
         ('account-identity', 'account-user', 'local', 'account-user',
          'account@example.test', 1),
         ('credential-identity', 'credential-user', 'local', 'credential-user',
          'credential@example.test', 1)`,
    ),
    db.prepare(
      `INSERT INTO api_keys (
         id, key, key_hash, name, description, permissions,
         allowed_models, is_revoked, created_by, revoked_by, revoked_at
       ) VALUES (
         'legacy-api-key', 'legacy-key', 'legacy-key-hash',
         'Legacy API key', 'Preserved across 0007', '["entries:read"]',
         '["article"]', 1, 'legacy-only-user', 'legacy-only-user',
         '2026-01-01T00:00:00.000Z'
       )`,
    ),
    db.prepare(
      `INSERT INTO auth_credentials (
         id, identity_id, type, password_hash, updated_at
       ) VALUES
         ('account-credential', 'account-identity', 'password',
          'account-auth-credential-hash', '2026-01-01T00:00:00.000Z'),
         ('credential-credential', 'credential-identity', 'password',
          'auth-credential-hash', '2026-01-01T00:00:00.000Z')`,
    ),
    db.prepare(
      `INSERT INTO auth_accounts (
         id, user_id, provider_id, account_id, password_hash, access_token
       ) VALUES
         ('existing-credential-account', 'account-user', 'credential',
          'stale-account-id', 'canonical-account-hash', NULL),
         ('existing-social-account', 'account-user', 'github',
          'github-subject', NULL, 'social-access-token')`,
    ),
    db.prepare(
      `INSERT INTO auth_sessions (
         id, user_id, identity_id, refresh_token_hash,
         user_agent, ip, expires_at, revoked_at
       ) VALUES
         ('active-session', 'credential-user', 'credential-identity',
          'active-refresh-hash', 'migration-matrix', '203.0.113.10',
          '2099-01-01T00:00:00.000Z', NULL),
         ('revoked-session', 'credential-user', 'credential-identity',
          'revoked-refresh-hash', NULL, NULL,
          '2099-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
         ('expired-session', 'credential-user', 'credential-identity',
          'expired-refresh-hash', NULL, NULL,
          '2000-01-01T00:00:00.000Z', NULL)`,
    ),
    db.prepare(
      `INSERT INTO auth_login_events (
         id, provider, result, session_id
       ) VALUES
         ('active-session-event', 'local', 'success', 'active-session'),
         ('revoked-session-event', 'local', 'success', 'revoked-session'),
         ('expired-session-event', 'local', 'success', 'expired-session')`,
    ),
    db.prepare(
      "INSERT INTO settings (key, value) VALUES ('migration.sentinel', 'preserve-me')",
    ),
  ]);

  const beforeCounts = {
    apiKeys: await readCount(db, "SELECT COUNT(*) AS count FROM api_keys"),
    credentials: await readCount(
      db,
      "SELECT COUNT(*) AS count FROM auth_credentials",
    ),
    identities: await readCount(
      db,
      "SELECT COUNT(*) AS count FROM auth_identities",
    ),
    loginEvents: await readCount(
      db,
      "SELECT COUNT(*) AS count FROM auth_login_events",
    ),
    settings: await readCount(db, "SELECT COUNT(*) AS count FROM settings"),
    users: await readCount(db, "SELECT COUNT(*) AS count FROM users"),
  };

  await applyD1Migrations(db, [forwardMigration as D1Migration]);

  expect({
    apiKeys: await readCount(db, "SELECT COUNT(*) AS count FROM api_keys"),
    credentials: await readCount(
      db,
      "SELECT COUNT(*) AS count FROM auth_credentials",
    ),
    identities: await readCount(
      db,
      "SELECT COUNT(*) AS count FROM auth_identities",
    ),
    loginEvents: await readCount(
      db,
      "SELECT COUNT(*) AS count FROM auth_login_events",
    ),
    settings: await readCount(db, "SELECT COUNT(*) AS count FROM settings"),
    users: await readCount(db, "SELECT COUNT(*) AS count FROM users"),
  }).toEqual(beforeCounts);
  expect(
    await db
      .prepare("SELECT value FROM settings WHERE key = 'migration.sentinel'")
      .first<string>("value"),
  ).toBe("preserve-me");

  const credentialAccounts = await db
    .prepare(
      `SELECT id, user_id, provider_id, account_id, password_hash
       FROM auth_accounts
       WHERE provider_id = 'credential'
       ORDER BY user_id`,
    )
    .all<{
      account_id: string;
      id: string;
      password_hash: string;
      provider_id: string;
      user_id: string;
    }>();
  expect(credentialAccounts.results).toEqual([
    {
      id: "existing-credential-account",
      user_id: "account-user",
      provider_id: "credential",
      account_id: "account-user",
      password_hash: "canonical-account-hash",
    },
    {
      id: "authacct_migrated_credential-user",
      user_id: "credential-user",
      provider_id: "credential",
      account_id: "credential-user",
      password_hash: "auth-credential-hash",
    },
    {
      id: "authacct_migrated_legacy-only-user",
      user_id: "legacy-only-user",
      provider_id: "credential",
      account_id: "legacy-only-user",
      password_hash: "legacy-only-password-hash",
    },
    {
      id: "authacct_migrated_password-user",
      user_id: "password-user",
      provider_id: "credential",
      account_id: "password-user",
      password_hash: "users-password-hash",
    },
  ]);

  expect(
    await db
      .prepare(
        `SELECT provider_id, account_id, access_token
         FROM auth_accounts
         WHERE id = 'existing-social-account'`,
      )
      .first(),
  ).toEqual({
    provider_id: "github",
    account_id: "github-subject",
    access_token: "social-access-token",
  });
  expect(
    await db
      .prepare(
        `SELECT id, key, key_hash, name, description, permissions,
                allowed_models, is_revoked, created_by, revoked_by, revoked_at
         FROM api_keys
         WHERE id = 'legacy-api-key'`,
      )
      .first(),
  ).toEqual({
    id: "legacy-api-key",
    key: "legacy-key",
    key_hash: "legacy-key-hash",
    name: "Legacy API key",
    description: "Preserved across 0007",
    permissions: '["entries:read"]',
    allowed_models: '["article"]',
    is_revoked: 1,
    created_by: "legacy-only-user",
    revoked_by: "legacy-only-user",
    revoked_at: "2026-01-01T00:00:00.000Z",
  });

  expect(
    await db
      .prepare(
        `SELECT name, password, role_id
         FROM users
         WHERE id = 'legacy-only-user'`,
      )
      .first(),
  ).toEqual({
    name: "Legacy Only User",
    password: "!",
    role_id: '["custom.editor","system.super-admin"]',
  });
  expect(
    await readCount(
      db,
      `SELECT COUNT(*) AS count
       FROM user_roles
       WHERE user_id = 'legacy-only-user'
         AND role_id = 'system.super-admin'`,
    ),
  ).toBe(1);
  expect(
    await readCount(
      db,
      `SELECT COUNT(*) AS count
       FROM user_roles
       WHERE user_id = 'legacy-only-user'`,
    ),
  ).toBe(2);
  expect(
    await readCount(
      db,
      "SELECT COUNT(*) AS count FROM users WHERE password <> '!'",
    ),
  ).toBe(0);

  const migratedSessions = await db
    .prepare(
      `SELECT id, user_id, token, legacy_refresh_token_hash,
              expires_at, ip_address, user_agent
       FROM auth_sessions
       ORDER BY id`,
    )
    .all<{
      expires_at: number;
      id: string;
      ip_address: string;
      legacy_refresh_token_hash: string;
      token: string;
      user_agent: string;
      user_id: string;
    }>();
  expect(migratedSessions.results).toEqual([
    {
      id: "active-session",
      user_id: "credential-user",
      token: "legacy:active-refresh-hash",
      legacy_refresh_token_hash: "active-refresh-hash",
      expires_at: Date.parse("2099-01-01T00:00:00.000Z"),
      ip_address: "203.0.113.10",
      user_agent: "migration-matrix",
    },
  ]);
  const migratedLoginEvents = await db
    .prepare(
      `SELECT id, session_id
       FROM auth_login_events
       ORDER BY id`,
    )
    .all<{ id: string; session_id: string | null }>();
  expect(migratedLoginEvents.results).toEqual([
    { id: "active-session-event", session_id: "active-session" },
    { id: "expired-session-event", session_id: null },
    { id: "revoked-session-event", session_id: null },
  ]);
  await expectForeignKeysValid(db);

  await applyD1Migrations(db, [forwardMigration as D1Migration]);
  expect(
    await readCount(db, "SELECT COUNT(*) AS count FROM d1_migrations"),
  ).toBe(8);
  expect(
    await readCount(db, "SELECT COUNT(*) AS count FROM auth_sessions"),
  ).toBe(1);
});
