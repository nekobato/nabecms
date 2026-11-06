import type {
  ContentEntry,
  ContentServiceDeps,
  EntryFieldRecord,
  EntryRecord,
  EntryStatus,
  FilterNode,
  MediaAsset,
  MediaRecord,
  RelationValue,
  SortKey,
  SortSpec,
} from "./types";
import { collectEntryReferenceIds } from "../../utils/entry-reference";

export const DEFAULT_LOCALE = "en-US";
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

const allowedSortKeys = new Set<SortKey>([
  "publishedAt",
  "updatedAt",
  "createdAt",
]);

/**
 * Build a locale preference list with fallback semantics.
 */
export function buildLocalePreference(
  locales: string[] | undefined,
  fallback: string,
): string[] {
  const result: string[] = [];
  const append = (value: string | undefined) => {
    if (!value) return;
    const normalized = value.trim();
    if (!normalized) return;
    if (!result.includes(normalized)) result.push(normalized);
  };
  (locales ?? []).forEach(append);
  append(fallback || DEFAULT_LOCALE);
  return result.length > 0 ? result : [DEFAULT_LOCALE];
}

function pickFieldRecord(
  records: EntryFieldRecord[],
  localePreference: readonly string[],
  defaultLocale: string,
): { record: EntryFieldRecord; locale: string } | null {
  if (records.length === 0) return null;
  const byLocale = new Map<string, EntryFieldRecord[]>();
  for (const record of records) {
    const key = record.locale || defaultLocale;
    const list = byLocale.get(key) ?? [];
    list.push(record);
    byLocale.set(key, list);
  }

  for (const candidate of localePreference) {
    const hit = byLocale.get(candidate);
    if (hit && hit.length > 0) return { record: hit[0], locale: candidate };
  }

  const fallback = byLocale.get(defaultLocale);
  if (fallback && fallback.length > 0) {
    return { record: fallback[0], locale: defaultLocale };
  }

  const firstLocale = byLocale.keys().next().value as string | undefined;
  if (!firstLocale) return null;
  return { record: byLocale.get(firstLocale)![0], locale: firstLocale };
}

function extractEntryLocale(
  picked: Array<{ record: EntryFieldRecord; locale: string }> | null,
  preferred: readonly string[],
): string {
  if (picked) {
    for (const pref of preferred) {
      if (picked.some((item) => item.locale === pref)) return pref;
    }
  }
  return preferred[0] ?? DEFAULT_LOCALE;
}

export function groupFieldsByEntry(
  fields: EntryFieldRecord[],
): Map<string, EntryFieldRecord[]> {
  const map = new Map<string, EntryFieldRecord[]>();
  for (const field of fields) {
    if (field.isPrivate) continue;
    const list = map.get(field.entryId) ?? [];
    list.push(field);
    map.set(field.entryId, list);
  }
  return map;
}

function groupFieldsByKey(
  fields: EntryFieldRecord[] | undefined,
): Map<string, EntryFieldRecord[]> {
  const map = new Map<string, EntryFieldRecord[]>();
  for (const field of fields ?? []) {
    if (field.isPrivate) continue;
    const list = map.get(field.fieldKey) ?? [];
    list.push(field);
    map.set(field.fieldKey, list);
  }
  return map;
}

function mapFieldValue(record: EntryFieldRecord): unknown {
  switch (record.type) {
    case "text":
      return record.valueString ?? "";
    case "number":
      return record.valueNumber ?? null;
    case "date":
      return record.valueDate ?? null;
    case "boolean":
      return Boolean(record.valueBoolean);
    case "media":
      return record.valueMedia ?? null;
    case "relation":
      return record.valueRelation ?? null;
    case "list":
      return Array.isArray(record.valueJson) ? record.valueJson : [];
    case "json":
    case "custom":
    default:
      return record.valueJson ?? null;
  }
}

const DROPPED_RICH_TEXT_NODE = Symbol("dropped-rich-text-node");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isRichTextValueEnvelope = (
  value: unknown,
): value is Record<string, unknown> & { value: unknown } =>
  isRecord(value) && value.type === "rich_text" && "value" in value;

function parseJsonValue(value: string): { ok: true; value: unknown } | null {
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch {
    return null;
  }
}

function getRichTextDocument(value: unknown): unknown {
  const root =
    typeof value === "string" ? (parseJsonValue(value)?.value ?? value) : value;
  return isRichTextValueEnvelope(root) ? root.value : root;
}

function getEntryReferenceId(value: unknown): string | null {
  if (!isRecord(value) || value.type !== "entryReference") return null;
  const attrs = value.attrs;
  if (!isRecord(attrs)) return null;
  const entryId = attrs.entryId;
  return typeof entryId === "string" && entryId.trim().length > 0
    ? entryId
    : null;
}

function sanitizeRichTextArray(
  value: unknown[],
  allowedEntryIds: ReadonlySet<string>,
): unknown[] {
  const result: unknown[] = [];
  for (const child of value) {
    const sanitized = sanitizeRichTextNode(child, allowedEntryIds);
    if (sanitized !== DROPPED_RICH_TEXT_NODE) {
      result.push(sanitized);
    }
  }
  return result;
}

function sanitizeRichTextNode(
  value: unknown,
  allowedEntryIds: ReadonlySet<string>,
): unknown | typeof DROPPED_RICH_TEXT_NODE {
  if (Array.isArray(value)) {
    return sanitizeRichTextArray(value, allowedEntryIds);
  }

  if (!isRecord(value)) {
    return value;
  }

  const entryReferenceId = getEntryReferenceId(value);
  if (entryReferenceId && !allowedEntryIds.has(entryReferenceId)) {
    return DROPPED_RICH_TEXT_NODE;
  }

  const sanitized: Record<string, unknown> = { ...value };
  if (Array.isArray(value.content)) {
    sanitized.content = sanitizeRichTextArray(value.content, allowedEntryIds);
  }
  if (Array.isArray(value.marks)) {
    sanitized.marks = sanitizeRichTextArray(value.marks, allowedEntryIds);
  }
  return sanitized;
}

function sanitizeRichTextEntryReferences(
  value: unknown,
  allowedEntryIds: ReadonlySet<string>,
): unknown {
  if (typeof value === "string") {
    const parsed = parseJsonValue(value);
    if (!parsed) return value;
    return JSON.stringify(
      sanitizeRichTextEntryReferences(parsed.value, allowedEntryIds),
    );
  }

  if (isRichTextValueEnvelope(value)) {
    const sanitizedValue = sanitizeRichTextNode(value.value, allowedEntryIds);
    return {
      ...value,
      value: sanitizedValue === DROPPED_RICH_TEXT_NODE ? null : sanitizedValue,
    };
  }

  const sanitized = sanitizeRichTextNode(value, allowedEntryIds);
  return sanitized === DROPPED_RICH_TEXT_NODE ? null : sanitized;
}

function mapRichTextFieldValue(
  record: EntryFieldRecord,
  allowedEntryIds?: ReadonlySet<string>,
): unknown {
  const value = record.valueJson ?? null;
  return allowedEntryIds
    ? sanitizeRichTextEntryReferences(value, allowedEntryIds)
    : value;
}

/**
 * Collect entry ids embedded by rich text fields.
 */
export function collectRichTextEntryReferenceIds(
  records: EntryFieldRecord[] | undefined,
): string[] {
  const ids = new Set<string>();
  for (const record of records ?? []) {
    if (record.isPrivate || record.type !== "rich_text") continue;
    const value = getRichTextDocument(record.valueJson ?? null);
    for (const id of collectEntryReferenceIds(value)) {
      ids.add(id);
    }
  }
  return Array.from(ids);
}

/**
 * Resolve rich text entry references that are visible in the current Content API mode.
 */
export async function resolveAllowedRichTextEntryIds(
  deps: ContentServiceDeps,
  records: EntryFieldRecord[] | undefined,
  options: {
    statuses: EntryStatus[];
    allowedModels?: string[] | null;
  },
): Promise<ReadonlySet<string>> {
  const referenceIds = collectRichTextEntryReferenceIds(records);
  if (referenceIds.length === 0) return new Set<string>();

  const entries = await deps.repo.listEntriesByIds(referenceIds, {
    statuses: options.statuses,
  });
  const allowedModelSet =
    options.allowedModels && options.allowedModels.length > 0
      ? new Set(options.allowedModels)
      : null;

  return new Set(
    entries
      .filter((entry) =>
        allowedModelSet ? allowedModelSet.has(entry.modelId) : true,
      )
      .map((entry) => entry.id),
  );
}

function normalizeRelation(value: unknown): RelationValue {
  if (value && typeof value === "object") {
    const candidate = value as any;
    const entryIds = Array.isArray(candidate.entryIds)
      ? candidate.entryIds.filter((id: any) => typeof id === "string")
      : [];
    const type: "one" | "many" = candidate.type === "one" ? "one" : "many";
    if (entryIds.length > 0) {
      return { type, entryIds };
    }
  }
  return { type: "many", entryIds: [] };
}

function resolveMediaUrl(
  record: MediaRecord,
  createPublicMediaUrl?: (input: { key: string; id: string }) => string,
): string | null {
  if (createPublicMediaUrl) {
    return createPublicMediaUrl({ key: record.url, id: record.id });
  }
  return record.url ?? null;
}

function toMediaAsset(
  record: MediaRecord,
  createPublicMediaUrl?: (input: { key: string; id: string }) => string,
): MediaAsset {
  return {
    id: record.id,
    url: resolveMediaUrl(record, createPublicMediaUrl),
    mimeType: record.mimeType ?? null,
    type: record.type ?? null,
    width: record.width ?? null,
    height: record.height ?? null,
    size: record.size ?? null,
    description: record.description ?? null,
  };
}

export function normalizeSort(sort?: string[]): SortSpec[] {
  const input = sort && sort.length > 0 ? sort : ["-publishedAt"];
  const specs: SortSpec[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const direction: "asc" | "desc" = trimmed.startsWith("-") ? "desc" : "asc";
    const keyText = trimmed.replace(/^[-+]/, "") as SortKey;
    if (!allowedSortKeys.has(keyText)) continue;
    specs.push({ key: keyText, direction });
  }
  if (specs.length === 0) {
    specs.push({ key: "publishedAt", direction: "desc" });
  }
  return specs;
}

export function sortEntries(
  items: ContentEntry[],
  specs: SortSpec[],
): ContentEntry[] {
  const comparator = (a: ContentEntry, b: ContentEntry) => {
    for (const spec of specs) {
      const left = (a as any)[spec.key] as string | null;
      const right = (b as any)[spec.key] as string | null;
      if (left === right) continue;
      const lv = left ?? "";
      const rv = right ?? "";
      if (lv === rv) continue;
      if (lv < rv) return spec.direction === "asc" ? -1 : 1;
      if (lv > rv) return spec.direction === "asc" ? 1 : -1;
    }
    return 0;
  };
  return [...items].sort(comparator);
}

export function clampLimit(limit?: number): number {
  const value = Number.isFinite(limit ?? NaN) ? Number(limit) : DEFAULT_LIMIT;
  if (Number.isNaN(value) || value <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(value)));
}

export function normalizePage(page?: number): number {
  const value = Number.isFinite(page ?? NaN) ? Number(page) : 1;
  if (Number.isNaN(value) || value <= 0) return 1;
  return Math.max(1, Math.floor(value));
}

function normalizeMediaIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return [value];
  }
  return [];
}

function getMediaFieldIds(record: EntryFieldRecord): string[] {
  if (record.type !== "media") return [];
  if (record.variant === "multiple") {
    const jsonIds = normalizeMediaIds(record.valueJson);
    if (jsonIds.length > 0) return jsonIds;
    return normalizeMediaIds(record.valueMedia);
  }

  if (typeof record.valueMedia === "string" && record.valueMedia.length > 0) {
    return [record.valueMedia];
  }

  const jsonIds = normalizeMediaIds(record.valueJson);
  return jsonIds.length > 0 ? [jsonIds[0]!] : [];
}

function getMediaFieldValue(
  record: EntryFieldRecord,
): string | string[] | null {
  const ids = getMediaFieldIds(record);
  if (record.variant === "multiple") {
    return ids;
  }
  return ids[0] ?? null;
}

function getFilterComparableValue(
  record: EntryFieldRecord | null | undefined,
): string | number | boolean | null {
  if (!record) return null;
  switch (record.type) {
    case "text":
      return record.valueString ?? null;
    case "number":
      return record.valueNumber ?? null;
    case "date":
      return record.valueDate ?? null;
    case "boolean":
      return record.valueBoolean ?? null;
    default:
      return null;
  }
}

function matchesFieldFilter(
  node: Extract<FilterNode, { kind: "field" }>,
  fieldsByKey: ReadonlyMap<string, EntryFieldRecord[]>,
  localePreference: readonly string[],
  defaultLocale: string,
): boolean {
  const picked = pickFieldRecord(
    fieldsByKey.get(node.fieldKey) ?? [],
    localePreference,
    defaultLocale,
  );
  const value = getFilterComparableValue(picked?.record);

  switch (node.operator) {
    case "$null":
      return value === null;
    case "$notNull":
      return value !== null;
    case "$eq":
      return value === node.value;
    case "$ne":
      return value !== node.value;
    case "$in":
      return value !== null && Array.isArray(node.value)
        ? node.value.includes(value)
        : false;
    case "$notIn":
      return value === null || !Array.isArray(node.value)
        ? false
        : !node.value.includes(value);
    case "$lt":
      return (
        value !== null && value < (node.value as string | number | boolean)
      );
    case "$lte":
      return (
        value !== null && value <= (node.value as string | number | boolean)
      );
    case "$gt":
      return (
        value !== null && value > (node.value as string | number | boolean)
      );
    case "$gte":
      return (
        value !== null && value >= (node.value as string | number | boolean)
      );
    case "$contains":
      return typeof value === "string" && typeof node.value === "string"
        ? value.includes(node.value)
        : false;
    case "$startsWith":
      return typeof value === "string" && typeof node.value === "string"
        ? value.startsWith(node.value)
        : false;
    case "$endsWith":
      return typeof value === "string" && typeof node.value === "string"
        ? value.endsWith(node.value)
        : false;
  }
}

function matchesFilterNode(
  node: FilterNode,
  fieldsByKey: ReadonlyMap<string, EntryFieldRecord[]>,
  localePreference: readonly string[],
  defaultLocale: string,
): boolean {
  switch (node.kind) {
    case "field":
      return matchesFieldFilter(
        node,
        fieldsByKey,
        localePreference,
        defaultLocale,
      );
    case "and":
      return node.nodes.every((child) =>
        matchesFilterNode(child, fieldsByKey, localePreference, defaultLocale),
      );
    case "or":
      return node.nodes.some((child) =>
        matchesFilterNode(child, fieldsByKey, localePreference, defaultLocale),
      );
    case "not":
      return !matchesFilterNode(
        node.node,
        fieldsByKey,
        localePreference,
        defaultLocale,
      );
  }
}

export function filterEntriesByFields(
  entries: EntryRecord[],
  fieldsByEntry: ReadonlyMap<string, EntryFieldRecord[]>,
  filters: FilterNode | null,
  localePreference: readonly string[],
  defaultLocale: string,
): EntryRecord[] {
  if (!filters) return entries;
  return entries.filter((entry) =>
    matchesFilterNode(
      filters,
      groupFieldsByKey(fieldsByEntry.get(entry.id)),
      localePreference,
      defaultLocale,
    ),
  );
}

function collectMediaIds(
  records: EntryFieldRecord[],
  includeMedia: boolean,
): string[] {
  if (!includeMedia) return [];
  const ids = new Set<string>();
  for (const record of records) {
    if (record.isPrivate || record.type !== "media") continue;
    for (const mediaId of getMediaFieldIds(record)) {
      ids.add(mediaId);
    }
  }
  return Array.from(ids);
}

export async function buildMediaMap(
  deps: ContentServiceDeps,
  records: EntryFieldRecord[],
  includeMedia: boolean,
): Promise<Map<string, MediaAsset>> {
  const mediaIds = collectMediaIds(records, includeMedia);
  const mediaList =
    includeMedia && mediaIds.length > 0
      ? await deps.repo.listMediaByIds(mediaIds)
      : [];
  const mediaMap = new Map<string, MediaAsset>();
  for (const media of mediaList) {
    mediaMap.set(media.id, toMediaAsset(media, deps.createPublicMediaUrl));
  }
  return mediaMap;
}

export function mergeMediaMaps(
  ...maps: Array<ReadonlyMap<string, MediaAsset>>
): Map<string, MediaAsset> {
  const merged = new Map<string, MediaAsset>();
  for (const map of maps) {
    for (const [id, asset] of map.entries()) {
      if (!merged.has(id)) {
        merged.set(id, asset);
      }
    }
  }
  return merged;
}

/**
 * Materialize a content entry from entry field rows.
 */
export function buildEntryFromFields(
  entry: EntryRecord,
  fields: EntryFieldRecord[] | undefined,
  localePreference: readonly string[],
  defaultLocale: string,
  includeRelations: boolean,
  responseFieldKeys?: ReadonlySet<string>,
  options?: { allowedRichTextEntryIds?: ReadonlySet<string> },
): { item: ContentEntry; selectedLocales: string[] } {
  const fieldsByKey = groupFieldsByKey(fields);

  const selected: Array<{ record: EntryFieldRecord; locale: string }> = [];
  const fieldValues: Record<string, unknown> = {};
  const relations: Record<string, RelationValue> = {};

  for (const [fieldKey, records] of fieldsByKey.entries()) {
    if (responseFieldKeys && !responseFieldKeys.has(fieldKey)) {
      continue;
    }
    const picked = pickFieldRecord(records, localePreference, defaultLocale);
    if (!picked) continue;
    selected.push(picked);
    const record = picked.record;

    if (record.type === "relation") {
      if (includeRelations) {
        relations[fieldKey] = normalizeRelation(record.valueRelation);
      }
      continue;
    }

    if (record.type === "media") {
      fieldValues[fieldKey] = getMediaFieldValue(record);
      continue;
    }

    if (record.type === "rich_text") {
      fieldValues[fieldKey] = mapRichTextFieldValue(
        record,
        options?.allowedRichTextEntryIds,
      );
      continue;
    }

    fieldValues[fieldKey] = mapFieldValue(record);
  }

  const locale = extractEntryLocale(selected, localePreference);
  const relationsOut =
    Object.keys(relations).length > 0 ? relations : undefined;

  return {
    item: {
      id: entry.id,
      modelId: entry.modelId,
      status: entry.status,
      locale,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      publishedAt: entry.publishedAt,
      fields: fieldValues,
      relations: relationsOut,
    },
    selectedLocales: selected.map((value) => value.locale),
  };
}

export function dedupeAssets(list: MediaAsset[]): MediaAsset[] {
  const map = new Map<string, MediaAsset>();
  for (const asset of list) {
    if (!asset.id) continue;
    if (map.has(asset.id)) continue;
    map.set(asset.id, asset);
  }
  return Array.from(map.values());
}

export function maxUpdatedAt(entries: Iterable<ContentEntry>): string | null {
  let max: string | null = null;
  for (const entry of entries) {
    if (!entry.updatedAt) continue;
    if (!max || entry.updatedAt > max) max = entry.updatedAt;
  }
  return max;
}
