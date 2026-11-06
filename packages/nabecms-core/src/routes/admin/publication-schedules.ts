import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import {
  isScheduledPublishingEnabled,
  resolveScheduledPublishingRunner,
} from "../../config";
import * as schema from "../../database/schema";
import { dispatchWebhooks } from "../../lib/webhook";
import { createPublicationScheduleRepository } from "../../repositories/publication-schedules";
import {
  EntryNotFoundError,
  EntryRevisionNotFoundError,
} from "../../services/entries";
import { createD1EntriesServiceDeps } from "../../services/entries-d1";
import {
  cancelScheduledPublicationAction,
  InvalidScheduledPublicationActionError,
  listScheduledPublicationActions,
  retryScheduledPublicationAction,
  runDueScheduledPublicationActions,
  schedulePublicationAction,
  ScheduledPublicationActionNotFoundError,
  type PublicationSchedulesServiceDeps,
} from "../../services/publication-schedules";
import type { AppContext } from "../../types";
import { generateIdWithPrefix } from "../../utils/id";
import { requireActor } from "./_authz";

const schedulePayloadSchema = z.object({
  action: z.enum(["publish", "unpublish"]),
  revisionId: z.string().min(1).optional().nullable(),
  scheduledAt: z.string().min(1),
});

const runDuePayloadSchema = z.object({
  limit: z.number().int().positive().max(100).optional(),
});

const statusValues = [
  "pending",
  "processing",
  "completed",
  "failed",
  "cancelled",
] as const;

type DurableObjectNamespaceLike = {
  getByName: (name: string) => {
    fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  };
};

const isDurableObjectNamespaceLike = (
  value: unknown,
): value is DurableObjectNamespaceLike =>
  Boolean(
    value && typeof (value as { getByName?: unknown }).getByName === "function",
  );

/**
 * Return a disabled response when scheduled publishing is not configured.
 * @param c - Hono context
 * @returns 404 response when the feature is disabled
 */
const requireScheduledPublishingEnabled = (c: any): Response | void => {
  if (isScheduledPublishingEnabled(c.get("config"))) return;
  return c.json(
    {
      error: {
        code: "SCHEDULED_PUBLISHING_DISABLED",
        message: "Scheduled publishing is not enabled",
      },
    },
    404,
  );
};

/**
 * Parse comma-separated status filters from a request.
 * @param raw - Raw query parameter
 * @returns Valid scheduled action statuses
 */
const parseStatuses = (raw: string | undefined | null) => {
  if (!raw) return undefined;
  const allowed = new Set<string>(statusValues);
  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is (typeof statusValues)[number] =>
      allowed.has(value),
    );
  return values.length > 0 ? values : undefined;
};

/**
 * Parse a bounded list limit from a query parameter.
 * @param raw - Raw query parameter
 * @returns Safe list limit
 */
const parseLimit = (raw: string | undefined | null): number => {
  const value = Number(raw ?? 100);
  if (!Number.isFinite(value) || value <= 0) return 100;
  return Math.min(200, Math.floor(value));
};

/**
 * Create service dependencies from a Hono context.
 * @param c - Hono context
 * @returns Scheduled publication service dependencies
 */
function createDeps(c: any): PublicationSchedulesServiceDeps {
  const db = drizzle(c.env.DB, { schema });

  return {
    repo: createPublicationScheduleRepository(db),
    entries: createD1EntriesServiceDeps(db),
    generateId: (prefix: "scheduled_publication_action") =>
      generateIdWithPrefix(prefix),
    now: () => new Date(),
    emitEntryEvent: async ({ eventType, actorId, entry, schedule }) => {
      await dispatchWebhooks({
        db,
        env: c.env,
        eventType,
        actor: { id: actorId },
        resource: {
          kind: "entry",
          id: entry.id,
          model_id: entry.modelId,
        },
        data: {
          current: entry,
          status: entry.status,
          schedule: {
            id: schedule.id,
            action: schedule.action,
            scheduled_at: schedule.scheduledAt,
          },
        },
        context: {
          request_id: c.get("requestId") ?? null,
          ip: c.req.header("CF-Connecting-IP") || null,
          user_agent: c.req.header("User-Agent") || null,
        },
      });
    },
  };
}

/**
 * Ask the configured Durable Object scheduler to refresh its next alarm.
 * @param c - Hono context
 */
async function requestSchedulerReschedule(c: any): Promise<void> {
  const config = c.get("config");
  const runner = resolveScheduledPublishingRunner(config);
  if (runner.type !== "durable-object") return;

  const binding = (c.env as Record<string, unknown>)[runner.binding];
  if (!isDurableObjectNamespaceLike(binding)) {
    console.warn(
      `[publication-schedules] missing Durable Object binding "${runner.binding}"`,
    );
    return;
  }

  try {
    const stub = binding.getByName(runner.instanceName);
    const response = await stub.fetch(
      "https://publication-scheduler.local/reschedule",
      {
        method: "POST",
      },
    );
    if (!response.ok) {
      console.warn(
        `[publication-schedules] scheduler reschedule failed with ${response.status}`,
      );
    }
  } catch (error) {
    console.warn("[publication-schedules] scheduler reschedule failed", error);
  }
}

/**
 * Convert known scheduled publication errors to HTTP responses.
 * @param c - Hono context
 * @param error - Caught error
 * @returns HTTP response
 */
function handleScheduledPublicationError(c: any, error: unknown): Response {
  if (error instanceof EntryNotFoundError) {
    return c.json(
      { error: { code: "ENTRY_NOT_FOUND", message: error.message } },
      404,
    );
  }
  if (error instanceof EntryRevisionNotFoundError) {
    return c.json(
      { error: { code: "REVISION_NOT_FOUND", message: error.message } },
      404,
    );
  }
  if (error instanceof ScheduledPublicationActionNotFoundError) {
    return c.json(
      { error: { code: "SCHEDULE_NOT_FOUND", message: error.message } },
      404,
    );
  }
  if (error instanceof InvalidScheduledPublicationActionError) {
    return c.json(
      { error: { code: "INVALID_SCHEDULE", message: error.message } },
      400,
    );
  }

  console.error("Scheduled publication route failed", error);
  return c.json(
    {
      error: {
        code: "SCHEDULED_PUBLICATION_FAILED",
        message: "Scheduled publication operation failed",
      },
    },
    500,
  );
}

const app = new Hono<AppContext>()
  .get("/api/admin/publication-schedules", async (c) => {
    const disabled = requireScheduledPublishingEnabled(c);
    if (disabled) return disabled;
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;

    const deps = createDeps(c);
    const items = await listScheduledPublicationActions(deps, {
      modelId: c.req.query("modelId") ?? undefined,
      entryId: c.req.query("entryId") ?? undefined,
      statuses: parseStatuses(c.req.query("status")),
      limit: parseLimit(c.req.query("limit")),
    });
    return c.json({ items });
  })
  .post("/api/admin/models/:modelId/entries/:entryId/schedules", async (c) => {
    const disabled = requireScheduledPublishingEnabled(c);
    if (disabled) return disabled;
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;

    let payload: z.infer<typeof schedulePayloadSchema>;
    try {
      payload = schedulePayloadSchema.parse(await c.req.json());
    } catch (error) {
      if (error instanceof z.ZodError) {
        return c.json(
          { error: { code: "INVALID_PAYLOAD", issues: error.issues } },
          400,
        );
      }
      return c.json({ error: { code: "INVALID_PAYLOAD" } }, 400);
    }

    try {
      const deps = createDeps(c);
      const item = await schedulePublicationAction(deps, {
        actorId: actor.id,
        modelId: c.req.param("modelId"),
        entryId: c.req.param("entryId"),
        revisionId: payload.revisionId ?? null,
        action: payload.action,
        scheduledAt: payload.scheduledAt,
      });
      await requestSchedulerReschedule(c);
      return c.json({ item }, 201);
    } catch (error) {
      return handleScheduledPublicationError(c, error);
    }
  })
  .delete("/api/admin/publication-schedules/:scheduleId", async (c) => {
    const disabled = requireScheduledPublishingEnabled(c);
    if (disabled) return disabled;
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;

    try {
      const deps = createDeps(c);
      const item = await cancelScheduledPublicationAction(
        deps,
        c.req.param("scheduleId"),
      );
      await requestSchedulerReschedule(c);
      return c.json({ item });
    } catch (error) {
      return handleScheduledPublicationError(c, error);
    }
  })
  .post("/api/admin/publication-schedules/:scheduleId/retry", async (c) => {
    const disabled = requireScheduledPublishingEnabled(c);
    if (disabled) return disabled;
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;

    try {
      const deps = createDeps(c);
      const item = await retryScheduledPublicationAction(
        deps,
        c.req.param("scheduleId"),
      );
      await requestSchedulerReschedule(c);
      return c.json({ item });
    } catch (error) {
      return handleScheduledPublicationError(c, error);
    }
  })
  .post("/api/admin/publication-schedules/run-due", async (c) => {
    const disabled = requireScheduledPublishingEnabled(c);
    if (disabled) return disabled;
    const actor = await requireActor(c);
    if (actor instanceof Response) return actor;

    let payload: z.infer<typeof runDuePayloadSchema> = {};
    try {
      const raw = await c.req
        .json()
        .catch(() => ({}) satisfies z.infer<typeof runDuePayloadSchema>);
      payload = runDuePayloadSchema.parse(raw);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return c.json(
          { error: { code: "INVALID_PAYLOAD", issues: error.issues } },
          400,
        );
      }
      return c.json({ error: { code: "INVALID_PAYLOAD" } }, 400);
    }

    try {
      const deps = createDeps(c);
      const results = await runDueScheduledPublicationActions(deps, {
        limit: payload.limit,
      });
      await requestSchedulerReschedule(c);
      return c.json({ results });
    } catch (error) {
      return handleScheduledPublicationError(c, error);
    }
  });

export default app;
