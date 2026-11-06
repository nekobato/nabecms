import {
  EntryNotFoundError,
  EntryRevisionNotFoundError,
  publishEntryRevision,
  unpublishEntry,
  type EntriesServiceDeps,
  type UpdatedEntry,
} from "./entries";
import type {
  PublicationScheduleRepository,
  ScheduledPublicationActionRecord,
  ScheduledPublicationActionStatus,
  ScheduledPublicationActionType,
} from "../repositories/publication-schedules";

export type PublicationSchedulesServiceDeps = {
  repo: PublicationScheduleRepository;
  entries: EntriesServiceDeps;
  generateId: (prefix: "scheduled_publication_action") => string;
  now: () => Date;
  emitEntryEvent?: (params: {
    eventType: "entry.published" | "entry.unpublished";
    actorId: string;
    entry: UpdatedEntry;
    schedule: ScheduledPublicationActionRecord;
  }) => Promise<void>;
};

export type SchedulePublicationActionParams = {
  actorId: string;
  modelId: string;
  entryId: string;
  revisionId?: string | null;
  action: ScheduledPublicationActionType;
  scheduledAt: string;
};

export type ListScheduledPublicationActionsParams = {
  modelId?: string;
  entryId?: string;
  statuses?: ScheduledPublicationActionStatus[];
  limit?: number;
};

export type RunDueScheduledPublicationActionsParams = {
  limit?: number;
};

export type ScheduledPublicationActionResult = {
  actionId: string;
  status: "completed" | "failed" | "skipped";
  entryId: string;
  error?: string;
};

/**
 * Raised when a scheduled publication action cannot be found.
 */
export class ScheduledPublicationActionNotFoundError extends Error {
  constructor(public readonly actionId: string) {
    super(`Scheduled publication action ${actionId} not found`);
  }
}

/**
 * Raised when a scheduled publication action request is invalid.
 */
export class InvalidScheduledPublicationActionError extends Error {
  constructor(message: string) {
    super(message);
  }
}

const DEFAULT_DUE_ACTION_LIMIT = 25;
const PROCESSING_LOCK_TTL_MS = 15 * 60 * 1000;

/**
 * Convert an unknown failure into a stable message.
 * @param error - Unknown error
 * @returns Error message
 */
const formatError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Normalize an input date-time string into ISO 8601.
 * @param value - Input date-time string
 * @returns Normalized ISO date-time
 */
const normalizeScheduledAt = (value: string): string => {
  const trimmed = value.trim();
  const timestamp = Date.parse(trimmed);
  if (!trimmed || Number.isNaN(timestamp)) {
    throw new InvalidScheduledPublicationActionError(
      "scheduledAt must be a valid date-time string",
    );
  }
  return new Date(timestamp).toISOString();
};

/**
 * Ensure the target entry and revision exist before scheduling.
 * @param deps - Service dependencies
 * @param params - Schedule request
 */
const assertEntryAndRevision = async (
  deps: PublicationSchedulesServiceDeps,
  params: SchedulePublicationActionParams,
): Promise<void> => {
  const entry = await deps.entries.repo.findEntryById(params.entryId);
  if (!entry || entry.modelId !== params.modelId) {
    throw new EntryNotFoundError(params.entryId);
  }

  if (params.action !== "publish") return;
  const revisionId = params.revisionId?.trim();
  if (!revisionId) {
    throw new InvalidScheduledPublicationActionError(
      "revisionId is required for scheduled publish",
    );
  }

  const revision = await deps.entries.repo.findRevisionById(revisionId);
  if (!revision || revision.entryId !== params.entryId) {
    throw new EntryRevisionNotFoundError(revisionId);
  }
};

/**
 * Create a pending scheduled publication action.
 * @param deps - Service dependencies
 * @param params - Schedule request
 * @returns Created scheduled publication action
 */
export async function schedulePublicationAction(
  deps: PublicationSchedulesServiceDeps,
  params: SchedulePublicationActionParams,
): Promise<ScheduledPublicationActionRecord> {
  await assertEntryAndRevision(deps, params);

  const now = deps.now().toISOString();
  const scheduledAt = normalizeScheduledAt(params.scheduledAt);
  const revisionId =
    params.action === "publish" ? (params.revisionId?.trim() ?? null) : null;

  return await deps.repo.insert({
    id: deps.generateId("scheduled_publication_action"),
    modelId: params.modelId,
    entryId: params.entryId,
    revisionId,
    action: params.action,
    status: "pending",
    scheduledAt,
    requestedBy: params.actorId,
    lockedAt: null,
    executedAt: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * List scheduled publication actions for admin views.
 * @param deps - Service dependencies
 * @param params - Optional list filters
 * @returns Matching scheduled publication actions
 */
export async function listScheduledPublicationActions(
  deps: PublicationSchedulesServiceDeps,
  params: ListScheduledPublicationActionsParams = {},
): Promise<readonly ScheduledPublicationActionRecord[]> {
  return await deps.repo.list(params);
}

/**
 * Cancel a pending or failed scheduled publication action.
 * @param deps - Service dependencies
 * @param actionId - Scheduled action id
 * @returns Cancelled action
 */
export async function cancelScheduledPublicationAction(
  deps: PublicationSchedulesServiceDeps,
  actionId: string,
): Promise<ScheduledPublicationActionRecord> {
  const action = await deps.repo.findById(actionId);
  if (!action) {
    throw new ScheduledPublicationActionNotFoundError(actionId);
  }
  if (!["pending", "failed"].includes(action.status)) {
    throw new InvalidScheduledPublicationActionError(
      "Only pending or failed scheduled actions can be cancelled",
    );
  }

  const now = deps.now().toISOString();
  await deps.repo.update(action.id, {
    status: "cancelled",
    lockedAt: null,
    error: null,
    updatedAt: now,
  });

  const updated = await deps.repo.findById(action.id);
  if (!updated) {
    throw new ScheduledPublicationActionNotFoundError(action.id);
  }
  return updated;
}

/**
 * Move a failed scheduled action back to pending.
 * @param deps - Service dependencies
 * @param actionId - Scheduled action id
 * @returns Retried action
 */
export async function retryScheduledPublicationAction(
  deps: PublicationSchedulesServiceDeps,
  actionId: string,
): Promise<ScheduledPublicationActionRecord> {
  const action = await deps.repo.findById(actionId);
  if (!action) {
    throw new ScheduledPublicationActionNotFoundError(actionId);
  }
  if (action.status !== "failed") {
    throw new InvalidScheduledPublicationActionError(
      "Only failed scheduled actions can be retried",
    );
  }

  const now = deps.now().toISOString();
  await deps.repo.update(action.id, {
    status: "pending",
    lockedAt: null,
    executedAt: null,
    error: null,
    updatedAt: now,
  });

  const updated = await deps.repo.findById(action.id);
  if (!updated) {
    throw new ScheduledPublicationActionNotFoundError(action.id);
  }
  return updated;
}

/**
 * Return the next pending scheduled publication action.
 * @param deps - Service dependencies
 * @returns Next pending action or null
 */
export async function getNextScheduledPublicationAction(
  deps: PublicationSchedulesServiceDeps,
): Promise<ScheduledPublicationActionRecord | null> {
  return await deps.repo.findNextPending();
}

/**
 * Execute a claimed scheduled action through the existing entry services.
 * @param deps - Service dependencies
 * @param action - Claimed scheduled action
 * @returns Updated entry
 */
const executeClaimedAction = async (
  deps: PublicationSchedulesServiceDeps,
  action: ScheduledPublicationActionRecord,
): Promise<UpdatedEntry> => {
  if (action.action === "publish") {
    if (!action.revisionId) {
      throw new InvalidScheduledPublicationActionError(
        "Scheduled publish action is missing revisionId",
      );
    }
    return await publishEntryRevision(deps.entries, {
      actorId: action.requestedBy,
      modelId: action.modelId,
      entryId: action.entryId,
      revisionId: action.revisionId,
    });
  }

  return await unpublishEntry(deps.entries, {
    actorId: action.requestedBy,
    modelId: action.modelId,
    entryId: action.entryId,
  });
};

/**
 * Emit the scheduled entry webhook without changing the execution result.
 * @param deps - Service dependencies
 * @param params - Completed scheduled action data
 */
const emitScheduledEntryEvent = async (
  deps: PublicationSchedulesServiceDeps,
  params: {
    action: ScheduledPublicationActionRecord;
    entry: UpdatedEntry;
  },
): Promise<void> => {
  if (!deps.emitEntryEvent) return;

  try {
    await deps.emitEntryEvent({
      eventType:
        params.action.action === "publish"
          ? "entry.published"
          : "entry.unpublished",
      actorId: params.action.requestedBy,
      entry: params.entry,
      schedule: params.action,
    });
  } catch (error) {
    console.warn("[publication-schedules] emit entry event failed", error);
  }
};

/**
 * Execute all due pending scheduled publication actions up to the given limit.
 * @param deps - Service dependencies
 * @param params - Execution options
 * @returns Execution results for each due action
 */
export async function runDueScheduledPublicationActions(
  deps: PublicationSchedulesServiceDeps,
  params: RunDueScheduledPublicationActionsParams = {},
): Promise<ScheduledPublicationActionResult[]> {
  const nowDate = deps.now();
  const now = nowDate.toISOString();
  const staleProcessingCutoff = new Date(
    nowDate.getTime() - PROCESSING_LOCK_TTL_MS,
  ).toISOString();
  await deps.repo.releaseStaleProcessing(staleProcessingCutoff, now);

  const limit = Math.max(1, params.limit ?? DEFAULT_DUE_ACTION_LIMIT);
  const dueActions = await deps.repo.listDuePending(now, limit);
  const results: ScheduledPublicationActionResult[] = [];

  for (const action of dueActions) {
    const claimed = await deps.repo.claimPendingAction(action.id, now);
    if (!claimed) {
      results.push({
        actionId: action.id,
        status: "skipped",
        entryId: action.entryId,
      });
      continue;
    }

    try {
      const entry = await executeClaimedAction(deps, action);
      const executedAt = deps.now().toISOString();
      await deps.repo.update(action.id, {
        status: "completed",
        executedAt,
        error: null,
        updatedAt: executedAt,
      });
      await emitScheduledEntryEvent(deps, { action, entry });
      results.push({
        actionId: action.id,
        status: "completed",
        entryId: action.entryId,
      });
    } catch (error) {
      const failedAt = deps.now().toISOString();
      const message = formatError(error);
      await deps.repo.update(action.id, {
        status: "failed",
        error: message,
        updatedAt: failedAt,
      });
      results.push({
        actionId: action.id,
        status: "failed",
        entryId: action.entryId,
        error: message,
      });
    }
  }

  return results;
}
