import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ActionKind,
  DefiAction,
  Gate,
  GuardRuleResult,
  ProviderEvidence,
} from "../core/guard-types.js";
import { swapRules } from "./rules/swap.js";
import { approvalRules } from "./rules/approval.js";
import { lendingRules } from "./rules/lending.js";

// The rule engine judges one DeFi action against two distinct inputs that we
// deliberately keep separate: operator policy (allowlists the Rinne operator
// verified out-of-band) and provider evidence (live observations from Surf
// and Nansen). Rules are pure functions of the GuardRuleContext, so the same
// action, evidence, allowlists, and clock always produce the same decision —
// that determinism is what makes a recorded GuardDecision auditable later.

export interface AllowlistEntry {
  // On-chain address of the spender or protocol. Optional because early
  // integrations may reference a well-known protocol by name only.
  address?: string;
  // Human-readable name surfaced in decisions, e.g. "AGNI router".
  name: string;
  // Where the operator verified this entry, e.g. "mantle-docs", "team-review".
  source: string;
}

export interface GuardAllowlists {
  // Approval spender contracts the operator has verified, keyed by chain.
  spenders: Record<string, AllowlistEntry[]>;
  // Lending protocols the operator has verified, keyed by chain.
  protocols: Record<string, AllowlistEntry[]>;
  // Approval size cap in human token units; perToken overrides by symbol.
  approvalAmountThreshold: {
    default: string;
    perToken: Record<string, string>;
  };
}

export interface GuardRuleContext {
  action: DefiAction;
  evidence: ProviderEvidence[];
  allowlists: GuardAllowlists;
  // The clock is injected rather than read inside rules so freshness checks
  // are deterministic and replayable in tests and audits.
  now: Date;
}

export interface GuardRule {
  id: string;
  appliesTo: ActionKind[];
  evaluate(ctx: GuardRuleContext): GuardRuleResult;
}

// Every rule the engine knows about, in evaluation order. evaluate.ts selects
// the subset whose appliesTo matches the action kind.
export const guardRules: GuardRule[] = [...swapRules, ...approvalRules, ...lendingRules];

// A reference is allowlisted only if it matches an entry's on-chain ADDRESS
// (case-insensitive). Matching by name is deliberately NOT allowed: the
// allowlist fast-path skips the live risk provider, so granting it on a
// free-text label an agent supplies (e.g. spender: "Agni Finance SwapRouter")
// would let an unverified address ride a trusted name to `proceed`. You only
// earn the skip-the-provider fast-path by submitting a real address the
// operator verified; a name falls through to the provider (and, not being an
// address, to `review`). The matched entry's name is still returned so rules
// can cite the operator's source.
export function isAllowlisted(entries: AllowlistEntry[], ref: string): AllowlistEntry | null {
  const lower = ref.toLowerCase();
  return (
    entries.find((entry) => entry.address !== undefined && entry.address.toLowerCase() === lower) ??
    null
  );
}

// Gate policy: a critical failure is a hard stop; a warning failure means a
// human should look before funds move; and a provider error means the guard
// could not see what it normally sees, so the action goes to review rather
// than proceeding blind — even when every rule that could run passed.
export function computeGate(ruleResults: GuardRuleResult[], evidence: ProviderEvidence[]): Gate {
  const failures = ruleResults.filter((result) => result.status === "fail");
  if (failures.some((result) => result.severity === "critical")) {
    return "block";
  }
  if (failures.some((result) => result.severity === "warning")) {
    return "review";
  }
  if (evidence.some((item) => item.status === "error")) {
    return "review";
  }
  return "proceed";
}

// The built-in approval cap mirrors the shipped config's default so a missing
// config file degrades to the same posture as the shipped one, not to "no
// cap at all".
const DEFAULT_APPROVAL_THRESHOLD = "1000000";

export function emptyAllowlists(): GuardAllowlists {
  return {
    spenders: {},
    protocols: {},
    approvalAmountThreshold: { default: DEFAULT_APPROVAL_THRESHOLD, perToken: {} },
  };
}

// Compiled location is dist/src/guard/, so the package root is three levels
// up — the same resolution doctor.ts uses for its probes.
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DEFAULT_CONFIG_PATH = join(PACKAGE_ROOT, "config", "guard-allowlists.json");

// Loads operator policy. Resolution order: explicit path argument, then the
// RINNE_GUARD_CONFIG environment variable, then the packaged default. A
// missing file is a valid deployment state (the guard runs with empty policy
// and unknown spenders/protocols simply do not get the allowlist fast-path),
// but a file that exists and cannot be read or parsed is a configuration bug
// the operator must fix, so those throw with actionable messages.
export function loadAllowlists(path?: string): GuardAllowlists {
  const configPath = path ?? process.env.RINNE_GUARD_CONFIG ?? DEFAULT_CONFIG_PATH;
  let text: string;
  try {
    text = readFileSync(configPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyAllowlists();
    }
    throw new Error(
      `Could not read guard allowlist config at ${configPath}: ${(error as Error).message}. ` +
        `Fix the file permissions or point RINNE_GUARD_CONFIG at a readable file.`
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Guard allowlist config at ${configPath} is not valid JSON: ${(error as Error).message}. ` +
        `Repair the file, or delete it to run with empty allowlists.`
    );
  }
  return normalizeAllowlists(parsed);
}

// Config normalization is lenient: unknown fields are ignored and malformed
// entries are dropped rather than crashing the guard, because a half-broken
// allowlist should degrade to "fewer fast-paths", never to "guard down".
function normalizeAllowlists(parsed: unknown): GuardAllowlists {
  const base = emptyAllowlists();
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return base;
  }
  const record = parsed as Record<string, unknown>;
  return {
    spenders: normalizeEntryMap(record["spenders"]),
    protocols: normalizeEntryMap(record["protocols"]),
    approvalAmountThreshold: normalizeThresholds(record["approvalAmountThreshold"]),
  };
}

function normalizeEntryMap(value: unknown): Record<string, AllowlistEntry[]> {
  const out: Record<string, AllowlistEntry[]> = {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return out;
  }
  for (const [chain, rawEntries] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(rawEntries)) continue;
    const entries: AllowlistEntry[] = [];
    for (const raw of rawEntries) {
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) continue;
      const candidate = raw as Record<string, unknown>;
      const name = candidate["name"];
      if (typeof name !== "string" || name.length === 0) continue;
      const entry: AllowlistEntry = {
        name,
        source: typeof candidate["source"] === "string" ? candidate["source"] : "unspecified",
      };
      if (typeof candidate["address"] === "string") {
        entry.address = candidate["address"];
      }
      entries.push(entry);
    }
    out[chain] = entries;
  }
  return out;
}

function normalizeThresholds(value: unknown): GuardAllowlists["approvalAmountThreshold"] {
  const result: GuardAllowlists["approvalAmountThreshold"] = {
    default: DEFAULT_APPROVAL_THRESHOLD,
    perToken: {},
  };
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return result;
  }
  const record = value as Record<string, unknown>;
  // Thresholds must be plain decimals. A non-numeric value (a locale-formatted
  // "1,000,000", a typo) is dropped rather than kept, because a kept-but-
  // unparseable cap would make Number() yield NaN and silently disable the
  // approval-amount rule — a guard that fails open on operator typo. Dropping
  // it falls back to the built-in default instead.
  if (isPlainDecimal(record["default"])) {
    result.default = record["default"] as string;
  }
  const perToken = record["perToken"];
  if (perToken !== null && typeof perToken === "object" && !Array.isArray(perToken)) {
    for (const [symbol, threshold] of Object.entries(perToken as Record<string, unknown>)) {
      if (isPlainDecimal(threshold)) {
        result.perToken[symbol] = threshold as string;
      }
    }
  }
  return result;
}

function isPlainDecimal(value: unknown): boolean {
  return typeof value === "string" && /^\d+(\.\d+)?$/.test(value);
}
