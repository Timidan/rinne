import type { GuardRuleResult, SwapAction } from "../../core/guard-types.js";
import type { GuardRule, GuardRuleContext } from "../rules.js";
import { mulDiv, parseDecimal } from "../../core/decimal.js";

// Swap guard rules. The rules that gate hardest — a positive floor, a sane
// slippage cap, and a floor that is consistent with the expected output — are
// pure action math, so a dangerous swap blocks even if Surf is unreachable. The
// Surf market evidence rule turns a provider failure into a review signal; it
// never invents a price.

const MAX_SLIPPAGE_BPS = 300;
const QUOTE_MAX_AGE_MS = 120_000;
// Quotes dated more than this far in the future are treated as untrusted rather
// than "fresh" (a negative age must not pass the freshness check).
const QUOTE_FUTURE_SKEW_MS = 60_000;
const AMOUNT_SCALE = 18;

function asSwap(ctx: GuardRuleContext): SwapAction | null {
  return ctx.action.kind === "swap" ? ctx.action : null;
}

// Truncate to AMOUNT_SCALE fractional digits so parseDecimal never throws on an
// over-precise amount; returns null only for a genuinely non-decimal string.
function toScaled(value: string): bigint | null {
  const [whole, fraction = ""] = value.split(".");
  const safe = fraction.length > AMOUNT_SCALE ? `${whole}.${fraction.slice(0, AMOUNT_SCALE)}` : value;
  try {
    return parseDecimal(safe, AMOUNT_SCALE);
  } catch {
    return null;
  }
}

const minReceivedRequired: GuardRule = {
  id: "swap-min-received-required",
  appliesTo: ["swap"],
  evaluate(ctx): GuardRuleResult {
    const swap = asSwap(ctx);
    if (!swap) {
      return notApplicable("swap-min-received-required", "Action is not a swap.");
    }
    if (swap.minReceived === undefined) {
      return fail(
        "swap-min-received-required",
        "The swap declares no minReceived floor, so a sandwich or stale quote could return " +
          "almost nothing and still satisfy the trade. A floor is mandatory.",
        { minReceived: null }
      );
    }
    const parsed = toScaled(swap.minReceived);
    if (parsed === null) {
      return fail(
        "swap-min-received-required",
        `The minReceived floor "${swap.minReceived}" is not a usable number; treat the floor as absent.`,
        { minReceived: swap.minReceived }
      );
    }
    if (parsed <= 0n) {
      return fail(
        "swap-min-received-required",
        `A minReceived floor of ${swap.minReceived} is not a floor at all — the swap could return nothing ` +
          "and still settle. The floor must be greater than zero.",
        { minReceived: swap.minReceived }
      );
    }
    return pass(
      "swap-min-received-required",
      `The swap sets a positive minReceived floor of ${swap.minReceived}.`,
      { minReceived: swap.minReceived }
    );
  },
};

const slippageLimit: GuardRule = {
  id: "swap-slippage-limit",
  appliesTo: ["swap"],
  evaluate(ctx): GuardRuleResult {
    const swap = asSwap(ctx);
    if (!swap) return notApplicable("swap-slippage-limit", "Action is not a swap.");
    if (swap.maxSlippageBps === undefined) {
      // No cap declared. If there is also no expectedOut, the floor cannot be
      // sanity-checked at all, so a human should look — never silently proceed.
      if (swap.expectedOut === undefined) {
        return {
          id: "swap-slippage-limit",
          status: "fail",
          severity: "warning",
          explanation:
            "The swap declares neither a maxSlippageBps cap nor an expectedOut, so its floor cannot be " +
            "bounded against the market. A human should confirm the trade.",
          evidence: { maxSlippageBps: null, expectedOut: null },
        };
      }
      return notApplicable(
        "swap-slippage-limit",
        "No maxSlippageBps declared; the floor is checked against expectedOut instead."
      );
    }
    if (swap.maxSlippageBps > MAX_SLIPPAGE_BPS) {
      return fail(
        "swap-slippage-limit",
        `The swap tolerates ${swap.maxSlippageBps} bps of slippage, above the ${MAX_SLIPPAGE_BPS} bps ` +
          "ceiling. That much tolerance invites value extraction.",
        { maxSlippageBps: swap.maxSlippageBps, limitBps: MAX_SLIPPAGE_BPS }
      );
    }
    return pass(
      "swap-slippage-limit",
      `Slippage tolerance ${swap.maxSlippageBps} bps is within the ${MAX_SLIPPAGE_BPS} bps ceiling.`,
      { maxSlippageBps: swap.maxSlippageBps, limitBps: MAX_SLIPPAGE_BPS }
    );
  },
};

// Critical: the declared floor must be consistent with the declared expected
// output. A floor far below expectedOut (e.g. minReceived "0" while expecting
// 53) lets the swap settle for almost nothing — the floor is economically
// meaningless even though it is technically present and positive.
const floorConsistency: GuardRule = {
  id: "swap-floor-consistency",
  appliesTo: ["swap"],
  evaluate(ctx): GuardRuleResult {
    const swap = asSwap(ctx);
    if (!swap || swap.expectedOut === undefined || swap.minReceived === undefined) {
      return notApplicable(
        "swap-floor-consistency",
        "No expectedOut to check the floor against."
      );
    }
    const expected = toScaled(swap.expectedOut);
    const floor = toScaled(swap.minReceived);
    if (expected === null || floor === null || expected <= 0n) {
      return notApplicable(
        "swap-floor-consistency",
        "expectedOut or minReceived is not a usable number."
      );
    }
    // Most lenient tolerated slippage: the declared cap, bounded by the ceiling.
    const effectiveBps = Math.min(swap.maxSlippageBps ?? MAX_SLIPPAGE_BPS, MAX_SLIPPAGE_BPS);
    const impliedFloor = mulDiv(expected, BigInt(10_000 - effectiveBps), 10_000n);
    if (floor < impliedFloor) {
      return {
        id: "swap-floor-consistency",
        status: "fail",
        severity: "critical",
        explanation:
          `The minReceived floor (${swap.minReceived}) is below the minimum implied by expectedOut ` +
          `${swap.expectedOut} at ${effectiveBps} bps slippage. The declared floor permits more loss than ` +
          "the declared slippage and offers no real protection.",
        evidence: {
          minReceived: swap.minReceived,
          expectedOut: swap.expectedOut,
          impliedFloor: formatScaled(impliedFloor),
          slippageBps: effectiveBps,
        },
      };
    }
    return pass(
      "swap-floor-consistency",
      `The minReceived floor is consistent with expectedOut ${swap.expectedOut} at ${effectiveBps} bps.`,
      { minReceived: swap.minReceived, expectedOut: swap.expectedOut, slippageBps: effectiveBps }
    );
  },
};

const quoteFreshness: GuardRule = {
  id: "swap-quote-freshness",
  appliesTo: ["swap"],
  evaluate(ctx): GuardRuleResult {
    const swap = asSwap(ctx);
    const quotedAt = swap?.quote?.quotedAt;
    if (!swap || quotedAt === undefined) {
      return notApplicable(
        "swap-quote-freshness",
        "No quote timestamp supplied, so freshness cannot be checked here."
      );
    }
    const quotedMs = Date.parse(quotedAt);
    if (Number.isNaN(quotedMs)) {
      return {
        id: "swap-quote-freshness",
        status: "fail",
        severity: "warning",
        explanation: `The quote timestamp "${quotedAt}" is not a valid date; treat the quote as untrusted.`,
        evidence: { quotedAt },
      };
    }
    const ageMs = ctx.now.getTime() - quotedMs;
    if (ageMs < -QUOTE_FUTURE_SKEW_MS) {
      return {
        id: "swap-quote-freshness",
        status: "fail",
        severity: "warning",
        explanation:
          `The quote is dated ${Math.round(-ageMs / 1000)}s in the future, beyond clock skew. ` +
          "A future-dated quote cannot be trusted as fresh; a human should confirm.",
        evidence: { quotedAt, secondsAhead: Math.round(-ageMs / 1000) },
      };
    }
    if (ageMs > QUOTE_MAX_AGE_MS) {
      return {
        id: "swap-quote-freshness",
        status: "fail",
        severity: "warning",
        explanation:
          `The quote is ${Math.round(ageMs / 1000)}s old, past the ${QUOTE_MAX_AGE_MS / 1000}s freshness window. ` +
          "A human should confirm the price still holds.",
        evidence: { quotedAt, ageSeconds: Math.round(ageMs / 1000), maxAgeSeconds: QUOTE_MAX_AGE_MS / 1000 },
      };
    }
    return pass(
      "swap-quote-freshness",
      `The quote is ${Math.max(0, Math.round(ageMs / 1000))}s old, within the freshness window.`,
      { quotedAt, ageSeconds: Math.round(ageMs / 1000) }
    );
  },
};

const marketEvidence: GuardRule = {
  id: "swap-market-evidence",
  appliesTo: ["swap"],
  evaluate(ctx): GuardRuleResult {
    const surf = ctx.evidence.find(
      (item) => item.provider === "surf" && item.purpose === "market-signal"
    );
    if (!surf) {
      return notApplicable(
        "swap-market-evidence",
        "No Surf market evidence was attached to this decision."
      );
    }
    if (surf.status === "error") {
      return {
        id: "swap-market-evidence",
        status: "fail",
        severity: "warning",
        explanation:
          `Surf market data could not be fetched (${surf.error ?? "unknown error"}), so the price the ` +
          "swap is built on is unverified. A human should confirm before funds move.",
        evidence: { provider: "surf", status: "error", error: surf.error ?? null },
      };
    }
    return pass(
      "swap-market-evidence",
      `Surf market evidence is live: ${surf.summary}`,
      { ...surf.data, provider: "surf", status: "live", payloadHash: surf.payloadHash ?? null }
    );
  },
};

function notApplicable(id: string, explanation: string): GuardRuleResult {
  return { id, status: "not-applicable", severity: "info", explanation, evidence: {} };
}

function pass(id: string, explanation: string, evidence: Record<string, unknown>): GuardRuleResult {
  return { id, status: "pass", severity: "info", explanation, evidence };
}

function fail(id: string, explanation: string, evidence: Record<string, unknown>): GuardRuleResult {
  return { id, status: "fail", severity: "critical", explanation, evidence };
}

function formatScaled(value: bigint): string {
  // Lightweight format for evidence display; not used for comparisons.
  const base = 10n ** BigInt(AMOUNT_SCALE);
  const whole = value / base;
  const frac = (value % base).toString().padStart(AMOUNT_SCALE, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export const swapRules: GuardRule[] = [
  minReceivedRequired,
  slippageLimit,
  floorConsistency,
  quoteFreshness,
  marketEvidence,
];
