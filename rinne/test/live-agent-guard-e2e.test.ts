import test from "node:test";
import assert from "node:assert/strict";

// Full live acceptance: real external agent endpoints plan actions, those
// actions go through a running Rinne /v1/guard, and the decisions are persisted
// with live Surf/Nansen evidence. SKIPPED unless RINNE_LIVE_E2E=1; when enabled
// it FAILS LOUDLY if any live input is missing — it must never pass silently
// without credentials, agent endpoints, or live provider evidence.

const LIVE = process.env.RINNE_LIVE_E2E === "1";

interface DecisionShape {
  decisionId: string;
  gate: string;
  providerEvidence: Array<{ provider: string; status: string }>;
}

async function planAction(agentUrl: string): Promise<unknown> {
  const res = await fetch(agentUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chain: "mantle", request: "plan-action" }),
  });
  assert.ok(res.ok, `agent endpoint ${agentUrl} returned ${res.status}`);
  const body = (await res.json()) as { action?: unknown };
  return body.action ?? body;
}

async function guard(
  baseUrl: string,
  agentId: string,
  apiKey: string,
  action: unknown
): Promise<DecisionShape> {
  const res = await fetch(`${baseUrl}/v1/guard`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ schemaVersion: "rinne.guard-request.v1", agentId, action }),
  });
  const body = (await res.json()) as DecisionShape;
  assert.equal(res.status, 200, `guard call failed: ${JSON.stringify(body)}`);
  return body;
}

test("live agents drive guard decisions with live provider evidence", { skip: !LIVE }, async () => {
  const baseUrl = need("RINNE_BASE_URL");
  need("SURF_API_KEY");
  need("NANSEN_API_KEY");
  const swapId = need("RINNE_LIVE_SWAP_AGENT_ID");
  const swapKey = need("RINNE_LIVE_SWAP_AGENT_KEY");
  const swapUrl = need("RINNE_LIVE_SWAP_AGENT_URL");
  const riskId = need("RINNE_LIVE_RISK_AGENT_ID");
  const riskKey = need("RINNE_LIVE_RISK_AGENT_KEY");
  const riskUrl = need("RINNE_LIVE_RISK_AGENT_URL");

  const swapDecision = await guard(baseUrl, swapId, swapKey, await planAction(swapUrl));
  const riskDecision = await guard(baseUrl, riskId, riskKey, await planAction(riskUrl));

  // Decisions are persisted and retrievable.
  for (const decision of [swapDecision, riskDecision]) {
    const fetched = await fetch(`${baseUrl}/api/decisions/${decision.decisionId}`);
    assert.equal(fetched.status, 200, `decision ${decision.decisionId} was not persisted`);
    // No evidence is ever mock.
    assert.ok(
      decision.providerEvidence.every((e) => e.status === "live" || e.status === "error"),
      "provider evidence must be live or error, never mock"
    );
  }

  // The swap decision must carry live Surf evidence; the risk decision live
  // Nansen evidence (status "error" is a real failure, not acceptable here
  // since keys are present — surface it).
  const surf = swapDecision.providerEvidence.find((e) => e.provider === "surf");
  assert.equal(surf?.status, "live", "swap decision must carry live Surf evidence");
  const nansen = riskDecision.providerEvidence.find((e) => e.provider === "nansen");
  assert.equal(nansen?.status, "live", "risk decision must carry live Nansen evidence");
});

function need(name: string): string {
  const value = process.env[name];
  assert.ok(value, `RINNE_LIVE_E2E=1 requires ${name}`);
  return value;
}
