import type { ApprovalAction, GuardRuleResult } from "../../core/guard-types.js";
import { isAllowlisted, type GuardRule, type GuardRuleContext } from "../rules.js";
import { detectHighRiskLabel } from "../../providers/risk-signal.js";

// Approval guard rules. Two gate on pure math (an unlimited or oversized
// allowance is dangerous regardless of who the spender is). The spender-risk
// rule reads Nansen evidence under a conservative posture: an explicit
// high-risk label blocks; an operator-allowlisted spender proceeds; everything
// else — a provider error, OR an unrecognized spender with no positive trust
// signal — is sent to review. Absence of a risk label is not proof of safety.

// 2^256 - 1, the canonical "infinite approval" sentinel.
const MAX_UINT256 = (1n << 256n) - 1n;
// Above this many human token units an approval is treated as effectively
// unlimited even if it is not the exact max-uint sentinel.
const ABSURD_HUMAN_UNITS = 1_000_000_000_000_000; // 1e15

function asApproval(ctx: GuardRuleContext): ApprovalAction | null {
  return ctx.action.kind === "approval" ? ctx.action : null;
}

// Compares a plain decimal amount string against the max-uint sentinel without
// losing precision for integer inputs; falls back to float magnitude for
// fractional ones (which are never anywhere near the sentinel anyway).
function isUnlimited(amount: string): boolean {
  if (/^\d+$/.test(amount)) {
    try {
      return BigInt(amount) >= MAX_UINT256;
    } catch {
      return false;
    }
  }
  return Number(amount) >= Number(MAX_UINT256);
}

const noUnlimited: GuardRule = {
  id: "approval-no-unlimited",
  appliesTo: ["approval"],
  evaluate(ctx): GuardRuleResult {
    const approval = asApproval(ctx);
    if (!approval) {
      return notApplicable("approval-no-unlimited", "Action is not an approval.");
    }
    const numeric = Number(approval.amount);
    if (isUnlimited(approval.amount) || numeric >= ABSURD_HUMAN_UNITS) {
      return {
        id: "approval-no-unlimited",
        status: "fail",
        severity: "critical",
        explanation:
          `The approval grants ${approval.amount} ${approval.token.symbol}, an effectively unlimited ` +
          "allowance. A compromised or malicious spender could drain the whole balance. Approve only what the action needs.",
        evidence: { amount: approval.amount, token: approval.token.symbol, maxUint: MAX_UINT256.toString() },
      };
    }
    return {
      id: "approval-no-unlimited",
      status: "pass",
      severity: "info",
      explanation: `The approval is bounded at ${approval.amount} ${approval.token.symbol}.`,
      evidence: { amount: approval.amount, token: approval.token.symbol },
    };
  },
};

const amountLimit: GuardRule = {
  id: "approval-amount-limit",
  appliesTo: ["approval"],
  evaluate(ctx): GuardRuleResult {
    const approval = asApproval(ctx);
    if (!approval) {
      return notApplicable("approval-amount-limit", "Action is not an approval.");
    }
    const thresholds = ctx.allowlists.approvalAmountThreshold;
    const limitStr = thresholds.perToken[approval.token.symbol] ?? thresholds.default;
    const limit = Number(limitStr);
    const amount = Number(approval.amount);
    if (Number.isFinite(limit) && amount > limit) {
      return {
        id: "approval-amount-limit",
        status: "fail",
        severity: "warning",
        explanation:
          `The approval of ${approval.amount} ${approval.token.symbol} exceeds the operator's ` +
          `${limitStr} ${approval.token.symbol} display threshold. A human should confirm the size is intended.`,
        evidence: { amount: approval.amount, threshold: limitStr, token: approval.token.symbol },
      };
    }
    return {
      id: "approval-amount-limit",
      status: "pass",
      severity: "info",
      explanation: `The approval of ${approval.amount} ${approval.token.symbol} is within the ${limitStr} threshold.`,
      evidence: { amount: approval.amount, threshold: limitStr, token: approval.token.symbol },
    };
  },
};

const spenderRisk: GuardRule = {
  id: "approval-spender-risk",
  appliesTo: ["approval"],
  evaluate(ctx): GuardRuleResult {
    const approval = asApproval(ctx);
    if (!approval) {
      return notApplicable("approval-spender-risk", "Action is not an approval.");
    }
    const allowlisted = isAllowlisted(ctx.allowlists.spenders[approval.chain] ?? [], approval.spender);
    if (allowlisted) {
      return {
        id: "approval-spender-risk",
        status: "pass",
        severity: "info",
        explanation: `Spender is operator-allowlisted as "${allowlisted.name}" (${allowlisted.source}).`,
        evidence: { spender: approval.spender, allowlisted: allowlisted.name, source: allowlisted.source },
      };
    }
    const nansen = ctx.evidence.find(
      (item) => item.provider === "nansen" && item.purpose === "spender-risk"
    );
    if (nansen?.status === "error") {
      return {
        id: "approval-spender-risk",
        status: "fail",
        severity: "warning",
        explanation:
          `Nansen risk data for the spender could not be fetched (${nansen.error ?? "unknown error"}). ` +
          "The spender is not allowlisted, so a human should confirm it.",
        evidence: { spender: approval.spender, provider: "nansen", status: "error", error: nansen.error ?? null },
      };
    }
    const highRisk = nansen ? detectHighRiskLabel(nansen.data) : null;
    if (highRisk) {
      return {
        id: "approval-spender-risk",
        status: "fail",
        severity: "critical",
        explanation:
          `Nansen flags the spender as high risk (${highRisk}). Do not approve this address.`,
        // Provider data spread first so the rule's own authoritative fields
        // (the label that actually triggered the block) win on any key clash.
        evidence: { ...nansen?.data, spender: approval.spender, provider: "nansen", riskLabel: highRisk },
      };
    }
    // Conservative posture: the spender is NOT operator-allowlisted, and the
    // absence of a high-risk label is not positive proof of safety — a
    // brand-new malicious contract simply has no labels yet. An unrecognized
    // first-time counterparty is sent to review, never silently approved.
    return {
      id: "approval-spender-risk",
      status: "fail",
      severity: "warning",
      explanation: nansen
        ? `The spender ${approval.spender} is not operator-allowlisted and Nansen returned no high-risk label. ` +
          "An unrecognized counterparty with no positive trust signal should be confirmed by a human before approval."
        : `No spender-risk evidence is available and ${approval.spender} is not operator-allowlisted; ` +
          "a human should confirm this counterparty before approval.",
      evidence: { ...(nansen?.data ?? {}), spender: approval.spender, provider: nansen ? "nansen" : null, allowlisted: false },
    };
  },
};

function notApplicable(id: string, explanation: string): GuardRuleResult {
  return { id, status: "not-applicable", severity: "info", explanation, evidence: {} };
}

export const approvalRules: GuardRule[] = [noUnlimited, amountLimit, spenderRisk];
