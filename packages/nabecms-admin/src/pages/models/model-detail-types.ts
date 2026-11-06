import type { FieldType } from "@nekobato/nabecms-core/contracts";

export type ModelDetail = {
  id: string;
  name: string;
  description: string | null;
  isPublic: boolean;
  titleFieldId: string | null;
  createdAt: string;
  updatedAt: string;
  fieldsCount: number;
};

export type ModelField = {
  id: string;
  name: string;
  fieldKey: string;
  type: FieldType;
  required: boolean;
  hasLocales: boolean;
  isPrivate: boolean;
  isUnique: boolean;
  variant: string | null;
  options: unknown;
  defaultValue: unknown;
  position: number;
  isDisplayTitle: boolean;
};

export type ModelDependency = {
  modelId: string;
  modelName: string;
  fieldId: string;
  fieldName: string;
  dependencyType: "relation";
  relationVariant: "one" | "many";
};
