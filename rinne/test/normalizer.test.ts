import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMarketPayload } from "../src/adapters/surf.js";
import type { ProviderPayload } from "../src/core/types.js";

// A representative live Surf market-price Payload, stated inline. Rinne ships
// no canned data, so each test declares the exact market it needs. Fixed
// timestamps keep the freshness-derived confidence deterministic: the newest
// point is 60 seconds older than fetchedAt, which lands at the top of the
// confidence ladder.
const FETCHED_AT = "2026-06-10T12:00:00Z";
const FETCHED_SEC = Date.parse(FETCHED_AT) / 1000;
const LATEST_SEC = FETCHED_SEC - 60;

function makePayload(): ProviderPayload {
  return {
    provider: "surf",
    operation: "market-price",
    params: {},
    fetchedAt: FETCHED_AT,
    cacheStatus: "live",
    raw: {
      symbol: "MNT",
      data: [
        { symbol: "MNT", metric: "price", value: 0.51, timestamp: LATEST_SEC - 7200 },
        { symbol: "MNT", metric: "price", value: 0.52, timestamp: LATEST_SEC - 3600 },
        { symbol: "MNT", metric: "price", value: 0.53, timestamp: LATEST_SEC },
      ],
    },
  };
}

test("normalizer creates the expected Signal fields from a live-shaped Payload", () => {
  const signal = normalizeMarketPayload(makePayload());

  assert.equal(signal.kind, "market");
  assert.equal(signal.symbol, "MNT");
  // The newest point in the series prices the Signal, fixed-point at scale 6.
  assert.equal(signal.priceUsd, "0.530000");
  assert.equal(signal.observedAt, new Date(LATEST_SEC * 1000).toISOString());
  // The fetch happened moments after the newest point, so freshness-derived
  // confidence is at the top of the ladder.
  assert.equal(signal.confidence, 0.95);
  assert.equal(signal.sourceFields.priceUsd, "raw.data[latest].value");
});

test("normalizer rejects a Payload with no usable price points", () => {
  assert.throws(
    () => normalizeMarketPayload({ ...makePayload(), raw: { symbol: "MNT", data: [] } }),
    /no usable price points/
  );
});

test("normalizer rejects a Payload that is not the Surf series shape", () => {
  assert.throws(
    () =>
      normalizeMarketPayload({
        ...makePayload(),
        raw: { data: { symbol: "MNT", price_usd: "0.53" } },
      }),
    /raw\.data must be an array/
  );
});
