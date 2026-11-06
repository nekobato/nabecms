import { z } from "zod";
import type {
  RoleRepository,
  RoleRecord,
  RolePermissions,
} from "../repositories/roles";

export type RolesServiceDeps = {
  repo: RoleRepository;
  generateId: (prefix: "role") => string;
  now: () => Date;
};

export type CreateRoleParams = {
  name: string;
  description?: string | null;
  permissions: RolePermissions;
};

export type UpdateRoleParams = Partial<CreateRoleParams>;

export type PublicRole = Pick<
  RoleRecord,
  | "id"
  | "name"
  | "description"
  | "permissions"
  | "isSystem"
  | "createdAt"
  | "updatedAt"
>;

export class RoleAlreadyExistsError extends Error {
  constructor(public readonly name: string) {
    super(`Role '${name}' already exists`);
  }
}

export class RoleNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Role '${id}' not found`);
  }
}

export class SystemRoleModificationError extends Error {
  constructor(public readonly id: string) {
    super(`Cannot modify system role '${id}'`);
  }
}

const permissionsSchema = z.object({
  allow: z.array(z.string()).default([]),
});

const sanitizePermissions = (input: unknown): RolePermissions => {
  const parsed = permissionsSchema.parse(input ?? { allow: [] });

  const sanitizeList = (values: string[]) =>
    Array.from(
      new Set(
        values.map((value) => value.trim()).filter((value) => value.length > 0),
      ),
    );

  return {
    allow: sanitizeList(parsed.allow),
  } satisfies RolePermissions;
};

const normalizeName = (name: string): string => {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error("Role name must not be empty");
  }
  return trimmed;
};

const normalizeDescription = (
  description: string | null | undefined,
): string | null => {
  if (description === null || description === undefined) return null;
  const trimmed = description.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toPublicRole = (record: RoleRecord): PublicRole => ({
  id: record.id,
  name: record.name,
  description: record.description ?? null,
  permissions: sanitizePermissions(record.permissions),
  isSystem: record.isSystem,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

export async function listRoles(deps: RolesServiceDeps): Promise<PublicRole[]> {
  const records = await deps.repo.list();
  if (!records.length) return [];
  return records.map(toPublicRole);
}

export async function createRole(
  deps: RolesServiceDeps,
  params: CreateRoleParams,
): Promise<PublicRole> {
  const name = normalizeName(params.name);
  const existing = await deps.repo.findByName(name);
  if (existing) {
    throw new RoleAlreadyExistsError(name);
  }

  const permissions = sanitizePermissions(params.permissions ?? { allow: [] });
  const description = normalizeDescription(params.description ?? null);
  const nowIso = deps.now().toISOString();
  const id = deps.generateId("role");

  await deps.repo.insert({
    id,
    name,
    description,
    permissions,
    isSystem: false,
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  const inserted = await deps.repo.findById(id);
  if (!inserted) {
    throw new Error("Failed to create role");
  }

  return toPublicRole(inserted);
}

export async function updateRole(
  deps: RolesServiceDeps,
  id: string,
  params: UpdateRoleParams,
): Promise<PublicRole> {
  const target = await deps.repo.findById(id);
  if (!target) {
    throw new RoleNotFoundError(id);
  }
  if (target.isSystem) {
    throw new SystemRoleModificationError(id);
  }

  const nextName =
    params.name !== undefined ? normalizeName(params.name) : target.name;
  if (nextName !== target.name) {
    const other = await deps.repo.findByName(nextName);
    if (other && other.id !== id) {
      throw new RoleAlreadyExistsError(nextName);
    }
  }

  const permissions =
    params.permissions !== undefined
      ? sanitizePermissions(params.permissions)
      : sanitizePermissions(target.permissions);
  const description =
    params.description !== undefined
      ? normalizeDescription(params.description)
      : normalizeDescription(target.description ?? null);

  const updatedAt = deps.now().toISOString();

  await deps.repo.updateById(id, {
    name: nextName,
    description,
    permissions,
    updatedAt,
  });

  const updated = await deps.repo.findById(id);
  if (!updated) {
    throw new Error("Failed to update role");
  }
  return toPublicRole(updated);
}

export async function deleteRole(
  deps: RolesServiceDeps,
  id: string,
): Promise<void> {
  const target = await deps.repo.findById(id);
  if (!target) {
    throw new RoleNotFoundError(id);
  }
  if (target.isSystem) {
    throw new SystemRoleModificationError(id);
  }

  await deps.repo.deleteById(id);
}
