// Typed client for the Rinne API (rinne serve). The dashboard observes the
// hosted guard: it reads agents and decisions over the public /api/* endpoints.
// Agents register and guard themselves over /v1 directly — the dashboard never
// mutates, so there is no registerAgent client here.

import type { GuardDecision, Gate, RegisteredAgentView } from "./guard-types";

export type { GuardDecision, Gate, RegisteredAgentView } from "./guard-types";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ApiError(`Unexpected response from ${path} (HTTP ${response.status})`, response.status);
  }
  if (!response.ok) {
    const message = (body as { error?: string }).error ?? `HTTP ${response.status}`;
    throw new ApiError(message, response.status);
  }
  return body as T;
}

export function listAgents(): Promise<{ agents: RegisteredAgentView[] }> {
  return request("/api/agents");
}

export function getAgent(
  agentId: string
): Promise<{ agent: RegisteredAgentView; decisions: GuardDecision[] }> {
  return request(`/api/agents/${encodeURIComponent(agentId)}`);
}

export function listDecisions(agentId?: string): Promise<{ decisions: GuardDecision[] }> {
  const query = agentId ? `?agentId=${encodeURIComponent(agentId)}` : "";
  return request(`/api/decisions${query}`);
}

export function getDecision(decisionId: string): Promise<GuardDecision> {
  return request(`/api/decisions/${encodeURIComponent(decisionId)}`);
}

export const GATE_LABELS: Record<Gate, string> = {
  proceed: "Proceed",
  block: "Block",
  review: "Review",
};
