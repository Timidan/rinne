import test from "node:test";
import assert from "node:assert/strict";
import { evaluateGuardRules } from "../src/guard/evaluate.js";
import { isAllowlisted } from "../src/guard/rules.js";
import { EMPTY_ALLOWLISTS, KNOWN_PROTOCOL, allowlistsWith } from "./guard-helpers.js";
import type { LendingAction, ProviderEvidence } from "../src/core/guard-types.js";

const NOW = new Date("2026-06-13T12:00:00.000Z");

function lending(overrides: Partial<LendingAction> = {}): LendingAction {
  return {
    kind: "lending",
    chain: "mantle",
    protocol: KNOWN_PROTOCOL,
    operation: "borrow",
    asset: { symbol: "USDC", decimals: 6 },
    amount: "1000",
    healthFactorAfter: "1.8",
    ...overrides,
  };
}

test("a healthy borrow against an allowlisted protocol proceeds", () => {
  const result = evaluateGuardRules(lending(), [], { allowlists: allowlistsWith(), now: NOW });
  assert.equal(result.gate, "proceed");
});

test("a borrow that lands below the health-factor floor is blocked", () => {
  const result = evaluateGuardRules(lending({ healthFactorAfter: "1.05" }), [], {
    allowlists: allowlistsWith(),
    now: NOW,
  });
  assert.equal(result.gate, "block");
  const rule = result.ruleResults.find((r) => r.id === "lending-health-factor-min");
  assert.equal(rule?.status, "fail");
  assert.equal(rule?.severity, "critical");
});

test("a health factor crafted just under the floor blocks (no float rounding)", () => {
  // Number("1.2499999999999999") === 1.25, so a float compare would let this
  // slip past. Exact decimal comparison must still block it.
  const result = evaluateGuardRules(lending({ healthFactorAfter: "1.2499999999999999" }), [], {
    allowlists: allowlistsWith(),
    now: NOW,
  });
  assert.equal(result.gate, "block");
  assert.equal(
    result.ruleResults.find((r) => r.id === "lending-health-factor-min")?.status,
    "fail"
  );
  // Exactly at the floor is allowed (>= 1.25 passes).
  const atFloor = evaluateGuardRules(lending({ healthFactorAfter: "1.25" }), [], {
    allowlists: allowlistsWith(),
    now: NOW,
  });
  assert.equal(atFloor.gate, "proceed");
});

test("the allowlist fast-path matches by address only, never by name", () => {
  const entries = allowlistsWith().protocols["mantle"] ?? [];
  // The real address is allowlisted...
  assert.ok(isAllowlisted(entries, KNOWN_PROTOCOL));
  // ...but the entry's display NAME must NOT grant the fast-path (an agent
  // could otherwise ride a trusted label without proving the address).
  assert.equal(isAllowlisted(entries, "Lendle"), null);
  assert.equal(isAllowlisted(entries, "lendle"), null);
});

test("a borrow with no declared resulting health factor is flagged for review", () => {
  const action = lending();
  delete action.healthFactorAfter;
  const result = evaluateGuardRules(action, [], { allowlists: allowlistsWith(), now: NOW });
  assert.equal(result.gate, "review");
  assert.equal(
    result.ruleResults.find((r) => r.id === "lending-health-factor-present")?.status,
    "fail"
  );
});

test("a supply does not require a health factor and proceeds", () => {
  const action = lending({ operation: "supply" });
  delete action.healthFactorAfter;
  const result = evaluateGuardRules(action, [], { allowlists: allowlistsWith(), now: NOW });
  assert.equal(result.gate, "proceed");
});

test("conservative posture: an unknown, unallowlisted protocol is sent to review", () => {
  const result = evaluateGuardRules(
    lending({ protocol: "0x4444444444444444444444444444444444444444" }),
    [],
    { allowlists: EMPTY_ALLOWLISTS, now: NOW }
  );
  assert.equal(result.gate, "review");
  assert.equal(
    result.ruleResults.find((r) => r.id === "lending-protocol-risk")?.severity,
    "warning"
  );
});

test("an explicit Nansen high-risk label blocks an unknown protocol", () => {
  const nansen: ProviderEvidence = {
    provider: "nansen",
    status: "live",
    purpose: "protocol-risk",
    fetchedAt: NOW.toISOString(),
    payloadHash: "sha256:y",
    summary: "labels: exploiter",
    data: { labels: ["exploiter"] },
  };
  const result = evaluateGuardRules(
    lending({ protocol: "0x5555555555555555555555555555555555555555" }),
    [nansen],
    { allowlists: EMPTY_ALLOWLISTS, now: NOW }
  );
  assert.equal(result.gate, "block");
});

// --- Security regression (Codex review: self-attested health-factor) ---

test("a borrow whose declared health factor RISES is sent to review (inconsistent)", () => {
  // A borrow reduces collateralization, so HF must fall. Declaring it rising
  // (1.5 -> 1.8) is internally contradictory and must not silently proceed,
  // even on an allowlisted protocol.
  const result = evaluateGuardRules(
    lending({ healthFactorBefore: "1.5", healthFactorAfter: "1.8" }),
    [],
    { allowlists: allowlistsWith(), now: NOW }
  );
  assert.equal(result.gate, "review");
  assert.equal(
    result.ruleResults.find((r) => r.id === "lending-health-factor-consistency")?.severity,
    "warning"
  );
});
