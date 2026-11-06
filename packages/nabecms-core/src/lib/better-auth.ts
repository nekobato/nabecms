import bcrypt from "bcryptjs";
import * as schema from "../database/schema";
import type { Env } from "../types";
import { REFRESH_TTL_SECONDS } from "./auth";
import { resolveSsoConfig, SsoConfigError } from "./sso/config";
import { DEFAULT_USER_PREFERENCES } from "./user-preferences";

export { SsoConfigError } from "./sso/config";

type BetterAuthInstance = {
  handler: (request: Request) => Response | Promise<Response>;
};

const authCache = new WeakMap<object, Promise<BetterAuthInstance | null>>();

/**
 * Resolve a bcrypt cost accepted by bcryptjs, falling back to the project
 * default when an environment value is absent or invalid.
 */
const resolveBcryptCost = (value: string | undefined): number => {
  const parsed = Number(value ?? 10);
  return Number.isInteger(parsed) && parsed >= 4 && parsed <= 31 ? parsed : 10;
};

/**
 * Create the canonical Better Auth instance for one Worker environment.
 */
const createBetterAuth = async (
  env: Env,
): Promise<BetterAuthInstance | null> => {
  const ssoConfig = resolveSsoConfig(env);
  if (!ssoConfig.enabled || !ssoConfig.betterAuth) {
    return null;
  }

  const db = env.DB as unknown;
  if (!db || typeof db !== "object") {
    throw new Error("[auth] DB binding is required for Better Auth");
  }

  const [{ betterAuth }, { drizzleAdapter }, { drizzle }] = await Promise.all([
    import("better-auth"),
    import("better-auth/adapters/drizzle"),
    import("drizzle-orm/d1"),
  ]);

  const betterAuthSchema = {
    user: schema.users,
    session: schema.authSessions,
    account: schema.authAccounts,
    verification: schema.authVerifications,
  } as const;
  const authDb = drizzle(db as any, { schema: betterAuthSchema });
  const bcryptCost = resolveBcryptCost(env.BCRYPT_COST);

  return betterAuth({
    secret: ssoConfig.betterAuth.secret,
    baseURL: ssoConfig.betterAuth.baseURL,
    database: drizzleAdapter(authDb, {
      provider: "sqlite",
      schema: betterAuthSchema,
      transaction: false,
    }),
    socialProviders: {},
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      password: {
        hash: async (password) => await bcrypt.hash(password, bcryptCost),
        verify: async ({ hash, password }) =>
          await bcrypt.compare(password, hash),
      },
    },
    user: {},
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            return {
              data: {
                ...user,
                // Legacy schema still requires password/roleId during migration period.
                password: "!",
                roleId: [],
                uiPreferences: DEFAULT_USER_PREFERENCES,
              },
            };
          },
        },
      },
    },
    account: {
      accountLinking: {
        enabled: false,
        trustedProviders: [],
        allowDifferentEmails: false,
      },
    },
    session: {
      expiresIn: REFRESH_TTL_SECONDS,
    },
    verification: {},
    trustedOrigins: [ssoConfig.betterAuth.baseURL],
  });
};

/**
 * Return a Better Auth instance cached by the D1 binding identity.
 */
export const getBetterAuth = async (
  env: Env,
): Promise<BetterAuthInstance | null> => {
  const cacheKey = env.DB as unknown;
  if (!cacheKey || typeof cacheKey !== "object") {
    return await createBetterAuth(env);
  }

  const cached = authCache.get(cacheKey);
  if (cached) {
    return await cached;
  }

  const pending = createBetterAuth(env).catch((error) => {
    authCache.delete(cacheKey);
    throw error;
  });
  authCache.set(cacheKey, pending);

  return await pending;
};
