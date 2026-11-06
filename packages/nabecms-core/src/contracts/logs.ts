import type { AuditLogSnapshot } from "../lib/audit-log";

export type AuditLogItem = {
  id: string;
  userId: string | null;
  userName: string | null;
  action: string;
  targetTable: string;
  targetId: string;
  before: AuditLogSnapshot | null;
  after: AuditLogSnapshot | null;
  createdAt: string;
};

export type EntryRevisionLogItem = {
  id: string;
  entryId: string;
  revisionNumber: number;
  status: string;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
  publishedAt: string | null;
  modelId: string | null;
  modelName: string | null;
  entryStatus: string | null;
};

export type AuthLogItem = {
  id: string;
  userId: string | null;
  userName: string | null;
  provider: string;
  result: string;
  reason: string | null;
  createdAt: string;
};

export type LogPage<T> = { items: T[]; total: number };
export type LogsResponse = {
  auditLogs: LogPage<AuditLogItem>;
  entryRevisions: LogPage<EntryRevisionLogItem>;
};
export type AuthLogsResponse = { authLogs: LogPage<AuthLogItem> };
