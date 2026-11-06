import { EncryptJWT, jwtDecrypt } from "jose";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Env } from "../types";
import type { AuthInviteRecord } from "../repositories/auth-invites";
import type { EmailDelivery } from "../contracts/email";
import { ensureJwtSecret, sha256Hex } from "../lib/auth";
import * as schema from "../database/schema";
import { getEmailSettings, sendAuthEmail } from "./email-settings";
import { createRoleRepository } from "../repositories/roles";
import { ensureInviteRolesAllowed } from "./invites";

/** Derive a purpose-specific encryption key without reusing a JWT signing key directly. */
async function encryptionKey(env: Env) {
  const source = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(ensureJwtSecret(env)),
    "HKDF",
    false,
    ["deriveBits"],
  );
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new TextEncoder().encode("nabecms"),
        info: new TextEncoder().encode("invite-email:v1"),
      },
      source,
      256,
    ),
  );
}

/** Seal the existing token, binding the ciphertext to its invite and expiry. */
export async function sealInviteToken(
  env: Env,
  inviteId: string,
  token: string,
  expiresAt: string,
) {
  return new EncryptJWT({ token })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setSubject(inviteId)
    .setAudience("nabecms:invite-email")
    .setExpirationTime(Math.floor(new Date(expiresAt).getTime() / 1000))
    .encrypt(await encryptionKey(env));
}

/** Reject swapped, expired, or superseded ciphertext before it can be sent. */
export async function openInviteToken(
  env: Env,
  invite: AuthInviteRecord,
): Promise<string | null> {
  try {
    const ciphertext = invite.metadata?.emailToken;
    if (typeof ciphertext !== "string") return null;
    const { payload } = await jwtDecrypt(ciphertext, await encryptionKey(env), {
      audience: "nabecms:invite-email",
      subject: invite.id,
      keyManagementAlgorithms: ["dir"],
      contentEncryptionAlgorithms: ["A256GCM"],
    });
    if (
      typeof payload.token !== "string" ||
      (await sha256Hex(payload.token)) !== invite.tokenHash
    )
      return null;
    return payload.token;
  } catch {
    return null;
  }
}

/** Send only a current, active invite; never regenerate or extend it on failure. */
export async function deliverInvite(
  env: Env,
  invite: AuthInviteRecord,
): Promise<{
  delivery?: EmailDelivery;
  error?: "EMAIL_DISABLED" | "INVITE_UNUSABLE" | "INVITE_REGENERATE_REQUIRED";
}> {
  const db = drizzle(env.DB, { schema });
  await ensureInviteRolesAllowed(
    { rolesRepo: createRoleRepository(db) },
    invite.roleIds ?? [],
  );
  const settings = await getEmailSettings(env);
  if (!settings.environment.configured || !settings.item.invitesEnabled)
    return { error: "EMAIL_DISABLED" };
  if (
    !["pending", "sent"].includes(invite.status) ||
    new Date(invite.tokenExpiresAt).getTime() <= Date.now()
  )
    return { error: "INVITE_UNUSABLE" };
  const token = await openInviteToken(env, invite);
  if (!token) return { error: "INVITE_REGENERATE_REQUIRED" };
  const url = new URL("/admin/auth/invite", settings.environment.baseUrl!);
  url.searchParams.set("token", token);
  const delivery = await sendAuthEmail(
    env,
    settings.item,
    "invite",
    invite.email,
    `${settings.item.senderName}: Invitation / 招待`,
    `You are invited to NabeCMS. / NabeCMSへの招待です。\n\n${url}\n\nExpires / 有効期限: ${invite.tokenExpiresAt}`,
  );
  // Do not overwrite a concurrent regeneration or reactivate a consumed invite.
  try {
    await db
      .update(schema.authInvites)
      .set({ metadata: { ...invite.metadata, emailDelivery: delivery } })
      .where(
        and(
          eq(schema.authInvites.id, invite.id),
          eq(schema.authInvites.tokenHash, invite.tokenHash),
          inArray(schema.authInvites.status, ["pending", "sent"]),
        ),
      );
  } catch {
    console.warn("Invite delivery result could not be recorded");
  }
  return { delivery };
}
