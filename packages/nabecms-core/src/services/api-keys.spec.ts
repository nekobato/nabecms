import { describe, it, expect, beforeEach } from "vitest";
import {
  createApiKey,
  rotateApiKey,
  revokeApiKey,
  updateApiKey,
  ApiKeyNotFoundError,
  ApiKeyConflictError,
  ApiKeyValidationError,
} from "./api-keys";
import type { ApiKeyRepository, ApiKeyRecord } from "../repositories/api-keys";
import { sha256Hex } from "../lib/auth";

class MemoryRepo implements ApiKeyRepository {
  data: ApiKeyRecord[] = [];

  async list() {
    return [...this.data];
  }

  async findById(id: string) {
    return this.data.find((k) => k.id === id) ?? null;
  }

  async findByKeyHash(keyHash: string) {
    return this.data.find((k) => k.keyHash === keyHash) ?? null;
  }

  async insert(record: ApiKeyRecord) {
    this.data.push(record);
  }

  async updateById(id: string, values: Partial<ApiKeyRecord>) {
    const index = this.data.findIndex((k) => k.id === id);
    if (index === -1) return;
    this.data[index] = { ...this.data[index], ...values } as ApiKeyRecord;
  }

  async deleteById(id: string) {
    this.data = this.data.filter((k) => k.id !== id);
  }
}

describe("api-keys service", () => {
  let repo: MemoryRepo;
  const now = new Date("2025-01-01T00:00:00Z");

  beforeEach(() => {
    repo = new MemoryRepo();
  });

  it("creates api key with hashed secret", async () => {
    const deps = {
      repo,
      now: () => now,
      generateId: () => "apiKey_1",
    } as const;
    const { key, secret } = await createApiKey(deps, {
      actorId: "user_1",
      name: "SDK",
      permissions: ["contents:read"],
    });
    expect(key.id).toBe("apiKey_1");
    expect(key.permissions).toContain("contents:read");
    const stored = await repo.findById("apiKey_1");
    expect(stored?.keyHash).toBe(await sha256Hex(secret));
    expect(stored?.key).toBe(stored?.keyHash); // legacy column
    expect(stored?.createdBy).toBe("user_1");
  });

  it("rejects api key without explicit permissions", async () => {
    const deps = {
      repo,
      now: () => now,
      generateId: () => "apiKey_1",
    } as const;

    await expect(
      createApiKey(deps, {
        actorId: "user_1",
        name: "SDK",
        permissions: [],
      }),
    ).rejects.toBeInstanceOf(ApiKeyValidationError);
  });

  it("rotates api key and returns new secret", async () => {
    const deps = {
      repo,
      now: () => now,
      generateId: () => "apiKey_1",
    } as const;
    const first = await createApiKey(deps, {
      actorId: "user_1",
      name: "SDK",
      permissions: ["contents:read"],
    });
    const prevHash = (await repo.findById(first.key.id))?.keyHash;
    const rotated = await rotateApiKey(deps, first.key.id, "user_1");
    const stored = await repo.findById(first.key.id);
    expect(stored?.keyHash).not.toBe(prevHash);
    expect(stored?.keyHash).toBe(await sha256Hex(rotated.secret));
  });

  it("rejects rotating a revoked api key", async () => {
    const deps = {
      repo,
      now: () => now,
      generateId: () => "apiKey_1",
    } as const;
    const created = await createApiKey(deps, {
      actorId: "user_1",
      name: "SDK",
      permissions: ["contents:read"],
    });
    const revoked = await revokeApiKey(deps, created.key.id, "user_1");
    const storedBeforeRotate = await repo.findById(created.key.id);

    await expect(
      rotateApiKey(deps, revoked.id, "user_1"),
    ).rejects.toBeInstanceOf(ApiKeyConflictError);

    const storedAfterRotate = await repo.findById(created.key.id);
    expect(storedAfterRotate?.keyHash).toBe(storedBeforeRotate?.keyHash);
    expect(storedAfterRotate?.isRevoked).toBe(true);
    expect(storedAfterRotate?.revokedBy).toBe("user_1");
    expect(storedAfterRotate?.revokedAt).toBe(now.toISOString());
  });

  it("revokes api key", async () => {
    const deps = {
      repo,
      now: () => now,
      generateId: () => "apiKey_1",
    } as const;
    const created = await createApiKey(deps, {
      actorId: "user_1",
      name: "SDK",
      permissions: ["contents:read"],
    });
    expect(created.key.isRevoked).toBe(false);
    const revoked = await revokeApiKey(deps, created.key.id, "user_1");
    expect(revoked.isRevoked).toBe(true);
    expect(revoked.revokedBy).toBe("user_1");
    expect(revoked.revokedAt).toBe(now.toISOString());
  });

  it("updates name, permissions, and allowed models", async () => {
    const deps = {
      repo,
      now: () => now,
      generateId: () => "apiKey_1",
    } as const;
    await createApiKey(deps, {
      actorId: "user_1",
      name: "SDK",
      permissions: ["contents:read"],
    });
    const updated = await updateApiKey(deps, "apiKey_1", {
      name: "Mobile",
      permissions: ["contents:manage"],
      allowedModels: ["blog"],
    });
    expect(updated.name).toBe("Mobile");
    expect(updated.permissions).toEqual(["contents:manage"]);
    expect(updated.allowedModels).toEqual(["blog"]);
  });

  it("updates revoked api key metadata without reactivating it", async () => {
    const deps = {
      repo,
      now: () => now,
      generateId: () => "apiKey_1",
    } as const;
    await createApiKey(deps, {
      actorId: "user_1",
      name: "SDK",
      permissions: ["contents:read"],
    });
    await revokeApiKey(deps, "apiKey_1", "user_1");

    const updated = await updateApiKey(deps, "apiKey_1", {
      name: "Mobile",
    });

    expect(updated.name).toBe("Mobile");
    expect(updated.isRevoked).toBe(true);
    expect(updated.revokedBy).toBe("user_1");
    expect(updated.revokedAt).toBe(now.toISOString());
  });

  it("throws on missing id", async () => {
    const deps = {
      repo,
      now: () => now,
      generateId: () => "apiKey_1",
    } as const;
    await expect(
      revokeApiKey(deps, "missing" as string, "user_1"),
    ).rejects.toBeInstanceOf(ApiKeyNotFoundError);
  });
});
