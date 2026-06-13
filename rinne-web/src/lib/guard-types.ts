// Dashboard-side mirror of the engine's guard types (rinne/src/core/guard-types.ts).
// Kept as a plain copy so the web app has no build-time dependency on the engine.

export type ActionKind = "swap" | "approval" | "lending";
export type Gate = "proceed" | "block" | "review";
export type GuardMode = "observe" | "enforce";
export type AgentStatus = "healthy" | "quiet" | "offline" | "error";

export interface RegisteredAgentView {
  id: string;
  name: string;
  owner: { kind: "email" | "wallet" | "manual"; value: string };
  endpointUrl?: string;
  supportedActions: ActionKind[];
  guardMode: GuardMode;
  createdAt: string;
  updatedAt: string;
  lastSeenAt?: string;
  // Derived by the server from lastSeenAt and the latest decision.
  status: AgentStatus;
  counters: {
    total: number;
    proceeded: number;
    blocked: number;
    review: number;
  };
}

export interface TokenRef {
  symbol: string;
  address?: string;
  decimals: number;
}

export interface SwapAction {
  kind: "swap";
  chain: "mantle";
  tokenIn: TokenRef;
  tokenOut: TokenRef;
  amountIn: string;
  expectedOut?: string;
  minReceived?: string;
  maxSlippageBps?: number;
  quote?: { source?: string; quotedAt?: string; price?: string };
}

export interface ApprovalAction {
  kind: "approval";
  chain: "mantle";
  token: TokenRef;
  spender: string;
  amount: string;
  currentAllowance?: string;
  reason?: string;
}

export interface LendingAction {
  kind: "lending";
  chain: "mantle";
  protocol: string;
  operation: "supply" | "withdraw" | "borrow" | "repay";
  asset: TokenRef;
  amount: string;
  healthFactorBefore?: string;
  healthFactorAfter?: string;
  liquidationThresholdBps?: number;
}

export type DefiAction = SwapAction | ApprovalAction | LendingAction;

export interface GuardRuleResult {
  id: string;
  status: "pass" | "fail" | "not-applicable";
  severity: "info" | "warning" | "critical";
  explanation: string;
  evidence: Record<string, unknown>;
}

export interface ProviderEvidence {
  provider: "surf" | "nansen";
  status: "live" | "error";
  purpose: "market-signal" | "spender-risk" | "protocol-risk";
  fetchedAt: string;
  payloadHash?: string;
  summary: string;
  error?: string;
  data?: Record<string, unknown>;
}

export interface GuardDecision {
  schemaVersion: string;
  decisionId: string;
  agentId: string;
  createdAt: string;
  gate: Gate;
  action: DefiAction;
  providerEvidence: ProviderEvidence[];
  ruleResults: GuardRuleResult[];
  summary: string;
  reportHash: string;
  onchain?: { chainId: number; txHash?: string; registryAddress?: string };
}

export interface RegisterAgentInput {
  name: string;
  owner: { kind: "email" | "wallet" | "manual"; value: string };
  endpointUrl?: string;
  supportedActions: ActionKind[];
  guardMode: GuardMode;
}

export interface RegisterAgentResponse {
  agent: RegisteredAgentView;
  // Shown exactly once; the server stores only a hash.
  apiKey: string;
}
