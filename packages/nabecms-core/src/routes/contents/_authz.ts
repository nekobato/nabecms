import { drizzle } from "drizzle-orm/d1";
import { bearerTokenFrom } from "../../lib/auth";
import * as schema from "../../database/schema";
import { createMediaUrlResolver } from "../../lib/media-url";
import { setApiRequestLogContext } from "../../observability/api-request-log";
import { createContentsRepository } from "../../repositories/contents";
import {
  authorizeApiKey,
  ForbiddenError,
  UnauthorizedError,
  type ContentServiceDeps,
} from "../../services/contents-delivery";

/**
 * Auth result exposed to contents routes and contents-scoped plugins.
 */
export type ContentsAccess = {
  canRead: boolean;
  canPreview: boolean;
  allowedModels: string[] | null;
  apiKeyId?: string;
};

/**
 * Result of validating a contents API request.
 */
export type ContentsAccessResult =
  | {
      deps: ContentServiceDeps;
      auth: ContentsAccess;
    }
  | { error: Response };

/**
 * Build shared contents service dependencies from the current request context.
 */
export function createContentsDeps(c: any): ContentServiceDeps {
  if (!c.env?.DB) {
    throw new Error("DB binding 'DB' is not configured");
  }
  const db = drizzle(c.env.DB, { schema });
  const repo = createContentsRepository(db);
  const createPublicMediaUrl = createMediaUrlResolver({
    fallbackPath: ({ id }) => `/api/admin/media/${id}/file`,
  });
  return { repo, createPublicMediaUrl } satisfies ContentServiceDeps;
}

/**
 * Require a valid contents API token and return the resolved access context.
 */
export async function requireContentsAccess(
  c: any,
  opts?: { requirePreview?: boolean; targetModelId?: string },
): Promise<ContentsAccessResult> {
  const token = bearerTokenFrom(c);
  if (!token) {
    return {
      error: c.json(
        { error: { code: "UNAUTHORIZED", message: "Missing bearer token" } },
        401,
      ),
    };
  }

  let deps: ContentServiceDeps;
  try {
    deps = createContentsDeps(c);
  } catch (error) {
    console.error("contents: failed to init deps", error);
    return {
      error: c.json({ error: { code: "DATABASE_BINDING_MISSING" } }, 500),
    };
  }

  try {
    const auth = await authorizeApiKey(deps, token, {
      targetModelId: opts?.targetModelId,
    });
    const apiKeyId =
      typeof (auth as any).apiKey?.id === "string"
        ? ((auth as any).apiKey.id as string)
        : undefined;
    if (apiKeyId) {
      setApiRequestLogContext(c, { apiKeyId });
    }
    const permissions = Array.isArray((auth as any).apiKey?.permissions)
      ? ((auth as any).apiKey.permissions as string[])
      : [];
    const canRead = auth.canRead ?? permissions.includes("contents:read");
    const canPreview =
      auth.canPreview ?? permissions.includes("contents:preview");
    const allowedModels = (auth as any).allowedModels ?? null;

    if (!canRead) {
      return {
        error: c.json(
          { error: { code: "FORBIDDEN", message: "contents:read required" } },
          403,
        ),
      };
    }
    if (opts?.requirePreview && !canPreview) {
      return {
        error: c.json(
          {
            error: { code: "FORBIDDEN", message: "contents:preview required" },
          },
          403,
        ),
      };
    }
    return { deps, auth: { canRead, canPreview, allowedModels, apiKeyId } };
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return {
        error: c.json(
          { error: { code: "UNAUTHORIZED", message: error.message } },
          401,
        ),
      };
    }
    if (error instanceof ForbiddenError) {
      return {
        error: c.json(
          { error: { code: "FORBIDDEN", message: error.message } },
          403,
        ),
      };
    }
    console.error("contents: authorizeApiKey failed", error);
    return {
      error: c.json(
        {
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to authorize contents API request",
          },
        },
        500,
      ),
    };
  }
}
