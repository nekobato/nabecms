import { collectFilterFieldKeys, normalizeFilterNode } from "./filters";
import { resolveIncludedEntries } from "./includes";
import {
  DEFAULT_LOCALE,
  buildEntryFromFields,
  buildLocalePreference,
  buildMediaMap,
  clampLimit,
  dedupeAssets,
  filterEntriesByFields,
  groupFieldsByEntry,
  maxUpdatedAt,
  mergeMediaMaps,
  normalizePage,
  normalizeSort,
  resolveAllowedRichTextEntryIds,
  sortEntries,
} from "./mapper";
import {
  ForbiddenError,
  ContentModelNotFoundError,
  type ContentServiceDeps,
  type EntriesListResult,
  type EntryResult,
  type ModelRecord,
  type ListEntriesParams,
  type EntryStatus,
} from "./types";

function sanitizeModel(model: ModelRecord): ModelRecord {
  const fields = model.fields.filter((field) => !field.isPrivate);
  return { ...model, fields };
}

function filterByAllowedModels(
  models: ModelRecord[],
  allowedModels: string[] | null,
): ModelRecord[] {
  if (!allowedModels || allowedModels.length === 0) return models;
  const allowedSet = new Set(allowedModels);
  return models.filter((model) => allowedSet.has(model.id));
}

/**
 * List public content models visible to the current API key.
 */
export async function listContentModels(
  deps: ContentServiceDeps,
  allowedModels?: string[] | null,
): Promise<{ items: ModelRecord[] }> {
  const models = await deps.repo.listPublicModels();
  const sanitized = models
    .filter((model) => !model.isPrivate)
    .map((model) => sanitizeModel(model));
  const filtered = filterByAllowedModels(sanitized, allowedModels ?? null);
  return { items: filtered };
}

/**
 * Return a single public content model when it is visible to the caller.
 */
export async function getContentModel(
  deps: ContentServiceDeps,
  modelId: string,
  allowedModels?: string[] | null,
): Promise<ModelRecord | null> {
  const model = await deps.repo.findModelById(modelId);
  if (!model || model.isPrivate) return null;
  if (
    allowedModels &&
    allowedModels.length > 0 &&
    !allowedModels.includes(model.id)
  ) {
    return null;
  }
  return sanitizeModel(model);
}

/**
 * List content entries with locale selection, filters, and side-loaded assets.
 */
export async function listContentEntries(
  deps: ContentServiceDeps,
  params: ListEntriesParams,
  allowedModels?: string[] | null,
): Promise<EntriesListResult> {
  if (
    allowedModels &&
    allowedModels.length > 0 &&
    !allowedModels.includes(params.modelId)
  ) {
    throw new ForbiddenError("API key is not allowed for this model");
  }
  const model = await deps.repo.findModelById(params.modelId);
  if (!model || model.isPrivate) throw new ContentModelNotFoundError();
  const defaultLocale =
    deps.defaultLocale ??
    (await deps.repo.findDefaultLocale()) ??
    DEFAULT_LOCALE;
  const localePreference = buildLocalePreference(params.locales, defaultLocale);

  const includeDraft = params.includeDraft === true;
  const includeMedia = params.includeMedia !== false;
  const includeRelations = params.includeRelations !== false;
  const includeAssets = includeMedia && params.includeAssets !== false;

  const page = normalizePage(params.page);
  const limit = clampLimit(params.limit);
  const offset = (page - 1) * limit;
  const sort = normalizeSort(params.sort);

  const statuses: EntryStatus[] = includeDraft
    ? ["published", "draft"]
    : ["published"];
  const requestedFieldKeys = params.fields?.length ? params.fields : undefined;
  const fieldMap = new Map(
    model.fields
      .filter((field) => !field.isPrivate)
      .map((field) => [field.fieldKey, field] as const),
  );
  const filters = params.filters
    ? normalizeFilterNode(params.filters, fieldMap)
    : null;
  const filterFieldKeys = Array.from(collectFilterFieldKeys(filters));

  const entries = await deps.repo.listEntriesByModel(params.modelId, {
    statuses,
    since: params.since ?? null,
  });

  if (entries.length === 0) {
    return {
      items: [],
      page,
      limit,
      total: 0,
      included: { entries: [], assets: [] },
      errors: [],
      lastUpdatedAt: null,
    };
  }

  const entryIds = entries.map((entry) => entry.id);
  const fieldKeys =
    requestedFieldKeys || filterFieldKeys.length > 0
      ? Array.from(new Set([...(requestedFieldKeys ?? []), ...filterFieldKeys]))
      : undefined;

  const fieldRows = await deps.repo.listEntryFields(entryIds, {
    fieldKeys,
    locales: localePreference,
  });
  const filteredEntries = filterEntriesByFields(
    entries,
    groupFieldsByEntry(fieldRows),
    filters,
    localePreference,
    defaultLocale,
  );
  const mediaMap = await buildMediaMap(deps, fieldRows, includeAssets);
  const allowedRichTextEntryIds = await resolveAllowedRichTextEntryIds(
    deps,
    fieldRows,
    { statuses, allowedModels },
  );

  const fieldsByEntry = groupFieldsByEntry(fieldRows);
  const mapped = filteredEntries.map((entry) => {
    const group = fieldsByEntry.get(entry.id);
    const { item } = buildEntryFromFields(
      entry,
      group,
      localePreference,
      defaultLocale,
      includeRelations,
      requestedFieldKeys ? new Set(requestedFieldKeys) : undefined,
      { allowedRichTextEntryIds },
    );
    return item;
  });

  const sorted = sortEntries(mapped, sort);
  const total = sorted.length;
  const paged = sorted.slice(offset, offset + limit);
  const included = await resolveIncludedEntries(deps, paged, {
    statuses,
    localePreference,
    defaultLocale,
    includeAssets,
    includeRelations,
    allowedModels,
  });
  const assets = includeAssets
    ? dedupeAssets(
        Array.from(mergeMediaMaps(mediaMap, included.mediaMap).values()),
      )
    : [];
  const lastUpdatedAt = maxUpdatedAt([...paged, ...included.entries]);

  return {
    items: paged,
    page,
    limit,
    total,
    included: { entries: included.entries, assets },
    errors: included.errors,
    lastUpdatedAt,
  };
}

/**
 * Fetch a single content entry together with optional includes.
 */
export async function getContentEntry(
  deps: ContentServiceDeps,
  params: {
    modelId: string;
    entryId: string;
    locales?: string[];
    fields?: string[];
    includeDraft?: boolean;
    includeMedia?: boolean;
    includeRelations?: boolean;
    includeAssets?: boolean;
  },
  allowedModels?: string[] | null,
): Promise<EntryResult | null> {
  if (
    allowedModels &&
    allowedModels.length > 0 &&
    !allowedModels.includes(params.modelId)
  ) {
    throw new ForbiddenError("API key is not allowed for this model");
  }
  const model = await deps.repo.findModelById(params.modelId);
  if (!model || model.isPrivate) return null;
  const defaultLocale =
    deps.defaultLocale ??
    (await deps.repo.findDefaultLocale()) ??
    DEFAULT_LOCALE;
  const localePreference = buildLocalePreference(params.locales, defaultLocale);
  const includeDraft = params.includeDraft === true;
  const includeMedia = params.includeMedia !== false;
  const includeRelations = params.includeRelations !== false;
  const includeAssets = includeMedia && params.includeAssets !== false;
  const requestedFieldKeys = params.fields?.length ? params.fields : undefined;
  const statuses: EntryStatus[] = includeDraft
    ? ["published", "draft"]
    : ["published"];

  const entry = await deps.repo.findEntryById(params.modelId, params.entryId);
  if (!entry) return null;
  if (!includeDraft && entry.status !== "published") return null;

  const fieldRows = await deps.repo.listEntryFields([entry.id], {
    fieldKeys: requestedFieldKeys,
    locales: localePreference,
  });
  const mediaMap = await buildMediaMap(deps, fieldRows, includeAssets);
  const allowedRichTextEntryIds = await resolveAllowedRichTextEntryIds(
    deps,
    fieldRows,
    { statuses, allowedModels },
  );

  const { item } = buildEntryFromFields(
    entry,
    fieldRows,
    localePreference,
    defaultLocale,
    includeRelations,
    requestedFieldKeys ? new Set(requestedFieldKeys) : undefined,
    { allowedRichTextEntryIds },
  );
  const included = await resolveIncludedEntries(deps, [item], {
    statuses,
    localePreference,
    defaultLocale,
    includeAssets,
    includeRelations,
    allowedModels,
  });

  const assets = includeAssets
    ? dedupeAssets(
        Array.from(mergeMediaMaps(mediaMap, included.mediaMap).values()),
      )
    : [];
  const lastUpdatedAt = maxUpdatedAt([item, ...included.entries]);

  return {
    item,
    included: { entries: included.entries, assets },
    errors: included.errors,
    lastUpdatedAt,
  };
}

export * from "./auth";
export * from "./filters";
export * from "./types";
