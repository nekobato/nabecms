type RichTextNode = {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: unknown[];
  marks?: unknown[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const tryParseJson = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

type RemovedEntryReferences = {
  value: unknown;
  removed: boolean;
};

const visitNode = (node: unknown, collector: Set<string>) => {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const child of node) {
      visitNode(child, collector);
    }
    return;
  }

  if (!isRecord(node)) return;

  const richNode = node as RichTextNode;

  if (richNode.type === "entryReference" && isRecord(richNode.attrs)) {
    const entryId = richNode.attrs.entryId;
    if (typeof entryId === "string" && entryId.trim().length > 0) {
      collector.add(entryId);
    }
  }

  if (Array.isArray(richNode.content)) {
    visitNode(richNode.content, collector);
  }
  if (Array.isArray(richNode.marks)) {
    visitNode(richNode.marks, collector);
  }
};

export const collectEntryReferenceIds = (value: unknown): string[] => {
  let root: unknown = value;
  if (typeof value === "string") {
    root = tryParseJson(value);
  }

  const ids = new Set<string>();
  visitNode(root, ids);
  return Array.from(ids);
};

const removeReferenceNode = (
  node: unknown,
  targetEntryId: string,
): RemovedEntryReferences | null => {
  if (Array.isArray(node)) {
    let removed = false;
    const value: unknown[] = [];
    for (const child of node) {
      const result = removeReferenceNode(child, targetEntryId);
      if (!result) {
        removed = true;
        continue;
      }
      removed = removed || result.removed;
      value.push(result.value);
    }
    return { value, removed };
  }

  if (!isRecord(node)) {
    return { value: node, removed: false };
  }

  const richNode = node as RichTextNode;
  if (richNode.type === "entryReference" && isRecord(richNode.attrs)) {
    const entryId = richNode.attrs.entryId;
    if (entryId === targetEntryId) {
      return null;
    }
  }

  let removed = false;
  const value: Record<string, unknown> = { ...node };
  if ("value" in value) {
    const result = removeReferenceNode(value.value, targetEntryId);
    value.value = result?.value ?? null;
    removed = removed || result === null || result.removed;
  }
  if (Array.isArray(richNode.content)) {
    const result = removeReferenceNode(richNode.content, targetEntryId);
    value.content = result?.value ?? [];
    removed = removed || result === null || result.removed;
  }
  if (Array.isArray(richNode.marks)) {
    const result = removeReferenceNode(richNode.marks, targetEntryId);
    value.marks = result?.value ?? [];
    removed = removed || result === null || result.removed;
  }

  return { value, removed };
};

/**
 * Remove rich text entryReference nodes that point at a target entry id.
 */
export const removeEntryReferences = (
  value: unknown,
  targetEntryId: string,
): RemovedEntryReferences => {
  if (!targetEntryId) return { value, removed: false };

  if (typeof value === "string") {
    const parsed = tryParseJson(value);
    if (parsed === null) return { value, removed: false };
    const result = removeEntryReferences(parsed, targetEntryId);
    return {
      value: result.removed ? JSON.stringify(result.value) : value,
      removed: result.removed,
    };
  }

  const result = removeReferenceNode(value, targetEntryId);
  if (!result) return { value: null, removed: true };
  return result;
};
