import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CreateAgentInput, GuardDecision, RegisteredAgent } from "./guard-types.js";
import { newAgentId } from "./ids.js";
import { createApiKey, verifyApiKey } from "./api-keys.js";

// File-backed store for the hosted guard: registered agents and the guard
// decisions issued for them. Plain JSON files keep the hosted MVP inspectable
// with nothing but `cat` — an operator can audit exactly what Rinne knows
// about an agent without a database client. The store persists only the
// SHA-256 hash of each agent's API key; the plaintext key exists exactly once,
// in the return value of createAgent, and is never written to disk or logs.

export interface GuardStore {
  listAgents(): Promise<RegisteredAgent[]>;
  getAgent(agentId: string): Promise<RegisteredAgent | null>;
  createAgent(input: CreateAgentInput): Promise<{ agent: RegisteredAgent; apiKey: string }>;
  updateAgent(agent: RegisteredAgent): Promise<void>;
  listDecisions(agentId?: string): Promise<GuardDecision[]>;
  getDecision(decisionId: string): Promise<GuardDecision | null>;
  saveDecision(decision: GuardDecision): Promise<void>;
}

// A missing file just means nothing has been stored yet, so the store starts
// from an empty array instead of failing first-run setups. Anything else —
// unreadable file, corrupt JSON, wrong top-level shape — is surfaced loudly,
// because silently dropping stored agents or decisions would be worse than
// refusing to serve.
async function readJsonArray<T>(filePath: string): Promise<T[]> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw new Error(`Cannot read store file "${filePath}": ${(error as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Store file "${filePath}" is not valid JSON: ${(error as Error).message}. ` +
        `Restore it from a backup or delete it to start the store empty.`
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      `Store file "${filePath}" must contain a JSON array, got ${typeof parsed}. ` +
        `Restore it from a backup or delete it to start the store empty.`
    );
  }
  return parsed as T[];
}

// Write-to-temp-then-rename so a crash mid-write never leaves a truncated
// store file behind: readers see either the old contents or the new ones.
async function writeJsonArrayAtomic(filePath: string, rows: unknown[]): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(rows, null, 2) + "\n", "utf8");
  await rename(tmpPath, filePath);
}

export function createGuardStore(rootDir: string): GuardStore {
  const agentsPath = join(rootDir, "agents.json");
  const decisionsPath = join(rootDir, "decisions.json");

  // In-process mutex: every operation is appended to one promise chain, so a
  // read can never observe a half-finished read-modify-write from a
  // concurrent request handler. The chain swallows rejections from earlier
  // operations so one failed save does not poison every later call — each
  // caller still receives its own operation's rejection.
  let chain: Promise<unknown> = Promise.resolve();
  function withLock<T>(operation: () => Promise<T>): Promise<T> {
    const result = chain.then(operation);
    chain = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  return {
    listAgents(): Promise<RegisteredAgent[]> {
      return withLock(() => readJsonArray<RegisteredAgent>(agentsPath));
    },

    getAgent(agentId: string): Promise<RegisteredAgent | null> {
      return withLock(async () => {
        const agents = await readJsonArray<RegisteredAgent>(agentsPath);
        return agents.find((agent) => agent.id === agentId) ?? null;
      });
    },

    createAgent(input: CreateAgentInput): Promise<{ agent: RegisteredAgent; apiKey: string }> {
      return withLock(async () => {
        const key = createApiKey();
        const now = new Date().toISOString();
        const agent: RegisteredAgent = {
          id: newAgentId(),
          name: input.name,
          owner: input.owner,
          endpointUrl: input.endpointUrl,
          supportedActions: [...input.supportedActions],
          guardMode: input.guardMode,
          apiKeyHash: key.hash,
          createdAt: now,
          updatedAt: now,
        };
        const agents = await readJsonArray<RegisteredAgent>(agentsPath);
        agents.push(agent);
        await writeJsonArrayAtomic(agentsPath, agents);
        // The plaintext key leaves the store exactly here and nowhere else.
        // The caller must show it to the agent owner once; only the hash is
        // ever stored, so a lost key means re-registering.
        return { agent, apiKey: key.plaintext };
      });
    },

    updateAgent(agent: RegisteredAgent): Promise<void> {
      return withLock(async () => {
        const agents = await readJsonArray<RegisteredAgent>(agentsPath);
        const index = agents.findIndex((existing) => existing.id === agent.id);
        if (index === -1) {
          throw new Error(
            `Cannot update agent "${agent.id}": no agent with that id is registered. ` +
              `Register it first with createAgent.`
          );
        }
        agents[index] = { ...agent, updatedAt: new Date().toISOString() };
        await writeJsonArrayAtomic(agentsPath, agents);
      });
    },

    listDecisions(agentId?: string): Promise<GuardDecision[]> {
      return withLock(async () => {
        const decisions = await readJsonArray<GuardDecision>(decisionsPath);
        const filtered =
          agentId === undefined
            ? decisions
            : decisions.filter((decision) => decision.agentId === agentId);
        // Newest first: the hosted dashboard and CLI show the latest guard
        // verdicts at the top, and ISO-8601 timestamps sort correctly as
        // plain strings.
        return [...filtered].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      });
    },

    getDecision(decisionId: string): Promise<GuardDecision | null> {
      return withLock(async () => {
        const decisions = await readJsonArray<GuardDecision>(decisionsPath);
        return decisions.find((decision) => decision.decisionId === decisionId) ?? null;
      });
    },

    saveDecision(decision: GuardDecision): Promise<void> {
      return withLock(async () => {
        const decisions = await readJsonArray<GuardDecision>(decisionsPath);
        // Upsert by decisionId so a retried save (for example after a network
        // hiccup between the engine and its caller) never duplicates a
        // decision in the audit log.
        const index = decisions.findIndex(
          (existing) => existing.decisionId === decision.decisionId
        );
        if (index === -1) {
          decisions.push(decision);
        } else {
          decisions[index] = decision;
        }
        await writeJsonArrayAtomic(decisionsPath, decisions);
      });
    },
  };
}

// Chosen over adding getAgentByKeyHash to the GuardStore interface: keeping
// the store interface exactly to CRUD keeps every implementation trivial,
// and key lookup is a pure composition on top of listAgents. Comparison goes
// through verifyApiKey (constant-time over the hash digests), so this matches
// the documented timing-attack defense rather than a plain string compare.
export async function findAgentByApiKey(
  store: GuardStore,
  plaintextKey: string
): Promise<RegisteredAgent | null> {
  const agents = await store.listAgents();
  return agents.find((agent) => verifyApiKey(plaintextKey, agent.apiKeyHash)) ?? null;
}
