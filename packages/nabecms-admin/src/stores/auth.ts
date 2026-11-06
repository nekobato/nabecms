import { defineStore } from "pinia";
import { setLocale } from "../plugins/i18n";
import { authorizedFetch } from "../utils/http";
import { resolveUserPreferences, type UserPreferences } from "../types/user-preferences";

type User = {
  id: string;
  email: string;
  name: string;
  roleId: string[];
  uiPreferences?: UserPreferences;
};

type SessionUser = {
  id: string;
  email: string | null;
  name: string;
  emailVerified: boolean;
};

type State = {
  accessToken: string | null;
  user: User | null;
  sessionUser: SessionUser | null;
  preferences: UserPreferences;
  allowSignup: boolean | null;
  initialized: boolean;
  bootstrapError: { code: string; message?: string } | null;
};

type SessionTokenResponse = {
  accessToken: string;
  user: User;
};

/**
 * Resolve the initial UI preferences from local storage.
 */
const loadInitialPreferences = (): UserPreferences => {
  const storedLocale = typeof window !== "undefined" ? window.localStorage.getItem("locale") : null;
  return resolveUserPreferences({
    locale: storedLocale,
  });
};

const toRecord = (value: unknown): Record<string, unknown> | null => (value && typeof value === "object" ? (value as Record<string, unknown>) : null);

const toSessionUser = (value: unknown): SessionUser | null => {
  const userRecord = toRecord(value);
  if (!userRecord) return null;

  const id = userRecord.id;
  const email = userRecord.email;
  if (typeof id !== "string" || id.length === 0) return null;

  const resolvedEmail = typeof email === "string" ? email : null;
  const name = typeof userRecord.name === "string" && userRecord.name.length > 0 ? userRecord.name : (resolvedEmail ?? id);
  const emailVerified = Boolean(
    typeof userRecord.emailVerified === "boolean"
      ? userRecord.emailVerified
      : typeof userRecord.email_verified === "boolean"
        ? userRecord.email_verified
        : false,
  );

  return {
    id,
    email: resolvedEmail,
    name,
    emailVerified,
  };
};

const extractSessionUser = (payload: unknown): SessionUser | null => {
  const root = toRecord(payload);
  if (!root) return null;

  const rootUser = toSessionUser(root.user);
  if (rootUser) return rootUser;

  const session = toRecord(root.session);
  return toSessionUser(session?.user);
};

const mapUserToSessionUser = (user: User | null): SessionUser | null => {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: true,
  };
};

export const useAuthStore = defineStore("auth", {
  state: (): State => ({
    accessToken: null,
    user: null,
    sessionUser: null,
    preferences: loadInitialPreferences(),
    allowSignup: null,
    initialized: false,
    bootstrapError: null,
  }),
  getters: {
    /** Whether the current user can be treated as authenticated in the UI. */
    isAuthenticated: (state): boolean => Boolean(state.sessionUser || state.accessToken),
  },
  actions: {
    /** Apply user preferences to UI state and persist them locally. */
    applyUserPreferences(preferences: UserPreferences) {
      this.preferences = preferences;
      setLocale(preferences.locale);
    },
    /** Sync preferences from the current user record. */
    syncPreferencesFromUser(user: User | null) {
      if (!user) return;
      const resolved = resolveUserPreferences(user.uiPreferences);
      this.applyUserPreferences(resolved);
    },
    /** Set the session state and update UI preferences. */
    setSession(accessToken: string | null, user: User | null) {
      this.accessToken = accessToken;
      this.user = user;
      this.syncPreferencesFromUser(user);
    },
    /** Set the Better Auth session user snapshot. */
    setSessionUser(user: SessionUser | null) {
      this.sessionUser = user;
    },
    /** Clear both Better Auth session state and legacy token state. */
    clearSessionState() {
      this.accessToken = null;
      this.user = null;
      this.sessionUser = null;
    },
    /** Resolve session information from Better Auth. */
    async fetchBetterAuthSession(): Promise<SessionUser | null> {
      try {
        const response = await fetch("/api/auth/get-session", {
          method: "GET",
          credentials: "include",
        });
        if (!response.ok) {
          return null;
        }
        const payload: unknown = await response.json().catch(() => null);
        return extractSessionUser(payload);
      } catch (error) {
        console.warn("Failed to resolve Better Auth session:", error);
        return null;
      }
    },
    /**
     * Exchange Better Auth session cookie for a temporary admin access token.
     * Falls back to legacy refresh when session-token endpoint is unavailable.
     */
    async fetchSessionToken(): Promise<SessionTokenResponse | null> {
      try {
        const response = await fetch("/api/admin/auth/session-token", {
          method: "POST",
          credentials: "include",
        });
        if (!response.ok) return null;

        const payload: unknown = await response.json().catch(() => null);
        const record = toRecord(payload);
        const accessToken = record?.accessToken;
        const user = record?.user;
        if (typeof accessToken !== "string" || accessToken.length === 0) {
          return null;
        }
        const userRecord = toRecord(user);
        if (!userRecord || typeof userRecord.id !== "string") {
          return null;
        }

        return {
          accessToken,
          user: {
            id: userRecord.id,
            email: typeof userRecord.email === "string" ? userRecord.email : "",
            name: typeof userRecord.name === "string" && userRecord.name.length > 0 ? userRecord.name : userRecord.id,
            roleId: Array.isArray(userRecord.roleId) ? userRecord.roleId.filter((item): item is string => typeof item === "string") : [],
            uiPreferences: resolveUserPreferences(userRecord.uiPreferences),
          },
        };
      } catch (error) {
        console.warn("Failed to exchange session token:", error);
        return null;
      }
    },
    /** Legacy refresh fallback used while access-token APIs still exist. */
    async refreshLegacySession(): Promise<SessionTokenResponse | null> {
      try {
        const res = await fetch("/api/admin/auth/refresh", {
          method: "POST",
          credentials: "include",
        });
        if (!res.ok) return null;
        const data: unknown = await res.json().catch(() => null);
        const record = toRecord(data);
        const accessToken = record?.accessToken;
        const userRecord = toRecord(record?.user);
        if (typeof accessToken !== "string" || !userRecord || typeof userRecord.id !== "string") {
          return null;
        }
        return {
          accessToken,
          user: {
            id: userRecord.id,
            email: typeof userRecord.email === "string" ? userRecord.email : "",
            name: typeof userRecord.name === "string" && userRecord.name.length > 0 ? userRecord.name : userRecord.id,
            roleId: Array.isArray(userRecord.roleId) ? userRecord.roleId.filter((item): item is string => typeof item === "string") : [],
            uiPreferences: resolveUserPreferences(userRecord.uiPreferences),
          },
        };
      } catch (error) {
        console.warn("Failed to refresh legacy auth session:", error);
        return null;
      }
    },
    /** Update the signed-in user's UI preferences. */
    async updatePreferences(patch: Partial<UserPreferences>) {
      const res = await authorizedFetch(this, "/api/admin/user-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        throw new Error(`Failed to update preferences: ${res.status}`);
      }
      const data: unknown = await res.json().catch(() => ({}));
      const next = resolveUserPreferences((data as { item?: unknown } | null)?.item);
      if (this.user) this.user = { ...this.user, uiPreferences: next };
      this.applyUserPreferences(next);
      return next;
    },
    async loadBootstrap() {
      try {
        const res = await fetch("/api/admin/system/bootstrap");
        if (!res.ok) {
          let payload: unknown = null;
          try {
            payload = await res.json();
          } catch {}
          const errorObj =
            payload && typeof payload === "object" && "error" in payload ? (payload as { error?: { code?: string; message?: string } }).error : undefined;
          const code = errorObj?.code ?? "BOOTSTRAP_FAILED";
          const message = errorObj?.message;
          this.bootstrapError = { code, message };
          throw new Error(code);
        }
        const data = await res.json();
        // Back-compat: map either allowInitialize or allowSignup
        this.allowSignup = Boolean(data.allowInitialize !== undefined ? data.allowInitialize : data.allowSignup);
        this.initialized = Boolean(data.initialized ?? false);
        this.bootstrapError = null;
      } catch (error) {
        console.log(error);
        // Preserve bootstrapError if set above, otherwise fallback
        if (!this.bootstrapError) {
          this.bootstrapError = { code: "BOOTSTRAP_FAILED" };
        }
        this.allowSignup = false;
        this.initialized = false;
      }
    },
    async refresh() {
      const sessionUser = await this.fetchBetterAuthSession();
      if (sessionUser) {
        this.setSessionUser(sessionUser);

        const sessionToken = await this.fetchSessionToken();
        if (sessionToken) {
          this.setSession(sessionToken.accessToken, sessionToken.user);
          return true;
        }

        // Keep session-authenticated state even if token bridge is unavailable.
        const fallbackUser: User = {
          id: sessionUser.id,
          email: sessionUser.email ?? "",
          name: sessionUser.name,
          roleId: this.user?.id === sessionUser.id ? this.user.roleId : [],
          uiPreferences: this.user?.id === sessionUser.id ? this.user.uiPreferences : this.preferences,
        };
        this.setSession(null, fallbackUser);
        return true;
      }

      const legacySession = await this.refreshLegacySession();
      if (legacySession) {
        this.setSession(legacySession.accessToken, legacySession.user);
        this.setSessionUser(mapUserToSessionUser(legacySession.user));
        return true;
      }

      this.clearSessionState();
      return false;
    },
    /** Sign in with local email/password credentials. */
    async login(email: string, password: string) {
      // Prefer Better Auth email/password to keep one primary session model.
      const betterAuthResponse = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email,
          password,
          rememberMe: true,
          disableRedirect: true,
        }),
      }).catch(() => null);

      if (betterAuthResponse?.ok) {
        const refreshed = await this.refresh();
        if (refreshed) return;
      }

      // Transitional fallback while legacy credential users still exist.
      const res = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        let code = "login failed";
        try {
          const data = await res.json();
          code = data?.error?.code || code;
        } catch {}
        throw new Error(code);
      }
      const data = await res.json();
      this.setSession(data.accessToken, data.user ?? null);
      this.setSessionUser(mapUserToSessionUser(data.user ?? null));
    },
    /** Request a password reset email for a local credential user. */
    async requestPasswordReset(email: string) {
      const res = await fetch("/api/admin/auth/request-password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        let code = "REQUEST_PASSWORD_RESET_FAILED";
        try {
          const data = await res.json();
          code = data?.error?.code || code;
        } catch {}
        throw new Error(code);
      }
    },
    /** Reset local credential password with a valid token from reset URL. */
    async resetPassword(token: string, newPassword: string) {
      const res = await fetch("/api/admin/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token, newPassword }),
      });
      if (!res.ok) {
        let code = "RESET_PASSWORD_FAILED";
        try {
          const data = await res.json();
          code = data?.error?.code || code;
        } catch {}
        throw new Error(code);
      }
    },
    async signup(email: string, password: string, name: string) {
      const res = await fetch("/api/admin/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password, name }),
      });
      if (!res.ok) throw new Error("signup failed");
      const data = await res.json();
      this.setSession(data.accessToken, data.user ?? null);
      this.setSessionUser(mapUserToSessionUser(data.user ?? null));
    },
    async initialize(email: string, password: string, name: string, defaultLocale: string, bootstrapSecret: string) {
      const res = await fetch("/api/admin/auth/initialize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Nabecms-Bootstrap-Secret": bootstrapSecret,
        },
        credentials: "include",
        body: JSON.stringify({ email, password, name, defaultLocale }),
      });
      if (!res.ok) {
        let code = "initialize failed";
        try {
          const data = await res.json();
          code = data?.error?.code || data?.error?.message || code;
        } catch {}
        throw new Error(code);
      }
      // On success, backend returns 201 with { userId }, no session issuance
      this.initialized = true;
      this.allowSignup = false;
      return true;
    },
    async logout() {
      await Promise.allSettled([
        fetch("/api/auth/sign-out", { method: "POST", credentials: "include" }),
        fetch("/api/admin/auth/logout", { method: "POST", credentials: "include" }),
      ]);
      this.clearSessionState();
    },
    authHeader(): Record<string, string> {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`;
      return headers;
    },
  },
});
