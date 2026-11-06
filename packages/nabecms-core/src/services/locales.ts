import type { LocaleRepository, LocaleRecord } from "../repositories/locales";

export type LocalesServiceDeps = {
  repo: LocaleRepository;
  now: () => Date;
};

export type CreateLocaleParams = {
  code: string;
  isDefault?: boolean;
};

export type PublicLocale = Pick<
  LocaleRecord,
  "code" | "isDefault" | "createdAt" | "updatedAt"
>;

export class LocaleAlreadyExistsError extends Error {
  constructor(public readonly code: string) {
    super(`Locale with code ${code} already exists`);
  }
}

export class LocaleNotFoundError extends Error {
  constructor(public readonly code: string) {
    super(`Locale with code ${code} not found`);
  }
}

export class CannotDeleteDefaultLocaleError extends Error {
  constructor(public readonly code: string) {
    super(`Cannot delete default locale: ${code}`);
  }
}

function normalizeCode(code: string): string {
  const trimmed = code.trim();
  if (trimmed.length === 0) {
    throw new Error("Locale code must not be empty");
  }
  return trimmed;
}

function toPublicLocale(record: LocaleRecord): PublicLocale {
  return {
    code: record.code,
    isDefault: record.isDefault,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export async function listLocales(
  deps: LocalesServiceDeps,
): Promise<PublicLocale[]> {
  const items = await deps.repo.list();
  return items.map(toPublicLocale);
}

export async function createLocale(
  deps: LocalesServiceDeps,
  params: CreateLocaleParams,
): Promise<PublicLocale> {
  const code = normalizeCode(params.code);
  const existing = await deps.repo.findByCode(code);
  if (existing) {
    throw new LocaleAlreadyExistsError(code);
  }

  const nowIso = deps.now().toISOString();
  const currentDefault = await deps.repo.getDefault();
  const shouldBeDefault = params.isDefault === true || !currentDefault;

  if (shouldBeDefault) {
    await deps.repo.clearDefault(nowIso);
  }

  await deps.repo.insert({
    code,
    isDefault: shouldBeDefault,
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  const inserted = await deps.repo.findByCode(code);
  if (!inserted) {
    throw new Error("Failed to create locale");
  }

  return toPublicLocale(inserted);
}

export async function setDefaultLocale(
  deps: LocalesServiceDeps,
  code: string,
): Promise<PublicLocale> {
  const normalized = normalizeCode(code);
  const target = await deps.repo.findByCode(normalized);
  if (!target) {
    throw new LocaleNotFoundError(normalized);
  }
  if (target.isDefault) {
    return toPublicLocale(target);
  }

  const nowIso = deps.now().toISOString();
  await deps.repo.clearDefault(nowIso);
  await deps.repo.updateByCode(normalized, {
    isDefault: true,
    updatedAt: nowIso,
  });

  const updated = await deps.repo.findByCode(normalized);
  if (!updated) {
    throw new Error("Failed to update locale");
  }
  return toPublicLocale(updated);
}

export async function deleteLocale(
  deps: LocalesServiceDeps,
  code: string,
): Promise<void> {
  const normalized = normalizeCode(code);
  const target = await deps.repo.findByCode(normalized);
  if (!target) {
    throw new LocaleNotFoundError(normalized);
  }
  if (target.isDefault) {
    throw new CannotDeleteDefaultLocaleError(normalized);
  }

  await deps.repo.deleteByCode(normalized);
}
