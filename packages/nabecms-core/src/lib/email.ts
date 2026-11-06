/**
 * Canonical error used when Worker email delivery is misconfigured.
 */
export class EmailConfigurationError extends Error {
  readonly code:
    | "EMAIL_BINDING_NOT_CONFIGURED"
    | "EMAIL_SENDER_NOT_CONFIGURED"
    | "EMAIL_MODULE_UNAVAILABLE";

  constructor(
    code:
      | "EMAIL_BINDING_NOT_CONFIGURED"
      | "EMAIL_SENDER_NOT_CONFIGURED"
      | "EMAIL_MODULE_UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "EmailConfigurationError";
    this.code = code;
  }
}

/**
 * Input payload for plain-text transactional email delivery.
 */
export type SendTextEmailInput = {
  to: string;
  subject: string;
  text: string;
  from?: string;
  fromName?: string;
};

type EmailEnv = {
  EMAIL_SENDER?: {
    send: (message: unknown) => Promise<unknown>;
  };
  AUTH_EMAIL_FROM?: string;
};

/**
 * Prevent header injection by stripping CR/LF from a header value.
 */
const sanitizeHeaderValue = (value: string): string =>
  value.replace(/[\r\n]+/gu, " ").trim();

/**
 * Resolve the sender address from payload or environment.
 */
const resolveSender = (env: EmailEnv, from?: string): string => {
  const resolved = (from ?? env.AUTH_EMAIL_FROM ?? "").trim();
  if (resolved.length === 0) {
    throw new EmailConfigurationError(
      "EMAIL_SENDER_NOT_CONFIGURED",
      "AUTH_EMAIL_FROM must be configured to send emails",
    );
  }
  return resolved;
};

/**
 * Send a plain-text transactional email through Cloudflare `send_email`.
 */
export const sendTextEmail = async (
  env: object,
  input: SendTextEmailInput,
): Promise<void> => {
  const legacyEnv = env as EmailEnv;
  if (
    !legacyEnv.EMAIL_SENDER ||
    typeof legacyEnv.EMAIL_SENDER.send !== "function"
  ) {
    throw new EmailConfigurationError(
      "EMAIL_BINDING_NOT_CONFIGURED",
      "EMAIL_SENDER binding is not configured",
    );
  }

  const to = input.to.trim();
  if (to.length === 0) {
    throw new Error("Recipient email is required");
  }

  const from = sanitizeHeaderValue(resolveSender(legacyEnv, input.from));
  const subject = sanitizeHeaderValue(input.subject);

  await legacyEnv.EMAIL_SENDER.send({
    from: input.fromName
      ? { email: from, name: sanitizeHeaderValue(input.fromName) }
      : from,
    to,
    subject,
    text: input.text,
  });
};
