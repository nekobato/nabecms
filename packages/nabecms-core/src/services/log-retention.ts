import { z } from "zod";
import type { Env } from "../types";
import type {
  LogRetentionSettings,
  LogManagementResponse,
  LogCleanupState,
} from "../contracts/log-management";

type Database = Env["DB"];
export const LOG_RETENTION_KEY = "log_retention";
export const DEFAULT_LOG_RETENTION_DAYS = 90;
// SQLite supports dates from year 0000. Longer periods have no useful cutoff.
export const MAX_LOG_RETENTION_DAYS = 730000;
export const logRetentionSchema = z
  .object({
    retentionDays: z.union([
      z.number().int().min(1).max(MAX_LOG_RETENTION_DAYS),
      z.literal(false),
    ]),
  })
  .strict();

/** Missing settings use defaults; malformed stored settings must stop deletion. */
export async function getLogRetention(
  db: Database,
): Promise<LogRetentionSettings> {
  const row = await db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .bind(LOG_RETENTION_KEY)
    .first<{ value: string }>();
  if (!row) return { retentionDays: DEFAULT_LOG_RETENTION_DAYS };
  return logRetentionSchema.parse(JSON.parse(row.value));
}

/** Persist the policy and its audit event in one transaction. */
export async function updateLogRetention(
  db: Database,
  input: LogRetentionSettings,
  actorId: string,
): Promise<void> {
  const item = logRetentionSchema.parse(input);
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      )
      .bind(LOG_RETENTION_KEY, JSON.stringify(item), now),
    db
      .prepare(
        "INSERT INTO audit_logs (id, user_id, action, target_table, target_id, created_at) VALUES (?, ?, 'update', 'settings', ?, ?)",
      )
      .bind(crypto.randomUUID(), actorId, LOG_RETENTION_KEY, now),
  ]);
}

/** Read the latest durable state without exposing lease identifiers. */
export async function getLogManagement(
  db: Database,
): Promise<LogManagementResponse> {
  const item = await getLogRetention(db);
  const row = await db
    .prepare(
      `SELECT status, started_at AS startedAt, finished_at AS finishedAt,
    last_success_at AS lastSuccessAt, cutoff, audit_deleted AS auditDeleted, auth_deleted AS authDeleted,
    remaining, error_code AS errorCode, lease_expires_at AS leaseExpiresAt
    FROM log_cleanup_state WHERE id = 'logs'`,
    )
    .first<
      Omit<LogCleanupState, "remaining"> & {
        remaining: number | null;
        leaseExpiresAt: string;
      }
    >();
  const cleanup: LogCleanupState | null = row
    ? {
        status: row.status,
        startedAt: row.startedAt,
        finishedAt: row.finishedAt,
        lastSuccessAt: row.lastSuccessAt,
        cutoff: row.cutoff,
        auditDeleted: row.auditDeleted,
        authDeleted: row.authDeleted,
        remaining: row.remaining === null ? null : row.remaining === 1,
        errorCode: row.errorCode,
      }
    : null;
  const now = Date.now();
  const interrupted =
    row?.status === "running" &&
    Date.parse(row.leaseExpiresAt.replace(" ", "T") + "Z") <= now;
  const health = interrupted
    ? "interrupted"
    : row?.status === "running"
      ? "recent"
      : item.retentionDays === false
        ? "disabled"
        : !row
          ? "never"
          : now - Date.parse(row.startedAt) > 48 * 60 * 60 * 1000
            ? "stale"
            : "recent";
  return { item, cleanup, health };
}

const BATCH_SIZE = 500;
const ROUNDS = 5;
const MAX_RUN_MS = 20000;
const OWNED =
  "id = 'logs' AND run_id = ? AND status = 'running' AND lease_expires_at > CURRENT_TIMESTAMP";

/**
 * Run bounded cleanup independently of HTTP traffic. Each deletion and its count
 * commit together. A database lease fences late/overlapping workers, including
 * after lease expiry. A later invocation can resume interrupted work safely.
 */
export async function runLogCleanup(env: Pick<Env, "DB">): Promise<void> {
  const db = env.DB;
  const runId = crypto.randomUUID();
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  let claimed = false;
  let errorCode = "LOG_CLEANUP_DATABASE_ERROR";
  try {
    const claim = await db
      .prepare(
        `INSERT INTO log_cleanup_state
      (id, run_id, status, started_at, lease_expires_at) VALUES ('logs', ?, 'running', ?, datetime('now', '+15 minutes'))
      ON CONFLICT(id) DO UPDATE SET run_id = excluded.run_id, status = 'running', started_at = excluded.started_at,
      lease_expires_at = excluded.lease_expires_at, finished_at = NULL, cutoff = NULL,
      audit_deleted = 0, auth_deleted = 0, remaining = NULL, error_code = NULL
      WHERE log_cleanup_state.status != 'running' OR log_cleanup_state.lease_expires_at <= CURRENT_TIMESTAMP`,
      )
      .bind(runId, startedAt)
      .run();
    if (claim.meta.changes === 0) return;
    claimed = true;
    errorCode = "LOG_RETENTION_SETTINGS_ERROR";
    const settings = await getLogRetention(db);
    errorCode = "LOG_CLEANUP_DATABASE_ERROR";
    if (settings.retentionDays === false) {
      await db
        .prepare(
          `UPDATE log_cleanup_state SET status = 'disabled', finished_at = ? WHERE ${OWNED}`,
        )
        .bind(new Date().toISOString(), runId)
        .run();
      return;
    }
    const cutoff = new Date(
      started - settings.retentionDays * 86400000,
    ).toISOString();
    await db
      .prepare(`UPDATE log_cleanup_state SET cutoff = ? WHERE ${OWNED}`)
      .bind(cutoff, runId)
      .run();
    const pending = { audit_logs: true, auth_login_events: true };
    for (
      let round = 0;
      round < ROUNDS && Date.now() - started < MAX_RUN_MS;
      round++
    ) {
      for (const table of ["audit_logs", "auth_login_events"] as const) {
        if (!pending[table]) continue;
        const counter =
          table === "audit_logs" ? "audit_deleted" : "auth_deleted";
        // Identifiers are fixed internal literals. julianday handles both legacy
        // CURRENT_TIMESTAMP values and ISO strings, preserving subsecond cutoffs.
        const result = await db.batch([
          db
            .prepare(
              `DELETE FROM ${table} WHERE id IN
            (SELECT id FROM ${table} WHERE julianday(created_at) < julianday(?)
             ORDER BY julianday(created_at), id LIMIT ?)
            AND EXISTS (SELECT 1 FROM log_cleanup_state WHERE ${OWNED})`,
            )
            .bind(cutoff, BATCH_SIZE, runId),
          db
            .prepare(
              `UPDATE log_cleanup_state SET ${counter} = ${counter} + changes() WHERE ${OWNED}`,
            )
            .bind(runId),
        ]);
        if (result[1].meta.changes === 0) return;
        pending[table] = result[0].meta.changes === BATCH_SIZE;
      }
      if (!pending.audit_logs && !pending.auth_login_events) break;
    }
    const finishedAt = new Date().toISOString();
    const finished = await db
      .prepare(
        `UPDATE log_cleanup_state SET status = 'completed', finished_at = ?, last_success_at = ?,
      remaining = (EXISTS(SELECT 1 FROM audit_logs WHERE julianday(created_at) < julianday(?))
        OR EXISTS(SELECT 1 FROM auth_login_events WHERE julianday(created_at) < julianday(?))) WHERE ${OWNED}`,
      )
      .bind(finishedAt, finishedAt, cutoff, cutoff, runId)
      .run();
    if (finished.meta.changes > 0)
      console.log(
        JSON.stringify({ event: "log_cleanup_completed", startedAt, cutoff }),
      );
  } catch {
    if (claimed) {
      try {
        await db
          .prepare(
            `UPDATE log_cleanup_state SET status = 'failed', finished_at = ?, error_code = ? WHERE ${OWNED}`,
          )
          .bind(new Date().toISOString(), errorCode, runId)
          .run();
      } catch {
        /* The retained start record will expire to an interrupted state. */
      }
    }
    console.error(
      JSON.stringify({
        event: "log_cleanup_failed",
        startedAt,
        code: errorCode,
      }),
    );
    throw new Error(errorCode);
  }
}
