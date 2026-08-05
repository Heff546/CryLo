# CryLoNexus Evidence Protocol V1

## Status

This specification defines deterministic evidence formatting, hashing,
unsigned heartbeat construction, and heartbeat validation.

It does not enable:

- signing
- private-key storage
- nonce generation
- sequence persistence
- network submission
- verifier consensus
- reward eligibility
- reward assignment

## Protocol namespace

The CryLoNexus Evidence Protocol is abbreviated as CEP.

- CEP-1: Canonical JSON
- CEP-2: Evidence Hashing
- CEP-3: Unsigned Heartbeat
- CEP-4: Heartbeat Validation
- CEP-5: Verifier Observation
- CEP-6: Verification Window

The Operator Uptime Verification Protocol V1 is the first protocol built on CEP.

## Evidence pipeline

```text
normalized status
      |
      v
CEP-1 canonical JSON
      |
      v
CEP-2 Keccak-256 status hash
      |
      v
CEP-3 unsigned heartbeat
      |
      v
CEP-4 heartbeat validation
      |
      v
future detached signature
      |
      v
verifier observations
      |
      v
verification window
```

## CEP-1: Canonical JSON

Canonical JSON must:

1. Sort object keys lexicographically at every depth.
2. Preserve array order.
3. Emit no insignificant whitespace.
4. Encode the result as UTF-8.
5. Serialize negative zero as `0`.
6. Reject undefined values.
7. Reject functions.
8. Reject symbols.
9. Reject BigInt values.
10. Reject non-finite numbers.
11. Reject sparse arrays.
12. Reject non-plain objects.
13. Reject circular structures.

Contract BigInt values must be normalized to decimal strings before entering
the evidence layer.

## CEP-2: Evidence Hashing

Evidence hashes are calculated as:

```text
Keccak-256(UTF8(canonical JSON))
```

Hashes must be:

- lowercase hexadecimal
- exactly 32 bytes
- prefixed with `0x`

A status hash commits to the complete normalized status object.

A heartbeat payload hash commits to all unsigned heartbeat fields except:

- `payloadHash`
- `signature`

## CEP-3: Unsigned Heartbeat

An unsigned heartbeat contains exactly:

- `protocolVersion`
- `chainId`
- `operatorAddress`
- `nodeId`
- `sequence`
- `issuedAt`
- `expiresAt`
- `nonce`
- `statusHash`
- `payloadHash`

The builder:

- accepts sequence, nonce, and timestamps as inputs
- does not generate state
- does not generate randomness
- does not sign
- does not send network traffic
- does not include raw status evidence
- returns an immutable top-level object

## CEP-4: Heartbeat Validation

The current validator requires:

- protocol version `1.0.0`
- CryLoNexus chain ID `5546` by default
- a valid EVM operator address
- a non-empty node identity
- a non-negative safe-integer sequence
- canonical UTC timestamps
- `expiresAt` later than `issuedAt`
- a 32-byte lowercase hexadecimal nonce
- canonical status and payload hashes
- an exact supported field set
- a payload hash matching the heartbeat contents

The validator may accept an explicitly supplied expected chain ID for isolated
testing or future network versions.

## Reference vectors

Immutable reference vectors are stored under:

```text
node-operator/protocol/test-vectors/
```

Compatible implementations must produce identical canonical JSON and hashes
for every published vector.

Reference vectors must not be silently regenerated after release.

Any intentional canonicalization, hashing, or envelope change requires:

- a new protocol version
- new vector filenames
- explicit migration documentation

## Security boundary

The current implementation:

- creates no signing keys
- reads no signing keys
- stores no signing keys
- creates no signatures
- verifies no signatures
- generates no nonces
- allocates no sequences
- persists no heartbeat state
- sends no network traffic
- changes no staking state
- changes no reward state
- never sets `rewardEligible` to true
