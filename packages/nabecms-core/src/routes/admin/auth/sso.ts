import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import type { AppContext } from "../../../types";
import * as schema from "../../../database/schema";
import { getBetterAuth, SsoConfigError } from "../../../lib/better-auth";
import { resolveSsoConfig } from "../../../lib/sso/config";
import { createAuthFlowStatesRepository } from "../../../repositories/auth-flow-states";
import { createAuthInvitesRepository } from "../../../repositories/auth-invites";
import { createRoleRepository } from "../../../repositories/roles";
import { createUserRepository } from "../../../repositories/users";
import { sha256Hex } from "../../../lib/auth";
import { requireTurnstileForLogin } from "../../../lib/turnstile-guard";
import { generateIdWithPrefix } from "../../../utils/id";
import {
  createFlowState,
  consumeFlowState,
  FlowStateConsumedError,
  FlowStateExpiredError,
  FlowStateFlowMismatchError,
  FlowStateNotFoundError,
  FlowStateProviderMismatchError,
  isSsoFlow,
  SSO_FLOWS,
  type SsoFlow,
} from "../../../services/sso-flow-states";
import {
  resolveSsoLoginUser,
  SignupNotAllowedError,
} from "../../../services/sso-login";
import {
  acceptInviteFromSsoUser,
  SsoInviteConsumedError,
  SsoInviteEmailMismatchError,
  SsoInviteExpiredError,
  SsoInviteNotFoundError,
  SsoInviteRevokedError,
} from "../../../services/sso-invite";

const SUPPORTED_SSO_PROVIDERS = ["google"] as const;
const PUBLIC_SSO_FLOWS = SSO_FLOWS.filter((flow) => flow !== "initialize");

type SupportedSsoProvider = (typeof SUPPORTED_SSO_PROVIDERS)[number];

const startBodySchema = z.object({
  flow: z.string(),
  inviteToken: z.string().min(10).optional(),
  defaultLocale: z.string().min(2).optional(),
  redirectSuccess: z.string().min(1).optional(),
  redirectError: z.string().min(1).optional(),
  turnstileToken: z.string().max(2048).optional(),
});

const isSafeRedirectPath = (value: string): boolean =>
  value.startsWith("/") && !value.startsWith("//");

const createFlowStateDeps = (c: any) => {
  const db = drizzle(c.env.DB, { schema });
  return {
    repo: createAuthFlowStatesRepository(db),
    now: () => new Date(),
    generateId: () => generateIdWithPrefix("flow") as string,
    hashToken: sha256Hex,
  };
};

const createInviteDeps = (c: any) => {
  const db = drizzle(c.env.DB, { schema });
  return {
    invitesRepo: createAuthInvitesRepository(db),
    usersRepo: createUserRepository(db),
    rolesRepo: createRoleRepository(db),
    now: () => new Date(),
  };
};

const createLoginDeps = (c: any) => {
  const db = drizzle(c.env.DB, { schema });
  return {
    usersRepo: createUserRepository(db),
  };
};

const buildRedirectUrl = (
  reqUrl: string,
  redirectTo: string,
  params: Record<string, string | undefined>,
): string | null => {
  if (!isSafeRedirectPath(redirectTo)) {
    return null;
  }

  const target = new URL(redirectTo, reqUrl);
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && value.length > 0) {
      target.searchParams.set(key, value);
    }
  }
  return target.toString();
};

const createAuthRequestHeaders = (c: any): Headers => {
  const requestHeaders = new Headers();
  const cookie = c.req.header("Cookie");
  if (cookie) {
    requestHeaders.set("Cookie", cookie);
  }
  return requestHeaders;
};

type LoginCallbackErrorCode =
  | "SIGNUP_NOT_ALLOWED"
  | "ACCOUNT_ALREADY_LINKED_TO_ANOTHER_USER"
  | "ACCOUNT_LINK_CONFLICT";

const resolveLoginCallbackErrorCode = (
  c: any,
): LoginCallbackErrorCode | null => {
  const rawError = (
    c.req.query("error_code") ??
    c.req.query("error") ??
    c.req.query("code") ??
    ""
  )
    .trim()
    .toLowerCase();

  if (rawError.length === 0) {
    return null;
  }

  if (
    rawError.includes("signup_disabled") ||
    rawError.includes("signup_not_allowed")
  ) {
    return "SIGNUP_NOT_ALLOWED";
  }
  if (
    rawError.includes("account_link_conflict") ||
    rawError.includes("link_conflict")
  ) {
    return "ACCOUNT_LINK_CONFLICT";
  }
  if (
    rawError.includes("account_already_linked_to_another_user") ||
    rawError.includes("account_already_linked") ||
    rawError.includes("already_linked")
  ) {
    return "ACCOUNT_ALREADY_LINKED_TO_ANOTHER_USER";
  }

  return null;
};

const extractSessionUser = (
  payload: unknown,
): {
  id: string;
  email: string | null;
  name: string;
  emailVerified: boolean;
} | null => {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const rootUser =
    record.user && typeof record.user === "object"
      ? (record.user as Record<string, unknown>)
      : null;
  const sessionUser =
    record.session &&
    typeof record.session === "object" &&
    (record.session as Record<string, unknown>).user &&
    typeof (record.session as Record<string, unknown>).user === "object"
      ? ((record.session as Record<string, unknown>).user as Record<
          string,
          unknown
        >)
      : null;
  const user = rootUser ?? sessionUser;
  if (!user) {
    return null;
  }

  const id = typeof user.id === "string" ? user.id : null;
  const email = typeof user.email === "string" ? user.email : null;
  if (!id) {
    return null;
  }

  const name =
    typeof user.name === "string" && user.name.length > 0
      ? user.name
      : (email ?? id);
  const emailVerifiedRaw =
    typeof user.emailVerified === "boolean"
      ? user.emailVerified
      : typeof user.email_verified === "boolean"
        ? user.email_verified
        : false;

  return {
    id,
    email,
    name,
    emailVerified: emailVerifiedRaw,
  };
};

const callbackSuccessResponse = (
  c: any,
  params: {
    flowStateId: string;
    flow: SsoFlow;
    provider: string;
    userId: string;
    redirectSuccess: string | null;
    metadata?: Record<string, unknown>;
  },
) => {
  if (params.redirectSuccess) {
    const redirectUrl = buildRedirectUrl(c.req.url, params.redirectSuccess, {
      flow: params.flow,
      provider: params.provider,
      userId: params.userId,
    });
    if (redirectUrl) {
      return c.redirect(redirectUrl, 302);
    }
  }

  return c.json(
    {
      flowStateId: params.flowStateId,
      flow: params.flow,
      provider: params.provider,
      userId: params.userId,
      ...(params.metadata ?? {}),
    },
    200,
  );
};

const callbackErrorResponse = (
  c: any,
  params: {
    code: string;
    message: string;
    status: number;
    redirectError?: string | null;
    flow?: string;
    provider?: string;
  },
) => {
  if (params.redirectError) {
    const redirectUrl = buildRedirectUrl(c.req.url, params.redirectError, {
      code: params.code,
      flow: params.flow,
      provider: params.provider,
    });
    if (redirectUrl) {
      return c.redirect(redirectUrl, 302);
    }
  }

  return c.json(
    {
      error: {
        code: params.code,
        message: params.message,
      },
    },
    params.status,
  );
};

const parseProvider = (
  providerParam: string,
): { ok: true; provider: SupportedSsoProvider } | { ok: false } => {
  if ((SUPPORTED_SSO_PROVIDERS as readonly string[]).includes(providerParam)) {
    return { ok: true, provider: providerParam as SupportedSsoProvider };
  }
  return { ok: false };
};

const app = new Hono<AppContext>()
  .get("/api/admin/auth/providers", async (c) => {
    try {
      const ssoConfig = resolveSsoConfig(c.env);
      return c.json({
        ssoEnabled: ssoConfig.enabled,
        providers: SUPPORTED_SSO_PROVIDERS.map((providerId) => ({
          id: providerId,
          enabled:
            ssoConfig.enabled &&
            providerId === "google" &&
            ssoConfig.providers.google.enabled,
          flows: PUBLIC_SSO_FLOWS,
        })),
      });
    } catch (error) {
      if (error instanceof SsoConfigError) {
        return c.json(
          {
            error: {
              code: "SSO_CONFIGURATION_ERROR",
              message: error.message,
            },
          },
          500,
        );
      }
      console.error("Failed to resolve providers", error);
      return c.json(
        {
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to resolve providers",
          },
        },
        500,
      );
    }
  })
  .post("/api/admin/auth/sso/:provider/start", async (c) => {
    const providerParam = c.req.param("provider");
    const providerResult = parseProvider(providerParam);
    if (!providerResult.ok) {
      return c.json(
        {
          error: {
            code: "PROVIDER_NOT_SUPPORTED",
            message: `Provider '${providerParam}' is not supported`,
          },
        },
        400,
      );
    }

    const body = await c.req.json().catch(() => null);
    const parsed = startBodySchema.safeParse(body);
    if (!parsed.success) {
      const hasFlowError = parsed.error.issues.some(
        (issue) => issue.path[0] === "flow",
      );
      return c.json(
        {
          error: {
            code: hasFlowError ? "INVALID_SSO_FLOW" : "BAD_REQUEST",
            message: hasFlowError ? "Invalid SSO flow" : "Invalid payload",
          },
        },
        400,
      );
    }

    if (!isSsoFlow(parsed.data.flow)) {
      return c.json(
        {
          error: {
            code: "INVALID_SSO_FLOW",
            message: "Invalid SSO flow",
          },
        },
        400,
      );
    }

    if (parsed.data.flow === "initialize") {
      return c.json(
        {
          error: {
            code: "INITIALIZE_VIA_SSO_DISABLED",
            message: "Initialize via SSO is disabled",
          },
        },
        403,
      );
    }

    if (parsed.data.flow === "login") {
      const turnstile = await requireTurnstileForLogin(
        c,
        parsed.data.turnstileToken,
      );
      if (turnstile instanceof Response) return turnstile;
    }

    if (
      (parsed.data.redirectSuccess &&
        !isSafeRedirectPath(parsed.data.redirectSuccess)) ||
      (parsed.data.redirectError &&
        !isSafeRedirectPath(parsed.data.redirectError))
    ) {
      return c.json(
        {
          error: {
            code: "BAD_REQUEST",
            message: "Invalid redirect target",
          },
        },
        400,
      );
    }

    try {
      const ssoConfig = resolveSsoConfig(c.env);
      if (!ssoConfig.enabled) {
        return c.json(
          {
            error: {
              code: "PROVIDER_DISABLED",
              message: "SSO is disabled",
            },
          },
          403,
        );
      }

      if (
        providerResult.provider === "google" &&
        !ssoConfig.providers.google.enabled
      ) {
        return c.json(
          {
            error: {
              code: "PROVIDER_DISABLED",
              message: "Google provider is disabled",
            },
          },
          403,
        );
      }

      const flowState = await createFlowState(createFlowStateDeps(c), {
        flow: parsed.data.flow,
        provider: providerResult.provider,
        inviteToken: parsed.data.inviteToken,
        defaultLocale: parsed.data.defaultLocale,
        redirectSuccess: parsed.data.redirectSuccess,
        redirectError: parsed.data.redirectError,
      });

      const callbackURL = new URL(
        `/api/admin/auth/sso/${providerResult.provider}/callback?flowState=${encodeURIComponent(flowState.id)}`,
        ssoConfig.betterAuth?.baseURL,
      ).toString();
      const authEndpointUrl = new URL(
        "/api/auth/sign-in/social",
        ssoConfig.betterAuth?.baseURL,
      ).toString();

      const auth = await getBetterAuth(c.env);
      if (!auth) {
        return c.json(
          {
            error: {
              code: "PROVIDER_DISABLED",
              message: "SSO is disabled",
            },
          },
          403,
        );
      }

      const requestHeaders = createAuthRequestHeaders(c);
      requestHeaders.set("Content-Type", "application/json");

      const authResponse = await auth.handler(
        new Request(authEndpointUrl, {
          method: "POST",
          headers: requestHeaders,
          body: JSON.stringify({
            provider: providerResult.provider,
            callbackURL,
            errorCallbackURL: callbackURL,
            disableRedirect: true,
            requestSignUp:
              flowState.flow === "initialize" || flowState.flow === "invite",
            additionalData: {
              flowStateId: flowState.id,
              flow: flowState.flow,
            },
          }),
        }),
      );

      const setCookie = authResponse.headers.get("set-cookie");
      if (setCookie) {
        c.header("set-cookie", setCookie);
      }

      const result = await authResponse.json().catch(() => null);
      if (!authResponse.ok || typeof result?.url !== "string") {
        return c.json(
          {
            error: {
              code: "OAUTH_CALLBACK_FAILED",
              message: "Failed to start social auth",
            },
          },
          401,
        );
      }

      return c.json({
        provider: providerResult.provider,
        flow: flowState.flow,
        flowStateId: flowState.id,
        url: result.url,
      });
    } catch (error) {
      if (error instanceof SsoConfigError) {
        return c.json(
          {
            error: {
              code: "SSO_CONFIGURATION_ERROR",
              message: error.message,
            },
          },
          500,
        );
      }

      console.error("Failed to start SSO flow", error);
      return c.json(
        {
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to start SSO flow",
          },
        },
        500,
      );
    }
  })
  .get("/api/admin/auth/sso/:provider/callback", async (c) => {
    const providerParam = c.req.param("provider");
    const providerResult = parseProvider(providerParam);
    if (!providerResult.ok) {
      return c.json(
        {
          error: {
            code: "PROVIDER_NOT_SUPPORTED",
            message: `Provider '${providerParam}' is not supported`,
          },
        },
        400,
      );
    }

    const flowStateId = c.req.query("flowState");
    if (!flowStateId) {
      return c.json(
        {
          error: {
            code: "FLOW_STATE_NOT_FOUND",
            message: "Flow state is missing",
          },
        },
        400,
      );
    }

    try {
      const flowState = await consumeFlowState(createFlowStateDeps(c), {
        id: flowStateId,
        provider: providerResult.provider,
      });

      if (
        flowState.flow !== "initialize" &&
        flowState.flow !== "invite" &&
        flowState.flow !== "login"
      ) {
        return c.json(
          {
            flowStateId: flowState.id,
            flow: flowState.flow,
            provider: flowState.provider,
            message: "SSO callback flow handler is not implemented yet",
          },
          501,
        );
      }

      if (flowState.flow === "initialize") {
        return callbackErrorResponse(c, {
          code: "INITIALIZE_VIA_SSO_DISABLED",
          message: "Initialize via SSO is disabled",
          status: 403,
          redirectError: flowState.redirectError,
          flow: flowState.flow,
          provider: flowState.provider,
        });
      }

      if (flowState.flow === "login") {
        const callbackErrorCode = resolveLoginCallbackErrorCode(c);
        if (callbackErrorCode) {
          return callbackErrorResponse(c, {
            code: callbackErrorCode,
            message:
              callbackErrorCode === "SIGNUP_NOT_ALLOWED"
                ? "Signup is not allowed in login flow"
                : callbackErrorCode === "ACCOUNT_ALREADY_LINKED_TO_ANOTHER_USER"
                  ? "Social account is already linked to another user"
                  : "Account linking conflict",
            status: callbackErrorCode === "SIGNUP_NOT_ALLOWED" ? 403 : 409,
            redirectError: flowState.redirectError,
            flow: flowState.flow,
            provider: flowState.provider,
          });
        }
      }

      const auth = await getBetterAuth(c.env);
      if (!auth) {
        return callbackErrorResponse(c, {
          code: "PROVIDER_DISABLED",
          message: "SSO is disabled",
          status: 403,
          redirectError: flowState.redirectError,
          flow: flowState.flow,
          provider: flowState.provider,
        });
      }

      const getSessionUrl = new URL(
        "/api/auth/get-session",
        c.req.url,
      ).toString();
      const authSessionResponse = await auth.handler(
        new Request(getSessionUrl, {
          method: "GET",
          headers: createAuthRequestHeaders(c),
        }),
      );
      const setCookie = authSessionResponse.headers.get("set-cookie");
      if (setCookie) {
        c.header("set-cookie", setCookie);
      }
      const authSession = await authSessionResponse.json().catch(() => null);
      const socialUser = extractSessionUser(authSession);
      if (!authSessionResponse.ok || !socialUser || !socialUser.id) {
        return callbackErrorResponse(c, {
          code: "OAUTH_CALLBACK_FAILED",
          message: "Failed to complete OAuth callback",
          status: 401,
          redirectError: flowState.redirectError,
          flow: flowState.flow,
          provider: flowState.provider,
        });
      }

      if (!socialUser.email) {
        return callbackErrorResponse(c, {
          code: "SOCIAL_EMAIL_MISSING",
          message: "Email is required from social provider",
          status: 422,
          redirectError: flowState.redirectError,
          flow: flowState.flow,
          provider: flowState.provider,
        });
      }

      if (!socialUser.emailVerified) {
        return callbackErrorResponse(c, {
          code: "SOCIAL_EMAIL_NOT_VERIFIED",
          message: "Social account email is not verified",
          status: 403,
          redirectError: flowState.redirectError,
          flow: flowState.flow,
          provider: flowState.provider,
        });
      }

      try {
        if (flowState.flow === "invite") {
          const inviteResult = await acceptInviteFromSsoUser(
            createInviteDeps(c),
            {
              inviteTokenHash: flowState.inviteTokenHash,
              user: {
                id: socialUser.id,
                email: socialUser.email,
              },
            },
          );
          return callbackSuccessResponse(c, {
            flowStateId: flowState.id,
            flow: flowState.flow,
            provider: flowState.provider,
            userId: inviteResult.userId,
            redirectSuccess: flowState.redirectSuccess,
            metadata: {
              inviteId: inviteResult.inviteId,
              roleIds: inviteResult.roleIds,
            },
          });
        }

        const loginResult = await resolveSsoLoginUser(createLoginDeps(c), {
          user: {
            id: socialUser.id,
            email: socialUser.email,
          },
        });
        return callbackSuccessResponse(c, {
          flowStateId: flowState.id,
          flow: flowState.flow,
          provider: flowState.provider,
          userId: loginResult.userId,
          redirectSuccess: flowState.redirectSuccess,
          metadata: {
            roleIds: loginResult.roleIds,
          },
        });
      } catch (error) {
        if (error instanceof SignupNotAllowedError) {
          return callbackErrorResponse(c, {
            code: "SIGNUP_NOT_ALLOWED",
            message: error.message,
            status: 403,
            redirectError: flowState.redirectError,
            flow: flowState.flow,
            provider: flowState.provider,
          });
        }

        if (error instanceof SsoInviteNotFoundError) {
          return callbackErrorResponse(c, {
            code: "INVITE_NOT_FOUND",
            message: error.message,
            status: 404,
            redirectError: flowState.redirectError,
            flow: flowState.flow,
            provider: flowState.provider,
          });
        }

        if (error instanceof SsoInviteExpiredError) {
          return callbackErrorResponse(c, {
            code: "INVITE_EXPIRED",
            message: error.message,
            status: 410,
            redirectError: flowState.redirectError,
            flow: flowState.flow,
            provider: flowState.provider,
          });
        }

        if (error instanceof SsoInviteConsumedError) {
          return callbackErrorResponse(c, {
            code: "INVITE_CONSUMED",
            message: error.message,
            status: 410,
            redirectError: flowState.redirectError,
            flow: flowState.flow,
            provider: flowState.provider,
          });
        }

        if (error instanceof SsoInviteRevokedError) {
          return callbackErrorResponse(c, {
            code: "INVITE_REVOKED",
            message: error.message,
            status: 410,
            redirectError: flowState.redirectError,
            flow: flowState.flow,
            provider: flowState.provider,
          });
        }

        if (error instanceof SsoInviteEmailMismatchError) {
          return callbackErrorResponse(c, {
            code: "INVITE_EMAIL_MISMATCH",
            message: error.message,
            status: 403,
            redirectError: flowState.redirectError,
            flow: flowState.flow,
            provider: flowState.provider,
          });
        }

        console.error("Failed to consume invite from SSO callback", error);
        return callbackErrorResponse(c, {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to process invite flow",
          status: 500,
          redirectError: flowState.redirectError,
          flow: flowState.flow,
          provider: flowState.provider,
        });
      }
    } catch (error) {
      if (error instanceof SsoConfigError) {
        return c.json(
          {
            error: {
              code: "SSO_CONFIGURATION_ERROR",
              message: error.message,
            },
          },
          500,
        );
      }

      if (error instanceof FlowStateNotFoundError) {
        return c.json(
          {
            error: {
              code: "FLOW_STATE_NOT_FOUND",
              message: error.message,
            },
          },
          400,
        );
      }

      if (error instanceof FlowStateExpiredError) {
        return c.json(
          {
            error: {
              code: "FLOW_STATE_EXPIRED",
              message: error.message,
            },
          },
          410,
        );
      }

      if (error instanceof FlowStateConsumedError) {
        return c.json(
          {
            error: {
              code: "FLOW_STATE_CONSUMED",
              message: error.message,
            },
          },
          409,
        );
      }

      if (error instanceof FlowStateProviderMismatchError) {
        return c.json(
          {
            error: {
              code: "FLOW_STATE_PROVIDER_MISMATCH",
              message: error.message,
            },
          },
          400,
        );
      }

      if (error instanceof FlowStateFlowMismatchError) {
        return c.json(
          {
            error: {
              code: "FLOW_STATE_FLOW_MISMATCH",
              message: error.message,
            },
          },
          400,
        );
      }

      console.error("Failed to resolve flow state", error);
      return c.json(
        {
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to resolve flow state",
          },
        },
        500,
      );
    }
  });

export default app;
