import { beforeEach, describe, expect, it, vi } from "vitest";

type DbMockOptions = {
  verification?: Record<string, unknown> | null;
  credentialAccount?: Record<string, unknown> | null;
};

const createDbMock = (options: DbMockOptions = {}) => {
  const updates: Array<Record<string, unknown>> = [];
  const selectQueue: unknown[][] = [];

  if ("verification" in options) {
    selectQueue.push(options.verification ? [options.verification] : []);
  }
  if ("credentialAccount" in options) {
    selectQueue.push(
      options.credentialAccount ? [options.credentialAccount] : [],
    );
  }

  let selectIndex = 0;

  const db = {
    select: vi.fn(() => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            const result = selectQueue[selectIndex] ?? [];
            selectIndex += 1;
            return result;
          },
        }),
      }),
    })),
    update: vi.fn(() => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updates.push(values);
        },
      }),
    })),
    delete: vi.fn(() => ({
      where: async () => {},
    })),
    insert: vi.fn(() => ({
      values: async () => {},
    })),
  };

  return { db, updates };
};

const createEnv = () =>
  ({
    DB: {} as any,
    WORKER_ENV: "test",
    BCRYPT_COST: "4",
    ASSETS: { fetch: vi.fn() },
  }) as any;

describe("admin auth password-reset route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("sends reset email for users with Better Auth credential account", async () => {
    const { db } = createDbMock({
      credentialAccount: {
        id: "authacct_1",
        userId: "user_1",
        providerId: "credential",
      },
    });
    const sendAuthEmail = vi.fn(async () => ({ status: "accepted" }));
    const rotatePasswordResetVerification = vi.fn(async () => {});

    vi.doMock("drizzle-orm/d1", () => ({
      drizzle: vi.fn(() => db),
    }));
    vi.doMock("../../../lib/auth", async () => {
      const actual = await vi.importActual("../../../lib/auth");
      return {
        ...(actual as object),
        getUserByEmail: vi.fn(async () => ({
          id: "user_1",
          email: "admin@example.com",
        })),
        getLocalIdentity: vi.fn(async () => null),
        getCredentialByIdentity: vi.fn(async () => null),
        sha256Hex: vi.fn(async () => "secret_hash"),
      };
    });
    vi.doMock("../../../services/email-settings", () => ({
      getEmailSettings: vi.fn(async () => ({
        environment: { configured: true, baseUrl: "https://cms.example.com" },
        item: { passwordResetEnabled: true },
      })),
      sendAuthEmail,
    }));
    vi.doMock("../../../services/auth-lifecycle", () => ({
      rotatePasswordResetVerification,
      resetCredentialPasswordLifecycle: vi.fn(),
    }));

    const { default: app } = await import("./password-reset");
    const res = await app.request(
      "/api/admin/auth/request-password-reset",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "admin@example.com" }),
      },
      createEnv(),
    );

    expect(res.status).toBe(200);
    expect(sendAuthEmail).toHaveBeenCalledTimes(1);
    expect(sendAuthEmail).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "password_reset",
      "admin@example.com",
      "NabeCMS password reset",
      expect.stringContaining(
        "https://cms.example.com/admin/auth/reset-password",
      ),
    );
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(rotatePasswordResetVerification).not.toHaveBeenCalled();
  });

  it("updates only the canonical credential in one reset lifecycle", async () => {
    const { db } = createDbMock({
      verification: {
        id: "verify_1",
        identifier: "password_reset:user_1",
        value: "secret_hash",
        expiresAt: new Date(Date.now() + 60_000),
      },
      credentialAccount: {
        id: "authacct_1",
        userId: "user_1",
        providerId: "credential",
      },
    });
    const hash = vi.fn(async () => "new_password_hash");
    const resetCredentialPasswordLifecycle = vi.fn(async () => true);

    vi.doMock("bcryptjs", () => ({
      default: {
        hash,
      },
    }));
    vi.doMock("drizzle-orm/d1", () => ({
      drizzle: vi.fn(() => db),
    }));
    vi.doMock("../../../lib/auth", async () => {
      const actual = await vi.importActual("../../../lib/auth");
      return {
        ...(actual as object),
        sha256Hex: vi.fn(async () => "secret_hash"),
      };
    });
    vi.doMock("../../../services/auth-lifecycle", () => ({
      rotatePasswordResetVerification: vi.fn(),
      resetCredentialPasswordLifecycle,
    }));

    const { default: app } = await import("./password-reset");
    const res = await app.request(
      "/api/admin/auth/reset-password",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: "user_1.abcdefghijklmnop",
          newPassword: "Password123",
        }),
      },
      createEnv(),
    );

    expect(res.status).toBe(200);
    expect(hash).toHaveBeenCalledTimes(1);
    expect(resetCredentialPasswordLifecycle).toHaveBeenCalledTimes(1);
    expect(resetCredentialPasswordLifecycle).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        accountId: "authacct_1",
        userId: "user_1",
        verificationId: "verify_1",
        verificationIdentifier: "password_reset:user_1",
        verificationValue: "secret_hash",
        passwordHash: "new_password_hash",
        now: expect.any(Date),
      }),
    );
  });
});
