import type { AnyD1Database } from "drizzle-orm/d1";
import type { NabeCmsConfig } from "./config";

/**
 * Cloudflare Workers Rate Limiting binding used by auth endpoint guards.
 */
export type RateLimitBinding = {
  limit: (input: { key: string }) => Promise<{ success: boolean }>;
};

export type Env = {
  AUTH_EMAIL_FROM?: string;
  AUTH_EMAIL_BASE_URL?: string;
  EMAIL_SENDER?: {
    send(message: {
      from: string | { email: string; name?: string };
      to: string;
      subject: string;
      text: string;
    }): Promise<unknown>;
  };
  DB: AnyD1Database;
  WORKER_ENV: "production" | "development" | "test";
  ADMIN_DEV_PROXY?: string; // "true" | "false" (dev only) - whether to proxy /admin to Vite
  ADMIN_DEV_PORT?: string; // dev only - Vite dev server port
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  BOOTSTRAP_SECRET?: string;
  JWT_SECRET?: string; // 独自JWT用の秘密鍵
  JWT_EXPIRES_IN?: string; // アクセストークン有効期限（デフォルト: 15m）
  BCRYPT_COST?: string;
  AUTH_LOGIN_RATE_LIMITER?: RateLimitBinding;
  AUTH_SENSITIVE_RATE_LIMITER?: RateLimitBinding;
  REFRESH_TOKEN_EXPIRES_IN?: string; // リフレッシュトークン有効期限（デフォルト: 7d）
  // Assets binding created by wrangler `assets` config
  ASSETS: {
    fetch: (input: RequestInfo, init?: RequestInit) => Promise<Response>;
  };
  // Private R2 binding. Media is delivered through authorized Worker routes.
  R2: {
    put: (key: string, value: any, options?: any) => Promise<unknown>;
    get: (key: string) => Promise<any>;
    delete: (key: string) => Promise<unknown>;
  };
};

/**
 * Request-scoped metadata added to structured API request logs.
 */
export type ApiRequestLogContext = {
  apiKeyId?: string;
  modelId?: string;
};

export interface AppContext {
  Bindings: Env;
  Variables: {
    requestId?: string;
    apiRequestLog?: ApiRequestLogContext;
    config?: NabeCmsConfig;
  };
}
