import test from "node:test";
import assert from "node:assert/strict";
import { normalizeGuardRequest } from "../src/guard/normalize-action.js";

// The normalizer is the trust boundary for agent-supplied JSON, so these
// tests pin down both directions of its contract: well-formed requests come
// out typed and stripped of anything undocumented, and every malformed
// request comes back as { ok: false } with a problem string that names the
// offending field — never a throw.

const USDC = {
  symbol: "USDC",
  decimals: 6,
  address: "0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9",
};
const MNT = { symbol: "MNT", decimals: 18 };

function swapRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: "rinne.guard-request.v1",
    agentId: "agt_test-agent.01",
    action: {
      kind: "swap",
      chain: "mantle",
      tokenIn: MNT,
      tokenOut: USDC,
      amountIn: "100",
      minReceived: "52.5",
      maxSlippageBps: 100,
      ...overrides,
    },
  };
}

test("valid swap request normalizes with unknown fields stripped", () => {
  const raw = {
    schemaVersion: "rinne.guard-request.v1",
    agentId: "agt_test-agent.01",
    // Over-sending must not break agents: extras at every level are dropped.
    debugFlag: true,
    action: {
      kind: "swap",
      chain: "mantle",
      tokenIn: { ...MNT, internalScore: 7 },
      tokenOut: USDC,
      amountIn: "100",
      expectedOut: "53.1",
      minReceived: "52.5",
      maxSlippageBps: 100,
      quote: { source: "surf", quotedAt: "2026-06-13T10:00:00Z", price: "0.531", venue: "x" },
      routerHint: "fastest",
    },
    context: { walletAddress: "0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9", dryRun: true },
    metadata: { runId: "r-1" },
  };
  const result = normalizeGuardRequest(raw);
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(result.request, {
    schemaVersion: "rinne.guard-request.v1",
    agentId: "agt_test-agent.01",
    action: {
      kind: "swap",
      chain: "mantle",
      tokenIn: MNT,
      tokenOut: USDC,
      amountIn: "100",
      expectedOut: "53.1",
      minReceived: "52.5",
      maxSlippageBps: 100,
      quote: { source: "surf", quotedAt: "2026-06-13T10:00:00Z", price: "0.531" },
    },
    context: { walletAddress: "0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9", dryRun: true },
    metadata: { runId: "r-1" },
  });
});

test("valid approval request normalizes", () => {
  const result = normalizeGuardRequest({
    schemaVersion: "rinne.guard-request.v1",
    agentId: "agt_approver",
    action: {
      kind: "approval",
      chain: "mantle",
      token: USDC,
      spender: "0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9",
      amount: "500",
      currentAllowance: "0",
      reason: "router allowance for the next swap",
      extra: "dropped",
    },
  });
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(result.request.action, {
    kind: "approval",
    chain: "mantle",
    token: USDC,
    spender: "0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9",
    amount: "500",
    currentAllowance: "0",
    reason: "router allowance for the next swap",
  });
});

test("valid lending request normalizes with a plain protocol name", () => {
  const result = normalizeGuardRequest({
    schemaVersion: "rinne.guard-request.v1",
    agentId: "agt_lender",
    action: {
      kind: "lending",
      chain: "mantle",
      protocol: "lendle",
      operation: "borrow",
      asset: USDC,
      amount: "1000",
      healthFactorBefore: "2.1",
      healthFactorAfter: "1.4",
      liquidationThresholdBps: 8250,
      strategyTag: "dropped",
    },
  });
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(result.request.action, {
    kind: "lending",
    chain: "mantle",
    protocol: "lendle",
    operation: "borrow",
    asset: USDC,
    amount: "1000",
    healthFactorBefore: "2.1",
    healthFactorAfter: "1.4",
    liquidationThresholdBps: 8250,
  });
});

test("malformed decimal is rejected naming the field", () => {
  const result = normalizeGuardRequest(swapRequest({ amountIn: "1,000" }));
  assert.ok(!result.ok);
  assert.match(result.problem, /"action\.amountIn"/);
  assert.match(result.problem, /decimal/);
});

test("scientific notation is not a plain decimal", () => {
  const result = normalizeGuardRequest(swapRequest({ amountIn: "1e18" }));
  assert.ok(!result.ok);
  assert.match(result.problem, /"action\.amountIn"/);
});

test("unknown action kind lists the accepted kinds", () => {
  const result = normalizeGuardRequest(swapRequest({ kind: "stake" }));
  assert.ok(!result.ok);
  assert.match(result.problem, /"action\.kind"/);
  assert.match(result.problem, /"swap", "approval", "lending"/);
});

test("invalid token address is rejected naming the field", () => {
  const result = normalizeGuardRequest(swapRequest({ tokenIn: { ...MNT, address: "0x1234" } }));
  assert.ok(!result.ok);
  assert.match(result.problem, /"action\.tokenIn\.address"/);
  assert.match(result.problem, /40 hex/);
});

test("an 0x-looking spender must be a complete address", () => {
  const result = normalizeGuardRequest({
    schemaVersion: "rinne.guard-request.v1",
    agentId: "agt_approver",
    action: {
      kind: "approval",
      chain: "mantle",
      token: USDC,
      spender: "0xdeadbeef",
      amount: "500",
    },
  });
  assert.ok(!result.ok);
  assert.match(result.problem, /"action\.spender"/);
});

test("an unsupported chain is rejected", () => {
  const result = normalizeGuardRequest(swapRequest({ chain: "ethereum" }));
  assert.ok(!result.ok);
  assert.match(result.problem, /"action\.chain"/);
  assert.match(result.problem, /mantle/);
});

test("the mantle-sepolia testnet chain is accepted and carried through", () => {
  const result = normalizeGuardRequest(swapRequest({ chain: "mantle-sepolia" }));
  assert.ok(result.ok);
  assert.equal(result.request.action.chain, "mantle-sepolia");
});

test("unknown lending operation lists the accepted operations", () => {
  const result = normalizeGuardRequest({
    schemaVersion: "rinne.guard-request.v1",
    agentId: "agt_lender",
    action: {
      kind: "lending",
      chain: "mantle",
      protocol: "lendle",
      operation: "leverage",
      asset: USDC,
      amount: "1000",
    },
  });
  assert.ok(!result.ok);
  assert.match(result.problem, /"action\.operation"/);
  assert.match(result.problem, /"supply", "withdraw", "borrow", "repay"/);
});

test("maxSlippageBps of 10000 (100%) is rejected as unit confusion", () => {
  const result = normalizeGuardRequest(swapRequest({ maxSlippageBps: 10000 }));
  assert.ok(!result.ok);
  assert.match(result.problem, /"action\.maxSlippageBps"/);
});

test("wrong schemaVersion is rejected naming the expected version", () => {
  const raw = swapRequest();
  raw["schemaVersion"] = "rinne.guard-request.v0";
  const result = normalizeGuardRequest(raw);
  assert.ok(!result.ok);
  assert.match(result.problem, /"schemaVersion"/);
  assert.match(result.problem, /rinne\.guard-request\.v1/);
});

test("agentId with unsafe characters is rejected", () => {
  const raw = swapRequest();
  raw["agentId"] = "agent id with spaces";
  const result = normalizeGuardRequest(raw);
  assert.ok(!result.ok);
  assert.match(result.problem, /"agentId"/);
});

test("non-object input returns ok:false instead of throwing", () => {
  for (const bad of ["a string", 42, null, undefined, ["array"]]) {
    const result = normalizeGuardRequest(bad);
    assert.ok(!result.ok, `expected ok:false for ${JSON.stringify(bad)}`);
    assert.match(result.problem, /not a JSON object/);
    assert.equal(result.raw, bad);
  }
});
