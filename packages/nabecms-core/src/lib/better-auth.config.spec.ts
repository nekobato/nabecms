import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as authSchema from "../database/schema";

const mocks = vi.hoisted(() => ({
  betterAuth: vi.fn((options: unknown) => ({
    handler: vi.fn(),
    options,
  })),
  drizzleAdapter: vi.fn(() => ({ adapter: true })),
  drizzle: vi.fn(() => ({ drizzle: true })),
}));

vi.mock("better-auth", () => ({ betterAuth: mocks.betterAuth }));
vi.mock("better-auth/adapters/drizzle", () => ({
  drizzleAdapter: mocks.drizzleAdapter,
}));
vi.mock("drizzle-orm/d1", () => ({ drizzle: mocks.drizzle }));

import { getBetterAuth } from "./better-auth";

const createEnv = () =>
  ({
    DB: {},
    WORKER_ENV: "test",
    BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-bytes-long",
    BETTER_AUTH_URL: "https://cms.example.test",
    BCRYPT_COST: "4",
  }) as any;

describe("Better Auth canonical configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes the canonical Drizzle tables to the database and adapter", async () => {
    await getBetterAuth(createEnv());

    const expectedSchema = {
      user: authSchema.users,
      session: authSchema.authSessions,
      account: authSchema.authAccounts,
      verification: authSchema.authVerifications,
    };
    expect(mocks.drizzle).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ schema: expectedSchema }),
    );
    expect(mocks.drizzleAdapter).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        provider: "sqlite",
        schema: expectedSchema,
        transaction: false,
      }),
    );
  });

  it("enables credential sign-in with the existing bcrypt hash contract", async () => {
    await getBetterAuth(createEnv());

    const options = mocks.betterAuth.mock.calls[0]?.[0] as any;
    expect(options.emailAndPassword).toMatchObject({
      enabled: true,
      disableSignUp: true,
    });
    expect(options.session.expiresIn).toBe(30 * 24 * 60 * 60);

    const existingHash = await bcrypt.hash("legacy-password", 4);
    await expect(
      options.emailAndPassword.password.verify({
        hash: existingHash,
        password: "legacy-password",
      }),
    ).resolves.toBe(true);
    await expect(
      options.emailAndPassword.password.verify({
        hash: existingHash,
        password: "wrong-password",
      }),
    ).resolves.toBe(false);
    await expect(
      options.emailAndPassword.password.hash("next-password"),
    ).resolves.toMatch(/^\$2[aby]\$/u);
  });
});
