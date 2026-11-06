import { drizzle } from "drizzle-orm/d1";
import * as schema from "../database/schema";
import { dispatchWebhooks } from "../lib/webhook";
import { createPublicationScheduleRepository } from "../repositories/publication-schedules";
import {
  getNextScheduledPublicationAction,
  runDueScheduledPublicationActions,
  type PublicationSchedulesServiceDeps,
} from "../services/publication-schedules";
import { createD1EntriesServiceDeps } from "../services/entries-d1";
import type { Env } from "../types";
import { generateIdWithPrefix } from "../utils/id";

type DurableObjectStateLike = {
  storage: {
    setAlarm: (scheduledTime: number) => Promise<void>;
    deleteAlarm: () => Promise<void>;
  };
};

const DEFAULT_ALARM_BATCH_LIMIT = 25;

/**
 * Durable Object coordinator for scheduled publication alarms.
 */
export class PublicationScheduler {
  constructor(
    private readonly state: DurableObjectStateLike,
    private readonly env: Env,
  ) {}

  /**
   * Handle scheduler control requests from the main Worker.
   * @param request - Durable Object request
   * @returns JSON response with scheduler state
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST") {
      return Response.json(
        { error: { code: "METHOD_NOT_ALLOWED" } },
        { status: 405 },
      );
    }

    if (url.pathname === "/reschedule") {
      const next = await this.reschedule();
      return Response.json({ next });
    }

    if (url.pathname === "/run-due") {
      const results = await this.runDueAndReschedule();
      return Response.json({ results });
    }

    return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  }

  /**
   * Cloudflare alarm entrypoint.
   */
  async alarm(): Promise<void> {
    await this.runDueAndReschedule();
  }

  /**
   * Refresh the alarm to the next pending scheduled publication action.
   * @returns Next alarm timestamp or null
   */
  async reschedule(): Promise<string | null> {
    const deps = this.createDeps();
    const next = await getNextScheduledPublicationAction(deps);
    if (!next) {
      await this.state.storage.deleteAlarm();
      return null;
    }

    const timestamp = Date.parse(next.scheduledAt);
    if (Number.isNaN(timestamp)) {
      await this.state.storage.deleteAlarm();
      return null;
    }

    await this.state.storage.setAlarm(Math.max(timestamp, Date.now()));
    return next.scheduledAt;
  }

  /**
   * Execute due actions and schedule the next alarm.
   * @returns Execution results
   */
  async runDueAndReschedule() {
    const deps = this.createDeps();
    const results = await runDueScheduledPublicationActions(deps, {
      limit: DEFAULT_ALARM_BATCH_LIMIT,
    });
    await this.reschedule();
    return results;
  }

  /**
   * Create service dependencies for scheduled publication execution.
   * @returns Service dependencies
   */
  private createDeps(): PublicationSchedulesServiceDeps {
    const db = drizzle(this.env.DB, { schema });

    return {
      repo: createPublicationScheduleRepository(db),
      entries: createD1EntriesServiceDeps(db),
      generateId: (prefix: "scheduled_publication_action") =>
        generateIdWithPrefix(prefix),
      now: () => new Date(),
      emitEntryEvent: async ({ eventType, actorId, entry, schedule }) => {
        await dispatchWebhooks({
          db,
          env: this.env,
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
            request_id: null,
          },
        });
      },
    };
  }
}
