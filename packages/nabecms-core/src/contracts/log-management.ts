/** Shared Admin API contracts for log retention and the latest cleanup run. */
export type LogRetentionSettings = { retentionDays: number | false };

export type LogCleanupState = {
  status: "running" | "completed" | "failed" | "disabled";
  startedAt: string;
  finishedAt: string | null;
  lastSuccessAt: string | null;
  cutoff: string | null;
  auditDeleted: number;
  authDeleted: number;
  remaining: boolean | null;
  errorCode: string | null;
};

export type LogManagementResponse = {
  item: LogRetentionSettings;
  cleanup: LogCleanupState | null;
  health: "never" | "recent" | "stale" | "interrupted" | "disabled";
};
