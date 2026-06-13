// Example external Agent for Rinne: one exported decide(input) function.
//
// Test it against any Scenario:
//   node dist/src/cli/index.js run scenarios/mnt-stale-price-swap.json \
//     --agent examples/agents/threshold-agent.mjs
//
// input = { scenarioId, signal, policy, chain, signalFetchedAt }
// Return a typed intent: { kind: "swap", ... } or { kind: "block", ... }.
// Rinne validates the shape strictly; anything else fails the Run loudly.

export async function decide(input) {
  const { signal, policy } = input;

  if (!signal.priceUsd) {
    return {
      kind: "block",
      reasonCode: "MISSING_FIELD",
      reasoning: "The Signal has no price; refusing to trade on incomplete data.",
    };
  }
  if (signal.confidence < policy.minConfidence) {
    return {
      kind: "block",
      reasonCode: "LOW_CONFIDENCE",
      reasoning: `Signal confidence ${signal.confidence} is below the policy minimum ${policy.minConfidence}.`,
    };
  }

  const expectedOut = Number(policy.amountInHuman) * Number(signal.priceUsd);
  const minReceived = (expectedOut * (1 - policy.maxSlippageBps / 10_000)).toFixed(
    policy.quoteCurrencyDecimals
  );

  return {
    kind: "swap",
    chain: "mantle",
    router: policy.router,
    tokenIn: policy.tokenIn,
    tokenOut: policy.tokenOut,
    amountIn: policy.amountInHuman,
    minReceived,
    maxSlippageBps: policy.maxSlippageBps,
    reasoning: "Confidence and slippage policy passed; swapping at the seen price.",
  };
}
