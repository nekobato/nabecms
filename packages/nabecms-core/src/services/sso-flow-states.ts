import type {
  AuthFlowStateInsert,
  AuthFlowStateRecord,
  AuthFlowStatesRepository,
} from "../repositories/auth-flow-states";

export const SSO_FLOWS = ["login", "initialize", "invite"] as const;
export type SsoFlow = (typeof SSO_FLOWS)[number];

const FLOW_STATE_TTL_MS = 10 * 60 * 1000;

export class FlowStateNotFoundError extends Error {
  constructor() {
    super("Flow state not found");
    this.name = "FlowStateNotFoundError";
  }
}

export class FlowStateExpiredError extends Error {
  constructor() {
    super("Flow state expired");
    this.name = "FlowStateExpiredError";
  }
}

export class FlowStateConsumedError extends Error {
  constructor() {
    super("Flow state already consumed");
    this.name = "FlowStateConsumedError";
  }
}

export class FlowStateProviderMismatchError extends Error {
  constructor() {
    super("Flow state provider mismatch");
    this.name = "FlowStateProviderMismatchError";
  }
}

export class FlowStateFlowMismatchError extends Error {
  constructor() {
    super("Flow state flow mismatch");
    this.name = "FlowStateFlowMismatchError";
  }
}

export type SsoFlowStateDeps = {
  repo: AuthFlowStatesRepository;
  now: () => Date;
  generateId: (prefix: "flow") => string;
  hashToken: (token: string) => Promise<string>;
};

export const isSsoFlow = (value: string): value is SsoFlow =>
  (SSO_FLOWS as readonly string[]).includes(value);

export async function createFlowState(
  deps: SsoFlowStateDeps,
  params: {
    flow: SsoFlow;
    provider: string;
    inviteToken?: string;
    defaultLocale?: string;
    redirectSuccess?: string;
    redirectError?: string;
  },
): Promise<AuthFlowStateRecord> {
  const now = deps.now();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + FLOW_STATE_TTL_MS).toISOString();

  const inviteTokenHash = params.inviteToken
    ? await deps.hashToken(params.inviteToken)
    : null;

  const record: AuthFlowStateInsert = {
    id: deps.generateId("flow"),
    flow: params.flow,
    provider: params.provider,
    inviteTokenHash,
    defaultLocale: params.defaultLocale ?? null,
    redirectSuccess: params.redirectSuccess ?? null,
    redirectError: params.redirectError ?? null,
    expiresAt,
    consumedAt: null,
    createdAt,
  };

  await deps.repo.insert(record);

  return record as AuthFlowStateRecord;
}

export async function resolveFlowState(
  deps: SsoFlowStateDeps,
  params: {
    id: string;
    provider?: string;
    flow?: SsoFlow;
  },
): Promise<AuthFlowStateRecord> {
  const state = await deps.repo.findById(params.id);
  if (!state) {
    throw new FlowStateNotFoundError();
  }

  if (params.provider && state.provider !== params.provider) {
    throw new FlowStateProviderMismatchError();
  }

  if (params.flow && state.flow !== params.flow) {
    throw new FlowStateFlowMismatchError();
  }

  if (state.consumedAt) {
    throw new FlowStateConsumedError();
  }

  const nowMs = deps.now().getTime();
  const expiresMs = new Date(state.expiresAt).getTime();
  if (expiresMs <= nowMs) {
    throw new FlowStateExpiredError();
  }

  return state;
}

export async function consumeFlowState(
  deps: SsoFlowStateDeps,
  params: {
    id: string;
    provider?: string;
    flow?: SsoFlow;
  },
): Promise<AuthFlowStateRecord> {
  const state = await resolveFlowState(deps, params);
  const consumedAt = deps.now().toISOString();
  await deps.repo.markConsumed(state.id, consumedAt);

  return {
    ...state,
    consumedAt,
  };
}
