import test from "node:test";
import assert from "node:assert/strict";
import { fetchSurfMarketEvidence } from "../src/providers/surf-live.js";
import { fetchNansenRiskEvidence } from "../src/providers/nansen-live.js";

// Live provider acceptance. This test is SKIPPED unless RINNE_LIVE_E2E=1.
// When enabled, it hits the real Surf and Nansen APIs and FAILS LOUDLY if the
// credentials are missing — a green run here means live evidence really worked,
// never that it was quietly skipped or mocked.

const LIVE = process.env.RINNE_LIVE_E2E === "1";

test("live Surf market evidence is fetched for a real Mantle token pair", { skip: !LIVE }, async () => {
  assert.ok(process.env.SURF_API_KEY, "RINNE_LIVE_E2E=1 requires SURF_API_KEY");
  const evidence = await fetchSurfMarketEvidence({
    tokenIn: { symbol: "MNT", decimals: 18 },
    tokenOut: { symbol: "USDC", decimals: 6 },
    chain: "mantle",
  });
  assert.equal(evidence.provider, "surf");
  assert.equal(evidence.status, "live", `expected live Surf evidence, got: ${evidence.error ?? "?"}`);
  assert.ok(evidence.payloadHash, "live evidence must carry a payload hash");
});

test("live Nansen risk evidence is fetched for a real address", { skip: !LIVE }, async () => {
  assert.ok(process.env.NANSEN_API_KEY, "RINNE_LIVE_E2E=1 requires NANSEN_API_KEY");
  const spender = process.env.RINNE_E2E_SPENDER_ADDRESS;
  assert.ok(spender, "RINNE_LIVE_E2E=1 requires RINNE_E2E_SPENDER_ADDRESS");
  const evidence = await fetchNansenRiskEvidence({
    chain: "mantle",
    address: spender,
    purpose: "spender-risk",
  });
  assert.equal(evidence.provider, "nansen");
  assert.equal(evidence.status, "live", `expected live Nansen evidence, got: ${evidence.error ?? "?"}`);
  assert.ok(evidence.payloadHash, "live evidence must carry a payload hash");
});
