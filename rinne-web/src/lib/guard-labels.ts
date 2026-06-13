// Human-facing labels and formatters for guard decisions. The engine speaks in
// rule slugs (swap-min-received-required) and raw fields (amountIn, bps); this
// is the one place we translate that into language a non-developer reads in
// seconds. Keep titles short and concrete.
import type { DefiAction, Gate } from "./guard-types";

// Rule slug -> short human title. The engine's own `explanation` stays as the
// sentence underneath; this is just the headline for each check.
const RULE_TITLES: Record<string, string> = {
  "swap-min-received-required": "Minimum amount to receive",
  "swap-slippage-limit": "Slippage limit",
  "swap-quote-freshness": "Price quote freshness",
  "swap-market-evidence": "Live market data",
  "approval-no-unlimited": "Unlimited approval",
  "approval-amount-limit": "Approval size",
  "approval-spender-risk": "Spender risk",
  "lending-health-factor-present": "Health factor declared",
  "lending-health-factor-min": "Minimum health factor",
  "lending-protocol-risk": "Protocol risk",
};

export function ruleTitle(id: string): string {
  return RULE_TITLES[id] ?? id;
}

// The kind of action in plain words (lending uses its operation verb).
export function actionNoun(action: DefiAction): string {
  if (action.kind === "swap") return "swap";
  if (action.kind === "approval") return "token approval";
  return action.operation; // borrow / supply / withdraw / repay
}

export function gateHeadline(gate: Gate, action: DefiAction): string {
  const noun = actionNoun(action);
  if (gate === "block") return `Rinne blocked this ${noun}.`;
  if (gate === "review") return `Rinne flagged this ${noun} for review.`;
  return `Rinne cleared this ${noun}.`;
}

// What the agent should DO about this gate — the single most useful sentence
// on the page for a non-expert.
export function gateGuidance(gate: Gate): string {
  if (gate === "block") {
    return "Do not execute it. A critical safety check failed; fix the issue below, then ask Rinne again.";
  }
  if (gate === "review") {
    return "Don't execute it yet. Rinne couldn't fully verify this action, so a human should confirm it first.";
  }
  return "Safe to execute, as far as Rinne can tell, as long as your agent's own policy also allows it.";
}

export function formatPct(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

export function shortenRef(ref: string): string {
  return /^0x[0-9a-fA-F]{40}$/.test(ref) ? `${ref.slice(0, 6)}…${ref.slice(-4)}` : ref;
}

// Group the whole-number part with thousands separators; keep the fraction as
// given (token amounts shouldn't be rounded for display).
export function formatAmount(value: string): string {
  const [whole = "", fraction] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction !== undefined ? `${grouped}.${fraction}` : grouped;
}

// A one-line plain-English statement of what the agent was trying to do.
export function actionSummary(action: DefiAction): string {
  if (action.kind === "swap") {
    const parts = [`Sell ${formatAmount(action.amountIn)} ${action.tokenIn.symbol} for ${action.tokenOut.symbol}`];
    if (action.maxSlippageBps !== undefined) parts.push(`max slippage ${formatPct(action.maxSlippageBps)}`);
    parts.push(
      action.minReceived
        ? `floor ${formatAmount(action.minReceived)} ${action.tokenOut.symbol}`
        : "no minimum set"
    );
    return parts.join(" · ");
  }
  if (action.kind === "approval") {
    return `Let ${shortenRef(action.spender)} spend ${formatAmount(action.amount)} ${action.token.symbol}`;
  }
  const hf = action.healthFactorAfter ? ` · health factor → ${action.healthFactorAfter}` : "";
  return `${capitalize(action.operation)} ${formatAmount(action.amount)} ${action.asset.symbol} on ${shortenRef(action.protocol)}${hf}`;
}

function capitalize(s: string): string {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s;
}
