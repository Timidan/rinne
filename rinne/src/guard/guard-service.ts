import type {
  AgentStatus,
  DefiAction,
  GuardDecision,
  GuardRequest,
  ProviderEvidence,
  RegisteredAgent,
} from "../core/guard-types.js";
import type { GuardStore } from "../core/guard-store.js";
import { hashJson, newDecisionId } from "../core/ids.js";
import { evaluateGuardRules } from "./evaluate.js";
import { isAllowlisted, loadAllowlists, type GuardAllowlists } from "./rules.js";
import { fetchSurfMarketEvidence } from "../providers/surf-live.js";
import { fetchNansenRiskEvidence } from "../providers/nansen-live.js";

// Orchestrates one guard decision end to end: gather the live provider evidence
// the action calls for, evaluate the deterministic rules against it, assemble a
// content-hashed GuardDecision, and persist it. Evidence fetchers are injected
// so tests can drive the full path with controllable provider responses without
// ever mocking inside the product code.

export interface GuardServiceDeps {
  store: GuardStore;
  fetchSurf?: typeof fetchSurfMarketEvidence;
  fetchNansen?: typeof fetchNansenRiskEvidence;
  allowlists?: GuardAllowlists;
  now?: () => Date;
}

// Gathers the provider evidence a given action requires. Swap decisions get
// Surf market evidence; approval and lending decisions get Nansen risk evidence
// for the spender/protocol address — UNLESS that address is operator-
// allowlisted, in which case the operator has already verified it and a Nansen
// round-trip would only add a failure mode (an unreachable Nansen would push an
// already-verified action to review). A provider failure for an un-allowlisted
// address returns an error evidence record (never canned data), which the rule
// layer turns into review.
export async function gatherEvidence(
  action: DefiAction,
  deps: GuardServiceDeps,
  allowlists: GuardAllowlists
): Promise<ProviderEvidence[]> {
  const surf = deps.fetchSurf ?? fetchSurfMarketEvidence;
  const nansen = deps.fetchNansen ?? fetchNansenRiskEvidence;

  if (action.kind === "swap") {
    return [await surf({ tokenIn: action.tokenIn, tokenOut: action.tokenOut, chain: action.chain })];
  }
  if (action.kind === "approval") {
    if (isAllowlisted(allowlists.spenders[action.chain] ?? [], action.spender)) return [];
    return [await nansen({ chain: action.chain, address: action.spender, purpose: "spender-risk" })];
  }
  // lending
  if (isAllowlisted(allowlists.protocols[action.chain] ?? [], action.protocol)) return [];
  return [await nansen({ chain: action.chain, address: action.protocol, purpose: "protocol-risk" })];
}

export async function runGuard(
  request: GuardRequest,
  deps: GuardServiceDeps
): Promise<GuardDecision> {
  const now = deps.now ?? (() => new Date());
  const allowlists = deps.allowlists ?? loadAllowlists();
  const evidence = await gatherEvidence(request.action, deps, allowlists);
  const evaluation = evaluateGuardRules(request.action, evidence, { allowlists, now: now() });

  const createdAt = now().toISOString();
  const decisionId = newDecisionId();
  // The report hash covers exactly what produced the gate, so anyone can
  // recompute it from the stored decision and verify nothing was altered.
  const reportHash = hashJson({
    action: request.action,
    providerEvidence: evidence,
    ruleResults: evaluation.ruleResults,
    gate: evaluation.gate,
  });

  const decision: GuardDecision = {
    schemaVersion: "rinne.guard-decision.v1",
    decisionId,
    agentId: request.agentId,
    createdAt,
    gate: evaluation.gate,
    action: request.action,
    providerEvidence: evidence,
    ruleResults: evaluation.ruleResults,
    summary: evaluation.summary,
    reportHash,
  };

  await deps.store.saveDecision(decision);
  return decision;
}

// Public view of an agent for the dashboard: the registry record minus its API
// key hash, plus a derived status and decision counters. Status is derived from
// recency of activity, not from pinging the endpoint (the MVP does not call
// agents unsolicited).
export interface RegisteredAgentView {
  id: string;
  name: string;
  owner: RegisteredAgent["owner"];
  endpointUrl?: string;
  supportedActions: RegisteredAgent["supportedActions"];
  guardMode: RegisteredAgent["guardMode"];
  createdAt: string;
  updatedAt: string;
  lastSeenAt?: string;
  status: AgentStatus;
  counters: { total: number; proceeded: number; blocked: number; review: number };
}

const HEALTHY_WINDOW_MS = 60 * 60 * 1000; // seen within an hour
const QUIET_WINDOW_MS = 24 * 60 * 60 * 1000; // seen within a day

export function deriveAgentStatus(agent: RegisteredAgent, now: Date): AgentStatus {
  if (!agent.lastSeenAt) return "offline";
  const age = now.getTime() - Date.parse(agent.lastSeenAt);
  if (!Number.isFinite(age)) return "offline";
  if (age <= HEALTHY_WINDOW_MS) return "healthy";
  if (age <= QUIET_WINDOW_MS) return "quiet";
  return "offline";
}

export function buildAgentView(
  agent: RegisteredAgent,
  decisions: GuardDecision[],
  now: Date
): RegisteredAgentView {
  const mine = decisions.filter((decision) => decision.agentId === agent.id);
  const counters = {
    total: mine.length,
    proceeded: mine.filter((decision) => decision.gate === "proceed").length,
    blocked: mine.filter((decision) => decision.gate === "block").length,
    review: mine.filter((decision) => decision.gate === "review").length,
  };
  const view: RegisteredAgentView = {
    id: agent.id,
    name: agent.name,
    owner: agent.owner,
    supportedActions: agent.supportedActions,
    guardMode: agent.guardMode,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
    status: deriveAgentStatus(agent, now),
    counters,
  };
  if (agent.endpointUrl !== undefined) view.endpointUrl = agent.endpointUrl;
  if (agent.lastSeenAt !== undefined) view.lastSeenAt = agent.lastSeenAt;
  return view;
}
