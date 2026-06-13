// Public types for the hosted guard surface: registered agents, generic DeFi
// actions, guard decisions, rule results, and provider evidence. These are
// the JSON shapes agents integrate against (docs/agents/SKILL.md); keep them
// plain and JSON-first — no SDK required.

export type ActionKind = "swap" | "approval" | "lending";
export type Gate = "proceed" | "block" | "review";
export type GuardMode = "observe" | "enforce";
export type AgentStatus = "healthy" | "quiet" | "offline" | "error";

export interface RegisteredAgent {
  id: string;
  name: string;
  owner: {
    kind: "email" | "wallet" | "manual";
    value: string;
  };
  endpointUrl?: string;
  supportedActions: ActionKind[];
  guardMode: GuardMode;
  // SHA-256 hash of the agent's API key. The plaintext key is returned once
  // at registration and never persisted anywhere.
  apiKeyHash: string;
  createdAt: string;
  updatedAt: string;
  lastSeenAt?: string;
}

export interface TokenRef {
  symbol: string;
  address?: string;
  decimals: number;
}

export interface QuoteContext {
  // Where the agent's quote came from and when, so freshness is checkable.
  source?: string;
  quotedAt?: string;
  price?: string;
}

// The chains an action may target. "mantle" is Mantle mainnet (chainId 5000);
// "mantle-sepolia" is the Mantle Sepolia testnet (chainId 5003), where an
// agent can guard and then execute a real swap with test funds.
export type Chain = "mantle" | "mantle-sepolia";

export interface SwapAction {
  kind: "swap";
  chain: Chain;
  tokenIn: TokenRef;
  tokenOut: TokenRef;
  amountIn: string;
  expectedOut?: string;
  minReceived?: string;
  maxSlippageBps?: number;
  quote?: QuoteContext;
}

export interface ApprovalAction {
  kind: "approval";
  chain: Chain;
  token: TokenRef;
  spender: string;
  amount: string;
  currentAllowance?: string;
  reason?: string;
}

export interface LendingAction {
  kind: "lending";
  chain: Chain;
  protocol: string;
  operation: "supply" | "withdraw" | "borrow" | "repay";
  asset: TokenRef;
  amount: string;
  healthFactorBefore?: string;
  healthFactorAfter?: string;
  liquidationThresholdBps?: number;
}

export type DefiAction = SwapAction | ApprovalAction | LendingAction;

export interface GuardContext {
  // Optional caller-supplied context recorded with the decision.
  walletAddress?: string;
  dryRun?: boolean;
  note?: string;
}

export interface GuardRequest {
  schemaVersion: "rinne.guard-request.v1";
  agentId: string;
  action: DefiAction;
  context?: GuardContext;
  metadata?: Record<string, unknown>;
}

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
  schemaVersion: "rinne.guard-decision.v1";
  decisionId: string;
  agentId: string;
  createdAt: string;
  gate: Gate;
  action: DefiAction;
  providerEvidence: ProviderEvidence[];
  ruleResults: GuardRuleResult[];
  summary: string;
  reportHash: string;
  onchain?: {
    chainId: number;
    txHash?: string;
    registryAddress?: string;
  };
}

export interface CreateAgentInput {
  name: string;
  owner: RegisteredAgent["owner"];
  endpointUrl?: string;
  supportedActions: ActionKind[];
  guardMode: GuardMode;
}
