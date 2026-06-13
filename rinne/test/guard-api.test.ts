import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { startServer, type RinneServer } from "../src/server/index.js";

// Drives the hosted guard API over real HTTP. Surf/Nansen are not reachable in
// the test environment, so provider evidence comes back as status "error" —
// which is itself a tested behavior: a provider failure must produce a saved
// "review" decision, never a hardcoded pass. The action-math rules (unlimited
// approval) still block regardless of provider state.

async function withServer(
  run: (server: RinneServer) => Promise<void>
): Promise<void> {
  const artifactRoot = mkdtempSync(join(tmpdir(), "rinne-guard-api-"));
  const prevNansen = process.env.NANSEN_API_KEY;
  // Force the Nansen adapter down its missing-key error path deterministically.
  delete process.env.NANSEN_API_KEY;
  const server = await startServer(0, { artifactRoot });
  try {
    await run(server);
  } finally {
    await server.close();
    if (prevNansen !== undefined) process.env.NANSEN_API_KEY = prevNansen;
    rmSync(artifactRoot, { recursive: true, force: true });
  }
}

function post(url: string, body: unknown, token?: string): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
}

// Agents self-register: no operator credential, no Authorization header.
async function registerAgent(
  server: RinneServer,
  supportedActions: string[]
): Promise<{ agentId: string; apiKey: string }> {
  const res = await post(`${server.url}/v1/register-agent`, {
    name: "Test Agent",
    owner: { kind: "manual", value: "tester" },
    supportedActions,
    guardMode: "enforce",
  });
  assert.equal(res.status, 201);
  const body = (await res.json()) as { agent: { id: string }; apiKey: string };
  return { agentId: body.agent.id, apiKey: body.apiKey };
}

test("agents self-register with no operator credential and get a key once", async () => {
  await withServer(async (server) => {
    const { agentId, apiKey } = await registerAgent(server, ["swap"]);
    assert.match(agentId, /^agt_/);
    assert.match(apiKey, /^rinne_live_/);
    // The key is not retrievable afterwards: the agent view never carries it.
    const view = await fetch(`${server.url}/api/agents/${agentId}`);
    const body = (await view.json()) as { agent: Record<string, unknown> };
    assert.equal("apiKeyHash" in body.agent, false);
    assert.equal("apiKey" in body.agent, false);
  });
});

test("an agent rotates its own key with its current key; another agent's key cannot", async () => {
  await withServer(async (server) => {
    const a = await registerAgent(server, ["swap"]);
    const b = await registerAgent(server, ["swap"]);
    // Wrong key for this agent is refused.
    const wrong = await post(`${server.url}/v1/agents/${a.agentId}/rotate-key`, {}, b.apiKey);
    assert.equal(wrong.status, 403);
    // No key at all is refused.
    const noAuth = await post(`${server.url}/v1/agents/${a.agentId}/rotate-key`, {});
    assert.equal(noAuth.status, 401);
    // The agent's own current key rotates it, and the old key then fails.
    const rotated = await post(`${server.url}/v1/agents/${a.agentId}/rotate-key`, {}, a.apiKey);
    assert.equal(rotated.status, 200);
    const { apiKey: newKey } = (await rotated.json()) as { apiKey: string };
    assert.notEqual(newKey, a.apiKey);
    const oldKeyGuard = await post(
      `${server.url}/v1/guard`,
      { schemaVersion: "rinne.guard-request.v1", agentId: a.agentId, action: { kind: "swap", chain: "mantle", tokenIn: { symbol: "MNT", decimals: 18 }, tokenOut: { symbol: "USDC", decimals: 6 }, amountIn: "100", minReceived: "52" } },
      a.apiKey
    );
    assert.equal(oldKeyGuard.status, 403);
  });
});

test("guard calls require a valid agent key", async () => {
  await withServer(async (server) => {
    const { agentId } = await registerAgent(server, ["swap"]);
    const noAuth = await post(`${server.url}/v1/guard`, {
      schemaVersion: "rinne.guard-request.v1",
      agentId,
      action: { kind: "swap", chain: "mantle", tokenIn: { symbol: "MNT", decimals: 18 }, tokenOut: { symbol: "USDC", decimals: 6 }, amountIn: "100", minReceived: "52" },
    });
    assert.equal(noAuth.status, 401);
    const badKey = await post(
      `${server.url}/v1/guard`,
      { schemaVersion: "rinne.guard-request.v1", agentId, action: { kind: "swap", chain: "mantle", tokenIn: { symbol: "MNT", decimals: 18 }, tokenOut: { symbol: "USDC", decimals: 6 }, amountIn: "100", minReceived: "52" } },
      "rinne_live_wrong"
    );
    assert.equal(badKey.status, 403);
  });
});

test("a key cannot guard for another agent", async () => {
  await withServer(async (server) => {
    const a = await registerAgent(server, ["swap"]);
    const b = await registerAgent(server, ["swap"]);
    const res = await post(
      `${server.url}/v1/guard`,
      {
        schemaVersion: "rinne.guard-request.v1",
        agentId: b.agentId, // mismatched
        action: { kind: "swap", chain: "mantle", tokenIn: { symbol: "MNT", decimals: 18 }, tokenOut: { symbol: "USDC", decimals: 6 }, amountIn: "100", minReceived: "52" },
      },
      a.apiKey
    );
    assert.equal(res.status, 403);
  });
});

test("an unlimited approval is blocked and the decision is persisted", async () => {
  await withServer(async (server) => {
    const { agentId, apiKey } = await registerAgent(server, ["approval"]);
    const maxUint = ((1n << 256n) - 1n).toString();
    const res = await post(
      `${server.url}/v1/guard`,
      {
        schemaVersion: "rinne.guard-request.v1",
        agentId,
        action: {
          kind: "approval",
          chain: "mantle",
          token: { symbol: "USDC", decimals: 6 },
          spender: "0x1111111111111111111111111111111111111111",
          amount: maxUint,
        },
      },
      apiKey
    );
    assert.equal(res.status, 200);
    const decision = (await res.json()) as { gate: string; decisionId: string };
    assert.equal(decision.gate, "block");

    // The decision is retrievable and listed (public reads).
    const fetched = await fetch(`${server.url}/api/decisions/${decision.decisionId}`);
    assert.equal(fetched.status, 200);
    const listed = (await (await fetch(`${server.url}/api/decisions?agentId=${agentId}`)).json()) as {
      decisions: Array<{ decisionId: string }>;
    };
    assert.ok(listed.decisions.some((d) => d.decisionId === decision.decisionId));
  });
});

test("a provider failure yields a saved review decision, never a hardcoded pass", async () => {
  await withServer(async (server) => {
    const { agentId, apiKey } = await registerAgent(server, ["approval"]);
    // A bounded approval to an unknown spender: rule math passes, but Nansen
    // (no key in tests) errors, so the gate must be review with the error
    // recorded on the decision.
    const res = await post(
      `${server.url}/v1/guard`,
      {
        schemaVersion: "rinne.guard-request.v1",
        agentId,
        action: {
          kind: "approval",
          chain: "mantle",
          token: { symbol: "USDC", decimals: 6 },
          spender: "0x2222222222222222222222222222222222222222",
          amount: "500",
        },
      },
      apiKey
    );
    assert.equal(res.status, 200);
    const decision = (await res.json()) as {
      gate: string;
      providerEvidence: Array<{ provider: string; status: string }>;
    };
    assert.equal(decision.gate, "review");
    const nansen = decision.providerEvidence.find((e) => e.provider === "nansen");
    assert.equal(nansen?.status, "error");
    // No evidence is ever recorded as "mock".
    assert.ok(decision.providerEvidence.every((e) => e.status === "live" || e.status === "error"));
  });
});

test("the agent skill is curl-installable with the live origin baked in", async () => {
  await withServer(async (server) => {
    const res = await fetch(`${server.url}/skill.md`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/markdown/);
    const body = await res.text();
    // The whole register-then-guard contract is present...
    assert.match(body, /\/v1\/register-agent/);
    assert.match(body, /\/v1\/guard/);
    // ...and the $RINNE_BASE_URL placeholder is replaced by this instance's
    // origin, so the curl examples are copy-paste ready.
    assert.equal(body.includes("$RINNE_BASE_URL"), false);
    assert.ok(body.includes(server.url), "served skill should reference this server's origin");
    // /skill is an alias for /skill.md.
    assert.equal((await fetch(`${server.url}/skill`)).status, 200);
  });
});

test("malformed guard requests are rejected with a field-level message", async () => {
  await withServer(async (server) => {
    const { agentId, apiKey } = await registerAgent(server, ["swap"]);
    const res = await post(
      `${server.url}/v1/guard`,
      {
        schemaVersion: "rinne.guard-request.v1",
        agentId,
        action: { kind: "swap", chain: "mantle", tokenIn: { symbol: "MNT", decimals: 18 }, tokenOut: { symbol: "USDC", decimals: 6 }, amountIn: "1e9", minReceived: "52" },
      },
      apiKey
    );
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /amountIn/);
  });
});
