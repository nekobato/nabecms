import { authLoginEvents } from "../database/schema";
import { generateIdWithPrefix } from "../utils/id";

type AuthEventResult = "success" | "failed" | "locked";
type AuthEventReason =
  | "invalid_password"
  | "user_not_found"
  | "locked"
  | "credentials_missing"
  | "other";

export type LogAuthEventInput = {
  userId?: string | null;
  provider?: "local";
  result: AuthEventResult;
  reason?: AuthEventReason | null;
};

/**
 * Best-effort logging of authentication outcomes. Swallows errors to avoid
 * affecting the login flow.
 */
export async function logAuthEvent(db: any, event: LogAuthEventInput) {
  try {
    await db.insert(authLoginEvents).values({
      id: generateIdWithPrefix("authlog"),
      userId: event.userId ?? null,
      provider: "local",
      result: event.result,
      reason: event.reason ?? null,
    });
  } catch {
    console.warn("[auth] failed to log auth event");
  }
}
