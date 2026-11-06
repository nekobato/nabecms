import { describe, expect, it } from "vitest";
import { openInviteToken, sealInviteToken } from "./invite-email";
import { sha256Hex } from "../lib/auth";
import type { Env } from "../types";
import type { AuthInviteRecord } from "../repositories/auth-invites";
const env = {
  JWT_SECRET: "test-invite-encryption-secret",
  WORKER_ENV: "test",
} as Env;
describe("sealed invitation tokens", () => {
  it("round trips only for the original invite, key, active hash and expiration", async () => {
    const token = "secret-invitation-token";
    const expiry = new Date(Date.now() + 60_000).toISOString();
    const sealed = await sealInviteToken(env, "invite_a", token, expiry);
    expect(sealed).not.toContain(token);
    const invite = {
      id: "invite_a",
      tokenHash: await sha256Hex(token),
      metadata: { emailToken: sealed },
    } as unknown as AuthInviteRecord;
    expect(await openInviteToken(env, invite)).toBe(token);
    expect(
      await openInviteToken(env, { ...invite, id: "invite_b" }),
    ).toBeNull();
    expect(
      await openInviteToken(env, { ...invite, tokenHash: "new-token-hash" }),
    ).toBeNull();
    expect(
      await openInviteToken({ ...env, JWT_SECRET: "rotated-secret" }, invite),
    ).toBeNull();
    expect(
      await openInviteToken(env, {
        ...invite,
        metadata: { emailToken: sealed + "broken" },
      }),
    ).toBeNull();
    const expired = await sealInviteToken(
      env,
      invite.id,
      token,
      new Date(Date.now() - 60_000).toISOString(),
    );
    expect(
      await openInviteToken(env, {
        ...invite,
        metadata: { emailToken: expired },
      }),
    ).toBeNull();
  });
});
