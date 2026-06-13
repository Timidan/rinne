// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Optional Mantle anchoring (Milestone 6, stretch). Event-only: anchoring a
/// Run costs minimal gas, stores nothing, and is verifiable on any explorer.
/// Not part of the demo-critical path; Rinne runs fully without it.
contract RinneRunRegistry {
    event RunSubmitted(
        bytes32 indexed traceHash,
        bytes32 indexed scenarioId,
        address indexed submitter,
        bool passed,
        string reportUri
    );

    function submitRun(
        bytes32 traceHash,
        bytes32 scenarioId,
        bool passed,
        string calldata reportUri
    ) external {
        emit RunSubmitted(traceHash, scenarioId, msg.sender, passed, reportUri);
    }
}
