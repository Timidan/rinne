// Drives the live guard flow end to end against a running Rinne instance:
// asks each real agent endpoint for a planned action, sends that action to
// Rinne's /v1/guard, and prints the actual gate Rinne returned. Nothing here
// is hardcoded — agent IDs, keys, and endpoints all come from the environment,
// and the gates printed are whatever Rinne actually decided.
//
// Required env (the agent IDs/keys are printed by register-live-agents.mjs):
//   RINNE_BASE_URL
//   RINNE_LIVE_SWAP_AGENT_ID,  RINNE_LIVE_SWAP_AGENT_KEY,  RINNE_LIVE_SWAP_AGENT_URL
//   RINNE_LIVE_RISK_AGENT_ID,  RINNE_LIVE_RISK_AGENT_KEY,  RINNE_LIVE_RISK_AGENT_URL

const baseUrl = requireEnv("RINNE_BASE_URL");

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var ${name}.`);
    process.exit(1);
  }
  return value;
}

// Asks a real agent endpoint for a planned action. The endpoint decides what it
// wants to do; we do not invent the action. Accepts either a bare action object
// or a { action } envelope.
async function planAction(agentUrl) {
  const res = await fetch(agentUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chain: "mantle", request: "plan-action" }),
  });
  if (!res.ok) throw new Error(`Agent ${agentUrl} returned ${res.status}`);
  const body = await res.json();
  return body.action ?? body;
}

async function guard(agentId, apiKey, action) {
  const res = await fetch(`${baseUrl}/v1/guard`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ schemaVersion: "rinne.guard-request.v1", agentId, action }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Guard call failed (${res.status}): ${JSON.stringify(body)}`);
  return body;
}

const swapAction = await planAction(requireEnv("RINNE_LIVE_SWAP_AGENT_URL"));
const swapDecision = await guard(
  requireEnv("RINNE_LIVE_SWAP_AGENT_ID"),
  requireEnv("RINNE_LIVE_SWAP_AGENT_KEY"),
  swapAction
);
console.log(`Swap guard decision: ${swapDecision.gate} ${swapDecision.decisionId}`);

const riskAction = await planAction(requireEnv("RINNE_LIVE_RISK_AGENT_URL"));
const riskDecision = await guard(
  requireEnv("RINNE_LIVE_RISK_AGENT_ID"),
  requireEnv("RINNE_LIVE_RISK_AGENT_KEY"),
  riskAction
);
console.log(`Risk guard decision: ${riskDecision.gate} ${riskDecision.decisionId}`);

console.log(`Open dashboard: ${baseUrl}/app/dashboard`);
