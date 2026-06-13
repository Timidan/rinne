// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Optional onchain anchoring for the hosted DeFi agent guard. Event-only,
/// mirroring RinneRunRegistry: anchoring stores nothing, costs minimal gas,
/// and is verifiable on any explorer. The dashboard and guard API run fully
/// without it — this contract is never a mandatory dependency.
///
/// Privacy: only hashes and an opaque report URI are emitted. No endpoint
/// URLs, no API keys, and no raw action data ever touch the chain.
contract RinneAgentRegistry {
    /// Gate encoding shared with the offchain guard engine:
    ///   0 = proceed (action allowed), 1 = block (action denied),
    ///   2 = review (escalated to a human). Values above 2 are rejected so an
    ///   indexer never has to guess what an unknown gate means.
    uint8 internal constant MAX_GATE = 2;

    event AgentRegistered(bytes32 indexed agentId, address indexed owner, bytes32 metadataHash);

    event GuardDecisionAnchored(
        bytes32 indexed decisionHash, bytes32 indexed agentId, uint8 gate, string reportUri
    );

    /// Attributes the agent to whoever sends the transaction. There is no
    /// stored ownership and no access control: anyone can emit, and consumers
    /// decide which (owner, agentId) pairs they trust.
    function registerAgent(bytes32 agentId, bytes32 metadataHash) external {
        emit AgentRegistered(agentId, msg.sender, metadataHash);
    }

    /// Anchors a guard decision hash so a third party can later prove the
    /// decision existed at this block. The reportUri points at the offchain
    /// report (e.g. ipfs://...); it is caller-supplied and unverified.
    function anchorGuardDecision(
        bytes32 decisionHash,
        bytes32 agentId,
        uint8 gate,
        string calldata reportUri
    ) external {
        require(gate <= MAX_GATE, "gate must be 0 (proceed), 1 (block), or 2 (review)");
        emit GuardDecisionAnchored(decisionHash, agentId, gate, reportUri);
    }
}
