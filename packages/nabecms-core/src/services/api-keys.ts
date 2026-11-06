import { sha256Hex } from "../lib/auth";
import type { ApiKeyRepository, ApiKeyRecord } from "../repositories/api-keys";
import { generateIdWithPrefix } from "../utils/id";

export type ApiKeyServiceDeps = {
  repo: ApiKeyRepository;
  generateId?: (prefix: "apiKey") => string;
  now?: () => Date;
};

export type ApiKeyPermissions = string[];
export const API_KEY_SCOPE_VALUES = [
  "contents:read",
  "contents:preview",
  "contents:manage",
] as const;
const API_KEY_SCOPE_SET = new Set<string>(API_KEY_SCOPE_VALUES);

export type CreateApiKeyParams = {
  actorId: string;
  name: string;
  description?: string | null;
  permissions: ApiKeyPermissions;
  allowedModels?: string[] | null;
};

export type UpdateApiKeyParams = {
  name?: string;
  description?: string | null;
  permissions?: ApiKeyPermissions;
  allowedModels?: string[] | null;
};

export type PublicApiKey = {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  allowedModels: string[] | null;
  isRevoked: boolean;
  createdBy: string | null;
  revokedBy: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export class ApiKeyNotFoundError extends Error {
  constructor(id: string) {
    super(`API key '${id}' not found`);
    this.name = "ApiKeyNotFoundError";
  }
}

export class ApiKeyConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiKeyConflictError";
  }
}

export class ApiKeyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiKeyValidationError";
  }
}

const normalizeName = (name: string): string => {
  const trimmed = (name ?? "").trim();
  if (!trimmed) throw new Error("API key name must not be empty");
  return trimmed;
};

const normalizeDescription = (
  description: string | null | undefined,
): string | null => {
  if (description === undefined || description === null) return null;
  const trimmed = description.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizePermissions = (
  permissions: ApiKeyPermissions | undefined,
): string[] => {
  const normalized = Array.from(
    new Set(
      (permissions ?? [])
        .map((p) => (typeof p === "string" ? p.trim() : ""))
        .filter((p) => p.length > 0),
    ),
  );
  if (normalized.length === 0) {
    throw new ApiKeyValidationError(
      "At least one API key permission is required",
    );
  }
  if (!normalized.every((permission) => API_KEY_SCOPE_SET.has(permission))) {
    throw new ApiKeyValidationError("Unknown API key permission");
  }
  return normalized;
};

const normalizeAllowedModels = (
  allowedModels: string[] | null | undefined,
): string[] | null => {
  if (!allowedModels || allowedModels.length === 0) return null;
  const cleaned = Array.from(
    new Set(
      allowedModels
        .map((v) => (typeof v === "string" ? v.trim() : ""))
        .filter((v) => v.length > 0),
    ),
  );
  return cleaned.length > 0 ? cleaned : null;
};

const toPublic = (record: ApiKeyRecord): PublicApiKey => ({
  id: record.id,
  name: record.name,
  description: record.description ?? null,
  permissions: Array.isArray(record.permissions)
    ? (record.permissions as string[])
        .map((permission) =>
          typeof permission === "string" ? permission.trim() : "",
        )
        .filter((permission) => API_KEY_SCOPE_SET.has(permission))
    : [],
  allowedModels: normalizeAllowedModels(
    record.allowedModels as string[] | null,
  ),
  isRevoked: Boolean(record.isRevoked),
  createdBy: record.createdBy ?? null,
  revokedBy: record.revokedBy ?? null,
  revokedAt: record.revokedAt ?? null,
  lastUsedAt: record.lastUsedAt ?? null,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

const SECRET_BYTES = 32;

function generateSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(SECRET_BYTES));
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function listApiKeys(
  deps: ApiKeyServiceDeps,
  params?: { search?: string },
): Promise<{ items: PublicApiKey[] }> {
  const records = await deps.repo.list(params);
  return { items: records.map(toPublic) };
}

export async function createApiKey(
  deps: ApiKeyServiceDeps,
  params: CreateApiKeyParams,
): Promise<{ key: PublicApiKey; secret: string }> {
  const name = normalizeName(params.name);
  const description = normalizeDescription(params.description);
  const permissions = normalizePermissions(params.permissions);
  const allowedModels = normalizeAllowedModels(params.allowedModels);
  const secret = generateSecret();
  const keyHash = await sha256Hex(secret);
  const nowIso = (deps.now ?? (() => new Date()))().toISOString();
  const id = (deps.generateId ?? generateIdWithPrefix)("apiKey");

  const existing = await deps.repo.findByKeyHash(keyHash);
  if (existing) {
    throw new ApiKeyConflictError("Generated key collides with existing hash");
  }

  await deps.repo.insert({
    id,
    key: keyHash, // legacy column (no plain storage)
    keyHash,
    name,
    description,
    permissions,
    allowedModels,
    isRevoked: false,
    createdBy: params.actorId,
    revokedBy: null,
    revokedAt: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  const inserted = await deps.repo.findById(id);
  if (!inserted) throw new Error("Failed to create API key");

  return { key: toPublic(inserted), secret };
}

export async function updateApiKey(
  deps: ApiKeyServiceDeps,
  id: string,
  params: UpdateApiKeyParams,
): Promise<PublicApiKey> {
  const target = await deps.repo.findById(id);
  if (!target) throw new ApiKeyNotFoundError(id);

  const name =
    params.name !== undefined ? normalizeName(params.name) : target.name;
  const description =
    params.description !== undefined
      ? normalizeDescription(params.description)
      : normalizeDescription(target.description ?? null);
  const permissions =
    params.permissions !== undefined
      ? normalizePermissions(params.permissions)
      : normalizePermissions(target.permissions as string[]);
  const allowedModels =
    params.allowedModels !== undefined
      ? normalizeAllowedModels(params.allowedModels)
      : normalizeAllowedModels(target.allowedModels as string[] | null);
  const updatedAt = (deps.now ?? (() => new Date()))().toISOString();

  await deps.repo.updateById(id, {
    name,
    description,
    permissions,
    allowedModels,
    updatedAt,
  });

  const updated = await deps.repo.findById(id);
  if (!updated) throw new Error("Failed to update API key");
  return toPublic(updated);
}

export async function rotateApiKey(
  deps: ApiKeyServiceDeps,
  id: string,
  _actorId?: string,
): Promise<{ key: PublicApiKey; secret: string }> {
  const target = await deps.repo.findById(id);
  if (!target) throw new ApiKeyNotFoundError(id);
  if (target.isRevoked) {
    throw new ApiKeyConflictError("Revoked API keys cannot be rotated");
  }

  const secret = generateSecret();
  const keyHash = await sha256Hex(secret);
  const updatedAt = (deps.now ?? (() => new Date()))().toISOString();

  await deps.repo.updateById(id, {
    keyHash,
    key: keyHash,
    updatedAt,
  });

  const updated = await deps.repo.findById(id);
  if (!updated) throw new Error("Failed to rotate API key");
  return { key: toPublic(updated), secret };
}

export async function revokeApiKey(
  deps: ApiKeyServiceDeps,
  id: string,
  actorId: string,
): Promise<PublicApiKey> {
  const target = await deps.repo.findById(id);
  if (!target) throw new ApiKeyNotFoundError(id);
  if (target.isRevoked) return toPublic(target);

  const updatedAt = (deps.now ?? (() => new Date()))().toISOString();
  await deps.repo.updateById(id, {
    isRevoked: true,
    revokedBy: actorId,
    revokedAt: updatedAt,
    updatedAt,
  });
  const updated = await deps.repo.findById(id);
  if (!updated) throw new Error("Failed to revoke API key");
  return toPublic(updated);
}

export async function deleteApiKey(
  deps: ApiKeyServiceDeps,
  id: string,
): Promise<void> {
  const target = await deps.repo.findById(id);
  if (!target) throw new ApiKeyNotFoundError(id);
  await deps.repo.deleteById(id);
}
