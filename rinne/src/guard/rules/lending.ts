import type { GuardRuleResult, LendingAction } from "../../core/guard-types.js";
import { isAllowlisted, type GuardRule, type GuardRuleContext } from "../rules.js";
import { detectHighRiskLabel } from "../../providers/risk-signal.js";
import { parseDecimal } from "../../core/decimal.js";

// Lending guard rules. The health-factor rules gate on pure math — a post-action
// health factor below the safety margin blocks regardless of provider data — so
// the most dangerous lending mistake (borrowing into liquidation range) is caught
// even without Nansen. The protocol-risk rule mirrors the approval spender rule's
// "minimize reviews" posture.

// Borrowing or withdrawing down to a health factor this low is one adverse
// price tick from liquidation; block below it.
const MIN_HEALTH_FACTOR = "1.25";
// Compare health factors at this fixed-point scale. Exact BigInt comparison
// (not float64) so a value crafted just under the floor — e.g.
// "1.2499999999999999" — does not round up to 1.25 and slip past the block.
const HF_SCALE = 18;

// True when healthFactorAfter is strictly below MIN_HEALTH_FACTOR, compared
// exactly. Excess fractional precision is truncated toward zero (which only
// ever makes a value smaller, i.e. errs toward blocking — the safe direction);
// anything unparseable is treated as below the floor (block), never above it.
function belowHealthFactorFloor(healthFactorAfter: string): boolean {
  const scaled = scaleHealthFactor(healthFactorAfter);
  if (scaled === null) return true; // unparseable -> treat as below the floor
  return scaled < parseDecimal(MIN_HEALTH_FACTOR, HF_SCALE);
}

// Parse a health factor at HF_SCALE, truncating excess precision toward zero
// (the safe direction). Returns null for a non-decimal string.
function scaleHealthFactor(value: string): bigint | null {
  const dot = value.indexOf(".");
  const truncated =
    dot >= 0 && value.length - dot - 1 > HF_SCALE ? value.slice(0, dot + 1 + HF_SCALE) : value;
  try {
    return parseDecimal(truncated, HF_SCALE);
  } catch {
    return null;
  }
}

// Operations that reduce collateralization and therefore must declare where the
// health factor lands.
const RISK_INCREASING_OPERATIONS = new Set(["borrow", "withdraw"]);

function asLending(ctx: GuardRuleContext): LendingAction | null {
  return ctx.action.kind === "lending" ? ctx.action : null;
}

const healthFactorPresent: GuardRule = {
  id: "lending-health-factor-present",
  appliesTo: ["lending"],
  evaluate(ctx): GuardRuleResult {
    const lending = asLending(ctx);
    if (!lending) {
      return notApplicable("lending-health-factor-present", "Action is not a lending action.");
    }
    if (!RISK_INCREASING_OPERATIONS.has(lending.operation)) {
      return notApplicable(
        "lending-health-factor-present",
        `A ${lending.operation} does not reduce collateralization, so a post-action health factor is not required.`
      );
    }
    if (lending.healthFactorAfter === undefined) {
      return {
        id: "lending-health-factor-present",
        status: "fail",
        severity: "warning",
        explanation:
          `This ${lending.operation} does not declare healthFactorAfter, so its effect on liquidation risk ` +
          "is unknown. A human should confirm the resulting position.",
        evidence: { operation: lending.operation, healthFactorAfter: null },
      };
    }
    return {
      id: "lending-health-factor-present",
      status: "pass",
      severity: "info",
      explanation: `The ${lending.operation} declares a resulting health factor of ${lending.healthFactorAfter}.`,
      evidence: { operation: lending.operation, healthFactorAfter: lending.healthFactorAfter },
    };
  },
};

const healthFactorMin: GuardRule = {
  id: "lending-health-factor-min",
  appliesTo: ["lending"],
  evaluate(ctx): GuardRuleResult {
    const lending = asLending(ctx);
    if (!lending || lending.healthFactorAfter === undefined) {
      return notApplicable(
        "lending-health-factor-min",
        "No resulting health factor to check against the minimum."
      );
    }
    if (belowHealthFactorFloor(lending.healthFactorAfter)) {
      return {
        id: "lending-health-factor-min",
        status: "fail",
        severity: "critical",
        explanation:
          `The resulting health factor ${lending.healthFactorAfter} is below the ${MIN_HEALTH_FACTOR} safety ` +
          "margin. The position would sit one adverse price move from liquidation.",
        evidence: { healthFactorAfter: lending.healthFactorAfter, minimum: MIN_HEALTH_FACTOR },
      };
    }
    return {
      id: "lending-health-factor-min",
      status: "pass",
      severity: "info",
      explanation: `The resulting health factor ${lending.healthFactorAfter} is at or above the ${MIN_HEALTH_FACTOR} margin.`,
      evidence: { healthFactorAfter: lending.healthFactorAfter, minimum: MIN_HEALTH_FACTOR },
    };
  },
};

// The health-factor figures are agent-attested: Rinne checks the agent's own
// declared post-action health factor against the floor (catching the common
// case of an agent about to borrow itself into liquidation range). It does not
// yet independently recompute the position on-chain. This rule is a cheap
// contradiction check: for an operation that REDUCES collateralization, the
// resulting health factor must not be reported as higher than before — if it
// is, the declared figures are internally inconsistent and a human should look.
const healthFactorConsistency: GuardRule = {
  id: "lending-health-factor-consistency",
  appliesTo: ["lending"],
  evaluate(ctx): GuardRuleResult {
    const lending = asLending(ctx);
    if (
      !lending ||
      !RISK_INCREASING_OPERATIONS.has(lending.operation) ||
      lending.healthFactorBefore === undefined ||
      lending.healthFactorAfter === undefined
    ) {
      return notApplicable(
        "lending-health-factor-consistency",
        "Need both a before and after health factor on a borrow/withdraw to check consistency."
      );
    }
    const before = scaleHealthFactor(lending.healthFactorBefore);
    const after = scaleHealthFactor(lending.healthFactorAfter);
    if (before === null || after === null) {
      return notApplicable(
        "lending-health-factor-consistency",
        "A declared health factor is not a usable number."
      );
    }
    if (after >= before) {
      return {
        id: "lending-health-factor-consistency",
        status: "fail",
        severity: "warning",
        explanation:
          `This ${lending.operation} reduces collateralization, yet the declared health factor rises from ` +
          `${lending.healthFactorBefore} to ${lending.healthFactorAfter}. The figures are inconsistent; a human ` +
          "should confirm the real resulting position.",
        evidence: {
          operation: lending.operation,
          healthFactorBefore: lending.healthFactorBefore,
          healthFactorAfter: lending.healthFactorAfter,
        },
      };
    }
    return {
      id: "lending-health-factor-consistency",
      status: "pass",
      severity: "info",
      explanation: `The declared health factor falls from ${lending.healthFactorBefore} to ${lending.healthFactorAfter}, as expected for a ${lending.operation}.`,
      evidence: {
        operation: lending.operation,
        healthFactorBefore: lending.healthFactorBefore,
        healthFactorAfter: lending.healthFactorAfter,
      },
    };
  },
};

const protocolRisk: GuardRule = {
  id: "lending-protocol-risk",
  appliesTo: ["lending"],
  evaluate(ctx): GuardRuleResult {
    const lending = asLending(ctx);
    if (!lending) {
      return notApplicable("lending-protocol-risk", "Action is not a lending action.");
    }
    const allowlisted = isAllowlisted(ctx.allowlists.protocols[lending.chain] ?? [], lending.protocol);
    if (allowlisted) {
      return {
        id: "lending-protocol-risk",
        status: "pass",
        severity: "info",
        explanation: `Protocol is operator-allowlisted as "${allowlisted.name}" (${allowlisted.source}).`,
        evidence: { protocol: lending.protocol, allowlisted: allowlisted.name, source: allowlisted.source },
      };
    }
    const nansen = ctx.evidence.find(
      (item) => item.provider === "nansen" && item.purpose === "protocol-risk"
    );
    if (nansen?.status === "error") {
      return {
        id: "lending-protocol-risk",
        status: "fail",
        severity: "warning",
        explanation:
          `Nansen risk data for the protocol could not be fetched (${nansen.error ?? "unknown error"}). ` +
          "The protocol is not allowlisted, so a human should confirm it.",
        evidence: { protocol: lending.protocol, provider: "nansen", status: "error", error: nansen.error ?? null },
      };
    }
    const highRisk = nansen ? detectHighRiskLabel(nansen.data) : null;
    if (highRisk) {
      return {
        id: "lending-protocol-risk",
        status: "fail",
        severity: "critical",
        explanation: `Nansen flags the protocol as high risk (${highRisk}). Do not transact with it.`,
        // Provider data spread first so the rule's authoritative fields win.
        evidence: { ...nansen?.data, protocol: lending.protocol, provider: "nansen", riskLabel: highRisk },
      };
    }
    // Conservative posture: an unrecognized protocol that is neither
    // operator-allowlisted nor positively labeled is sent to review — the
    // absence of a high-risk label is not proof the protocol is safe.
    return {
      id: "lending-protocol-risk",
      status: "fail",
      severity: "warning",
      explanation: nansen
        ? `The protocol ${lending.protocol} is not operator-allowlisted and Nansen returned no high-risk label. ` +
          "An unrecognized protocol with no positive trust signal should be confirmed by a human."
        : `No protocol-risk evidence is available and ${lending.protocol} is not operator-allowlisted; ` +
          "a human should confirm this protocol.",
      evidence: { ...(nansen?.data ?? {}), protocol: lending.protocol, provider: nansen ? "nansen" : null, allowlisted: false },
    };
  },
};

function notApplicable(id: string, explanation: string): GuardRuleResult {
  return { id, status: "not-applicable", severity: "info", explanation, evidence: {} };
}

export const lendingRules: GuardRule[] = [
  healthFactorPresent,
  healthFactorMin,
  healthFactorConsistency,
  protocolRisk,
];
