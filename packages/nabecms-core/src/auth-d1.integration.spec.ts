/// <reference types="@cloudflare/vitest-plugin/types" />

/**
 * Real Cloudflare D1 integration coverage for the canonical Better Auth schema,
 * lifecycle batches, and the forward migration from the v0 authentication data.
 */
import {
  applyD1Migrations,
  env,
  SELF,
  type D1Migration,
} from "cloudflare:test";
import bcrypt from "bcryptjs";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { beforeAll, describe, expect, it } from "vitest";
import * as schema from "./database/schema";
import { REFRESH_COOKIE, sha256Hex } from "./lib/auth";
import { getBetterAuth } from "./lib/better-auth";
import adminAuthRefreshRoute from "./routes/admin/auth/refresh";
import {
  acceptInviteLifecycle,
  initializeAuthLifecycle,
  resetCredentialPasswordLifecycle,
  rotatePasswordResetVerification,
} from "./services/auth-lifecycle";
import type { Env } from "./types";

const TEST_ORIGIN = "https://cms.example.test";
const BOOTSTRAP_SECRET = "nabecms-real-d1-bootstrap-secret";
const OWNER_EMAIL = "owner@example.test";
const OWNER_PASSWORD = "OwnerPass123!";
const INVITED_EMAIL = "editor@example.test";
const INVITED_PASSWORD = "EditorPass123!";
const RESET_PASSWORD = "EditorPass456!";
const LEGACY_EMAIL = "legacy@example.test";
const LEGACY_PASSWORD = "LegacyPass123!";
const LEGACY_PASSWORD_HASH =
  "$2b$04$abcdefghijklmnopqrstuuJ/IDvsMpFnm7fTw/CizNgkt31J2g8Su";
const LEGACY_REFRESH_TOKEN = "legacy-active-refresh-token";
const BATCH_OBSERVATION_ERROR = new Error(
  "auth lifecycle D1 batch statement count observed",
);
const BATCH_FAILURE_TABLE = "__auth_lifecycle_batch_failure";
const REAL_AUTH_FLOW_TIMEOUT_MS = 30_000;

const INITIALIZE_LIFECYCLE_TABLES = [
  { name: "settings", orderBy: "key" },
  { name: "roles", orderBy: "id" },
  { name: "users", orderBy: "id" },
  { name: "user_roles", orderBy: "user_id, role_id" },
  { name: "auth_accounts", orderBy: "id" },
  { name: "locales", orderBy: "code" },
  { name: BATCH_FAILURE_TABLE, orderBy: "value" },
] as const;

const INVITE_LIFECYCLE_TABLES = [
  { name: "users", orderBy: "id" },
  { name: "user_roles", orderBy: "user_id, role_id" },
  { name: "auth_accounts", orderBy: "id" },
  { name: "auth_invites", orderBy: "id" },
  { name: "auth_sessions", orderBy: "id" },
  { name: "auth_login_events", orderBy: "id" },
  { name: BATCH_FAILURE_TABLE, orderBy: "value" },
] as const;

const PASSWORD_RESET_LIFECYCLE_TABLES = [
  { name: "auth_accounts", orderBy: "id" },
  { name: "auth_sessions", orderBy: "id" },
  { name: "auth_verifications", orderBy: "id" },
  { name: BATCH_FAILURE_TABLE, orderBy: "value" },
] as const;

type MigrationDatabase = Parameters<typeof applyD1Migrations>[0];
type AuthLifecycleDatabase = DrizzleD1Database<typeof schema>;
type D1BatchStatements = ReturnType<MigrationDatabase["prepare"]>[];
type D1BatchInterceptor = (
  statements: D1BatchStatements,
) => ReturnType<MigrationDatabase["batch"]>;
type AuthLifecycleOperation = (db: AuthLifecycleDatabase) => Promise<unknown>;

type LifecycleTable = {
  name: string;
  orderBy: string;
};

type LifecycleSnapshot = Record<string, Record<string, unknown>[]>;

type BoundaryCoverage = {
  injectionIndexes: number[];
  statementCount: number;
};

type IntegrationTestEnv = {
  DB: MigrationDatabase;
  LEGACY_DB: MigrationDatabase;
  NABECMS_001_MIGRATIONS: D1Migration[];
  TEST_MIGRATIONS: D1Migration[];
};

type TableColumn = {
  name: string;
  notnull: number;
  pk: number;
  type: string;
};

type IndexRow = {
  name: string;
  unique: number;
};

const bindings = env as unknown as IntegrationTestEnv;

/**
 * Create a structural D1 delegate that overrides only `batch()` while keeping
 * prepared statements bound to the real database.
 */
const createBatchInterceptingDatabase = (
  delegate: MigrationDatabase,
  interceptBatch: D1BatchInterceptor,
): MigrationDatabase =>
  ({
    prepare: (query: string) => delegate.prepare(query),
    batch: interceptBatch,
    exec: (query: string) => delegate.exec(query),
    dump: () => delegate.dump(),
  }) as unknown as MigrationDatabase;

/** Return a schema-aware Drizzle client over the supplied D1 binding. */
const createAuthLifecycleDatabase = (
  db: MigrationDatabase,
): AuthLifecycleDatabase => drizzle(db, { schema });

/** Read every row from each lifecycle table in deterministic order. */
const readLifecycleSnapshot = async (
  db: MigrationDatabase,
  tables: readonly LifecycleTable[],
): Promise<LifecycleSnapshot> => {
  const snapshot: LifecycleSnapshot = {};

  for (const table of tables) {
    const result = await db
      .prepare(`SELECT * FROM "${table.name}" ORDER BY ${table.orderBy}`)
      .all<Record<string, unknown>>();
    snapshot[table.name] = result.results;
  }

  return snapshot;
};

/** Observe the number of statements emitted by one lifecycle without running it. */
const observeBatchStatementCount = async (
  delegate: MigrationDatabase,
  operation: AuthLifecycleOperation,
): Promise<number> => {
  let statementCount: number | undefined;
  const observingDatabase = createBatchInterceptingDatabase(
    delegate,
    async (statements) => {
      statementCount = statements.length;
      throw BATCH_OBSERVATION_ERROR;
    },
  );

  try {
    await operation(createAuthLifecycleDatabase(observingDatabase));
  } catch (error) {
    if (error !== BATCH_OBSERVATION_ERROR) throw error;
  }

  if (statementCount === undefined) {
    throw new Error("Authentication lifecycle did not call D1 batch()");
  }

  return statementCount;
};

/**
 * Inject a valid CHECK-constraint failure at every position in a D1 batch and
 * prove the affected tables exactly match their pre-operation state each time.
 */
const verifyRollbackAtEveryBatchBoundary = async (
  delegate: MigrationDatabase,
  tables: readonly LifecycleTable[],
  operation: AuthLifecycleOperation,
): Promise<BoundaryCoverage> => {
  const statementCount = await observeBatchStatementCount(delegate, operation);
  const injectionIndexes = Array.from(
    { length: statementCount + 1 },
    (_, index) => index,
  );
  const before = await readLifecycleSnapshot(delegate, tables);

  for (const injectionIndex of injectionIndexes) {
    const injectingDatabase = createBatchInterceptingDatabase(
      delegate,
      (statements) => {
        const injectedStatements = [...statements];
        injectedStatements.splice(
          injectionIndex,
          0,
          delegate.prepare(
            `INSERT INTO "${BATCH_FAILURE_TABLE}" (value) VALUES (1)`,
          ),
        );
        return delegate.batch(injectedStatements);
      },
    );

    await expect(
      operation(createAuthLifecycleDatabase(injectingDatabase)),
      `expected CHECK failure at batch insertion index ${injectionIndex}`,
    ).rejects.toThrow(/CHECK constraint failed/iu);
    expect(
      await readLifecycleSnapshot(delegate, tables),
      `expected full rollback at batch insertion index ${injectionIndex}`,
    ).toEqual(before);
  }

  return { injectionIndexes, statementCount };
};

/** Send a request through the configured NabeCMS Worker. */
const requestWorker = async (
  pathname: string,
  init?: RequestInit,
): Promise<Response> =>
  await SELF.fetch(new Request(new URL(pathname, TEST_ORIGIN), init));

/** Return a Cookie request-header pair from a Set-Cookie response header. */
const extractSessionCookie = (setCookie: string | null): string | null => {
  if (!setCookie) return null;
  const match = setCookie.match(
    /(?:^|,\s*)((?:__Secure-)?better-auth\.session_token=[^;,\s]+)/u,
  );
  return match?.[1] ?? null;
};

/** Return the legacy refresh Cookie pair from a Set-Cookie response header. */
const extractRefreshCookie = (setCookie: string | null): string | null => {
  if (!setCookie) return null;
  const match = setCookie.match(/(?:^|,\s*)(__Host\.refresh=[^;,\s]+)/u);
  return match?.[1] ?? null;
};

/** Sign in through the public Better Auth route and return its session cookie. */
const signInWithBetterAuth = async (
  email: string,
  password: string,
): Promise<{ cookie: string | null; response: Response }> => {
  const response = await requestWorker("/api/auth/sign-in/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: TEST_ORIGIN,
    },
    body: JSON.stringify({ email, password, rememberMe: true }),
  });

  return {
    cookie: extractSessionCookie(response.headers.get("set-cookie")),
    response,
  };
};

/** Exchange a Better Auth session cookie for an Admin API access token. */
const issueAdminAccessToken = async (
  sessionCookie: string,
): Promise<string> => {
  const response = await requestWorker("/api/admin/auth/session-token", {
    method: "POST",
    headers: { Cookie: sessionCookie, Origin: TEST_ORIGIN },
  });
  expect(response.status).toBe(200);
  const payload = (await response.json()) as { accessToken: string };
  return payload.accessToken;
};

/** Create an invite through the authenticated Admin API. */
const createInviteThroughAdminApi = async (
  accessToken: string,
  email: string,
): Promise<{ inviteId: string; token: string }> => {
  const response = await requestWorker("/api/admin/auth/invites", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, roleIds: ["role.editor"] }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { inviteId: string; token: string };
};

/** Read SQLite table metadata from a real D1 binding. */
const readTableColumns = async (
  db: MigrationDatabase,
  tableName: string,
): Promise<TableColumn[]> => {
  const result = await db
    .prepare(`PRAGMA table_info('${tableName}')`)
    .all<TableColumn>();
  return result.results;
};

/** Read SQLite index metadata from a real D1 binding. */
const readIndexes = async (
  db: MigrationDatabase,
  tableName: string,
): Promise<IndexRow[]> => {
  const result = await db
    .prepare(`PRAGMA index_list('${tableName}')`)
    .all<IndexRow>();
  return result.results;
};

/** Return the scalar count selected by the supplied SQL statement. */
const readCount = async (
  db: MigrationDatabase,
  query: string,
): Promise<number> => (await db.prepare(query).first<number>("count")) ?? 0;

/** Build the minimal environment required by a real Better Auth instance. */
const createLegacyAuthEnv = (): Env =>
  ({
    DB: bindings.LEGACY_DB,
    WORKER_ENV: "test",
    BETTER_AUTH_SECRET: "nabecms-real-d1-integration-secret-32-bytes",
    BETTER_AUTH_URL: TEST_ORIGIN,
    BCRYPT_COST: "4",
    JWT_SECRET: "nabecms-real-d1-legacy-jwt-secret-32-bytes",
  }) as unknown as Env;

beforeAll(async () => {
  await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS);
  await bindings.DB.prepare(
    `CREATE TABLE "${BATCH_FAILURE_TABLE}" (
       value INTEGER NOT NULL CHECK (value = 0)
     )`,
  ).run();
});

describe("real D1 authentication integration", () => {
  it("applies every migration to a fresh DB with the canonical schema and indexes", async () => {
    const migrationNames = await bindings.DB.prepare(
      "SELECT name FROM d1_migrations ORDER BY id",
    ).all<{ name: string }>();
    expect(
      migrationNames.results.map((row: { name: string }) => row.name),
    ).toEqual(bindings.TEST_MIGRATIONS.map(({ name }) => name));

    const accountColumns = await readTableColumns(bindings.DB, "auth_accounts");
    expect(accountColumns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "id", type: "TEXT", pk: 1 }),
        expect.objectContaining({ name: "user_id", type: "TEXT", notnull: 1 }),
        expect.objectContaining({
          name: "provider_id",
          type: "TEXT",
          notnull: 1,
        }),
        expect.objectContaining({
          name: "account_id",
          type: "TEXT",
          notnull: 1,
        }),
        expect.objectContaining({ name: "password_hash", type: "TEXT" }),
        expect.objectContaining({
          name: "access_token_expires_at",
          type: "INTEGER",
        }),
        expect.objectContaining({
          name: "refresh_token_expires_at",
          type: "INTEGER",
        }),
        expect.objectContaining({ name: "created_at", type: "INTEGER" }),
        expect.objectContaining({ name: "updated_at", type: "INTEGER" }),
      ]),
    );

    const sessionColumns = await readTableColumns(bindings.DB, "auth_sessions");
    expect(sessionColumns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "id", type: "TEXT", pk: 1 }),
        expect.objectContaining({ name: "user_id", type: "TEXT", notnull: 1 }),
        expect.objectContaining({ name: "token", type: "TEXT", notnull: 1 }),
        expect.objectContaining({
          name: "expires_at",
          type: "INTEGER",
          notnull: 1,
        }),
        expect.objectContaining({ name: "ip_address", type: "TEXT" }),
        expect.objectContaining({ name: "user_agent", type: "TEXT" }),
        expect.objectContaining({ name: "created_at", type: "INTEGER" }),
        expect.objectContaining({ name: "updated_at", type: "INTEGER" }),
      ]),
    );
    expect(sessionColumns.map(({ name }) => name)).not.toEqual(
      expect.arrayContaining([
        "identity_id",
        "refresh_token_hash",
        "revoked_at",
      ]),
    );

    const accountIndexes = await readIndexes(bindings.DB, "auth_accounts");
    expect(accountIndexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "auth_accounts_provider_account_unique",
          unique: 1,
        }),
        expect.objectContaining({ name: "auth_accounts_user_idx" }),
      ]),
    );
    const sessionIndexes = await readIndexes(bindings.DB, "auth_sessions");
    expect(sessionIndexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "auth_sessions_token_unique",
          unique: 1,
        }),
        expect.objectContaining({ name: "auth_sessions_user_idx" }),
      ]),
    );
  });

  it("rolls back initialize at every D1 batch statement boundary", async () => {
    const now = new Date("2030-01-02T03:04:05.000Z");
    const coverage = await verifyRollbackAtEveryBatchBoundary(
      bindings.DB,
      INITIALIZE_LIFECYCLE_TABLES,
      async (db) =>
        await initializeAuthLifecycle(db, {
          userId: "user-boundary-initialize",
          accountId: "account-boundary-initialize",
          email: "initialize-boundary@example.test",
          name: "Initialize Boundary",
          passwordHash: LEGACY_PASSWORD_HASH,
          defaultLocale: "ja",
          now,
        }),
    );

    expect(coverage).toEqual({
      statementCount: 7,
      injectionIndexes: [0, 1, 2, 3, 4, 5, 6, 7],
    });
  });

  it("rolls back the entire initialize lifecycle when a late D1 batch statement fails", async () => {
    await bindings.DB.prepare(
      `CREATE TRIGGER reject_test_credential
       BEFORE INSERT ON auth_accounts
       BEGIN
         SELECT RAISE(ABORT, 'injected credential failure');
       END`,
    ).run();

    try {
      const response = await requestWorker("/api/admin/auth/initialize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Nabecms-Bootstrap-Secret": BOOTSTRAP_SECRET,
        },
        body: JSON.stringify({
          email: "rollback@example.test",
          password: "RollbackPass123!",
          name: "Rollback Test",
          defaultLocale: "ja",
        }),
      });

      expect(response.status).toBe(500);
      expect(
        await readCount(bindings.DB, "SELECT COUNT(*) AS count FROM users"),
      ).toBe(0);
      expect(
        await readCount(
          bindings.DB,
          "SELECT COUNT(*) AS count FROM auth_accounts",
        ),
      ).toBe(0);
      expect(
        await readCount(
          bindings.DB,
          "SELECT COUNT(*) AS count FROM settings WHERE key = 'system.initialized'",
        ),
      ).toBe(0);
      expect(
        await readCount(
          bindings.DB,
          "SELECT COUNT(*) AS count FROM user_roles",
        ),
      ).toBe(0);
      expect(
        await readCount(bindings.DB, "SELECT COUNT(*) AS count FROM locales"),
      ).toBe(0);
    } finally {
      await bindings.DB.prepare(
        "DROP TRIGGER IF EXISTS reject_test_credential",
      ).run();
    }
  });

  it(
    "initializes, signs in with Better Auth, reads the session, issues a JWT, and signs out",
    async () => {
      const initializeResponse = await requestWorker(
        "/api/admin/auth/initialize",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Nabecms-Bootstrap-Secret": BOOTSTRAP_SECRET,
          },
          body: JSON.stringify({
            email: OWNER_EMAIL,
            password: OWNER_PASSWORD,
            name: "Owner",
            defaultLocale: "ja",
          }),
        },
      );
      expect(initializeResponse.status).toBe(201);
      expect(initializeResponse.headers.get("set-cookie")).toBeNull();
      const initialized = (await initializeResponse.json()) as {
        userId: string;
      };

      const account = await bindings.DB.prepare(
        `SELECT user_id, provider_id, account_id, password_hash
       FROM auth_accounts
       WHERE user_id = ?`,
      )
        .bind(initialized.userId)
        .first<{
          account_id: string;
          password_hash: string;
          provider_id: string;
          user_id: string;
        }>();
      expect(account).toMatchObject({
        user_id: initialized.userId,
        provider_id: "credential",
        account_id: initialized.userId,
      });
      expect(account?.password_hash).toMatch(/^\$2[aby]\$/u);
      expect(
        await readCount(
          bindings.DB,
          "SELECT COUNT(*) AS count FROM auth_credentials",
        ),
      ).toBe(0);

      const signInResponse = await requestWorker("/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: TEST_ORIGIN,
        },
        body: JSON.stringify({
          email: OWNER_EMAIL,
          password: OWNER_PASSWORD,
          rememberMe: true,
        }),
      });
      expect(signInResponse.status).toBe(200);
      const sessionCookie = extractSessionCookie(
        signInResponse.headers.get("set-cookie"),
      );
      expect(sessionCookie).not.toBeNull();

      const sessionResponse = await requestWorker("/api/auth/get-session", {
        method: "GET",
        headers: { Cookie: sessionCookie as string },
      });
      expect(sessionResponse.status).toBe(200);
      const sessionPayload = (await sessionResponse.json()) as {
        session: { id: string; userId: string };
        user: { email: string; id: string };
      };
      expect(sessionPayload.user).toMatchObject({
        id: initialized.userId,
        email: OWNER_EMAIL,
      });
      expect(sessionPayload.session.userId).toBe(initialized.userId);

      const storedSession = await bindings.DB.prepare(
        "SELECT id, user_id, token, legacy_refresh_token_hash FROM auth_sessions",
      ).first<{
        id: string;
        legacy_refresh_token_hash: string | null;
        token: string;
        user_id: string;
      }>();
      expect(storedSession).toMatchObject({
        id: sessionPayload.session.id,
        user_id: initialized.userId,
        legacy_refresh_token_hash: null,
      });
      expect(storedSession?.token.startsWith("legacy:")).toBe(false);

      const tokenResponse = await requestWorker(
        "/api/admin/auth/session-token",
        {
          method: "POST",
          headers: {
            Cookie: sessionCookie as string,
            Origin: TEST_ORIGIN,
          },
        },
      );
      expect(tokenResponse.status).toBe(200);
      const tokenPayload = (await tokenResponse.json()) as {
        accessToken: string;
        user: { id: string };
      };
      expect(tokenPayload.accessToken.split(".")).toHaveLength(3);
      expect(tokenPayload.user.id).toBe(initialized.userId);

      const signOutResponse = await requestWorker("/api/auth/sign-out", {
        method: "POST",
        headers: {
          Cookie: sessionCookie as string,
          Origin: TEST_ORIGIN,
        },
      });
      expect(signOutResponse.status).toBe(200);
      expect(
        await readCount(
          bindings.DB,
          "SELECT COUNT(*) AS count FROM auth_sessions",
        ),
      ).toBe(0);

      const signedOutSessionResponse = await requestWorker(
        "/api/auth/get-session",
        {
          method: "GET",
          headers: { Cookie: sessionCookie as string },
        },
      );
      expect(signedOutSessionResponse.status).toBe(200);
      expect(await signedOutSessionResponse.json()).toBeNull();
    },
    REAL_AUTH_FLOW_TIMEOUT_MS,
  );

  it(
    "creates and accepts an invite into canonical account/session rows, then logs in, refreshes, and rejects replay",
    async () => {
      const nowIso = new Date().toISOString();
      await bindings.DB.prepare(
        `INSERT OR IGNORE INTO roles (
         id, name, description, permissions, is_system, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          "role.editor",
          "Editor",
          "D1 integration editor role",
          '{"allow":["entries:*:read"]}',
          0,
          nowIso,
          nowIso,
        )
        .run();

      const ownerSignIn = await signInWithBetterAuth(
        OWNER_EMAIL,
        OWNER_PASSWORD,
      );
      expect(ownerSignIn.response.status).toBe(200);
      expect(ownerSignIn.cookie).not.toBeNull();
      const ownerAccessToken = await issueAdminAccessToken(
        ownerSignIn.cookie as string,
      );
      const invite = await createInviteThroughAdminApi(
        ownerAccessToken,
        INVITED_EMAIL,
      );

      const validateResponse = await requestWorker(
        "/api/admin/auth/accept-invite/validate",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: invite.token }),
        },
      );
      expect(validateResponse.status).toBe(200);

      const acceptResponse = await requestWorker(
        "/api/admin/auth/accept-invite",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "real-d1-integration",
          },
          body: JSON.stringify({
            token: invite.token,
            name: "Editor",
            password: INVITED_PASSWORD,
          }),
        },
      );
      expect(acceptResponse.status).toBe(200);
      const acceptPayload = (await acceptResponse.json()) as {
        accessToken: string;
        invite: { id: string; status: string };
        user: { id: string };
      };
      expect(acceptPayload.accessToken.split(".")).toHaveLength(3);
      expect(acceptPayload.invite).toEqual({
        id: invite.inviteId,
        status: "consumed",
      });
      const acceptedRefreshCookie = extractRefreshCookie(
        acceptResponse.headers.get("set-cookie"),
      );
      expect(acceptedRefreshCookie).not.toBeNull();

      const canonicalAccount = await bindings.DB.prepare(
        `SELECT id, user_id, provider_id, account_id, password_hash
       FROM auth_accounts
       WHERE user_id = ?`,
      )
        .bind(acceptPayload.user.id)
        .first<{
          account_id: string;
          id: string;
          password_hash: string;
          provider_id: string;
          user_id: string;
        }>();
      expect(canonicalAccount).toMatchObject({
        user_id: acceptPayload.user.id,
        provider_id: "credential",
        account_id: acceptPayload.user.id,
      });
      expect(canonicalAccount?.password_hash).toMatch(/^\$2[aby]\$/u);

      const acceptedSession = await bindings.DB.prepare(
        `SELECT id, user_id, token, legacy_refresh_token_hash
       FROM auth_sessions
       WHERE user_id = ? AND legacy_refresh_token_hash IS NOT NULL`,
      )
        .bind(acceptPayload.user.id)
        .first<{
          id: string;
          legacy_refresh_token_hash: string;
          token: string;
          user_id: string;
        }>();
      expect(acceptedSession?.user_id).toBe(acceptPayload.user.id);
      expect(acceptedSession?.token).toBe(
        `legacy:${acceptedSession?.legacy_refresh_token_hash}`,
      );

      const refreshResponse = await requestWorker("/api/admin/auth/refresh", {
        method: "POST",
        headers: { Cookie: acceptedRefreshCookie as string },
      });
      expect(refreshResponse.status).toBe(200);
      const rotatedRefreshCookie = extractRefreshCookie(
        refreshResponse.headers.get("set-cookie"),
      );
      expect(rotatedRefreshCookie).not.toBeNull();
      expect(rotatedRefreshCookie).not.toBe(acceptedRefreshCookie);

      const loginResponse = await requestWorker("/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: INVITED_EMAIL,
          password: INVITED_PASSWORD,
        }),
      });
      expect(loginResponse.status).toBe(200);
      expect(await loginResponse.clone().json()).toEqual({ betterAuth: true });
      expect(
        extractSessionCookie(loginResponse.headers.get("set-cookie")),
      ).not.toBeNull();

      const replayResponse = await requestWorker(
        "/api/admin/auth/accept-invite",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token: invite.token,
            name: "Replay",
            password: "ReplayPass123!",
          }),
        },
      );
      expect(replayResponse.status).toBe(410);
      expect(
        await readCount(
          bindings.DB,
          `SELECT COUNT(*) AS count FROM users WHERE email = '${INVITED_EMAIL}'`,
        ),
      ).toBe(1);
      expect(
        await readCount(
          bindings.DB,
          `SELECT COUNT(*) AS count
         FROM auth_accounts account
         INNER JOIN users user ON user.id = account.user_id
         WHERE user.email = '${INVITED_EMAIL}' AND account.provider_id = 'credential'`,
        ),
      ).toBe(1);
    },
    REAL_AUTH_FLOW_TIMEOUT_MS,
  );

  it("rolls back chunked invite acceptance at every D1 batch statement boundary", async () => {
    const ownerId = await bindings.DB.prepare(
      "SELECT id FROM users WHERE email = ?",
    )
      .bind(OWNER_EMAIL)
      .first<string>("id");
    expect(ownerId).not.toBeNull();

    const now = new Date("2030-02-03T04:05:06.000Z");
    const nowIso = now.toISOString();
    const roleIds = Array.from(
      { length: 34 },
      (_, index) => `role.boundary.${index.toString().padStart(2, "0")}`,
    );
    await bindings.DB.batch(
      roleIds.map((roleId, index) =>
        bindings.DB.prepare(
          `INSERT INTO roles (
             id, name, description, permissions, is_system, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          roleId,
          `Boundary Role ${index.toString().padStart(2, "0")}`,
          "Invite boundary injection fixture",
          '{"allow":["entries:*:read"]}',
          0,
          nowIso,
          nowIso,
        ),
      ),
    );

    const inviteId = "invite-boundary-chunked";
    const inviteTokenHash = "invite-boundary-token-hash";
    await bindings.DB.prepare(
      `INSERT INTO auth_invites (
         id, email, role_ids, token_hash, token_expires_at, status, sent_at,
         created_at, updated_at, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        inviteId,
        "invite-boundary@example.test",
        JSON.stringify(roleIds),
        inviteTokenHash,
        "2099-01-01T00:00:00.000Z",
        "sent",
        nowIso,
        nowIso,
        nowIso,
        ownerId,
      )
      .run();

    const coverage = await verifyRollbackAtEveryBatchBoundary(
      bindings.DB,
      INVITE_LIFECYCLE_TABLES,
      async (db) =>
        await acceptInviteLifecycle(db, {
          inviteId,
          inviteTokenHash,
          userId: "user-boundary-invite",
          accountId: "account-boundary-invite",
          sessionId: "session-boundary-invite",
          authLogId: "authlog-boundary-invite",
          email: "invite-boundary@example.test",
          name: "Invite Boundary",
          roleIds,
          passwordHash: LEGACY_PASSWORD_HASH,
          refreshTokenHash: "refresh-boundary-invite",
          sessionExpiresAt: new Date("2030-02-04T04:05:06.000Z"),
          ipAddress: "203.0.113.30",
          userAgent: "auth-boundary-integration",
          now,
        }),
    );

    expect(coverage).toEqual({
      statementCount: 7,
      injectionIndexes: [0, 1, 2, 3, 4, 5, 6, 7],
    });
  });

  it("rolls back every invite acceptance row when the final auth-log write fails", async () => {
    const ownerSignIn = await signInWithBetterAuth(OWNER_EMAIL, OWNER_PASSWORD);
    expect(ownerSignIn.response.status).toBe(200);
    const ownerAccessToken = await issueAdminAccessToken(
      ownerSignIn.cookie as string,
    );
    const failedEmail = "rollback-invite@example.test";
    const invite = await createInviteThroughAdminApi(
      ownerAccessToken,
      failedEmail,
    );

    await bindings.DB.prepare(
      `CREATE TRIGGER reject_test_invite_auth_log
       BEFORE INSERT ON auth_login_events
       WHEN NEW.user_id IN (SELECT id FROM users WHERE email = '${failedEmail}')
       BEGIN
         SELECT RAISE(ABORT, 'injected invite auth-log failure');
       END`,
    ).run();

    try {
      const response = await requestWorker("/api/admin/auth/accept-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: invite.token,
          name: "Rollback Invite",
          password: "RollbackInvite123!",
        }),
      });
      expect(response.status).toBe(500);

      const storedInvite = await bindings.DB.prepare(
        `SELECT status, consumed_by_user_id
         FROM auth_invites
         WHERE id = ?`,
      )
        .bind(invite.inviteId)
        .first<{ consumed_by_user_id: string | null; status: string }>();
      expect(storedInvite).toEqual({
        status: "sent",
        consumed_by_user_id: null,
      });
      expect(
        await readCount(
          bindings.DB,
          `SELECT COUNT(*) AS count FROM users WHERE email = '${failedEmail}'`,
        ),
      ).toBe(0);
      expect(
        await readCount(
          bindings.DB,
          `SELECT COUNT(*) AS count
           FROM auth_accounts account
           INNER JOIN users user ON user.id = account.user_id
           WHERE user.email = '${failedEmail}'`,
        ),
      ).toBe(0);
      expect(
        await readCount(
          bindings.DB,
          `SELECT COUNT(*) AS count
           FROM auth_sessions session
           INNER JOIN users user ON user.id = session.user_id
           WHERE user.email = '${failedEmail}'`,
        ),
      ).toBe(0);
      expect(
        await readCount(
          bindings.DB,
          `SELECT COUNT(*) AS count
           FROM auth_login_events WHERE user_id IN (SELECT id FROM users WHERE email = '${failedEmail}')`,
        ),
      ).toBe(0);
    } finally {
      await bindings.DB.prepare(
        "DROP TRIGGER IF EXISTS reject_test_invite_auth_log",
      ).run();
    }
  });

  it("resets the canonical password atomically, invalidates the old password, and fails closed on replay", async () => {
    const requestResetResponse = await requestWorker(
      "/api/admin/auth/request-password-reset",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: INVITED_EMAIL }),
      },
    );
    const resetRouteResponse = await requestWorker(
      "/api/admin/auth/reset-password",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: "not-mounted-token-value",
          newPassword: RESET_PASSWORD,
        }),
      },
    );
    expect(requestResetResponse.status).toBe(403);
    expect(resetRouteResponse.status).toBe(400);

    const subject = await bindings.DB.prepare(
      `SELECT user.id AS user_id, account.id AS account_id
       FROM users user
       INNER JOIN auth_accounts account ON account.user_id = user.id
       WHERE user.email = ? AND account.provider_id = 'credential'`,
    )
      .bind(INVITED_EMAIL)
      .first<{ account_id: string; user_id: string }>();
    expect(subject).not.toBeNull();

    const db = drizzle(bindings.DB, { schema });
    const resetNow = new Date();
    const verificationId = "verify-real-d1-success";
    const verificationIdentifier = `password_reset:${subject!.user_id}`;
    const verificationValue = "real-d1-reset-verification";
    await rotatePasswordResetVerification(db, {
      id: verificationId,
      identifier: verificationIdentifier,
      value: verificationValue,
      expiresAt: new Date(resetNow.getTime() + 60 * 60 * 1000),
      now: resetNow,
    });
    expect(
      await readCount(
        bindings.DB,
        `SELECT COUNT(*) AS count FROM auth_sessions WHERE user_id = '${subject!.user_id}'`,
      ),
    ).toBeGreaterThan(0);

    const nextPasswordHash = await bcrypt.hash(RESET_PASSWORD, 4);
    const reset = await resetCredentialPasswordLifecycle(db, {
      accountId: subject!.account_id,
      userId: subject!.user_id,
      verificationId,
      verificationIdentifier,
      verificationValue,
      passwordHash: nextPasswordHash,
      now: resetNow,
    });
    expect(reset).toBe(true);
    expect(
      await readCount(
        bindings.DB,
        `SELECT COUNT(*) AS count FROM auth_sessions WHERE user_id = '${subject!.user_id}'`,
      ),
    ).toBe(0);
    expect(
      await readCount(
        bindings.DB,
        `SELECT COUNT(*) AS count FROM auth_verifications WHERE id = '${verificationId}'`,
      ),
    ).toBe(0);

    const storedPasswordHash = await bindings.DB.prepare(
      "SELECT password_hash FROM auth_accounts WHERE id = ?",
    )
      .bind(subject!.account_id)
      .first<string>("password_hash");
    await expect(
      bcrypt.compare(RESET_PASSWORD, storedPasswordHash as string),
    ).resolves.toBe(true);
    await expect(
      bcrypt.compare(INVITED_PASSWORD, storedPasswordHash as string),
    ).resolves.toBe(false);

    const newPasswordSignIn = await signInWithBetterAuth(
      INVITED_EMAIL,
      RESET_PASSWORD,
    );
    expect(newPasswordSignIn.response.status).toBe(200);
    expect(newPasswordSignIn.cookie).not.toBeNull();
    const sessionsBeforeReplay = await bindings.DB.prepare(
      "SELECT id FROM auth_sessions WHERE user_id = ? ORDER BY id",
    )
      .bind(subject!.user_id)
      .all<{ id: string }>();
    expect(sessionsBeforeReplay.results).toHaveLength(1);

    const replay = await resetCredentialPasswordLifecycle(db, {
      accountId: subject!.account_id,
      userId: subject!.user_id,
      verificationId,
      verificationIdentifier,
      verificationValue,
      passwordHash: nextPasswordHash,
      now: resetNow,
    });
    expect(replay).toBe(false);
    const sessionsAfterReplay = await bindings.DB.prepare(
      "SELECT id FROM auth_sessions WHERE user_id = ? ORDER BY id",
    )
      .bind(subject!.user_id)
      .all<{ id: string }>();
    expect(sessionsAfterReplay.results).toEqual(sessionsBeforeReplay.results);
  });

  it.each([false, true])(
    "rolls back password reset at every D1 batch statement boundary, first credential=%s",
    async (createAccount) => {
      const subject = await bindings.DB.prepare(
        `SELECT user.id AS user_id, account.id AS account_id
       FROM users user
       INNER JOIN auth_accounts account ON account.user_id = user.id
       WHERE user.email = ? AND account.provider_id = 'credential'`,
      )
        .bind(INVITED_EMAIL)
        .first<{ account_id: string; user_id: string }>();
      expect(subject).not.toBeNull();

      const db = drizzle(bindings.DB, { schema });
      const existingAccount = await bindings.DB.prepare(
        "SELECT * FROM auth_accounts WHERE id = ?",
      )
        .bind(subject!.account_id)
        .first<Record<string, unknown>>();
      if (createAccount)
        await bindings.DB.prepare("DELETE FROM auth_accounts WHERE id = ?")
          .bind(subject!.account_id)
          .run();
      const now = new Date("2030-03-04T05:06:07.000Z");
      const verificationId = "verify-boundary-password-reset";
      const verificationIdentifier = `password_reset:${subject!.user_id}`;
      const verificationValue = "boundary-password-reset-verification";
      await rotatePasswordResetVerification(db, {
        id: verificationId,
        identifier: verificationIdentifier,
        value: verificationValue,
        expiresAt: new Date("2030-03-04T06:06:07.000Z"),
        now,
      });
      expect(
        await readCount(
          bindings.DB,
          `SELECT COUNT(*) AS count FROM auth_sessions WHERE user_id = '${subject!.user_id}'`,
        ),
      ).toBeGreaterThan(0);

      const nextPasswordHash = await bcrypt.hash("BoundaryResetPass123!", 4);
      const coverage = await verifyRollbackAtEveryBatchBoundary(
        bindings.DB,
        PASSWORD_RESET_LIFECYCLE_TABLES,
        async (lifecycleDb) =>
          await resetCredentialPasswordLifecycle(lifecycleDb, {
            accountId: subject!.account_id,
            createAccount,
            userId: subject!.user_id,
            verificationId,
            verificationIdentifier,
            verificationValue,
            passwordHash: nextPasswordHash,
            now,
          }),
      );

      expect(coverage).toEqual({
        statementCount: 3,
        injectionIndexes: [0, 1, 2, 3],
      });
      // Preserve the fixture used by the following canonical-credential tests.
      if (createAccount) {
        const columns = Object.keys(existingAccount!);
        await bindings.DB.prepare(
          `INSERT INTO auth_accounts (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
        )
          .bind(...Object.values(existingAccount!))
          .run();
      }
    },
  );

  it("rolls back password and session changes when the final reset-verification delete fails", async () => {
    const subject = await bindings.DB.prepare(
      `SELECT user.id AS user_id, account.id AS account_id, account.password_hash
       FROM users user
       INNER JOIN auth_accounts account ON account.user_id = user.id
       WHERE user.email = ? AND account.provider_id = 'credential'`,
    )
      .bind(INVITED_EMAIL)
      .first<{
        account_id: string;
        password_hash: string;
        user_id: string;
      }>();
    expect(subject).not.toBeNull();

    const activeSignIn = await signInWithBetterAuth(
      INVITED_EMAIL,
      RESET_PASSWORD,
    );
    expect(activeSignIn.response.status).toBe(200);
    const sessionsBeforeFailure = await bindings.DB.prepare(
      "SELECT id FROM auth_sessions WHERE user_id = ? ORDER BY id",
    )
      .bind(subject!.user_id)
      .all<{ id: string }>();
    expect(sessionsBeforeFailure.results.length).toBeGreaterThan(0);

    const db = drizzle(bindings.DB, { schema });
    const resetNow = new Date();
    const verificationId = "verify-real-d1-rollback";
    const verificationIdentifier = `password_reset:${subject!.user_id}`;
    const verificationValue = "real-d1-rollback-verification";
    await rotatePasswordResetVerification(db, {
      id: verificationId,
      identifier: verificationIdentifier,
      value: verificationValue,
      expiresAt: new Date(resetNow.getTime() + 60 * 60 * 1000),
      now: resetNow,
    });
    const rejectedPasswordHash = await bcrypt.hash("RejectedPass123!", 4);
    await bindings.DB.prepare(
      `CREATE TRIGGER reject_test_reset_verification_delete
       BEFORE DELETE ON auth_verifications
       WHEN OLD.id = '${verificationId}'
       BEGIN
         SELECT RAISE(ABORT, 'injected reset verification failure');
       END`,
    ).run();

    try {
      await expect(
        resetCredentialPasswordLifecycle(db, {
          accountId: subject!.account_id,
          userId: subject!.user_id,
          verificationId,
          verificationIdentifier,
          verificationValue,
          passwordHash: rejectedPasswordHash,
          now: resetNow,
        }),
      ).rejects.toThrow("injected reset verification failure");

      const passwordAfterFailure = await bindings.DB.prepare(
        "SELECT password_hash FROM auth_accounts WHERE id = ?",
      )
        .bind(subject!.account_id)
        .first<string>("password_hash");
      expect(passwordAfterFailure).toBe(subject!.password_hash);
      const sessionsAfterFailure = await bindings.DB.prepare(
        "SELECT id FROM auth_sessions WHERE user_id = ? ORDER BY id",
      )
        .bind(subject!.user_id)
        .all<{ id: string }>();
      expect(sessionsAfterFailure.results).toEqual(
        sessionsBeforeFailure.results,
      );
      expect(
        await readCount(
          bindings.DB,
          `SELECT COUNT(*) AS count FROM auth_verifications WHERE id = '${verificationId}'`,
        ),
      ).toBe(1);
    } finally {
      await bindings.DB.prepare(
        "DROP TRIGGER IF EXISTS reject_test_reset_verification_delete",
      ).run();
    }
  });

  it("migrates v0 bcrypt credentials and only active legacy sessions before real sign-in", async () => {
    const legacyMigrations = bindings.NABECMS_001_MIGRATIONS;
    const forwardMigration = bindings.TEST_MIGRATIONS.find(({ name }) =>
      name.startsWith("0007_"),
    );
    expect(legacyMigrations).toHaveLength(7);
    expect(forwardMigration).toBeDefined();

    await applyD1Migrations(bindings.LEGACY_DB, legacyMigrations);
    const activeRefreshHash = await sha256Hex(LEGACY_REFRESH_TOKEN);
    await bindings.LEGACY_DB.batch([
      bindings.LEGACY_DB.prepare(
        `INSERT INTO users (
           id, email, password_hash, display_name, is_owner,
           email_verified, password, name, role_id, ui_preferences
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        "legacy-user",
        LEGACY_EMAIL,
        LEGACY_PASSWORD_HASH,
        "Legacy User",
        1,
        1,
        LEGACY_PASSWORD_HASH,
        "Legacy User",
        '["system.super-admin"]',
        "null",
      ),
      bindings.LEGACY_DB.prepare(
        `INSERT INTO auth_identities (
           id, user_id, provider, subject, email, email_verified
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(
        "legacy-identity",
        "legacy-user",
        "local",
        "legacy-user",
        LEGACY_EMAIL,
        1,
      ),
      bindings.LEGACY_DB.prepare(
        `INSERT INTO auth_credentials (
           id, identity_id, type, password_hash
         ) VALUES (?, ?, ?, ?)`,
      ).bind(
        "legacy-credential",
        "legacy-identity",
        "password",
        LEGACY_PASSWORD_HASH,
      ),
      bindings.LEGACY_DB.prepare(
        `INSERT INTO auth_sessions (
           id, user_id, identity_id, refresh_token_hash,
           user_agent, ip, expires_at, revoked_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        "legacy-active",
        "legacy-user",
        "legacy-identity",
        activeRefreshHash,
        "legacy-agent",
        "203.0.113.20",
        "2099-01-01T00:00:00.000Z",
        null,
      ),
      bindings.LEGACY_DB.prepare(
        `INSERT INTO auth_sessions (
           id, user_id, identity_id, refresh_token_hash,
           expires_at, revoked_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(
        "legacy-revoked",
        "legacy-user",
        "legacy-identity",
        "revoked-refresh-hash",
        "2099-01-01T00:00:00.000Z",
        "2025-01-01T00:00:00.000Z",
      ),
      bindings.LEGACY_DB.prepare(
        `INSERT INTO auth_sessions (
           id, user_id, identity_id, refresh_token_hash,
           expires_at, revoked_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(
        "legacy-expired",
        "legacy-user",
        "legacy-identity",
        "expired-refresh-hash",
        "2000-01-01T00:00:00.000Z",
        null,
      ),
    ]);

    await applyD1Migrations(bindings.LEGACY_DB, [forwardMigration!]);

    const migratedAccount = await bindings.LEGACY_DB.prepare(
      `SELECT user_id, provider_id, account_id, password_hash
       FROM auth_accounts
       WHERE user_id = ?`,
    )
      .bind("legacy-user")
      .first<{
        account_id: string;
        password_hash: string;
        provider_id: string;
        user_id: string;
      }>();
    expect(migratedAccount).toEqual({
      user_id: "legacy-user",
      provider_id: "credential",
      account_id: "legacy-user",
      password_hash: LEGACY_PASSWORD_HASH,
    });

    const migratedSessions = await bindings.LEGACY_DB.prepare(
      `SELECT id, token, legacy_refresh_token_hash, expires_at
       FROM auth_sessions
       ORDER BY id`,
    ).all<{
      expires_at: number;
      id: string;
      legacy_refresh_token_hash: string;
      token: string;
    }>();
    expect(migratedSessions.results).toEqual([
      {
        id: "legacy-active",
        token: `legacy:${activeRefreshHash}`,
        legacy_refresh_token_hash: activeRefreshHash,
        expires_at: Date.parse("2099-01-01T00:00:00.000Z"),
      },
    ]);

    const legacyRefreshResponse = await adminAuthRefreshRoute.request(
      "/api/admin/auth/refresh",
      {
        method: "POST",
        headers: { Cookie: `${REFRESH_COOKIE}=${LEGACY_REFRESH_TOKEN}` },
      },
      createLegacyAuthEnv(),
    );
    expect(legacyRefreshResponse.status).toBe(200);
    expect(
      extractRefreshCookie(legacyRefreshResponse.headers.get("set-cookie")),
    ).not.toBeNull();

    const legacyAuth = await getBetterAuth(createLegacyAuthEnv());
    expect(legacyAuth).not.toBeNull();
    const signInResponse = await legacyAuth!.handler(
      new Request(new URL("/api/auth/sign-in/email", TEST_ORIGIN), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: TEST_ORIGIN,
        },
        body: JSON.stringify({
          email: LEGACY_EMAIL,
          password: LEGACY_PASSWORD,
          rememberMe: true,
        }),
      }),
    );
    expect(signInResponse.status).toBe(200);
    const legacySessionCookie = extractSessionCookie(
      signInResponse.headers.get("set-cookie"),
    );
    expect(legacySessionCookie).not.toBeNull();
    const getSessionResponse = await legacyAuth!.handler(
      new Request(new URL("/api/auth/get-session", TEST_ORIGIN), {
        headers: {
          Cookie: legacySessionCookie as string,
          Origin: TEST_ORIGIN,
        },
      }),
    );
    expect(getSessionResponse.status).toBe(200);
    expect(await getSessionResponse.json()).toMatchObject({
      user: { email: LEGACY_EMAIL, id: "legacy-user" },
    });
    expect(
      await readCount(
        bindings.LEGACY_DB,
        "SELECT COUNT(*) AS count FROM auth_sessions",
      ),
    ).toBe(2);
  });
});
