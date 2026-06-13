import type { MarketSignal, ProviderPayload } from "../core/types.js";
import { formatDecimal, parseDecimal } from "../core/decimal.js";

const SIGNAL_SCALE = 6;

// Base URL of the Surf Data API gateway. Overridable for tests.
const SURF_API_BASE_ENV = "SURF_API_URL";
const DEFAULT_SURF_API_BASE = "https://api.asksurf.ai/gateway";

export function surfApiBase(): string {
  return process.env[SURF_API_BASE_ENV] || DEFAULT_SURF_API_BASE;
}

function requireRawField(value: unknown, path: string): unknown {
  if (value === undefined || value === null) {
    throw new Error(`Surf Payload is missing required field ${path}`);
  }
  return value;
}

// Confidence for the real Surf market-price shape is not provided by the API;
// Rinne derives it deterministically from Signal freshness (newest data point
// age relative to fetchedAt), so replay from the Trace gives the same number.
function confidenceFromFreshness(ageMinutes: number): number {
  if (ageMinutes <= 15) return 0.95;
  if (ageMinutes <= 120) return 0.9;
  if (ageMinutes <= 360) return 0.8;
  return 0.5;
}

interface SurfPricePoint {
  symbol?: string;
  metric?: string;
  value?: number;
  timestamp?: number;
}

// Normalizes the real Surf Data API market-price response: a series of
// { metric: "price", value, timestamp } points. The newest point becomes the
// Signal price.
function normalizeSurfPriceSeries(payload: ProviderPayload): MarketSignal {
  const raw = payload.raw as { symbol?: unknown; data?: SurfPricePoint[] };
  const symbol = String(requireRawField(raw.symbol, "raw.symbol"));
  const points = (raw.data ?? []).filter(
    (point) =>
      point.metric === "price" &&
      typeof point.value === "number" &&
      Number.isFinite(point.value) &&
      point.value > 0 &&
      typeof point.timestamp === "number" &&
      // A point tagged for a different asset must never price this Signal.
      (point.symbol === undefined || point.symbol === symbol)
  );
  if (points.length === 0) {
    throw new Error("Surf Payload has no usable price points in raw.data");
  }
  const latest = points.reduce((a, b) => ((a.timestamp ?? 0) >= (b.timestamp ?? 0) ? a : b));
  const observedAtMs = (latest.timestamp as number) * 1000;
  const observedAt = new Date(observedAtMs).toISOString();

  const fetchedMs = Date.parse(payload.fetchedAt);
  if (Number.isNaN(fetchedMs)) {
    throw new Error(`Surf Payload fetchedAt is not a valid timestamp: "${payload.fetchedAt}"`);
  }
  const ageMinutes = (fetchedMs - observedAtMs) / 60_000;
  // Data claiming to come from the future (beyond small clock skew) is as
  // suspect as stale data; never give it fresh-data confidence.
  const confidence =
    ageMinutes < -5 ? 0.5 : confidenceFromFreshness(Math.max(0, ageMinutes));
  const priceUsd = formatDecimal(
    parseDecimal((latest.value as number).toFixed(SIGNAL_SCALE), SIGNAL_SCALE),
    SIGNAL_SCALE
  );

  return {
    kind: "market",
    symbol,
    priceUsd,
    observedAt,
    confidence,
    sourceFields: {
      symbol: "raw.symbol",
      priceUsd: "raw.data[latest].value",
      observedAt: "raw.data[latest].timestamp",
      confidence: "derived:freshness(raw.data[latest].timestamp vs fetchedAt)",
    },
  };
}

// Normalizes a raw Surf market-price Payload into the stable MarketSignal
// fields Rinne can perturb. Only the real Surf Data API shape is supported:
// a series of price points under raw.data. Provider-specific parsing stays
// isolated to this adapter.
export function normalizeMarketPayload(payload: ProviderPayload): MarketSignal {
  const raw = payload.raw as { data?: unknown } | null;
  if (!raw || !Array.isArray(raw.data)) {
    throw new Error(
      "Surf Payload raw.data must be an array of price points " +
        "(the Surf Data API market-price shape)"
    );
  }
  return normalizeSurfPriceSeries(payload);
}
