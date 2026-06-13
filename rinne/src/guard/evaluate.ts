import type { DefiAction, Gate, GuardRuleResult, ProviderEvidence } from "../core/guard-types.js";
import {
  computeGate,
  guardRules,
  loadAllowlists,
  type GuardAllowlists,
} from "./rules.js";

export interface EvaluateOptions {
  allowlists?: GuardAllowlists;
  now?: Date;
}

export interface GuardEvaluation {
  ruleResults: GuardRuleResult[];
  gate: Gate;
  summary: string;
}

// Pure, deterministic evaluation of one action against the rules that apply to
// it, given whatever live provider evidence was gathered. The gate and a human
// summary fall out of the rule results; nothing here fetches or guesses.
export function evaluateGuardRules(
  action: DefiAction,
  evidence: ProviderEvidence[],
  options: EvaluateOptions = {}
): GuardEvaluation {
  const allowlists = options.allowlists ?? loadAllowlists();
  const now = options.now ?? new Date();
  const ruleResults = guardRules
    .filter((rule) => rule.appliesTo.includes(action.kind))
    .map((rule) => rule.evaluate({ action, evidence, allowlists, now }));

  const gate = computeGate(ruleResults, evidence);
  return { ruleResults, gate, summary: summarize(action, gate, ruleResults, evidence) };
}

function summarize(
  action: DefiAction,
  gate: Gate,
  ruleResults: GuardRuleResult[],
  evidence: ProviderEvidence[]
): string {
  const failed = ruleResults.filter((rule) => rule.status === "fail");
  const providerErrors = evidence.filter((item) => item.status === "error");
  if (gate === "block") {
    const critical = failed.filter((rule) => rule.severity === "critical").map((rule) => rule.id);
    return `Blocked ${action.kind}: failed ${critical.join(", ")}.`;
  }
  if (gate === "review") {
    const reasons = [
      ...failed.filter((rule) => rule.severity === "warning").map((rule) => rule.id),
      ...providerErrors.map((item) => `${item.provider}-evidence-unavailable`),
    ];
    return `Needs review on ${action.kind}: ${reasons.join(", ")}.`;
  }
  return `Proceed: ${action.kind} passed all ${ruleResults.length} applicable guard rules.`;
}
