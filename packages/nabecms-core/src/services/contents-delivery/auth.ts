import { sha256Hex } from "../../lib/auth";
import {
  ForbiddenError,
  UnauthorizedError,
  type ApiKeyRecord,
  type ContentServiceDeps,
} from "./types";

function normalizePermissions(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((value) => (typeof value === "string" ? value : String(value ?? "")))
      .filter((value) => value.length > 0);
  }
  return [];
}

/**
 * Resolve and validate an API key for the contents API.
 */
export async function authorizeApiKey(
  deps: ContentServiceDeps,
  token: string | null,
  opts?: { targetModelId?: string },
): Promise<{
  apiKey: ApiKeyRecord;
  canRead: boolean;
  canPreview: boolean;
  canManage: boolean;
  allowedModels: string[] | null;
}> {
  if (!token) throw new UnauthorizedError("Missing token");
  const tokenHash = await sha256Hex(token);
  const record = await deps.repo.findApiKeyByToken(tokenHash, token);
  if (!record) throw new UnauthorizedError("Invalid API key");
  if (record.isRevoked) throw new ForbiddenError("API key is revoked");

  const permissions = normalizePermissions((record as any).permissions ?? []);
  const allowedModels = Array.isArray(record.allowedModels)
    ? record.allowedModels
    : null;

  if (
    opts?.targetModelId &&
    allowedModels &&
    allowedModels.length > 0 &&
    !allowedModels.includes(opts.targetModelId)
  ) {
    throw new ForbiddenError("API key is not allowed for this model");
  }

  const apiKey: ApiKeyRecord = {
    id: record.id,
    permissions,
    allowedModels,
    isRevoked: record.isRevoked,
    keyHash: record.keyHash,
    lastUsedAt: record.lastUsedAt ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };

  const canRead = permissions.includes("contents:read");
  const canPreview = permissions.includes("contents:preview");
  const canManage = permissions.includes("contents:manage");

  if (deps.repo.markApiKeyUsed) {
    const nowIso = deps.now
      ? deps.now().toISOString()
      : new Date().toISOString();
    deps.repo.markApiKeyUsed(apiKey.id, nowIso).catch((error) => {
      console.error("contents: failed to update api key lastUsedAt", error);
    });
  }

  return { apiKey, canRead, canPreview, canManage, allowedModels };
}
