import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AuthFlowStateInsert,
  AuthFlowStateRecord,
  AuthFlowStatesRepository,
} from "../repositories/auth-flow-states";
import {
  consumeFlowState,
  createFlowState,
  FlowStateConsumedError,
  FlowStateExpiredError,
  FlowStateFlowMismatchError,
  FlowStateNotFoundError,
  FlowStateProviderMismatchError,
  resolveFlowState,
  type SsoFlowStateDeps,
} from "./sso-flow-states";

class MockAuthFlowStatesRepository implements AuthFlowStatesRepository {
  private records = new Map<string, AuthFlowStateRecord>();

  constructor(initial: AuthFlowStateRecord[] = []) {
    for (const item of initial) {
      this.records.set(item.id, item);
    }
  }

  async insert(flowState: AuthFlowStateInsert): Promise<void> {
    this.records.set(flowState.id, flowState as AuthFlowStateRecord);
  }

  async findById(id: string): Promise<AuthFlowStateRecord | null> {
    return this.records.get(id) ?? null;
  }

  async markConsumed(id: string, consumedAt: string): Promise<void> {
    const record = this.records.get(id);
    if (!record) return;
    this.records.set(id, { ...record, consumedAt });
  }
}

describe("sso flow states service", () => {
  const now = new Date("2026-01-01T10:00:00.000Z");

  let repo: MockAuthFlowStatesRepository;
  let deps: SsoFlowStateDeps;

  beforeEach(() => {
    repo = new MockAuthFlowStatesRepository();
    deps = {
      repo,
      now: () => now,
      generateId: () => "flow_123",
      hashToken: vi.fn(async (value: string) => `hash:${value}`),
    };
  });

  it("creates a flow state with invite token hash", async () => {
    const created = await createFlowState(deps, {
      flow: "invite",
      provider: "google",
      inviteToken: "invite-token",
      redirectSuccess: "/auth/invite/success",
    });

    expect(created.id).toBe("flow_123");
    expect(created.flow).toBe("invite");
    expect(created.provider).toBe("google");
    expect(created.inviteTokenHash).toBe("hash:invite-token");
    expect(created.expiresAt).toBe("2026-01-01T10:10:00.000Z");
  });

  it("throws when flow state is missing", async () => {
    await expect(
      resolveFlowState(deps, { id: "unknown" }),
    ).rejects.toBeInstanceOf(FlowStateNotFoundError);
  });

  it("throws when flow state is expired", async () => {
    repo = new MockAuthFlowStatesRepository([
      {
        id: "flow_expired",
        flow: "login",
        provider: "google",
        inviteTokenHash: null,
        defaultLocale: null,
        redirectSuccess: null,
        redirectError: null,
        expiresAt: "2026-01-01T09:59:00.000Z",
        consumedAt: null,
        createdAt: "2026-01-01T09:00:00.000Z",
      },
    ]);
    deps = { ...deps, repo };

    await expect(
      resolveFlowState(deps, { id: "flow_expired" }),
    ).rejects.toBeInstanceOf(FlowStateExpiredError);
  });

  it("throws when flow state is already consumed", async () => {
    repo = new MockAuthFlowStatesRepository([
      {
        id: "flow_done",
        flow: "login",
        provider: "google",
        inviteTokenHash: null,
        defaultLocale: null,
        redirectSuccess: null,
        redirectError: null,
        expiresAt: "2026-01-01T11:00:00.000Z",
        consumedAt: "2026-01-01T10:01:00.000Z",
        createdAt: "2026-01-01T09:00:00.000Z",
      },
    ]);
    deps = { ...deps, repo };

    await expect(
      resolveFlowState(deps, { id: "flow_done" }),
    ).rejects.toBeInstanceOf(FlowStateConsumedError);
  });

  it("throws when provider or flow does not match", async () => {
    repo = new MockAuthFlowStatesRepository([
      {
        id: "flow_1",
        flow: "invite",
        provider: "google",
        inviteTokenHash: null,
        defaultLocale: null,
        redirectSuccess: null,
        redirectError: null,
        expiresAt: "2026-01-01T11:00:00.000Z",
        consumedAt: null,
        createdAt: "2026-01-01T09:00:00.000Z",
      },
    ]);
    deps = { ...deps, repo };

    await expect(
      resolveFlowState(deps, { id: "flow_1", provider: "discord" }),
    ).rejects.toBeInstanceOf(FlowStateProviderMismatchError);
    await expect(
      resolveFlowState(deps, { id: "flow_1", flow: "login" }),
    ).rejects.toBeInstanceOf(FlowStateFlowMismatchError);
  });

  it("consumes flow state", async () => {
    repo = new MockAuthFlowStatesRepository([
      {
        id: "flow_1",
        flow: "initialize",
        provider: "google",
        inviteTokenHash: null,
        defaultLocale: "ja",
        redirectSuccess: "/auth/initialize/success",
        redirectError: "/auth/initialize/error",
        expiresAt: "2026-01-01T11:00:00.000Z",
        consumedAt: null,
        createdAt: "2026-01-01T09:00:00.000Z",
      },
    ]);
    deps = { ...deps, repo };

    const consumed = await consumeFlowState(deps, {
      id: "flow_1",
      provider: "google",
      flow: "initialize",
    });

    expect(consumed.consumedAt).toBe("2026-01-01T10:00:00.000Z");
  });
});
