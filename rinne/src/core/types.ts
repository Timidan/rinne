// Core types shared by the live providers (Surf) and the guard's swap rules.

export type CacheStatus = "live" | "replay";

// A Payload is a raw provider response before Rinne normalizes it.
export interface ProviderPayload {
  provider: "surf";
  operation: string;
  params: Record<string, unknown>;
  fetchedAt: string;
  raw: unknown;
  cacheStatus: CacheStatus;
}

// A Signal is the normalized market data the guard's swap rules consume.
export interface MarketSignal {
  kind: "market";
  symbol: string;
  // Optional: a Surf payload can lack a usable price, in which case the
  // swap-market-evidence rule sends the decision to review.
  priceUsd?: string;
  observedAt: string;
  confidence: number;
  sourceFields: Record<string, string>;
}
