// Minimal Rinne agent example — zero dependencies, just Node 20+ (global fetch).
//
//   node examples/guard-a-swap.mjs
//   RINNE_BASE_URL=http://127.0.0.1:4517 node examples/guard-a-swap.mjs
//
// It registers an agent, then guards two swaps: a sound one (proceeds, backed by
// live Surf evidence) and one with a zero floor (blocked). This is exactly the
// pattern an autonomous agent follows: ASK before you act, obey the gate.

const BASE = process.env.RINNE_BASE_URL ?? "https://rinne.timidan.xyz";

async function post(path, body, apiKey) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

// 1. Register (open, no auth). The API key is returned exactly once.
const reg = await post("/v1/register-agent", {
  name: "example-mantle-agent",
  owner: { kind: "manual", value: "you@example.com" },
  supportedActions: ["swap"],
  guardMode: "enforce",
});
const agentId = reg.agent.id;
const apiKey = reg.apiKey;
console.log(`registered ${agentId}`);

// 2. Guard a planned swap before executing it.
function swap(minReceived) {
  return {
    schemaVersion: "rinne.guard-request.v1",
    agentId,
    action: {
      kind: "swap",
      chain: "mantle-sepolia",
      tokenIn: { symbol: "MNT", decimals: 18 },
      tokenOut: { symbol: "USDC", decimals: 6 },
      amountIn: "100",
      minReceived,
      maxSlippageBps: 100,
      quote: { source: "agni", quotedAt: new Date().toISOString(), price: "0.53" },
    },
  };
}

const sound = await post("/v1/guard", swap("52"), apiKey);
console.log(`sound swap     -> ${sound.gate}  (${sound.summary})`);

const noFloor = await post("/v1/guard", swap("0"), apiKey);
console.log(`zero-floor swap -> ${noFloor.gate}  (${noFloor.summary})`);

// 3. Act on the gate. Never execute after a block or review.
if (sound.gate === "proceed") {
  console.log("\n-> the agent would now broadcast the sound swap with its own wallet.");
}
if (noFloor.gate !== "proceed") {
  console.log("-> the zero-floor swap is NOT executed: Rinne caught the missing floor.");
}
