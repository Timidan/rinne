// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {RinneAgentRegistry} from "../src/RinneAgentRegistry.sol";

/// Minimal cheatcode surface so the package stays dependency-free (no
/// forge-std checkout): we declare only the cheatcodes these tests use,
/// bound to the canonical hevm cheatcode address.
interface Vm {
    function expectEmit(bool checkTopic1, bool checkTopic2, bool checkTopic3, bool checkData) external;
    function expectRevert(bytes calldata revertData) external;
}

contract RinneAgentRegistryTest {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    RinneAgentRegistry internal registry = new RinneAgentRegistry();

    // Redeclared locally so we can emit the expected shape for vm.expectEmit.
    event AgentRegistered(bytes32 indexed agentId, address indexed owner, bytes32 metadataHash);

    event GuardDecisionAnchored(
        bytes32 indexed decisionHash, bytes32 indexed agentId, uint8 gate, string reportUri
    );

    function test_registerAgentEmitsCallerAsOwner() external {
        // The owner field must be msg.sender (this test contract), not a
        // caller-supplied address, so attribution cannot be spoofed.
        vm.expectEmit(true, true, true, true);
        emit AgentRegistered(keccak256("agent"), address(this), keccak256("metadata"));
        registry.registerAgent(keccak256("agent"), keccak256("metadata"));
    }

    function test_anchorGuardDecisionEmitsEveryValidGate() external {
        // All three gate encodings (0=proceed, 1=block, 2=review) must anchor.
        for (uint8 gate = 0; gate <= 2; gate++) {
            vm.expectEmit(true, true, true, true);
            emit GuardDecisionAnchored(keccak256("decision"), keccak256("agent"), gate, "ipfs://report");
            registry.anchorGuardDecision(keccak256("decision"), keccak256("agent"), gate, "ipfs://report");
        }
    }

    function test_gateAboveTwoReverts() external {
        vm.expectRevert(bytes("gate must be 0 (proceed), 1 (block), or 2 (review)"));
        registry.anchorGuardDecision(keccak256("decision"), keccak256("agent"), 3, "ipfs://report");
    }

    function testFuzz_registerAgentEmitsForAnyHashes(bytes32 agentId, bytes32 metadataHash) external {
        // Event-only registration must succeed for arbitrary hashes; there is
        // no storage to collide with and no validation beyond attribution.
        vm.expectEmit(true, true, true, true);
        emit AgentRegistered(agentId, address(this), metadataHash);
        registry.registerAgent(agentId, metadataHash);
    }

    function testFuzz_anchorGuardDecisionEmitsForAnyHashes(
        bytes32 decisionHash,
        bytes32 agentId,
        uint8 gate
    ) external {
        gate = gate % 3; // clamp into the valid 0..2 encoding
        vm.expectEmit(true, true, true, true);
        emit GuardDecisionAnchored(decisionHash, agentId, gate, "ipfs://report");
        registry.anchorGuardDecision(decisionHash, agentId, gate, "ipfs://report");
    }

    function testFuzz_gateOutOfRangeAlwaysReverts(uint8 gate) external {
        if (gate <= 2) {
            gate = 3; // force into the invalid range without discarding runs
        }
        vm.expectRevert(bytes("gate must be 0 (proceed), 1 (block), or 2 (review)"));
        registry.anchorGuardDecision(keccak256("decision"), keccak256("agent"), gate, "ipfs://report");
    }
}
