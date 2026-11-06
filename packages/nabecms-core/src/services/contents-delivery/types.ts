export type FieldType =
  | "text"
  | "rich_text"
  | "number"
  | "date"
  | "list"
  | "media"
  | "json"
  | "relation"
  | "boolean"
  | "custom";

export type EntryStatus = "draft" | "published" | "archived";

export type SortKey = "publishedAt" | "updatedAt" | "createdAt";

export type SortSpec = {
  key: SortKey;
  direction: "asc" | "desc";
};

export type FilterableFieldType = Extract<
  FieldType,
  "text" | "number" | "date" | "boolean"
>;

export type FieldFilterOperator =
  | "$eq"
  | "$ne"
  | "$lt"
  | "$lte"
  | "$gt"
  | "$gte"
  | "$in"
  | "$notIn"
  | "$null"
  | "$notNull"
  | "$contains"
  | "$startsWith"
  | "$endsWith";

export type FilterNode =
  | {
      kind: "field";
      fieldKey: string;
      fieldType: FilterableFieldType;
      operator: FieldFilterOperator;
      value?: string | number | boolean | Array<string | number | boolean>;
    }
  | {
      kind: "and" | "or";
      nodes: FilterNode[];
    }
  | {
      kind: "not";
      node: FilterNode;
    };

export type FilterIssue = {
  path: Array<string | number>;
  message: string;
};

export type ApiKeyRecord = {
  id: string;
  permissions: string[];
  allowedModels: string[] | null;
  isRevoked: boolean;
  keyHash?: string | null;
  lastUsedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ModelFieldRecord = {
  id: string;
  modelId: string;
  name: string;
  fieldKey: string;
  type: FieldType;
  hasLocales: boolean;
  isPrivate: boolean;
  variant?: string | null;
  options?: unknown;
};

export type ModelRecord = {
  id: string;
  name: string;
  description: string | null;
  isPrivate: boolean;
  createdAt: string;
  updatedAt: string;
  fields: ModelFieldRecord[];
};

export type EntryRecord = {
  id: string;
  modelId: string;
  status: EntryStatus;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
};

export type EntryFieldRecord = {
  entryId: string;
  fieldId: string;
  fieldKey: string;
  type: FieldType;
  variant?: string | null;
  hasLocales: boolean;
  isPrivate: boolean;
  locale: string;
  valueString: string | null;
  valueNumber: number | null;
  valueDate: string | null;
  valueBoolean: boolean | null;
  valueJson: unknown;
  valueMedia: string | null;
  valueRelation: unknown;
};

export type MediaRecord = {
  id: string;
  url: string;
  mimeType: string;
  type: string;
  width: number | null;
  height: number | null;
  size: number;
  description: string | null;
};

export type RelationValue = {
  type: "one" | "many";
  entryIds: string[];
};

export type MediaAsset = {
  id: string;
  url: string | null;
  mimeType: string | null;
  type: string | null;
  width: number | null;
  height: number | null;
  size: number | null;
  description: string | null;
};

export type ContentEntry = {
  id: string;
  modelId: string;
  status: EntryStatus;
  locale: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  fields: Record<string, unknown>;
  relations?: Record<string, RelationValue>;
};

export type ContentLinkError = {
  code: "UNRESOLVABLE_LINK";
  sourceEntryId: string;
  sourceModelId: string;
  fieldKey: string;
  targetEntryId: string;
};

export type EntriesListResult = {
  items: ContentEntry[];
  page: number;
  limit: number;
  total: number;
  included: { entries: ContentEntry[]; assets: MediaAsset[] };
  errors: ContentLinkError[];
  lastUpdatedAt: string | null;
};

export type EntryResult = {
  item: ContentEntry;
  included: { entries: ContentEntry[]; assets: MediaAsset[] };
  errors: ContentLinkError[];
  lastUpdatedAt: string | null;
};

export interface ContentsRepository {
  findApiKeyByToken(
    tokenHash: string,
    tokenPlain: string,
  ): Promise<ApiKeyRecord | null>;
  markApiKeyUsed?(id: string, at: string): Promise<void>;
  findDefaultLocale(): Promise<string | null>;
  listPublicModels(): Promise<ModelRecord[]>;
  findModelById(id: string): Promise<ModelRecord | null>;
  listEntriesByModel(
    modelId: string,
    options: { statuses: EntryStatus[]; since?: string | null },
  ): Promise<EntryRecord[]>;
  listEntriesByIds(
    ids: string[],
    options: { statuses: EntryStatus[] },
  ): Promise<EntryRecord[]>;
  findEntryById(modelId: string, entryId: string): Promise<EntryRecord | null>;
  listEntryFields(
    entryIds: string[],
    options: { fieldKeys?: string[]; locales?: string[] },
  ): Promise<EntryFieldRecord[]>;
  listMediaByIds(ids: string[]): Promise<MediaRecord[]>;
}

export type ContentServiceDeps = {
  repo: ContentsRepository;
  now?: () => Date;
  defaultLocale?: string;
  createPublicMediaUrl?: (input: { key: string; id: string }) => string;
};

export type ListEntriesParams = {
  modelId: string;
  locales?: string[];
  fields?: string[];
  includeDraft?: boolean;
  includeMedia?: boolean;
  includeRelations?: boolean;
  includeAssets?: boolean;
  page?: number;
  limit?: number;
  sort?: string[];
  since?: string | null;
  filters?: unknown;
};

export class UnauthorizedError extends Error {
  constructor(message = "UNAUTHORIZED") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "FORBIDDEN") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class ContentModelNotFoundError extends Error {
  constructor() {
    super("Model not found");
    this.name = "ContentModelNotFoundError";
  }
}

export class InvalidFilterError extends Error {
  readonly issues: FilterIssue[];

  constructor(issues: FilterIssue[], message = "Invalid filters") {
    super(message);
    this.name = "InvalidFilterError";
    this.issues = issues;
  }
}
