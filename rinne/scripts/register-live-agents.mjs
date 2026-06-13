// Registers real, externally-hosted agent endpoints with a running Rinne
// instance via the public self-service endpoint each agent would call itself.
// No agent URLs, keys, provider payloads, or expected gates are hardcoded —
// everything comes from the environment, so this script can only ever register
// the live endpoints actually supplied.
//
// Required env:
//   RINNE_BASE_URL              e.g. http://127.0.0.1:4517
//   RINNE_LIVE_SWAP_AGENT_URL   a real /decide (or planning) endpoint for swaps
//   RINNE_LIVE_RISK_AGENT_URL   a real endpoint for approval/lending actions
//
// Prints the generated agentId + apiKey for each (the key is shown once).

const baseUrl = requireEnv("RINNE_BASE_URL");
const swapUrl = requireEnv("RINNE_LIVE_SWAP_AGENT_URL");
const riskUrl = requireEnv("RINNE_LIVE_RISK_AGENT_URL");

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var ${name}.`);
    process.exit(1);
  }
  return value;
}

async function register(name, endpointUrl, supportedActions) {
  const res = await fetch(`${baseUrl}/v1/register-agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      owner: { kind: "manual", value: "live-validation" },
      endpointUrl,
      supportedActions,
      guardMode: "enforce",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Registration failed (${res.status}): ${body}`);
  }
  return res.json();
}

const swap = await register("Live Swap Agent", swapUrl, ["swap"]);
console.log(`Registered live swap agent: ${swap.agent.id}`);
console.log(`  RINNE_LIVE_SWAP_AGENT_ID=${swap.agent.id}`);
console.log(`  RINNE_LIVE_SWAP_AGENT_KEY=${swap.apiKey}`);

const risk = await register("Live Risk Agent", riskUrl, ["approval", "lending"]);
console.log(`Registered live risk agent: ${risk.agent.id}`);
console.log(`  RINNE_LIVE_RISK_AGENT_ID=${risk.agent.id}`);
console.log(`  RINNE_LIVE_RISK_AGENT_KEY=${risk.apiKey}`);

console.log("\nExport the four lines above, then run run-live-guard-validation.mjs.");
