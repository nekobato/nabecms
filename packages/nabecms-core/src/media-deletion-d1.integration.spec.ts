/// <reference types="@cloudflare/vitest-plugin/types" />

import { applyD1Migrations, env, type D1Migration } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "./create-app";
import * as schema from "./database/schema";
import { createAccessToken } from "./lib/auth";
import { createMediaRepository } from "./repositories/media";
import { createMediaVariantRepository } from "./repositories/media-variants";
import type { Env } from "./types";

const bindings = env as unknown as Env & {
  DB: Parameters<typeof applyD1Migrations>[0];
  TEST_MIGRATIONS: D1Migration[];
};
const app = createApp({
  config: { database: { migrations: { enabled: false } } },
});
const db = drizzle(bindings.DB, { schema });
const mediaRepo = createMediaRepository(db);
const variantRepo = createMediaVariantRepository(db);
const actorId = "user_media_deletion";
const sessionId = "session_media_deletion";
let token: string;

beforeAll(async () => {
  await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS);
  await db.insert(schema.users).values({
    id: actorId,
    email: "media-deletion@example.test",
  });
  await db.insert(schema.authSessions).values({
    id: sessionId,
    userId: actorId,
    token: "media-deletion-session-token",
    expiresAt: new Date(Date.now() + 60_000),
  });
  token = await createAccessToken(bindings.JWT_SECRET!, {
    sub: actorId,
    email: "media-deletion@example.test",
    roles: ["system.super-admin"],
    sid: sessionId,
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await bindings.DB.prepare(
    "DROP TRIGGER IF EXISTS block_media_deletion",
  ).run();
});

const seedMedia = async (id: string) => {
  const sourceKey = `media/${id}/source.png`;
  const variantKey = `media/variants/${id}/thumbnail.webp`;
  const variantId = `variant_${id}`;
  await mediaRepo.insert({
    id,
    groupId: id,
    url: sourceKey,
    name: "source.png",
    type: "image",
    mimeType: "image/png",
    size: 6,
    status: "published",
    updatedBy: actorId,
  });
  await variantRepo.insert({
    id: variantId,
    mediaId: id,
    templateKey: "thumbnail",
    url: variantKey,
    provider: "frontend",
    status: "succeeded",
    mimeType: "image/webp",
  });
  await bindings.R2.put(sourceKey, "source");
  await bindings.R2.put(variantKey, "variant");
  return { sourceKey, variantKey, variantId };
};

const deleteMedia = (id: string, bucket = bindings.R2) =>
  app.request(
    `/api/admin/media/${id}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
    { ...bindings, R2: bucket },
  );

describe("media deletion with local D1 and R2", () => {
  it("cascades variant records and removes both stored objects", async () => {
    const id = "media_delete_success";
    const { sourceKey, variantKey, variantId } = await seedMedia(id);
    expect((await deleteMedia(id)).status).toBe(204);
    expect(await mediaRepo.findById(id)).toBeNull();
    expect(await variantRepo.findById(variantId)).toBeNull();
    expect(await bindings.R2.get(sourceKey)).toBeNull();
    expect(await bindings.R2.get(variantKey)).toBeNull();
  });

  it("keeps both records and objects when D1 rejects deletion", async () => {
    const id = "media_delete_db_failure";
    const { sourceKey, variantKey, variantId } = await seedMedia(id);
    await bindings.DB.prepare(
      `CREATE TRIGGER block_media_deletion BEFORE DELETE ON media
       BEGIN SELECT RAISE(ABORT, 'injected deletion failure'); END`,
    ).run();
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await deleteMedia(id)).status).toBe(500);
    expect(await mediaRepo.findById(id)).not.toBeNull();
    expect(await variantRepo.findById(variantId)).not.toBeNull();
    expect(await bindings.R2.get(sourceKey)).not.toBeNull();
    expect(await bindings.R2.get(variantKey)).not.toBeNull();
  });

  it("blocks delivery of retained objects after R2 cleanup fails", async () => {
    const id = "media_delete_r2_failure";
    const { sourceKey, variantKey, variantId } = await seedMedia(id);
    const failingBucket = {
      put: bindings.R2.put.bind(bindings.R2),
      get: vi.fn(bindings.R2.get.bind(bindings.R2)),
      delete: vi.fn(async () => {
        throw new Error("R2 unavailable");
      }),
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await deleteMedia(id, failingBucket)).status).toBe(204);
    expect(await mediaRepo.findById(id)).toBeNull();
    expect(await variantRepo.findById(variantId)).toBeNull();
    expect(await bindings.R2.get(sourceKey)).not.toBeNull();
    expect(await bindings.R2.get(variantKey)).not.toBeNull();

    for (const path of [
      `/api/admin/media/${id}/file`,
      `/api/admin/media-variants/${variantId}/file`,
    ]) {
      const response = await app.request(
        path,
        {},
        { ...bindings, R2: failingBucket },
      );
      expect(response.status).toBe(404);
    }
    expect(failingBucket.get).not.toHaveBeenCalled();
    expect(failingBucket.delete).toHaveBeenCalledTimes(2);
  });
});
