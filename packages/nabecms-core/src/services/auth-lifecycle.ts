/**
 * Atomic D1 write batches for authentication lifecycle transitions.
 *
 * Password hashing, token generation, and JWT signing belong to callers and
 * must finish before these functions are invoked.
 */
import {
  and,
  eq,
  exists,
  gt,
  inArray,
  notExists,
  sql,
  type SQL,
} from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../database/schema";
import { SUPER_ADMIN_ROLE_ID } from "../lib/system-roles";
import { DEFAULT_USER_PREFERENCES } from "../lib/user-preferences";

const SYSTEM_INITIALIZED_KEY = "system.initialized" as const;
const CREDENTIAL_PROVIDER_ID = "credential" as const;
const D1_MAX_BOUND_PARAMETERS = 100;
const USER_ROLE_BOUND_PARAMETERS = 3;
const USER_ROLE_ROWS_PER_INSERT = Math.floor(
  D1_MAX_BOUND_PARAMETERS / USER_ROLE_BOUND_PARAMETERS,
);

type AuthLifecycleDatabase = DrizzleD1Database<typeof schema>;

export type InitializeAuthLifecycleInput = {
  userId: string;
  accountId: string;
  email: string;
  name: string;
  passwordHash: string;
  defaultLocale: string;
  now: Date;
};

export type AcceptInviteLifecycleInput = {
  inviteId: string;
  inviteTokenHash: string;
  userId: string;
  accountId: string;
  sessionId: string;
  authLogId: string;
  email: string;
  name: string;
  roleIds: string[];
  passwordHash: string;
  refreshTokenHash: string;
  sessionExpiresAt: Date;
  ipAddress?: string;
  userAgent?: string;
  now: Date;
};

export type RotatePasswordResetVerificationInput = {
  id: string;
  identifier: string;
  value: string;
  expiresAt: Date;
  now: Date;
};

export type ResetCredentialPasswordLifecycleInput = {
  accountId: string;
  /** Create the first credential only after an emailed token proves ownership. */
  createAccount?: boolean;
  userId: string;
  verificationId: string;
  verificationIdentifier: string;
  verificationValue: string;
  passwordHash: string;
  now: Date;
};

/**
 * Error raised when an invite changes after validation but before its batch
 * commits. D1 constraints roll the whole batch back first.
 */
export class InviteAcceptanceConflictError extends Error {
  constructor() {
    super("Invite is no longer usable");
  }
}

/**
 * Error raised when an invite email is claimed by another user concurrently.
 */
export class InviteEmailConflictError extends Error {
  constructor() {
    super("User already exists for invite email");
  }
}

/**
 * Convert an unknown database error into a stable searchable message.
 */
const databaseErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Return whether a D1 error reports a foreign-key constraint failure.
 */
const isForeignKeyConstraintError = (error: unknown): boolean =>
  /foreign key constraint/iu.test(databaseErrorMessage(error));

/**
 * Return whether a D1 error reports the unique users.email constraint.
 */
const isUserEmailConstraintError = (error: unknown): boolean =>
  /unique constraint failed:\s*users\.email/iu.test(
    databaseErrorMessage(error),
  );

/** Return whether the mandatory invite eligibility guard rejected a claim. */
const isInviteEligibilityConstraintError = (error: unknown): boolean =>
  /not null constraint failed:\s*users\.email/iu.test(
    databaseErrorMessage(error),
  );

/**
 * Extract the number of rows changed by a D1 mutation result.
 */
const changedRowCount = (result: unknown): number => {
  if (!result || typeof result !== "object") return 0;
  const meta = (result as { meta?: unknown }).meta;
  if (!meta || typeof meta !== "object") return 0;
  const changes = (meta as { changes?: unknown }).changes;
  return typeof changes === "number" ? changes : 0;
};

/**
 * Create the initialization sentinel, reserved role, first user, credential
 * account, role assignment, and default locale in one D1 transaction batch.
 */
export const initializeAuthLifecycle = async (
  db: AuthLifecycleDatabase,
  input: InitializeAuthLifecycleInput,
): Promise<void> => {
  const nowIso = input.now.toISOString();

  await db.batch([
    db.insert(schema.settings).values({
      key: SYSTEM_INITIALIZED_KEY,
      value: { at: nowIso, by: input.userId, status: "completed" },
      updatedAt: nowIso,
    }),
    db
      .insert(schema.roles)
      .values({
        id: SUPER_ADMIN_ROLE_ID,
        name: "Super Admin",
        description: "System reserved role with full privileges",
        permissions: { allow: ["*"] },
        isSystem: true,
        createdAt: nowIso,
        updatedAt: nowIso,
      })
      .onConflictDoNothing({ target: schema.roles.id }),
    db.insert(schema.users).values({
      id: input.userId,
      email: input.email,
      name: input.name,
      roleId: [SUPER_ADMIN_ROLE_ID],
      uiPreferences: DEFAULT_USER_PREFERENCES,
      createdAt: nowIso,
      updatedAt: nowIso,
    }),
    db.insert(schema.userRoles).values({
      userId: input.userId,
      roleId: SUPER_ADMIN_ROLE_ID,
      createdAt: nowIso,
    }),
    db.insert(schema.authAccounts).values({
      id: input.accountId,
      userId: input.userId,
      providerId: CREDENTIAL_PROVIDER_ID,
      accountId: input.userId,
      password: input.passwordHash,
      createdAt: input.now,
      updatedAt: input.now,
    }),
    db.update(schema.locales).set({
      isDefault: false,
      updatedAt: nowIso,
    }),
    db
      .insert(schema.locales)
      .values({
        code: input.defaultLocale,
        isDefault: true,
        createdAt: nowIso,
        updatedAt: nowIso,
      })
      .onConflictDoUpdate({
        target: schema.locales.code,
        set: { isDefault: true, updatedAt: nowIso },
      }),
  ] as const);
};

/**
 * Accept an invite and create its user, roles, credential account, session,
 * and audit event in one D1 transaction batch.
 *
 * The first user insert obtains its mandatory email through an eligible-invite
 * subquery. A missing match yields NULL, so the NOT NULL constraint aborts the
 * batch before any canonical credentials can survive a stale claim.
 */
export const acceptInviteLifecycle = async (
  db: AuthLifecycleDatabase,
  input: AcceptInviteLifecycleInput,
): Promise<void> => {
  const nowIso = input.now.toISOString();
  const canonicalSessionToken = `legacy:${input.refreshTokenHash}`;
  // Inspect both the caller's role snapshot and current stored roles at commit.
  // A JSON parameter keeps the number of bindings independent of role count.
  const invitableRoles = (roleIds: SQL) => sql<boolean>`NOT EXISTS (
    SELECT 1 FROM json_each(${roleIds}) AS invited_role
    LEFT JOIN ${schema.roles} ON ${schema.roles.id} = trim(invited_role.value)
    WHERE trim(invited_role.value) = ${SUPER_ADMIN_ROLE_ID}
       OR ${schema.roles.id} IS NULL
       OR ${schema.roles.isSystem} = 1
  )`;
  const usableInvite = and(
    eq(schema.authInvites.id, input.inviteId),
    eq(schema.authInvites.tokenHash, input.inviteTokenHash),
    inArray(schema.authInvites.status, ["pending", "sent"]),
    gt(schema.authInvites.tokenExpiresAt, nowIso),
    invitableRoles(sql`${schema.authInvites.roleIds}`),
    invitableRoles(sql`${JSON.stringify(input.roleIds)}`),
  );
  const eligibleInviteEmail = db
    .select({ email: sql<string>`${input.email}` })
    .from(schema.authInvites)
    .where(usableInvite)
    .limit(1);
  const roleAssignmentInserts = [];
  for (
    let index = 0;
    index < input.roleIds.length;
    index += USER_ROLE_ROWS_PER_INSERT
  ) {
    roleAssignmentInserts.push(
      db.insert(schema.userRoles).values(
        input.roleIds
          .slice(index, index + USER_ROLE_ROWS_PER_INSERT)
          .map((roleId) => ({
            userId: input.userId,
            roleId,
            createdAt: nowIso,
          })),
      ),
    );
  }
  const guardedSessionSelect = db
    .select({
      id: sql<string>`${input.sessionId}`.as("id"),
      userId: sql<string>`${input.userId}`.as("user_id"),
      token: sql<string>`${canonicalSessionToken}`.as("token"),
      legacyRefreshTokenHash: sql<string>`${input.refreshTokenHash}`.as(
        "legacy_refresh_token_hash",
      ),
      expiresAt: sql<number>`${input.sessionExpiresAt.getTime()}`.as(
        "expires_at",
      ),
      ipAddress: sql<string | null>`${input.ipAddress ?? null}`.as(
        "ip_address",
      ),
      userAgent: sql<string | null>`${input.userAgent ?? null}`.as(
        "user_agent",
      ),
      createdAt: sql<number>`${input.now.getTime()}`.as("created_at"),
      updatedAt: sql<number>`${input.now.getTime()}`.as("updated_at"),
    })
    .from(schema.authInvites)
    .where(
      and(
        eq(schema.authInvites.id, input.inviteId),
        eq(schema.authInvites.tokenHash, input.inviteTokenHash),
        eq(schema.authInvites.status, "consumed"),
        eq(schema.authInvites.consumedByUserId, input.userId),
        eq(schema.authInvites.updatedAt, nowIso),
      ),
    )
    .limit(1);

  try {
    await db.batch([
      db.insert(schema.users).values({
        id: input.userId,
        email: sql<string>`(${eligibleInviteEmail})`,
        name: input.name,
        roleId: input.roleIds,
        uiPreferences: DEFAULT_USER_PREFERENCES,
        createdAt: nowIso,
        updatedAt: nowIso,
      }),
      ...roleAssignmentInserts,
      db.insert(schema.authAccounts).values({
        id: input.accountId,
        userId: input.userId,
        providerId: CREDENTIAL_PROVIDER_ID,
        accountId: input.userId,
        password: input.passwordHash,
        createdAt: input.now,
        updatedAt: input.now,
      }),
      db
        .update(schema.authInvites)
        .set({
          status: "consumed",
          consumedByUserId: input.userId,
          updatedAt: nowIso,
        })
        .where(usableInvite),
      db.insert(schema.authSessions).select(guardedSessionSelect),
      db.insert(schema.authLoginEvents).values({
        id: input.authLogId,
        userId: input.userId,
        provider: "local",
        result: "success",
        reason: "other",
        createdAt: nowIso,
      }),
    ] as const);
  } catch (error) {
    if (isUserEmailConstraintError(error)) {
      throw new InviteEmailConflictError();
    }
    if (
      isInviteEligibilityConstraintError(error) ||
      isForeignKeyConstraintError(error)
    ) {
      throw new InviteAcceptanceConflictError();
    }
    throw error;
  }
};

/**
 * Replace any prior password-reset verification with a fresh value in one D1
 * transaction batch.
 */
export const rotatePasswordResetVerification = async (
  db: AuthLifecycleDatabase,
  input: RotatePasswordResetVerificationInput,
): Promise<void> => {
  await db.batch([
    db
      .delete(schema.authVerifications)
      .where(eq(schema.authVerifications.identifier, input.identifier)),
    db.insert(schema.authVerifications).values({
      id: input.id,
      identifier: input.identifier,
      value: input.value,
      expiresAt: input.expiresAt,
      createdAt: input.now,
      updatedAt: input.now,
    }),
  ] as const);
};

/**
 * Set a canonical credential password, revoke all sessions, and consume
 * the matching verification in one D1 transaction batch.
 *
 * @returns `true` only when the verification was still active and the account
 * password was set by this batch, including the first credential when absent.
 */
export const resetCredentialPasswordLifecycle = async (
  db: AuthLifecycleDatabase,
  input: ResetCredentialPasswordLifecycleInput,
): Promise<boolean> => {
  const activeVerification = db
    .select({ id: schema.authVerifications.id })
    .from(schema.authVerifications)
    .where(
      and(
        eq(schema.authVerifications.id, input.verificationId),
        eq(schema.authVerifications.identifier, input.verificationIdentifier),
        eq(schema.authVerifications.value, input.verificationValue),
        gt(schema.authVerifications.expiresAt, input.now),
      ),
    );
  const accountHasNewPassword = db
    .select({ id: schema.authAccounts.id })
    .from(schema.authAccounts)
    .where(
      and(
        eq(schema.authAccounts.id, input.accountId),
        eq(schema.authAccounts.userId, input.userId),
        eq(schema.authAccounts.providerId, CREDENTIAL_PROVIDER_ID),
        eq(schema.authAccounts.password, input.passwordHash),
        eq(schema.authAccounts.updatedAt, input.now),
      ),
    );

  const passwordWrite = input.createAccount
    ? db.insert(schema.authAccounts).select(
        db
          .select({
            id: sql<string>`${input.accountId}`.as("id"),
            userId: schema.users.id,
            providerId: sql<string>`${CREDENTIAL_PROVIDER_ID}`.as(
              "provider_id",
            ),
            accountId: sql<string>`${input.userId}`.as("account_id"),
            password: sql<string>`${input.passwordHash}`.as("password_hash"),
            accessToken: sql<null>`NULL`.as("access_token"),
            refreshToken: sql<null>`NULL`.as("refresh_token"),
            idToken: sql<null>`NULL`.as("id_token"),
            scope: sql<null>`NULL`.as("scope"),
            accessTokenExpiresAt: sql<null>`NULL`.as("access_token_expires_at"),
            refreshTokenExpiresAt: sql<null>`NULL`.as(
              "refresh_token_expires_at",
            ),
            createdAt: sql<number>`${input.now.getTime()}`.as("created_at"),
            updatedAt: sql<number>`${input.now.getTime()}`.as("updated_at"),
          })
          .from(schema.users)
          .where(
            and(
              eq(schema.users.id, input.userId),
              exists(activeVerification),
              notExists(
                db
                  .select({ id: schema.authAccounts.id })
                  .from(schema.authAccounts)
                  .where(
                    and(
                      eq(schema.authAccounts.userId, input.userId),
                      eq(
                        schema.authAccounts.providerId,
                        CREDENTIAL_PROVIDER_ID,
                      ),
                    ),
                  ),
              ),
            ),
          ),
      )
    : db
        .update(schema.authAccounts)
        .set({ password: input.passwordHash, updatedAt: input.now })
        .where(
          and(
            eq(schema.authAccounts.id, input.accountId),
            eq(schema.authAccounts.userId, input.userId),
            eq(schema.authAccounts.providerId, CREDENTIAL_PROVIDER_ID),
            exists(activeVerification),
          ),
        );
  const results = await db.batch([
    passwordWrite,
    db
      .delete(schema.authSessions)
      .where(
        and(
          eq(schema.authSessions.userId, input.userId),
          exists(activeVerification),
          exists(accountHasNewPassword),
        ),
      ),
    db
      .delete(schema.authVerifications)
      .where(
        and(
          eq(schema.authVerifications.identifier, input.verificationIdentifier),
          exists(activeVerification),
          exists(accountHasNewPassword),
        ),
      ),
  ] as const);

  return changedRowCount(results[0]) === 1;
};
