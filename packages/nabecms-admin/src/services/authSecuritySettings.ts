import { authorizedFetch, type AuthStore } from "@/utils/http";

export type AuthSecuritySettings = {
  turnstile: {
    enabled: boolean;
  };
};

export type AuthSecurityEnvironment = {
  siteKeyConfigured: boolean;
  secretKeyConfigured: boolean;
  canEnable: boolean;
};

export type AuthSecuritySettingsResponse = {
  item: AuthSecuritySettings;
  env: AuthSecurityEnvironment;
  editable: boolean;
};

export type TurnstilePublicConfig = {
  enabled: boolean;
  siteKey: string | null;
  configured: {
    siteKey: boolean;
    secretKey: boolean;
    canEnable: boolean;
  };
};

const defaultSettings: AuthSecuritySettings = {
  turnstile: {
    enabled: false,
  },
};

const defaultEnv: AuthSecurityEnvironment = {
  siteKeyConfigured: false,
  secretKeyConfigured: false,
  canEnable: false,
};

/**
 * Normalize auth security settings from API responses.
 * @param value - Raw settings value
 * @returns Safe settings object
 */
function normalizeSettings(value: unknown): AuthSecuritySettings {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const turnstile = record?.turnstile && typeof record.turnstile === "object" ? (record.turnstile as Record<string, unknown>) : null;
  return {
    turnstile: {
      enabled: turnstile?.enabled === true,
    },
  };
}

/**
 * Normalize Turnstile env state from API responses.
 * @param value - Raw env value
 * @returns Safe env object
 */
function normalizeEnv(value: unknown): AuthSecurityEnvironment {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  return {
    siteKeyConfigured: record?.siteKeyConfigured === true,
    secretKeyConfigured: record?.secretKeyConfigured === true,
    canEnable: record?.canEnable === true,
  };
}

/**
 * Fetch authenticated auth security settings.
 * @param authStore - Auth store
 * @returns Settings response
 */
export async function fetchAuthSecuritySettings(authStore: AuthStore): Promise<AuthSecuritySettingsResponse> {
  const res = await authorizedFetch(authStore, "/api/admin/settings/auth-security");
  if (!res.ok) {
    throw new Error(`Failed to fetch auth security settings (${res.status})`);
  }
  const payload = (await res.json()) as Record<string, unknown>;
  return {
    item: normalizeSettings(payload.item ?? defaultSettings),
    env: normalizeEnv(payload.env ?? defaultEnv),
    editable: payload.editable === true,
  };
}

/**
 * Persist auth security settings.
 * @param authStore - Auth store
 * @param settings - Proposed settings
 * @returns Stored settings response
 */
export async function updateAuthSecuritySettings(authStore: AuthStore, settings: AuthSecuritySettings): Promise<AuthSecuritySettingsResponse> {
  const res = await authorizedFetch(authStore, "/api/admin/settings/auth-security", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(normalizeSettings(settings)),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    throw new Error(payload?.error?.code ?? `Failed to update auth security settings (${res.status})`);
  }
  const payload = (await res.json()) as Record<string, unknown>;
  return {
    item: normalizeSettings(payload.item ?? settings),
    env: normalizeEnv(payload.env ?? defaultEnv),
    editable: payload.editable === true,
  };
}

/**
 * Fetch public Turnstile config for login UI.
 * @returns Public Turnstile config
 */
export async function fetchTurnstilePublicConfig(): Promise<TurnstilePublicConfig> {
  const res = await fetch("/api/admin/auth/turnstile/config", {
    method: "GET",
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch Turnstile config (${res.status})`);
  }
  const payload = (await res.json()) as Record<string, unknown>;
  const configured = payload.configured && typeof payload.configured === "object" ? (payload.configured as Record<string, unknown>) : {};
  return {
    enabled: payload.enabled === true,
    siteKey: typeof payload.siteKey === "string" && payload.siteKey.length > 0 ? payload.siteKey : null,
    configured: {
      siteKey: configured.siteKey === true,
      secretKey: configured.secretKey === true,
      canEnable: configured.canEnable === true,
    },
  };
}
