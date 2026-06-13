import { createHash, randomUUID } from "node:crypto";

// Deterministic-where-it-matters ID helpers. Entity IDs are random; hashes
// of content (decisions, payloads, metadata) are SHA-256 so anyone can
// recompute and verify them.

export function newAgentId(): string {
  return `agt_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export function newDecisionId(): string {
  return `dec_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

// Canonical content hash for JSON values: stable key order, no whitespace.
export function hashJson(value: unknown): string {
  return `sha256:${sha256Hex(canonicalJson(value))}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
  return `{${entries.join(",")}}`;
}
