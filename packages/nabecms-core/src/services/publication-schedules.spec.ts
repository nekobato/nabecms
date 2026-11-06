import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EntriesServiceDeps } from "./entries";
import * as entriesService from "./entries";
import type {
  PublicationScheduleRepository,
  ScheduledPublicationActionRecord,
} from "../repositories/publication-schedules";
import {
  cancelScheduledPublicationAction,
  InvalidScheduledPublicationActionError,
  retryScheduledPublicationAction,
  runDueScheduledPublicationActions,
  schedulePublicationAction,
  ScheduledPublicationActionNotFoundError,
  type PublicationSchedulesServiceDeps,
} from "./publication-schedules";

vi.mock("./entries", async () => {
  const actual = await vi.importActual<typeof import("./entries")>("./entries");
  return {
    ...actual,
    publishEntryRevision: vi.fn(),
    unpublishEntry: vi.fn(),
  };
});

const nowIso = "2026-06-16T10:00:00.000Z";
const futureIso = "2026-06-16T11:00:00.000Z";

const createAction = (
  overrides: Partial<ScheduledPublicationActionRecord> = {},
): ScheduledPublicationActionRecord => ({
  id: "sched_1",
  modelId: "model_1",
  entryId: "entry_1",
  revisionId: "revision_1",
  action: "publish",
  status: "pending",
  scheduledAt: futureIso,
  requestedBy: "user_1",
  lockedAt: null,
  executedAt: null,
  error: null,
  createdAt: nowIso,
  updatedAt: nowIso,
  ...overrides,
});

const createDeps = (
  overrides: Partial<PublicationSchedulesServiceDeps> = {},
): PublicationSchedulesServiceDeps => {
  const actions = new Map<string, ScheduledPublicationActionRecord>();
  const repo: PublicationScheduleRepository = {
    insert: vi.fn(async (input) => {
      const action = createAction({
        ...input,
        revisionId: input.revisionId ?? null,
        lockedAt: input.lockedAt ?? null,
        executedAt: input.executedAt ?? null,
        error: input.error ?? null,
      } as Partial<ScheduledPublicationActionRecord>);
      actions.set(action.id, action);
      return action;
    }),
    findById: vi.fn(async (id) => actions.get(id) ?? null),
    list: vi.fn(async () => [...actions.values()]),
    listDuePending: vi.fn(async () =>
      [...actions.values()].filter((action) => action.status === "pending"),
    ),
    findNextPending: vi.fn(
      async () =>
        [...actions.values()].find((action) => action.status === "pending") ??
        null,
    ),
    releaseStaleProcessing: vi.fn(async (cutoffIso, updatedAt) => {
      for (const action of actions.values()) {
        if (
          action.status !== "processing" ||
          !action.lockedAt ||
          action.lockedAt > cutoffIso
        ) {
          continue;
        }
        actions.set(action.id, {
          ...action,
          status: "pending",
          lockedAt: null,
          updatedAt,
        });
      }
    }),
    claimPendingAction: vi.fn(async (id, lockedAt) => {
      const action = actions.get(id);
      if (!action || action.status !== "pending") return false;
      actions.set(id, {
        ...action,
        status: "processing",
        lockedAt,
        updatedAt: lockedAt,
      });
      return true;
    }),
    update: vi.fn(async (id, update) => {
      const action = actions.get(id);
      if (!action) return;
      actions.set(id, { ...action, ...update });
    }),
  };

  const entries = {
    repo: {
      findEntryById: vi.fn(async () => ({
        id: "entry_1",
        modelId: "model_1",
        status: "draft",
        createdAt: nowIso,
        updatedAt: nowIso,
        publishedAt: null,
        currentDraftRevisionId: "revision_1",
        publishedRevisionId: null,
      })),
      findRevisionById: vi.fn(async () => ({
        id: "revision_1",
        entryId: "entry_1",
        revisionNumber: 1,
        content: { fields: [] },
        status: "draft",
        createdBy: "user_1",
        createdAt: nowIso,
        publishedAt: null,
      })),
    },
    generateId: vi.fn(),
    now: () => new Date(nowIso),
  } as unknown as EntriesServiceDeps;

  return {
    repo,
    entries,
    generateId: () => "sched_1",
    now: () => new Date(nowIso),
    ...overrides,
  };
};

describe("publication schedules service", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(entriesService.publishEntryRevision).mockReset();
    vi.mocked(entriesService.unpublishEntry).mockReset();
  });

  it("creates a scheduled publish pinned to a revision", async () => {
    const deps = createDeps();

    const created = await schedulePublicationAction(deps, {
      actorId: "user_1",
      modelId: "model_1",
      entryId: "entry_1",
      revisionId: "revision_1",
      action: "publish",
      scheduledAt: futureIso,
    });

    expect(created).toMatchObject({
      id: "sched_1",
      action: "publish",
      status: "pending",
      revisionId: "revision_1",
      scheduledAt: futureIso,
    });
    expect(deps.entries.repo.findRevisionById).toHaveBeenCalledWith(
      "revision_1",
    );
  });

  it("rejects scheduled publish without a revision id", async () => {
    const deps = createDeps();

    await expect(
      schedulePublicationAction(deps, {
        actorId: "user_1",
        modelId: "model_1",
        entryId: "entry_1",
        action: "publish",
        scheduledAt: futureIso,
      }),
    ).rejects.toBeInstanceOf(InvalidScheduledPublicationActionError);
  });

  it("runs due actions through the existing publish service", async () => {
    const due = createAction({ scheduledAt: nowIso });
    const deps = createDeps();
    await deps.repo.insert(due as any);
    vi.mocked(entriesService.publishEntryRevision).mockResolvedValue({
      id: "entry_1",
      modelId: "model_1",
      status: "published",
      createdAt: nowIso,
      updatedAt: nowIso,
      publishedAt: nowIso,
    });

    const results = await runDueScheduledPublicationActions(deps);

    expect(results).toEqual([
      { actionId: "sched_1", status: "completed", entryId: "entry_1" },
    ]);
    expect(entriesService.publishEntryRevision).toHaveBeenCalledWith(
      deps.entries,
      {
        actorId: "user_1",
        modelId: "model_1",
        entryId: "entry_1",
        revisionId: "revision_1",
      },
    );
    expect(deps.repo.update).toHaveBeenLastCalledWith(
      "sched_1",
      expect.objectContaining({ status: "completed" }),
    );
  });

  it("keeps a completed action completed when webhook emission fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const due = createAction({ scheduledAt: nowIso });
    const emitEntryEvent = vi.fn(async () => {
      throw new Error("webhook down");
    });
    const deps = createDeps({ emitEntryEvent });
    await deps.repo.insert(due as any);
    vi.mocked(entriesService.publishEntryRevision).mockResolvedValue({
      id: "entry_1",
      modelId: "model_1",
      status: "published",
      createdAt: nowIso,
      updatedAt: nowIso,
      publishedAt: nowIso,
    });

    const results = await runDueScheduledPublicationActions(deps);

    expect(results).toEqual([
      { actionId: "sched_1", status: "completed", entryId: "entry_1" },
    ]);
    expect(emitEntryEvent).toHaveBeenCalledOnce();
    expect(deps.repo.update).toHaveBeenLastCalledWith(
      "sched_1",
      expect.objectContaining({ status: "completed" }),
    );
    expect(warn).toHaveBeenCalledWith(
      "[publication-schedules] emit entry event failed",
      expect.any(Error),
    );
  });

  it("marks a due action as failed when publish fails", async () => {
    const due = createAction({ scheduledAt: nowIso });
    const deps = createDeps();
    await deps.repo.insert(due as any);
    vi.mocked(entriesService.publishEntryRevision).mockRejectedValue(
      new Error("unique conflict"),
    );

    const results = await runDueScheduledPublicationActions(deps);

    expect(results).toEqual([
      {
        actionId: "sched_1",
        status: "failed",
        entryId: "entry_1",
        error: "unique conflict",
      },
    ]);
    expect(deps.repo.update).toHaveBeenLastCalledWith(
      "sched_1",
      expect.objectContaining({
        status: "failed",
        error: "unique conflict",
      }),
    );
  });

  it("skips a due action when another runner already claimed it", async () => {
    const due = createAction({ scheduledAt: nowIso });
    const deps = createDeps({
      repo: {
        ...createDeps().repo,
        listDuePending: vi.fn(async () => [due]),
        claimPendingAction: vi.fn(async () => false),
      } as PublicationScheduleRepository,
    });

    const results = await runDueScheduledPublicationActions(deps);

    expect(results).toEqual([
      { actionId: "sched_1", status: "skipped", entryId: "entry_1" },
    ]);
    expect(entriesService.publishEntryRevision).not.toHaveBeenCalled();
  });

  it("releases stale processing actions before running due actions", async () => {
    const stale = createAction({
      status: "processing",
      scheduledAt: nowIso,
      lockedAt: "2026-06-16T09:00:00.000Z",
    });
    const deps = createDeps();
    await deps.repo.insert(stale as any);
    vi.mocked(entriesService.publishEntryRevision).mockResolvedValue({
      id: "entry_1",
      modelId: "model_1",
      status: "published",
      createdAt: nowIso,
      updatedAt: nowIso,
      publishedAt: nowIso,
    });

    const results = await runDueScheduledPublicationActions(deps);

    expect(deps.repo.releaseStaleProcessing).toHaveBeenCalledWith(
      "2026-06-16T09:45:00.000Z",
      nowIso,
    );
    expect(results).toEqual([
      { actionId: "sched_1", status: "completed", entryId: "entry_1" },
    ]);
  });

  it("cancels pending actions and retries failed actions", async () => {
    const deps = createDeps();
    await deps.repo.insert(createAction() as any);

    const cancelled = await cancelScheduledPublicationAction(deps, "sched_1");
    expect(cancelled.status).toBe("cancelled");

    await deps.repo.update("sched_1", {
      status: "failed",
      error: "temporary failure",
    });
    const retried = await retryScheduledPublicationAction(deps, "sched_1");
    expect(retried).toMatchObject({
      status: "pending",
      error: null,
      executedAt: null,
    });
  });

  it("throws when cancelling an unknown action", async () => {
    const deps = createDeps();

    await expect(
      cancelScheduledPublicationAction(deps, "missing"),
    ).rejects.toBeInstanceOf(ScheduledPublicationActionNotFoundError);
  });
});
