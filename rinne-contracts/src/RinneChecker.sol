// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// RinneChecker is deployed by Rinne into a pinned Mantle fork (Anvil) for a
/// Run and queried with eth_call. It re-computes the swap outcome from the
/// Scenario's explicit quote inputs, so the numbers in the Report come from
/// EVM execution inside the fork rather than from Rinne's own process.
///
/// It deliberately does NOT read DEX liquidity or pool state: the execution
/// mode this enables is honestly labeled "fork-local-checker", not a router
/// simulation. All amounts are fixed-point integers scaled by `one`
/// (10^quoteCurrencyDecimals), matching Rinne's off-chain decimal math.
contract RinneChecker {
    /// @param amountIn       Scaled amount of tokenIn being swapped.
    /// @param referencePrice Scaled reference price (the baseline Signal quote).
    /// @param agentSeenPrice Scaled price the Agent actually saw in this Run.
    /// @param minReceived    Scaled minimum output the Agent's intent demands.
    /// @param one            The scale factor, 10^quoteCurrencyDecimals.
    /// @return expectedAmount Scaled output the Agent expected from the price it saw.
    /// @return receivedAmount Scaled output implied by the reference quote.
    /// @return minReceivedOk  Whether receivedAmount satisfies minReceived.
    function checkSwap(
        uint256 amountIn,
        uint256 referencePrice,
        uint256 agentSeenPrice,
        uint256 minReceived,
        uint256 one
    )
        external
        pure
        returns (uint256 expectedAmount, uint256 receivedAmount, bool minReceivedOk)
    {
        require(one > 0, "RinneChecker: zero scale");
        expectedAmount = (amountIn * agentSeenPrice) / one;
        receivedAmount = (amountIn * referencePrice) / one;
        minReceivedOk = receivedAmount >= minReceived;
    }
}
