import type { ProviderEvidence } from "../core/guard-types.js";
import { hashJson } from "../core/ids.js";

// Shared helpers for building provider evidence records. Evidence is always
// one of two honest states: "live" (a real provider answered, payload hash
// recorded) or "error" (the provider failed, the failure recorded). There is
// no mock state and no canned fallback — a failed provider pushes the guard
// gate toward review, never toward fake confidence.

export function liveEvidence(input: {
  provider: ProviderEvidence["provider"];
  purpose: ProviderEvidence["purpose"];
  rawPayload: unknown;
  summary: string;
  data?: Record<string, unknown>;
}): ProviderEvidence {
  return {
    provider: input.provider,
    status: "live",
    purpose: input.purpose,
    fetchedAt: new Date().toISOString(),
    payloadHash: hashJson(input.rawPayload),
    summary: input.summary,
    data: input.data,
  };
}

export function errorEvidence(input: {
  provider: ProviderEvidence["provider"];
  purpose: ProviderEvidence["purpose"];
  error: string;
}): ProviderEvidence {
  return {
    provider: input.provider,
    status: "error",
    purpose: input.purpose,
    fetchedAt: new Date().toISOString(),
    summary: `${input.provider} evidence unavailable: ${input.error}`,
    error: input.error,
  };
}

// Bounded fetch with a hard timeout, shared by provider adapters.
export async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    const message =
      (error as Error).name === "AbortError"
        ? `no response within ${timeoutMs / 1000}s`
        : (error as Error).message;
    throw new Error(message);
  } finally {
    clearTimeout(timer);
  }
}
