import test from "node:test";
import assert from "node:assert/strict";
import { evaluateGuardRules } from "../src/guard/evaluate.js";
import { EMPTY_ALLOWLISTS, KNOWN_SPENDER, allowlistsWith } from "./guard-helpers.js";
import type { ApprovalAction, ProviderEvidence } from "../src/core/guard-types.js";

const NOW = new Date("2026-06-13T12:00:00.000Z");
const MAX_UINT256 = ((1n << 256n) - 1n).toString();

function approval(overrides: Partial<ApprovalAction> = {}): ApprovalAction {
  return {
    kind: "approval",
    chain: "mantle",
    token: { symbol: "USDC", decimals: 6 },
    spender: KNOWN_SPENDER,
    amount: "100",
    ...overrides,
  };
}

test("an unlimited (max-uint) approval is blocked even to an allowlisted spender", () => {
  const result = evaluateGuardRules(approval({ amount: MAX_UINT256 }), [], {
    allowlists: allowlistsWith(),
    now: NOW,
  });
  assert.equal(result.gate, "block");
  const rule = result.ruleResults.find((r) => r.id === "approval-no-unlimited");
  assert.equal(rule?.status, "fail");
  assert.equal(rule?.severity, "critical");
});

test("a bounded approval to an allowlisted spender proceeds with no provider call", () => {
  const result = evaluateGuardRules(approval({ amount: "500" }), [], {
    allowlists: allowlistsWith(),
    now: NOW,
  });
  assert.equal(result.gate, "proceed");
  assert.equal(
    result.ruleResults.find((r) => r.id === "approval-spender-risk")?.status,
    "pass"
  );
});

test("conservative posture: an unknown, unallowlisted spender is sent to review", () => {
  const result = evaluateGuardRules(
    approval({ spender: "0x1111111111111111111111111111111111111111", amount: "500" }),
    [],
    { allowlists: EMPTY_ALLOWLISTS, now: NOW }
  );
  // No high-risk label is NOT proof of safety; an unrecognized first-time
  // counterparty must be confirmed by a human, never silently approved.
  assert.equal(result.gate, "review");
  assert.equal(
    result.ruleResults.find((r) => r.id === "approval-spender-risk")?.severity,
    "warning"
  );
});

test("an explicit Nansen high-risk label blocks an unknown spender", () => {
  const nansen: ProviderEvidence = {
    provider: "nansen",
    status: "live",
    purpose: "spender-risk",
    fetchedAt: NOW.toISOString(),
    payloadHash: "sha256:x",
    summary: "labels: drainer",
    data: { labels: ["drainer"], categories: ["behavioral"] },
  };
  const result = evaluateGuardRules(
    approval({ spender: "0x2222222222222222222222222222222222222222", amount: "500" }),
    [nansen],
    { allowlists: EMPTY_ALLOWLISTS, now: NOW }
  );
  assert.equal(result.gate, "block");
  assert.equal(
    result.ruleResults.find((r) => r.id === "approval-spender-risk")?.severity,
    "critical"
  );
});

test("a Nansen provider error on an unknown spender pushes to review", () => {
  const nansenError: ProviderEvidence = {
    provider: "nansen",
    status: "error",
    purpose: "spender-risk",
    fetchedAt: NOW.toISOString(),
    summary: "Nansen unavailable",
    error: "HTTP 500",
  };
  const result = evaluateGuardRules(
    approval({ spender: "0x3333333333333333333333333333333333333333", amount: "500" }),
    [nansenError],
    { allowlists: EMPTY_ALLOWLISTS, now: NOW }
  );
  assert.equal(result.gate, "review");
});

test("benign Nansen labels do not manufacture a false high-risk block", () => {
  // Regression: an unanchored substring regex used to flag "Critical
  // Infrastructure DAO" (critical), "rugby" (rug), "Hackathon Sponsor" (hack)
  // as high-risk and BLOCK an otherwise-safe approval. They must NOT block.
  // (Under the conservative posture an unallowlisted spender is reviewed, not
  // proceeded — the point here is only that benign labels never escalate to a
  // critical high-risk block.)
  for (const label of ["Critical Infrastructure DAO", "rugby club", "Hackathon Sponsor", "anti-fraud service"]) {
    const nansen: ProviderEvidence = {
      provider: "nansen",
      status: "live",
      purpose: "spender-risk",
      fetchedAt: NOW.toISOString(),
      payloadHash: "sha256:z",
      summary: label,
      data: { labels: [label] },
    };
    const result = evaluateGuardRules(
      approval({ spender: "0x6666666666666666666666666666666666666666", amount: "500" }),
      [nansen],
      { allowlists: EMPTY_ALLOWLISTS, now: NOW }
    );
    assert.notEqual(result.gate, "block", `"${label}" must not BLOCK (false high-risk)`);
    assert.notEqual(
      result.ruleResults.find((r) => r.id === "approval-spender-risk")?.severity,
      "critical",
      `"${label}" must not be flagged critical`
    );
  }
});

test("an oversized but bounded approval is flagged for review", () => {
  const result = evaluateGuardRules(approval({ amount: "5000000" }), [], {
    allowlists: allowlistsWith(),
    now: NOW,
  });
  assert.equal(result.gate, "review");
  assert.equal(
    result.ruleResults.find((r) => r.id === "approval-amount-limit")?.status,
    "fail"
  );
});
