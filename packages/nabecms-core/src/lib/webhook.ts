import { eq } from "drizzle-orm";
import { webhooks, webhookDeliveryLogs } from "../database/schema";
import { generateIdWithPrefix } from "../utils/id";
import Mustache from "mustache";
import { sendTextEmail } from "./email";

const enc = new TextEncoder();

type DispatchContext = {
  db: any;
  env: any;
  eventType: string;
  actor?: { id?: string | null; email?: string | null } | null;
  resource?: Record<string, unknown> | null;
  data?: Record<string, unknown> | null;
  context?: Record<string, unknown> | null;
  targetWebhookIds?: string[];
  ignoreEventFilters?: boolean;
};

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  const bytes = new Uint8Array(signature);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function buildEnvelope(input: DispatchContext) {
  const now = new Date().toISOString();
  return {
    id: generateIdWithPrefix("evt"),
    type: input.eventType,
    occurred_at: now,
    actor: input.actor ?? null,
    resource: input.resource ?? null,
    data: input.data ?? null,
    context: input.context ?? null,
  };
}

type WebhookRow = typeof webhooks.$inferSelect;

/**
 * Resolve `mailto:` webhook URL into recipient/subject, or null for HTTP delivery.
 */
function parseMailtoTarget(
  targetUrl: string,
): { to: string; subject: string | null } | null {
  try {
    const parsed = new URL(targetUrl);
    if (parsed.protocol !== "mailto:") {
      return null;
    }

    const to = decodeURIComponent(parsed.pathname).trim();
    if (to.length === 0) {
      return null;
    }

    const subject = parsed.searchParams.get("subject");
    return {
      to,
      subject: subject && subject.trim().length > 0 ? subject.trim() : null,
    };
  } catch {
    return null;
  }
}

function matchesEventFilter(
  row: WebhookRow,
  eventType: string,
  ignoreEventFilters?: boolean,
) {
  if (ignoreEventFilters) return true;
  const filters = (row.eventFilters as string[] | null) ?? null;
  if (!filters || filters.length === 0) return true;
  return filters.includes(eventType);
}

function isActive(row: WebhookRow) {
  const status = (row.status as string | null) ?? "active";
  return row.isActive !== false && status === "active";
}

async function logDelivery(
  db: any,
  log: {
    webhookId: string;
    eventId: string;
    eventType: string;
    status: "success" | "failed" | "skipped";
    attempt: number;
    responseCode?: number | null;
    latencyMs?: number | null;
    error?: string | null;
    payload: unknown;
    responseBody?: string | null;
  },
) {
  try {
    await db.insert(webhookDeliveryLogs).values({
      id: generateIdWithPrefix("whlog"),
      webhookId: log.webhookId,
      eventId: log.eventId,
      eventType: log.eventType,
      status: log.status,
      attempt: log.attempt,
      responseCode: log.responseCode ?? null,
      latencyMs: log.latencyMs ?? null,
      error: log.error ?? null,
      payload: log.payload as any,
      responseBody: log.responseBody ?? null,
    });
  } catch (error) {
    console.warn("[webhook] failed to log delivery", error);
  }
}

async function sendOne(
  env: any,
  row: WebhookRow,
  envelope: any,
): Promise<{
  status: "success" | "failed";
  responseCode?: number;
  latency?: number;
  error?: string;
  responseBody?: string | null;
}> {
  let renderedBody: string;
  if (row.bodyTemplate && row.bodyTemplate.length > 0) {
    try {
      renderedBody = Mustache.render(row.bodyTemplate, envelope);
    } catch (err) {
      return {
        status: "failed",
        error: `template_error: ${(err as Error).message}`,
        responseBody: null,
      };
    }
  } else {
    renderedBody = JSON.stringify(envelope);
  }

  const mailtoTarget = parseMailtoTarget(row.url);
  if (mailtoTarget) {
    const subject = mailtoTarget.subject ?? `[NabeCMS] ${envelope.type}`;
    const start = Date.now();
    try {
      await sendTextEmail(env, {
        to: mailtoTarget.to,
        subject,
        text: renderedBody,
      });
      return {
        status: "success",
        responseCode: 202,
        latency: Date.now() - start,
        responseBody: "accepted",
      };
    } catch (error) {
      return {
        status: "failed",
        error: (error as Error)?.message ?? String(error),
        responseBody: null,
      };
    }
  }

  const controller = new AbortController();
  const timeoutMs = row.timeoutMs ?? 10_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const body = renderedBody;
  const timestamp = Math.floor(Date.now() / 1000);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "nabecms-webhook/1.0",
    ...(row.customHeaders as Record<string, string> | null | undefined),
  };

  if (row.secret) {
    const signature = await hmacSha256Hex(row.secret, `${timestamp}.${body}`);
    headers["X-NABECMS-Webhook-Signature"] =
      `t=${timestamp},sha256=${signature}`;
  }

  headers["X-NABECMS-Webhook-Id"] = envelope.id;
  headers["X-NABECMS-Webhook-Type"] = envelope.type;

  const start = Date.now();
  try {
    const res = await fetch(row.url, {
      method: row.method || "POST",
      headers,
      body,
      signal: controller.signal,
    });
    const latency = Date.now() - start;
    clearTimeout(timer);
    const success = res.status >= 200 && res.status < 300;
    let responseBody: string | null = null;
    try {
      responseBody = await res.text();
    } catch (err) {
      responseBody = null;
    }
    return {
      status: success ? "success" : "failed",
      responseCode: res.status,
      latency,
      responseBody,
    };
  } catch (error: any) {
    clearTimeout(timer);
    return {
      status: "failed",
      error: (error as Error)?.message ?? String(error),
      responseBody: null,
    };
  }
}

export async function dispatchWebhooks(input: DispatchContext) {
  // In test environment, avoid network side effects
  const envName =
    (input.env?.WORKER_ENV as string | undefined) ?? "development";
  const isTest = envName === "test";

  const envelope = buildEnvelope(input);

  let rows: WebhookRow[] = [];
  try {
    const baseQuery = input.db.select().from(webhooks);
    if (input.targetWebhookIds && input.targetWebhookIds.length > 0) {
      rows = await baseQuery.where(eq(webhooks.id, input.targetWebhookIds[0]));
    } else {
      rows = await baseQuery;
    }
  } catch (error) {
    console.warn("[webhook] failed to load webhooks", error);
    return;
  }

  const targets = rows.filter(
    (row) =>
      isActive(row) &&
      matchesEventFilter(row, input.eventType, input.ignoreEventFilters),
  );

  if (targets.length === 0) return;

  for (const row of targets) {
    if (isTest) {
      await logDelivery(input.db, {
        webhookId: row.id,
        eventId: envelope.id,
        eventType: input.eventType,
        status: "skipped",
        attempt: 1,
        responseCode: 0,
        latencyMs: 0,
        error: "skipped in test env",
        payload: envelope,
      });
      continue;
    }

    const result = await sendOne(input.env, row, envelope);
    await logDelivery(input.db, {
      webhookId: row.id,
      eventId: envelope.id,
      eventType: input.eventType,
      status: result.status,
      attempt: 1,
      responseCode: result.responseCode ?? null,
      latencyMs: result.latency ?? null,
      error: result.error ?? null,
      responseBody: result.responseBody ?? null,
      payload: envelope,
    });
  }
}
