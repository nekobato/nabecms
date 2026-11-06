import { sendTextEmail } from "../lib/email";
import { z } from "zod";
import { drizzle } from "drizzle-orm/d1";
import type { Env } from "../types";
import type {
  EmailSettings,
  EmailSettingsResponse,
  EmailDelivery,
} from "../contracts/email";
import { createSettingsRepository } from "../repositories/settings";
import * as schema from "../database/schema";
import { generateIdWithPrefix } from "../utils/id";

export const emailSettingsSchema = z
  .object({
    senderName: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[^\r\n\u0000-\u001f]+$/u),
    invitesEnabled: z.boolean(),
    passwordResetEnabled: z.boolean(),
  })
  .strict();
export const defaultEmailSettings: EmailSettings = {
  senderName: "NabeCMS",
  invitesEnabled: false,
  passwordResetEnabled: false,
};

/** Only an explicitly configured origin may receive authentication tokens. */
export function emailEnvironment(
  env: Partial<Env>,
): EmailSettingsResponse["environment"] {
  const from = z.email().safeParse(env.AUTH_EMAIL_FROM?.trim());
  let baseUrl: string | null = null;
  try {
    const url = new URL(env.AUTH_EMAIL_BASE_URL ?? "");
    const local =
      env.WORKER_ENV !== "production" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      (url.protocol === "https:" || (local && url.protocol === "http:")) &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    )
      baseUrl = url.origin;
  } catch {
    /* Invalid configuration is reported without echoing its value. */
  }
  const missing = [
    typeof env.EMAIL_SENDER?.send !== "function" ? "EMAIL_SENDER" : null,
    !from.success ? "AUTH_EMAIL_FROM" : null,
    !baseUrl ? "AUTH_EMAIL_BASE_URL" : null,
  ].filter((item): item is string => item !== null);
  return {
    configured: missing.length === 0,
    from: from.success ? from.data : null,
    baseUrl,
    missing,
  };
}

/** Read saved policy and deployment capabilities separately. */
export async function getEmailSettings(
  env: Env,
): Promise<EmailSettingsResponse> {
  const repo = createSettingsRepository(drizzle(env.DB, { schema }));
  const stored = await repo.findByKey("email_settings");
  const parsed = emailSettingsSchema.safeParse(stored?.value);
  const last = await repo.findByKey("email_last_delivery");
  return {
    item: parsed.success ? parsed.data : { ...defaultEmailSettings },
    environment: emailEnvironment(env),
    lastDelivery: (last?.value as EmailDelivery | undefined) ?? null,
  };
}

/** Persist settings and their redacted audit event atomically. */
export async function saveEmailSettings(
  env: Env,
  item: EmailSettings,
  actorId: string,
) {
  const db = drizzle(env.DB, { schema });
  const now = new Date().toISOString();
  await db.batch([
    db
      .insert(schema.settings)
      .values({ key: "email_settings", value: item, updatedAt: now })
      .onConflictDoUpdate({
        target: schema.settings.key,
        set: { value: item, updatedAt: now },
      }),
    db.insert(schema.auditLogs).values({
      id: generateIdWithPrefix("audit"),
      userId: actorId,
      action: "update",
      targetTable: "settings",
      targetId: "email_settings",
      before: null,
      after: null,
      createdAt: now,
    }),
  ]);
}

/** Record no recipient, token, body, provider exception, or provider message ID. */
export async function recordEmailDelivery(env: Env, delivery: EmailDelivery) {
  const db = drizzle(env.DB, { schema });
  await db
    .insert(schema.settings)
    .values({
      key: "email_last_delivery",
      value: delivery,
      updatedAt: delivery.at,
    })
    .onConflictDoUpdate({
      target: schema.settings.key,
      set: { value: delivery, updatedAt: delivery.at },
    });
}

/** Send using the fixed sender and saved display name; acceptance is not delivery. */
export async function sendAuthEmail(
  env: Env,
  settings: EmailSettings,
  purpose: EmailDelivery["purpose"],
  to: string,
  subject: string,
  text: string,
): Promise<EmailDelivery> {
  const environment = emailEnvironment(env);
  let status: EmailDelivery["status"] = "failed";
  try {
    if (!environment.configured || !environment.from || !env.EMAIL_SENDER)
      throw new Error("unavailable");
    await sendTextEmail(env, {
      from: environment.from,
      fromName: settings.senderName,
      to,
      subject,
      text,
    });
    status = "accepted";
  } catch {
    /* Provider errors may contain recipient addresses and message bodies. */
  }
  const result: EmailDelivery = {
    status,
    purpose,
    at: new Date().toISOString(),
    errorCode: status === "failed" ? "EMAIL_DELIVERY_FAILED" : null,
  };
  try {
    await recordEmailDelivery(env, result);
  } catch {
    console.warn("Email delivery result could not be recorded");
  }
  return result;
}
