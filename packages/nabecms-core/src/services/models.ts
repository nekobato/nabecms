import type {
  ModelRepository,
  ModelRecord,
  ModelFieldDependencyCandidate,
} from "../repositories/models";
import type { RelationFieldVariant, RelationFieldOptions } from "../contracts";

export type ModelsServiceDeps = {
  repo: ModelRepository;
  generateId: (prefix: "model") => string;
  now: () => Date;
  logAuditEvent: (entry: AuditLogEntry) => Promise<void>;
};

export type CreateModelParams = {
  name: string;
  description?: string | null;
  isPublic: boolean;
};

export type PublicModel = {
  id: string;
  name: string;
  description: string | null;
  isPublic: boolean;
  titleFieldId: string | null;
  createdAt: string;
  updatedAt: string;
  fieldsCount: number;
  entriesCount: number;
};

export type ModelDependency = {
  modelId: string;
  modelName: string;
  fieldId: string;
  fieldName: string;
  dependencyType: "relation";
  relationVariant: RelationFieldVariant;
};

export type AuditLogEntry = {
  actorId: string;
  action: string;
  targetTable: string;
  targetId: string;
  before: unknown;
  after: unknown;
};

export class ModelNotFoundError extends Error {
  constructor(message = "Model not found") {
    super(message);
  }
}

export class ModelTitleFieldInvalidError extends Error {
  constructor(message = "Title field must belong to the target model") {
    super(message);
  }
}

function toPublicModel(
  record: ModelRecord,
  fieldsCount: number,
  entriesCount: number,
): PublicModel {
  return {
    id: record.id,
    name: record.name,
    description: record.description ?? null,
    isPublic: !record.isPrivate,
    titleFieldId: record.titleFieldId ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    fieldsCount,
    entriesCount,
  };
}

export async function createModel(
  deps: ModelsServiceDeps,
  params: CreateModelParams,
): Promise<PublicModel> {
  const id = deps.generateId("model");
  const nowIso = deps.now().toISOString();
  await deps.repo.insert({
    id,
    name: params.name,
    description: params.description ?? null,
    isPrivate: !params.isPublic,
    titleFieldId: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  return {
    id,
    name: params.name,
    description: params.description ?? null,
    isPublic: params.isPublic,
    titleFieldId: null,
    createdAt: nowIso,
    updatedAt: nowIso,
    fieldsCount: 0,
    entriesCount: 0,
  };
}

export async function listModels(
  deps: ModelsServiceDeps,
): Promise<PublicModel[]> {
  const records = await deps.repo.list();
  if (records.length === 0) return [];
  const ids = records.map((record) => record.id);
  const [fieldCounts, entryCounts] = await Promise.all([
    deps.repo.countFieldsByModelIds(ids),
    deps.repo.countEntriesByModelIds(ids),
  ]);
  return records.map((record) =>
    toPublicModel(
      record,
      fieldCounts.get(record.id) ?? 0,
      entryCounts.get(record.id) ?? 0,
    ),
  );
}

export async function getModelById(
  deps: ModelsServiceDeps,
  id: string,
): Promise<PublicModel | null> {
  const record = await deps.repo.findById(id);
  if (!record) return null;
  const [fieldCounts, entryCounts] = await Promise.all([
    deps.repo.countFieldsByModelIds([id]),
    deps.repo.countEntriesByModelIds([id]),
  ]);
  return toPublicModel(
    record,
    fieldCounts.get(id) ?? 0,
    entryCounts.get(id) ?? 0,
  );
}

const isRelationOptions = (
  options: unknown,
): options is RelationFieldOptions => {
  return (
    !!options &&
    typeof options === "object" &&
    Array.isArray((options as Record<string, unknown>).allowedModels)
  );
};

function extractRelationDependencies(
  candidate: ModelFieldDependencyCandidate,
  targetModelId: string,
): ModelDependency[] {
  if (
    candidate.field.type === "relation" &&
    isRelationOptions(candidate.field.options)
  ) {
    const allowed = candidate.field.options.allowedModels ?? [];
    if (allowed.includes(targetModelId) && candidate.field.variant) {
      return [
        {
          modelId: candidate.model.id,
          modelName: candidate.model.name,
          fieldId: candidate.field.id,
          fieldName: candidate.field.name,
          dependencyType: "relation",
          relationVariant: candidate.field.variant as RelationFieldVariant,
        },
      ];
    }
    return [];
  }

  return [];
}

export async function getModelDependencies(
  deps: ModelsServiceDeps,
  modelId: string,
): Promise<ModelDependency[]> {
  const fields = await deps.repo.listFieldsForDependencyCheck();
  const dependencies: ModelDependency[] = [];

  for (const candidate of fields) {
    const matches = extractRelationDependencies(candidate, modelId);
    dependencies.push(...matches);
  }

  return dependencies;
}

export class ModelDeletionBlockedError extends Error {
  constructor(public readonly dependencies: ModelDependency[]) {
    super("Model cannot be deleted because other models depend on it.");
  }
}

export type UpdateModelParams = {
  id: string;
  name: string;
  description?: string | null;
  isPublic: boolean;
  titleFieldId: string | null;
  actorId: string;
};

export async function updateModel(
  deps: ModelsServiceDeps,
  params: UpdateModelParams,
): Promise<PublicModel> {
  const existing = await deps.repo.findById(params.id);
  if (!existing) {
    throw new ModelNotFoundError();
  }

  if (params.titleFieldId) {
    const field = await deps.repo.findFieldById(params.titleFieldId);
    if (!field || field.modelId !== params.id) {
      throw new ModelTitleFieldInvalidError();
    }
  }

  const updatedAt = deps.now().toISOString();
  const updatePayload = {
    name: params.name,
    description: params.description ?? null,
    isPrivate: !params.isPublic,
    titleFieldId: params.titleFieldId,
    updatedAt,
  };

  await deps.repo.updateById(params.id, updatePayload);

  const updatedRecord = await deps.repo.findById(params.id);
  if (!updatedRecord) {
    throw new ModelNotFoundError();
  }

  await deps.logAuditEvent({
    actorId: params.actorId,
    action: "update",
    targetTable: "models",
    targetId: params.id,
    before: null,
    after: null,
  });

  const [fieldCounts, entryCounts] = await Promise.all([
    deps.repo.countFieldsByModelIds([params.id]),
    deps.repo.countEntriesByModelIds([params.id]),
  ]);

  return toPublicModel(
    updatedRecord,
    fieldCounts.get(params.id) ?? 0,
    entryCounts.get(params.id) ?? 0,
  );
}

export type DeleteModelParams = {
  id: string;
  actorId: string;
};

export async function deleteModel(
  deps: ModelsServiceDeps,
  params: DeleteModelParams,
): Promise<void> {
  const dependencies = await getModelDependencies(deps, params.id);
  if (dependencies.length > 0) {
    throw new ModelDeletionBlockedError(dependencies);
  }

  await deps.repo.deleteById(params.id);

  await deps.logAuditEvent({
    actorId: params.actorId,
    action: "delete",
    targetTable: "models",
    targetId: params.id,
    before: null,
    after: null,
  });
}
