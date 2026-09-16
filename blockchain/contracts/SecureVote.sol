// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Institutional prototype. The relayer is trusted to verify voter eligibility.
/// Ballots are public; voter names, account IDs, and emails are never submitted.
contract SecureVote {
    // Each candidate identifier represents a political party on the party-list
    // ballot. Generic ABI names are retained for existing deployments/receipts.
    address public immutable relayer;
    bytes32 public immutable instanceId;
    struct Election {
        uint64 startsAt;
        uint64 endsAt;
        bytes32[] candidates;
        mapping(bytes32 => bool) validCandidate;
        mapping(bytes32 => uint256) totals;
        mapping(bytes32 => bool) used;
    }
    mapping(bytes32 => Election) private elections;
    event ElectionCreated(bytes32 indexed electionId, uint64 startsAt, uint64 endsAt);
    event BallotAccepted(bytes32 indexed electionId, bytes32 indexed nullifier, bytes32 candidateId);
    modifier onlyRelayer() { require(msg.sender == relayer, "Unauthorized relayer"); _; }

    constructor(address relay, bytes32 instance) {
        require(relay != address(0) && instance != bytes32(0), "Invalid deployment");
        relayer = relay;
        instanceId = instance;
    }

    function createElection(bytes32 id, uint64 startsAt, uint64 endsAt, bytes32[] calldata candidates) external onlyRelayer {
        Election storage election = elections[id];
        require(id != bytes32(0) && election.endsAt == 0, "Election already exists");
        require(startsAt < endsAt && candidates.length > 0 && candidates.length <= 100, "Invalid election");
        election.startsAt = startsAt;
        election.endsAt = endsAt;
        for (uint256 i; i < candidates.length; ++i) {
            require(candidates[i] != bytes32(0) && !election.validCandidate[candidates[i]], "Invalid candidate");
            election.validCandidate[candidates[i]] = true;
            election.candidates.push(candidates[i]);
        }
        emit ElectionCreated(id, startsAt, endsAt);
    }

    function castVote(bytes32 id, bytes32 candidate, bytes32 nullifier, uint64 expiresAt) external onlyRelayer {
        Election storage election = elections[id];
        require(election.endsAt != 0 && block.timestamp >= election.startsAt && block.timestamp < election.endsAt, "Election is not active");
        require(block.timestamp < expiresAt && expiresAt <= election.endsAt, "Credential expired");
        require(election.validCandidate[candidate], "Invalid candidate");
        require(nullifier != bytes32(0) && !election.used[nullifier], "Credential already used");
        election.used[nullifier] = true;
        election.totals[candidate] += 1;
        emit BallotAccepted(id, nullifier, candidate);
    }

    function hasVoted(bytes32 id, bytes32 nullifier) external view returns (bool) { return elections[id].used[nullifier]; }
    function schedule(bytes32 id) external view returns (uint64, uint64) { return (elections[id].startsAt, elections[id].endsAt); }
    function results(bytes32 id) external view returns (bytes32[] memory candidates, uint256[] memory totals) {
        Election storage election = elections[id];
        require(election.endsAt != 0 && block.timestamp >= election.endsAt, "Results are not available");
        candidates = election.candidates;
        totals = new uint256[](candidates.length);
        for (uint256 i; i < candidates.length; ++i) totals[i] = election.totals[candidates[i]];
    }
}
