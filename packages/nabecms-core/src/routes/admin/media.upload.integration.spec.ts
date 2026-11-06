import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
  type MockInstance,
} from "vitest";
import { createApp } from "../../create-app";
import * as authLib from "../../lib/auth";
import * as mediaRepository from "../../repositories/media";
import * as mediaVariantRepository from "../../repositories/media-variants";
import * as settingsRepository from "../../repositories/settings";
import * as userRepository from "../../repositories/users";

const app = createApp();

describe("admin media routes integration", () => {
  const env = {
    DB: {} as any,
    R2: { put: vi.fn(), get: vi.fn(), delete: vi.fn() } as any,
    WORKER_ENV: "test" as const,
    JWT_SECRET: "test-secret",
    ASSETS: { fetch: vi.fn() },
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    env.R2.put = vi.fn().mockResolvedValue(undefined);
    env.R2.get = vi.fn();
    env.R2.delete = vi.fn();
    vi.spyOn(authLib, "verifyAccessToken").mockResolvedValue({
      sub: "user_123",
      sid: "sess_test",
      roles: ["system.super-admin"],
    } as any);
    vi.spyOn(settingsRepository, "createSettingsRepository").mockReturnValue({
      findByKey: vi.fn().mockResolvedValue(null),
      upsert: vi.fn(),
    } as any);
    vi.spyOn(
      mediaVariantRepository,
      "createMediaVariantRepository",
    ).mockReturnValue({
      insert: vi.fn(),
      insertMany: vi.fn(),
      findById: vi.fn(),
      findByMediaIdAndTemplateKey: vi.fn(),
      list: vi.fn(),
      updateById: vi.fn(),
    } as any);
  });

  it("stores uploaded files into R2 bucket", async () => {
    const repoInsert = vi.fn(async () => {});
    const repoFindById = vi.fn(async () => null);
    const repoFindByIds = vi.fn(async () => []);
    const repoList = vi.fn(async () => []);
    const repoCount = vi.fn(async () => 0);
    const repoUpdate = vi.fn(async () => {});
    const repoDelete = vi.fn(async () => {});

    vi.spyOn(mediaRepository, "createMediaRepository").mockReturnValue({
      insert: repoInsert,
      findById: repoFindById,
      findByIds: repoFindByIds,
      list: repoList,
      count: repoCount,
      updateById: repoUpdate,
      deleteById: repoDelete,
    } as any);

    vi.spyOn(userRepository, "createUserRepository").mockReturnValue({
      findManyByIds: vi.fn().mockResolvedValue([
        {
          id: "user_123",
          name: "Test User",
        },
      ]),
    } as any);

    const form = new FormData();
    form.append(
      "files[]",
      new Blob(
        [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
        { type: "image/png" },
      ),
      "photo.png",
    );

    const res = await app.request(
      "/api/admin/media",
      {
        method: "POST",
        body: form,
        headers: { Authorization: "Bearer token" },
      },
      env,
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(env.R2.put).toHaveBeenCalledTimes(1);
    expect(repoInsert).toHaveBeenCalledWith(
      expect.not.objectContaining({ locale: expect.anything() }),
    );

    const putCall = (
      env.R2.put as MockInstance<(...args: unknown[]) => unknown>
    ).mock.calls[0];
    const uploadedBody = putCall[1] as ArrayBuffer;
    expect(uploadedBody).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(uploadedBody)).toEqual(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });
});
