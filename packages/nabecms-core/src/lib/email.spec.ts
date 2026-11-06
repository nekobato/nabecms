import { describe, expect, it, vi } from "vitest";
import { EmailConfigurationError, sendTextEmail } from "./email";

describe("sendTextEmail", () => {
  it("throws EMAIL_BINDING_NOT_CONFIGURED when send_email binding is missing", async () => {
    await expect(
      sendTextEmail(
        { AUTH_EMAIL_FROM: "no-reply@example.com" },
        {
          to: "user@example.com",
          subject: "subject",
          text: "body",
        },
      ),
    ).rejects.toMatchObject({
      name: "EmailConfigurationError",
      code: "EMAIL_BINDING_NOT_CONFIGURED",
    } satisfies Partial<EmailConfigurationError>);
  });

  it("throws EMAIL_SENDER_NOT_CONFIGURED when sender address is missing", async () => {
    await expect(
      sendTextEmail(
        {
          EMAIL_SENDER: {
            send: vi.fn(),
          },
        },
        {
          to: "user@example.com",
          subject: "subject",
          text: "body",
        },
      ),
    ).rejects.toMatchObject({
      name: "EmailConfigurationError",
      code: "EMAIL_SENDER_NOT_CONFIGURED",
    } satisfies Partial<EmailConfigurationError>);
  });

  it("throws when recipient email is empty", async () => {
    await expect(
      sendTextEmail(
        {
          AUTH_EMAIL_FROM: "no-reply@example.com",
          EMAIL_SENDER: {
            send: vi.fn(),
          },
        },
        {
          to: "   ",
          subject: "subject",
          text: "body",
        },
      ),
    ).rejects.toThrow("Recipient email is required");
  });

  it("sends structured text email through the send_email binding", async () => {
    const send = vi.fn(async () => ({ messageId: "email_123" }));

    await sendTextEmail(
      {
        AUTH_EMAIL_FROM: " no-reply@example.com ",
        EMAIL_SENDER: {
          send,
        },
      },
      {
        to: " user@example.com ",
        subject: "Reset password\r\nBcc: injected@example.com",
        text: "line 1\nline 2",
      },
    );

    expect(send).toHaveBeenCalledWith({
      from: "no-reply@example.com",
      to: "user@example.com",
      subject: "Reset password Bcc: injected@example.com",
      text: "line 1\nline 2",
    });
  });
});
