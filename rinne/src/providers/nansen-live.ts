import type { Chain, ProviderEvidence } from "../core/guard-types.js";
import { errorEvidence, fetchJsonWithTimeout, liveEvidence } from "./provider-evidence.js";
import { detectHighRiskLabel } from "./risk-signal.js";

// Live Nansen address-label evidence for approval and lending guard decisions.
// Nansen's public API exposes risk as address *labels* (there is no numeric
// risk score), so this adapter fetches the labels for one address and folds
// them into provider evidence. A missing key or a failed fetch returns status
// "error" — never canned labels — and the rule layer turns that into review.
//
// API shape (docs.nansen.ai, verified 2026-06): POST to
// {base}/profiler/address/labels with header `apikey: <key>` and a JSON body
// { address, chain, pagination }. Mantle is an accepted chain value. The
// response is { data: [ { label, category } ] }.

const NANSEN_TIMEOUT_MS = 15_000;
const DEFAULT_NANSEN_BASE = "https://api.nansen.ai/api/v1";

export interface NansenRiskEvidenceInput {
  chain: Chain;
  address: string;
  purpose: "spender-risk" | "protocol-risk";
}

function nansenBase(): string {
  return process.env.NANSEN_API_URL || DEFAULT_NANSEN_BASE;
}

export async function fetchNansenRiskEvidence(
  input: NansenRiskEvidenceInput
): Promise<ProviderEvidence> {
  const apiKey = process.env.NANSEN_API_KEY;
  if (!apiKey) {
    // A missing key is an operator/config error, surfaced as an error evidence
    // record (which pushes the gate to review) rather than canned data. In
    // hosted/judged mode the server refuses to start without the key at all.
    return errorEvidence({
      provider: "nansen",
      purpose: input.purpose,
      error: "NANSEN_API_KEY is not set",
    });
  }

  // Plain names (e.g. "lendle") are valid action references but cannot be
  // looked up by Nansen, which keys on addresses. Record that honestly.
  if (!/^0x[0-9a-fA-F]{40}$/.test(input.address)) {
    return errorEvidence({
      provider: "nansen",
      purpose: input.purpose,
      error: `"${input.address}" is not an on-chain address; Nansen labels require an address`,
    });
  }

  let raw: unknown;
  try {
    raw = await fetchJsonWithTimeout(
      `${nansenBase()}/profiler/address/labels`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: apiKey },
        // One large page (the documented max) rather than just the first 100,
        // so a risk label ranked deep in a heavily-labeled address is not
        // missed — under-detection in a risk gate fails open.
        body: JSON.stringify({
          address: input.address,
          chain: input.chain,
          pagination: { page: 1, per_page: 1000 },
        }),
      },
      NANSEN_TIMEOUT_MS
    );
  } catch (error) {
    return errorEvidence({
      provider: "nansen",
      purpose: input.purpose,
      error: `Nansen label fetch for ${input.address} failed: ${(error as Error).message}`,
    });
  }

  // Strict shape check: a 200 that is not the documented { data: [ ... ] }
  // envelope (a schema change, an error body returned with 200, an HTML error
  // page, etc.) must NOT be read as "no labels" — that would fail open and let
  // a risky spender proceed. Treat it as unverified evidence -> review.
  if (!Array.isArray((raw as { data?: unknown })?.data)) {
    return errorEvidence({
      provider: "nansen",
      purpose: input.purpose,
      error: `Nansen response for ${input.address} was not the expected { data: [...] } shape; treating risk as unverified`,
    });
  }

  const { labels, categories } = extractLabels(raw);
  const data: Record<string, unknown> = {
    address: input.address,
    chain: input.chain,
    labels,
    categories,
  };
  const highRisk = detectHighRiskLabel(data);
  const summary =
    labels.length === 0
      ? `Nansen returned no labels for ${input.address}.`
      : `Nansen labels for ${input.address}: ${labels.join(", ")}${highRisk ? ` (high risk: ${highRisk})` : ""}.`;

  return liveEvidence({
    provider: "nansen",
    purpose: input.purpose,
    rawPayload: raw,
    summary,
    data: { ...data, riskFlagged: highRisk !== null },
  });
}

function extractLabels(raw: unknown): { labels: string[]; categories: string[] } {
  const labels: string[] = [];
  const categories: string[] = [];
  const data = (raw as { data?: unknown })?.data;
  if (Array.isArray(data)) {
    for (const row of data) {
      if (row && typeof row === "object") {
        const label = (row as Record<string, unknown>)["label"];
        const category = (row as Record<string, unknown>)["category"];
        if (typeof label === "string") labels.push(label);
        if (typeof category === "string") categories.push(category);
      }
    }
  }
  return { labels, categories };
}
