# CryLoNexus Operator Verification Protocol V1

## Status

Protocol definition only.

V1 defines canonical messages and security boundaries. It does not enable
distributed consensus, reward authorization, or automatic reward eligibility.

## Goals

The protocol provides a future external verifier with enough information to
determine that:

1. the message belongs to the configured CryLoNexus network;
2. the message belongs to one registered operator identity;
3. the message is fresh and has not been replayed;
4. the operator observed a valid CryLoNexus block;
5. the reported local status has not been altered after signing;
6. independent verifiers can produce deterministic observations;
7. bounded observation windows can later be aggregated safely.

## Non-goals

V1 does not prove that a local runtime is honest merely because it emits a
heartbeat. Local evidence is not consensus evidence.

V1 does not authorize rewards.

V1 does not permit a local runtime to set `rewardEligible` to true.

V1 does not define verifier selection, verifier staking, slashing, reputation,
quorum weighting, or an on-chain finalization contract.

## Message types

### Heartbeat envelope

An operator heartbeat binds:

- network and chain identity;
- operator wallet;
- public node identity;
- configured tier;
- service version;
- monotonic sequence;
- issue and expiry timestamps;
- unpredictable nonce;
- observed block number;
- canonical status hash;
- canonical payload hash;
- operator signature.

The sequence must strictly increase for each node identity.

The nonce must never be reused.

An expired heartbeat must fail verification.

### Verifier observation

A verifier observation binds one verifier decision to one heartbeat payload
hash.

A PASS observation must use `HEARTBEAT_VALID`.

A FAIL observation must use a specific failure reason.

A verifier must independently check:

- schema and protocol versions;
- chain ID;
- expiry and clock skew;
- operator signature;
- payload hash;
- status hash;
- sequence monotonicity;
- nonce replay;
- operator registration;
- operator tier and stake;
- RPC reachability.

### Verification window

A verification window aggregates evidence over a bounded period.

V1 records both:

- `locallyQualified`
- `consensusQualified`

These fields must remain distinct.

Local qualification means only that the runtime produced sufficient internally
consistent observations.

Consensus qualification requires the future distributed verifier protocol.

`rewardAuthorized` is fixed to false in V1.

## Canonicalization

All hashes and signatures must be generated from deterministic canonical JSON.

The future implementation must specify one exact canonicalization algorithm
before signatures are accepted across independently implemented clients.

Until that algorithm is implemented and tested, example hashes and signatures
are structural fixtures only.

## Identity

The operator wallet remains non-custodial.

The persistent operator service must not receive the user's wallet private key,
mnemonic, wallet password, or seed.

A separate node identity signing key may be introduced only after secure key
generation, file permissions, rotation, backup, recovery, and revocation rules
are defined.

The node identity key must never authorize asset transfers.

## Replay protection

Verifiers must reject:

- reused nonces;
- sequence rollback;
- duplicate payload hashes;
- expired messages;
- messages outside the allowed clock-skew boundary.

Replay state must survive verifier restarts.

## Reward safety

Reward eligibility requires all of the following in the future:

1. valid on-chain registration;
2. correct node tier;
3. sufficient stake;
4. verified observation window;
5. sufficient distinct verifier participation;
6. verifier consensus;
7. reward-policy authorization.

A local heartbeat alone is never sufficient.

## Initial policy proposal

The following values are proposals for staged testing, not final economics:

- heartbeat interval: 60 seconds;
- heartbeat expiry: 120 seconds;
- observation window: 20 minutes;
- expected heartbeats: 20;
- local qualification threshold: 18 successful heartbeats;
- maximum local failures: 2;
- minimum distinct verifiers: 3;
- consensus success threshold: 9000 basis points;
- allowed clock skew: 30 seconds.

These values must remain configurable in test deployments and must not be
embedded into reward contracts before staged testing.

## Rollout

1. Protocol schemas and fixtures.
2. Deterministic canonical hashing.
3. Secure node identity generation and storage.
4. Local unsigned evidence generation.
5. Local signed heartbeat generation.
6. Single trusted test verifier.
7. Multiple independent test verifiers.
8. Observation-window aggregation.
9. Adversarial and outage testing.
10. Testnet-only reward-policy simulation.
11. Security review.
12. Explicit mainnet activation decision.

## Required threat-model cases

The implementation plan must cover:

- forged operator identity;
- stolen node identity key;
- modified local runtime;
- replayed heartbeat;
- reordered heartbeat;
- verifier collusion;
- verifier Sybil attacks;
- false failure reporting;
- network partition;
- RPC endpoint spoofing;
- clock manipulation;
- stale registration state;
- tier downgrade during a window;
- stake removal during a window;
- duplicate node identities;
- copied operator installations;
- denial-of-service against operators or verifiers;
- reward finalization races;
- compromised release artifacts.

## Mainnet prohibition

No V1 protocol artifact may independently enable mainnet rewards.

Mainnet reward authorization requires a separately reviewed protocol version,
threat model, verifier policy, contract plan, staged test report, and explicit
activation.
