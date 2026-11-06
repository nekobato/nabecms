/** Only lifecycle metadata may be copied into an operation log. */
export type AuditLogSnapshot = {
  status?: "draft" | "published" | "archived";
  currentDraftRevisionId?: string | null;
  publishedRevisionId?: string | null;
  sourceRevisionId?: string | null;
};

/** Apply an allowlist at storage and response boundaries, including legacy JSON. */
export function sanitizeAuditSnapshot(value: unknown): AuditLogSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const snapshot: AuditLogSnapshot = {};
  if (
    record.status === "draft" ||
    record.status === "published" ||
    record.status === "archived"
  ) {
    snapshot.status = record.status;
  }
  for (const key of [
    "currentDraftRevisionId",
    "publishedRevisionId",
    "sourceRevisionId",
  ] as const) {
    const id = record[key];
    if (
      id === null ||
      (typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id))
    ) {
      snapshot[key] = id;
    }
  }
  return Object.keys(snapshot).length ? snapshot : null;
}
