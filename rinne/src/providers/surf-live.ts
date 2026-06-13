import type { Chain, ProviderEvidence, TokenRef } from "../core/guard-types.js";
import { normalizeMarketPayload, surfApiBase } from "../adapters/surf.js";
import type { ProviderPayload } from "../core/types.js";
import { errorEvidence, fetchJsonWithTimeout, liveEvidence } from "./provider-evidence.js";

const SURF_TIMEOUT_MS = 15_000;

export interface SurfMarketEvidenceInput {
  tokenIn: TokenRef;
  tokenOut: TokenRef;
  chain: Chain;
}

// Live Surf market evidence for swap guard decisions: the tokenIn price,
// its freshness, and the derived confidence, with the raw payload hashed
// into the decision record. A Surf failure returns status "error" — never
// canned data — and the rule layer turns that into a review gate.
export async function fetchSurfMarketEvidence(
  input: SurfMarketEvidenceInput
): Promise<ProviderEvidence> {
  const symbol = input.tokenIn.symbol;
  const base = surfApiBase();
  const query = new URLSearchParams({ symbol, time_range: "1d" });
  const headers: Record<string, string> = {};
  if (process.env.SURF_API_KEY) {
    headers.Authorization = `Bearer ${process.env.SURF_API_KEY}`;
  }

  let raw: unknown;
  try {
    raw = await fetchJsonWithTimeout(
      `${base}/v1/market/price?${query.toString()}`,
      { headers },
      SURF_TIMEOUT_MS
    );
  } catch (error) {
    return errorEvidence({
      provider: "surf",
      purpose: "market-signal",
      error: `Surf market fetch for ${symbol} failed: ${(error as Error).message}`,
    });
  }

  const payload: ProviderPayload = {
    provider: "surf",
    operation: "market-price",
    params: { symbol, timeRange: "1d" },
    fetchedAt: new Date().toISOString(),
    raw,
    cacheStatus: "live",
  };

  try {
    const signal = normalizeMarketPayload(payload);
    const ageMinutes = Math.max(
      0,
      Math.round((Date.parse(payload.fetchedAt) - Date.parse(signal.observedAt)) / 60_000)
    );
    return liveEvidence({
      provider: "surf",
      purpose: "market-signal",
      rawPayload: raw,
      summary:
        `Surf ${signal.symbol} price ${signal.priceUsd} USD, observed ${ageMinutes} min ` +
        `before fetch, confidence ${signal.confidence}.`,
      data: {
        symbol: signal.symbol,
        priceUsd: signal.priceUsd,
        observedAt: signal.observedAt,
        confidence: signal.confidence,
        ageMinutes,
        tokenOut: input.tokenOut.symbol,
      },
    });
  } catch (error) {
    // The provider answered but not in the documented shape: record the
    // adapter error; do not guess.
    return errorEvidence({
      provider: "surf",
      purpose: "market-signal",
      error: `Surf payload for ${symbol} did not normalize: ${(error as Error).message}`,
    });
  }
}
