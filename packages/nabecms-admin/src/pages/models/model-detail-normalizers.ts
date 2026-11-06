import { fieldTypes, type FieldType } from "@nekobato/nabecms-core/contracts";
import type { ModelDependency, ModelDetail, ModelField } from "./model-detail-types";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const ensureFieldType = (value: unknown): FieldType => (fieldTypes.includes(value as FieldType) ? (value as FieldType) : "text");

const parseJsonMaybe = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

/**
 * Normalizes a model detail API response into the page view model.
 */
export const toModelDetail = (input: unknown): ModelDetail => {
  const record = isRecord(input) ? input : {};
  return {
    id: typeof record.id === "string" ? record.id : String(record.id ?? ""),
    name: typeof record.name === "string" ? record.name : String(record.name ?? ""),
    description: typeof record.description === "string" ? record.description : record.description == null ? null : String(record.description),
    isPublic: Boolean(record.isPublic),
    titleFieldId: typeof record.titleFieldId === "string" ? record.titleFieldId : typeof record.title_field_id === "string" ? record.title_field_id : null,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : String(record.createdAt ?? ""),
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : String(record.updatedAt ?? ""),
    fieldsCount: typeof record.fieldsCount === "number" && Number.isFinite(record.fieldsCount) ? record.fieldsCount : Number(record.fieldsCount ?? 0) || 0,
  };
};

/**
 * Normalizes a model field API response into the UI field shape.
 */
export const toModelField = (input: unknown): ModelField => {
  const record = isRecord(input) ? input : {};
  const rawId = record.id;
  const id = typeof rawId === "string" && rawId.trim().length > 0 ? rawId : String(rawId ?? "") || `field_${Date.now()}`;
  const name = typeof record.name === "string" ? record.name : String(record.name ?? "");
  const rawFieldKey =
    typeof record.fieldKey === "string" ? record.fieldKey : typeof record.field_key === "string" ? record.field_key : String(record.fieldKey ?? "");
  const fieldKey = rawFieldKey.trim().length > 0 ? rawFieldKey : id;
  const type = ensureFieldType(record.type);
  const positionValue = record.position;
  const position = typeof positionValue === "number" && Number.isFinite(positionValue) ? positionValue : Number(positionValue ?? 0) || 0;
  const options = parseJsonMaybe(record.options ?? null);
  const defaultValue = parseJsonMaybe(record.defaultValue ?? null);

  return {
    id,
    name,
    fieldKey,
    type,
    required: Boolean(record.required),
    hasLocales: Boolean(record.hasLocales),
    isPrivate: Boolean(record.isPrivate),
    isUnique: typeof record.isUnique === "boolean" ? Boolean(record.isUnique) : Boolean(record.is_unique ?? false),
    variant: typeof record.variant === "string" ? record.variant : null,
    options,
    defaultValue,
    position,
    isDisplayTitle: Boolean(record.isDisplayTitle),
  };
};

/**
 * Normalizes a model dependency response item.
 */
export const toModelDependency = (input: unknown): ModelDependency | null => {
  if (!isRecord(input)) return null;

  const modelId = typeof input.modelId === "string" ? input.modelId : null;
  const fieldId = typeof input.fieldId === "string" ? input.fieldId : null;
  const dependencyType = input.dependencyType === "relation" ? input.dependencyType : null;
  const relationVariant = input.relationVariant === "one" || input.relationVariant === "many" ? input.relationVariant : null;

  if (!modelId || !fieldId || !dependencyType || !relationVariant) return null;

  return {
    modelId,
    modelName: typeof input.modelName === "string" ? input.modelName : modelId,
    fieldId,
    fieldName: typeof input.fieldName === "string" ? input.fieldName : fieldId,
    dependencyType,
    relationVariant,
  };
};

/**
 * Sorts fields by their persisted position.
 */
export const sortFieldsByPosition = (list: readonly ModelField[]): ModelField[] => [...list].sort((a, b) => a.position - b.position);

/**
 * Reassigns field positions to match the current UI order.
 */
export const applyLocalFieldOrder = (list: readonly ModelField[]): ModelField[] => list.map((field, index) => ({ ...field, position: index }));

/**
 * Resolves the title field selection from a preferred id or existing field flags.
 */
export const resolveTitleFieldId = (list: readonly ModelField[], preferred?: string | null): string | null => {
  if (preferred && list.some((field) => field.id === preferred)) {
    return preferred;
  }
  const flagged = list.find((field) => field.isDisplayTitle)?.id;
  return flagged ?? null;
};

/**
 * Applies title-field flags to a field list and returns the normalized selection.
 */
export const applyTitleSelectionToFields = (list: readonly ModelField[], selectedId: string | null): { fields: ModelField[]; titleFieldId: string | null } => {
  const normalized = selectedId && list.some((field) => field.id === selectedId) ? selectedId : null;
  return {
    fields: list.map((field) => ({ ...field, isDisplayTitle: field.id === normalized })),
    titleFieldId: normalized,
  };
};
