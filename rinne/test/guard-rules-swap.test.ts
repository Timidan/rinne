import test from "node:test";
import assert from "node:assert/strict";
import { evaluateGuardRules } from "../src/guard/evaluate.js";
import { EMPTY_ALLOWLISTS } from "./guard-helpers.js";
import type { ProviderEvidence, SwapAction } from "../src/core/guard-types.js";

const NOW = new Date("2026-06-13T12:00:00.000Z");

function swap(overrides: Partial<SwapAction> = {}): SwapAction {
  return {
    kind: "swap",
    chain: "mantle",
    tokenIn: { symbol: "MNT", decimals: 18 },
    tokenOut: { symbol: "USDC", decimals: 6 },
    amountIn: "100",
    minReceived: "52.4",
    maxSlippageBps: 100,
    ...overrides,
  };
}

const liveSurf: ProviderEvidence = {
  provider: "surf",
  status: "live",
  purpose: "market-signal",
  fetchedAt: NOW.toISOString(),
  payloadHash: "sha256:abc",
  summary: "MNT 0.53 USD",
  data: { priceUsd: "0.530000" },
};

test("a sound swap with live market evidence proceeds", () => {
  const result = evaluateGuardRules(swap(), [liveSurf], { allowlists: EMPTY_ALLOWLISTS, now: NOW });
  assert.equal(result.gate, "proceed");
});

test("a swap with no minReceived floor is blocked", () => {
  const action = swap();
  delete action.minReceived;
  const result = evaluateGuardRules(action, [liveSurf], { allowlists: EMPTY_ALLOWLISTS, now: NOW });
  assert.equal(result.gate, "block");
  const rule = result.ruleResults.find((r) => r.id === "swap-min-received-required");
  assert.equal(rule?.status, "fail");
  assert.equal(rule?.severity, "critical");
});

test("excessive slippage tolerance is blocked", () => {
  const result = evaluateGuardRules(swap({ maxSlippageBps: 500 }), [liveSurf], {
    allowlists: EMPTY_ALLOWLISTS,
    now: NOW,
  });
  assert.equal(result.gate, "block");
  assert.equal(
    result.ruleResults.find((r) => r.id === "swap-slippage-limit")?.status,
    "fail"
  );
});

test("a stale quote pushes the swap to review", () => {
  const stale = swap({ quote: { quotedAt: "2026-06-13T11:55:00.000Z" } }); // 5 min old
  const result = evaluateGuardRules(stale, [liveSurf], { allowlists: EMPTY_ALLOWLISTS, now: NOW });
  assert.equal(result.gate, "review");
  assert.equal(
    result.ruleResults.find((r) => r.id === "swap-quote-freshness")?.status,
    "fail"
  );
});

test("a Surf provider error pushes an otherwise-sound swap to review", () => {
  const surfError: ProviderEvidence = {
    provider: "surf",
    status: "error",
    purpose: "market-signal",
    fetchedAt: NOW.toISOString(),
    summary: "Surf unavailable",
    error: "HTTP 503",
  };
  const result = evaluateGuardRules(swap(), [surfError], { allowlists: EMPTY_ALLOWLISTS, now: NOW });
  assert.equal(result.gate, "review");
  const rule = result.ruleResults.find((r) => r.id === "swap-market-evidence");
  assert.equal(rule?.status, "fail");
  assert.equal(rule?.severity, "warning");
});

// --- Security regressions (Codex review: swap floor / freshness fail-opens) ---

test("a zero minReceived floor is blocked (not a real floor)", () => {
  const result = evaluateGuardRules(swap({ minReceived: "0" }), [liveSurf], {
    allowlists: EMPTY_ALLOWLISTS,
    now: NOW,
  });
  assert.equal(result.gate, "block");
  const rule = result.ruleResults.find((r) => r.id === "swap-min-received-required");
  assert.equal(rule?.severity, "critical");
});

test("a floor far below expectedOut is blocked as economically meaningless", () => {
  // expectedOut 53, slippage 100bps -> implied floor ~52.47; a 0.000001 floor
  // permits almost total loss and must not slip through.
  const result = evaluateGuardRules(
    swap({ minReceived: "0.000001", expectedOut: "53", maxSlippageBps: 100 }),
    [liveSurf],
    { allowlists: EMPTY_ALLOWLISTS, now: NOW }
  );
  assert.equal(result.gate, "block");
  assert.equal(
    result.ruleResults.find((r) => r.id === "swap-floor-consistency")?.severity,
    "critical"
  );
});

test("a swap with neither slippage cap nor expectedOut is sent to review", () => {
  const action = swap({ minReceived: "52.4" });
  delete action.maxSlippageBps;
  const result = evaluateGuardRules(action, [liveSurf], { allowlists: EMPTY_ALLOWLISTS, now: NOW });
  assert.equal(result.gate, "review");
});

test("a future-dated quote does not pass freshness (negative age)", () => {
  const future = swap({ quote: { quotedAt: "2026-06-13T12:30:00.000Z" } }); // 30 min ahead
  const result = evaluateGuardRules(future, [liveSurf], { allowlists: EMPTY_ALLOWLISTS, now: NOW });
  assert.equal(result.gate, "review");
  const rule = result.ruleResults.find((r) => r.id === "swap-quote-freshness");
  assert.equal(rule?.status, "fail");
});
