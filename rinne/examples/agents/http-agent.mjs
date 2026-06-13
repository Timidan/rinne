// Example hosted Agent for Rinne: an HTTP /decide endpoint.
//
// Start it:            node examples/agents/http-agent.mjs   (port 4789)
// Then run against it: node dist/src/cli/index.js run scenarios/mnt-stale-price-swap.json \
//                        --agent http://127.0.0.1:4789/decide
//
// Any language works: accept POST { scenarioId, signal, policy, chain,
// signalFetchedAt }, answer with one typed intent as JSON.

import { createServer } from "node:http";
import { decide } from "./threshold-agent.mjs";

const PORT = Number(process.env.AGENT_PORT ?? 4789);

createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/decide") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "POST /decide only" }));
    return;
  }
  let body = "";
  for await (const chunk of req) body += chunk;
  try {
    const intent = await decide(JSON.parse(body));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(intent));
  } catch (error) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: error.message }));
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Example Agent listening on http://127.0.0.1:${PORT}/decide`);
});
