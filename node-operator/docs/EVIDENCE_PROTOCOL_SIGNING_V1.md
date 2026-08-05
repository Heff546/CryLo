# CryLoNexus Evidence Protocol v1 Signing

## Mainnet decision

Evidence Protocol v1 uses recoverable secp256k1 signatures and the operator's existing CryLoNexus EVM identity.

The recovered signer address must equal the operator address registered for the node.

## Signed digest

The signer signs the exact canonical 32-byte heartbeat payloadHash produced by the Evidence Protocol Keccak-256 hashing rules.

Implementations must not use signMessage, personal_sign, an Ethereum message prefix, EIP-191, or any other message envelope.

The heartbeat signature field is excluded from payloadHash.

## Encoding and validation

Signatures use canonical 65-byte recoverable secp256k1 encoding: r, s, and recovery value.

External signatures must use a 0x prefix, lowercase hexadecimal, and exactly 65 bytes.

A private signing scalar must satisfy:

```text
1 <= privateKey < secp256k1 curve order
```

Malformed hashes, keys, signatures, addresses, and signer mismatches must be rejected.

## Verification

Verification validates the canonical payloadHash and signature, recovers the EVM signer, normalizes the address, and compares it with the expected registered operator address.

A valid signature from another operator is invalid for the heartbeat.

## Isolation

This primitive performs no networking, persistence, nonce generation, sequence allocation, contract writes, consensus decisions, or reward calculations.
