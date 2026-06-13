import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { createGuardStore, findAgentByApiKey } from "../src/core/guard-store.js";
import { hashApiKey } from "../src/core/api-keys.js";
import { newDecisionId } from "../src/core/ids.js";
import type { CreateAgentInput, GuardDecision } from "../src/core/guard-types.js";

function makeAgentInput(overrides: Partial<CreateAgentInput> = {}): CreateAgentInput {
  return {
    name: "yield-rebalancer",
    owner: { kind: "email", value: "owner@example.com" },
    supportedActions: ["swap", "approval"],
    guardMode: "enforce",
    ...overrides,
  };
}

function makeDecision(overrides: Partial<GuardDecision> = {}): GuardDecision {
  return {
    schemaVersion: "rinne.guard-decision.v1",
    decisionId: newDecisionId(),
    agentId: "agt_test",
    createdAt: "2026-06-13T10:00:00.000Z",
    gate: "proceed",
    action: {
      kind: "swap",
      chain: "mantle",
      tokenIn: { symbol: "MNT", decimals: 18 },
      tokenOut: { symbol: "USDC", decimals: 6 },
      amountIn: "100",
      minReceived: "52.40",
      maxSlippageBps: 100,
    },
    providerEvidence: [],
    ruleResults: [],
    summary: "All swap rules passed.",
    reportHash: "sha256:deadbeef",
    ...overrides,
  };
}

function withTempStoreDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "rinne-guard-store-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("createAgent stores only the key hash and returns the plaintext once", async () => {
  const { dir, cleanup } = withTempStoreDir();
  try {
    const store = createGuardStore(dir);
    const { agent, apiKey } = await store.createAgent(makeAgentInput());

    // The plaintext key must be usable by the caller but unrecoverable from
    // anything the store persists.
    assert.notEqual(apiKey, agent.apiKeyHash);
    assert.equal(agent.apiKeyHash, hashApiKey(apiKey));
    assert.match(agent.id, /^agt_/);
    assert.equal(agent.createdAt, agent.updatedAt);

    const agents = await store.listAgents();
    assert.equal(agents.length, 1);
    assert.equal(agents[0]?.id, agent.id);
    assert.equal(agents[0]?.name, "yield-rebalancer");

    const fetched = await store.getAgent(agent.id);
    assert.ok(fetched);
    assert.equal(fetched.apiKeyHash, agent.apiKeyHash);
    assert.equal(await store.getAgent("agt_missing"), null);

    // The plaintext key must never reach disk in any form.
    const onDisk = readFileSync(join(dir, "agents.json"), "utf8");
    assert.ok(!onDisk.includes(apiKey));
    assert.ok(onDisk.includes(agent.apiKeyHash));
  } finally {
    cleanup();
  }
});

test("findAgentByApiKey resolves the agent for the right key only", async () => {
  const { dir, cleanup } = withTempStoreDir();
  try {
    const store = createGuardStore(dir);
    const { agent, apiKey } = await store.createAgent(makeAgentInput());

    const found = await findAgentByApiKey(store, apiKey);
    assert.equal(found?.id, agent.id);
    assert.equal(await findAgentByApiKey(store, "rinne_live_wrongkey"), null);
  } finally {
    cleanup();
  }
});

test("decisions list newest first and filter by agentId", async () => {
  const { dir, cleanup } = withTempStoreDir();
  try {
    const store = createGuardStore(dir);
    const oldest = makeDecision({ agentId: "agt_a", createdAt: "2026-06-13T08:00:00.000Z" });
    const newest = makeDecision({ agentId: "agt_a", createdAt: "2026-06-13T12:00:00.000Z" });
    const other = makeDecision({ agentId: "agt_b", createdAt: "2026-06-13T10:00:00.000Z" });
    // Save out of chronological order to prove the store sorts on read.
    await store.saveDecision(newest);
    await store.saveDecision(oldest);
    await store.saveDecision(other);

    const all = await store.listDecisions();
    assert.deepEqual(
      all.map((decision) => decision.decisionId),
      [newest.decisionId, other.decisionId, oldest.decisionId]
    );

    const onlyA = await store.listDecisions("agt_a");
    assert.deepEqual(
      onlyA.map((decision) => decision.decisionId),
      [newest.decisionId, oldest.decisionId]
    );

    const fetched = await store.getDecision(oldest.decisionId);
    assert.equal(fetched?.createdAt, "2026-06-13T08:00:00.000Z");
    assert.equal(await store.getDecision("dec_missing"), null);
  } finally {
    cleanup();
  }
});

test("store files are created under the given root directory", async () => {
  const { dir, cleanup } = withTempStoreDir();
  try {
    // Point the store at a nested directory that does not exist yet, so this
    // also proves directories are created recursively on first write.
    const root = join(dir, "artifacts", "store");
    const store = createGuardStore(root);
    await store.createAgent(makeAgentInput());
    await store.saveDecision(makeDecision());

    assert.ok(existsSync(join(root, "agents.json")));
    assert.ok(existsSync(join(root, "decisions.json")));
    // The temp files from atomic writes must not linger after a save.
    assert.ok(!existsSync(join(root, "agents.json.tmp")));
    assert.ok(!existsSync(join(root, "decisions.json.tmp")));
  } finally {
    cleanup();
  }
});

test("a second store instance sees data persisted by the first", async () => {
  const { dir, cleanup } = withTempStoreDir();
  try {
    const first = createGuardStore(dir);
    const { agent } = await first.createAgent(makeAgentInput({ name: "persisted-agent" }));
    const decision = makeDecision({ agentId: agent.id });
    await first.saveDecision(decision);

    const second = createGuardStore(dir);
    const reloadedAgent = await second.getAgent(agent.id);
    assert.equal(reloadedAgent?.name, "persisted-agent");
    const reloadedDecisions = await second.listDecisions(agent.id);
    assert.equal(reloadedDecisions[0]?.decisionId, decision.decisionId);
  } finally {
    cleanup();
  }
});

test("updateAgent persists lastSeenAt and refreshes updatedAt", async () => {
  const { dir, cleanup } = withTempStoreDir();
  try {
    const store = createGuardStore(dir);
    const { agent } = await store.createAgent(makeAgentInput());

    // A short pause so the refreshed updatedAt timestamp is observably later
    // than the one set at creation.
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
    await store.updateAgent({ ...agent, lastSeenAt: "2026-06-13T12:34:56.000Z" });

    const reloaded = createGuardStore(dir);
    const updated = await reloaded.getAgent(agent.id);
    assert.ok(updated);
    assert.equal(updated.lastSeenAt, "2026-06-13T12:34:56.000Z");
    assert.ok(updated.updatedAt > agent.updatedAt);
    assert.equal(updated.createdAt, agent.createdAt);
  } finally {
    cleanup();
  }
});

test("updateAgent rejects unknown agents with an actionable error", async () => {
  const { dir, cleanup } = withTempStoreDir();
  try {
    const store = createGuardStore(dir);
    const { agent } = await store.createAgent(makeAgentInput());
    await assert.rejects(
      store.updateAgent({ ...agent, id: "agt_unknown" }),
      /no agent with that id is registered/
    );
  } finally {
    cleanup();
  }
});

test("concurrent saves serialize through the mutex without losing writes", async () => {
  const { dir, cleanup } = withTempStoreDir();
  try {
    const store = createGuardStore(dir);
    const decisions = Array.from({ length: 8 }, (_, index) =>
      makeDecision({ createdAt: `2026-06-13T0${index}:00:00.000Z` })
    );
    // Fire every save at once; without the in-process lock these
    // read-modify-write cycles would clobber each other.
    await Promise.all(decisions.map((decision) => store.saveDecision(decision)));

    const listed = await store.listDecisions();
    assert.equal(listed.length, decisions.length);
    const listedIds = new Set(listed.map((decision) => decision.decisionId));
    for (const decision of decisions) {
      assert.ok(listedIds.has(decision.decisionId));
    }
  } finally {
    cleanup();
  }
});

test("saveDecision upserts by decisionId instead of duplicating", async () => {
  const { dir, cleanup } = withTempStoreDir();
  try {
    const store = createGuardStore(dir);
    const decision = makeDecision();
    await store.saveDecision(decision);
    await store.saveDecision({ ...decision, summary: "Retried save." });

    const listed = await store.listDecisions();
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.summary, "Retried save.");
  } finally {
    cleanup();
  }
});
