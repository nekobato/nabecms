import {
  type ContentEntry,
  type ContentLinkError,
  type ContentServiceDeps,
  type EntryRecord,
  type EntryStatus,
  type MediaAsset,
} from "./types";
import {
  buildEntryFromFields,
  buildMediaMap,
  groupFieldsByEntry,
  resolveAllowedRichTextEntryIds,
} from "./mapper";

type RelationReference = {
  sourceEntryId: string;
  sourceModelId: string;
  fieldKey: string;
  targetEntryId: string;
};

function collectRelationReferences(
  items: readonly ContentEntry[],
): RelationReference[] {
  const references: RelationReference[] = [];
  for (const item of items) {
    for (const [fieldKey, relation] of Object.entries(item.relations ?? {})) {
      for (const targetEntryId of relation.entryIds) {
        references.push({
          sourceEntryId: item.id,
          sourceModelId: item.modelId,
          fieldKey,
          targetEntryId,
        });
      }
    }
  }
  return references;
}

function dedupeRelationErrors(errors: ContentLinkError[]): ContentLinkError[] {
  const map = new Map<string, ContentLinkError>();
  for (const error of errors) {
    const key = [error.sourceEntryId, error.fieldKey, error.targetEntryId].join(
      ":",
    );
    if (!map.has(key)) {
      map.set(key, error);
    }
  }
  return Array.from(map.values());
}

/**
 * Resolve relation side-loads for a set of primary content entries.
 */
export async function resolveIncludedEntries(
  deps: ContentServiceDeps,
  items: readonly ContentEntry[],
  options: {
    statuses: EntryStatus[];
    localePreference: readonly string[];
    defaultLocale: string;
    includeAssets: boolean;
    includeRelations: boolean;
    allowedModels?: string[] | null;
  },
): Promise<{
  entries: ContentEntry[];
  errors: ContentLinkError[];
  mediaMap: Map<string, MediaAsset>;
}> {
  if (!options.includeRelations) {
    return { entries: [], errors: [], mediaMap: new Map() };
  }

  const references = collectRelationReferences(items);
  if (references.length === 0) {
    return { entries: [], errors: [], mediaMap: new Map() };
  }

  const primaryIds = new Set(items.map((item) => item.id));
  const targetIds = Array.from(
    new Set(
      references
        .map((reference) => reference.targetEntryId)
        .filter((targetEntryId) => !primaryIds.has(targetEntryId)),
    ),
  );

  if (targetIds.length === 0) {
    return { entries: [], errors: [], mediaMap: new Map() };
  }

  const relatedEntries = await deps.repo.listEntriesByIds(targetIds, {
    statuses: options.statuses,
  });
  const allowedSet =
    options.allowedModels && options.allowedModels.length > 0
      ? new Set(options.allowedModels)
      : null;
  const accessibleEntries = relatedEntries.filter((entry) =>
    allowedSet ? allowedSet.has(entry.modelId) : true,
  );
  const relatedEntryMap = new Map(
    accessibleEntries.map((entry) => [entry.id, entry] as const),
  );

  const errors = dedupeRelationErrors(
    references
      .filter(
        (reference) =>
          !primaryIds.has(reference.targetEntryId) &&
          !relatedEntryMap.has(reference.targetEntryId),
      )
      .map(
        (reference) =>
          ({
            code: "UNRESOLVABLE_LINK",
            sourceEntryId: reference.sourceEntryId,
            sourceModelId: reference.sourceModelId,
            fieldKey: reference.fieldKey,
            targetEntryId: reference.targetEntryId,
          }) satisfies ContentLinkError,
      ),
  );

  if (relatedEntryMap.size === 0) {
    return { entries: [], errors, mediaMap: new Map() };
  }

  const orderedEntries = targetIds
    .map((id) => relatedEntryMap.get(id))
    .filter((entry): entry is EntryRecord => Boolean(entry));
  const relatedFieldRows = await deps.repo.listEntryFields(
    orderedEntries.map((entry) => entry.id),
    { locales: [...options.localePreference] },
  );
  const mediaMap = await buildMediaMap(
    deps,
    relatedFieldRows,
    options.includeAssets,
  );
  const allowedRichTextEntryIds = await resolveAllowedRichTextEntryIds(
    deps,
    relatedFieldRows,
    { statuses: options.statuses, allowedModels: options.allowedModels },
  );
  const fieldsByEntry = groupFieldsByEntry(relatedFieldRows);

  const entries = orderedEntries.map((entry) => {
    const { item } = buildEntryFromFields(
      entry,
      fieldsByEntry.get(entry.id),
      options.localePreference,
      options.defaultLocale,
      options.includeRelations,
      undefined,
      { allowedRichTextEntryIds },
    );
    return item;
  });

  return { entries, errors, mediaMap };
}
