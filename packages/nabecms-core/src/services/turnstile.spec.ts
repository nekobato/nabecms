import { describe, expect, it, vi } from "vitest";
import {
  canRenderTurnstileWidget,
  normalizeTurnstileToken,
  TurnstileVerificationConfigurationError,
  verifyTurnstileToken,
} from "./turnstile";

describe("turnstile service", () => {
  it("normalizes submitted tokens", () => {
    expect(normalizeTurnstileToken(" token ")).toBe("token");
    expect(normalizeTurnstileToken("")).toBeNull();
    expect(normalizeTurnstileToken("x".repeat(2049))).toBeNull();
    expect(normalizeTurnstileToken(null)).toBeNull();
  });

  it("rejects verification when secret key is missing", async () => {
    await expect(
      verifyTurnstileToken({ env: {} }, { token: "token" }),
    ).rejects.toBeInstanceOf(TurnstileVerificationConfigurationError);
  });

  it("submits tokens to Cloudflare Siteverify", async () => {
    const fetchMock = vi.fn(
      async (..._args: Parameters<typeof fetch>) =>
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    const result = await verifyTurnstileToken(
      { env: { TURNSTILE_SECRET_KEY: " secret " }, fetch: fetchMock },
      { token: " token ", remoteIp: "203.0.113.10" },
    );

    expect(result).toEqual({ success: true, errorCodes: [] });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      expect.objectContaining({ method: "POST" }),
    );

    const init = fetchMock.mock.calls[0]?.[1];
    const body = init?.body;
    expect(body).toBeInstanceOf(URLSearchParams);
    expect((body as URLSearchParams).get("secret")).toBe("secret");
    expect((body as URLSearchParams).get("response")).toBe("token");
    expect((body as URLSearchParams).get("remoteip")).toBe("203.0.113.10");
  });

  it("returns Cloudflare error codes for failed verification", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: false,
            "error-codes": ["timeout-or-duplicate"],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    );

    const result = await verifyTurnstileToken(
      { env: { TURNSTILE_SECRET_KEY: "secret" }, fetch: fetchMock },
      { token: "token" },
    );

    expect(result).toEqual({
      success: false,
      errorCodes: ["timeout-or-duplicate"],
    });
  });

  it("treats non-OK Siteverify responses as verification failures", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 503 }));

    const result = await verifyTurnstileToken(
      { env: { TURNSTILE_SECRET_KEY: "secret" }, fetch: fetchMock },
      { token: "token" },
    );

    expect(result).toEqual({
      success: false,
      errorCodes: ["siteverify-http-error"],
    });
  });

  it("renders the widget only when a site key is configured", () => {
    expect(
      canRenderTurnstileWidget({
        siteKeyConfigured: true,
        secretKeyConfigured: false,
        siteKey: "site-key",
        canEnable: false,
      }),
    ).toBe(true);
    expect(
      canRenderTurnstileWidget({
        siteKeyConfigured: false,
        secretKeyConfigured: true,
        siteKey: null,
        canEnable: false,
      }),
    ).toBe(false);
  });
});
