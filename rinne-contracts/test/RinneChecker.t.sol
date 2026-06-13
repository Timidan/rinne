// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {RinneChecker} from "../src/RinneChecker.sol";

/// Dependency-free forge tests: assertions are plain require() so the package
/// needs no forge-std checkout.
contract RinneCheckerTest {
    RinneChecker internal checker = new RinneChecker();

    uint256 internal constant ONE = 1e6; // quoteCurrencyDecimals = 6

    /// Mirrors the demo Scenario: 100 MNT at baseline 0.53 USD, Agent sees the
    /// stale 0.5724 USD quote (1.08x), demands minReceived 56.6676 USDC.
    function test_staleQuoteFailsMinReceived() external view {
        (uint256 expectedAmount, uint256 receivedAmount, bool ok) = checker.checkSwap(
            100_000000, // 100 MNT
            530000, // 0.530000 USD reference
            572400, // 0.572400 USD seen
            56_667600, // minReceived 56.6676
            ONE
        );
        require(expectedAmount == 57_240000, "expectedAmount mismatch");
        require(receivedAmount == 53_000000, "receivedAmount mismatch");
        require(!ok, "stale quote must fail minReceived");
    }

    function test_baselineQuotePassesMinReceived() external view {
        (uint256 expectedAmount, uint256 receivedAmount, bool ok) = checker.checkSwap(
            100_000000,
            530000,
            530000,
            52_470000, // minReceived 52.47 (100 bps under 53.00)
            ONE
        );
        require(expectedAmount == 53_000000, "expectedAmount mismatch");
        require(receivedAmount == 53_000000, "receivedAmount mismatch");
        require(ok, "baseline quote must pass minReceived");
    }

    function test_flooredDivisionMatchesOffchainMath() external view {
        // 3 units at price 0.333333 -> 0.999999, floored exactly like the
        // BigInt mulDiv in rinne/src/core/decimal.ts.
        (, uint256 receivedAmount,) = checker.checkSwap(3_000000, 333333, 333333, 0, ONE);
        require(receivedAmount == 999999, "floored division mismatch");
    }

    function test_zeroScaleReverts() external {
        bool reverted = false;
        try checker.checkSwap(1, 1, 1, 0, 0) returns (uint256, uint256, bool) {
            // should not succeed
        } catch {
            reverted = true;
        }
        require(reverted, "zero scale must revert");
    }
}
