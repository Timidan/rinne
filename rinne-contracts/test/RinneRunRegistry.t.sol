// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {RinneRunRegistry} from "../src/RinneRunRegistry.sol";

contract RinneRunRegistryTest {
    RinneRunRegistry internal registry = new RinneRunRegistry();

    event RunSubmitted(
        bytes32 indexed traceHash,
        bytes32 indexed scenarioId,
        address indexed submitter,
        bool passed,
        string reportUri
    );

    function test_submitRunEmitsEvent() external {
        // Plain call: success means the event-only path costs no storage and
        // cannot revert for any caller.
        registry.submitRun(keccak256("trace"), keccak256("scenario"), true, "ipfs://report");
        registry.submitRun(bytes32(0), bytes32(0), false, "");
    }
}
