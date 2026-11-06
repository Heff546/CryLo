# CryLo Gas Treasury coinbase recipient proof — security design gate

**Status: DESIGN PROPOSAL ONLY. NOT IMPLEMENTED. NO MAINNET RELEASE AUTHORIZED.**

## Confirmed defect and security objective

`src/cryptonote_core/cryptonote_tx_utils.cpp` creates a CryptoNote
one-time output for the fixed Gas Treasury recipient using the miner's
ephemeral transaction secret. `src/cryptonote_core/blockchain.cpp`
currently validates the treasury amount and its position but not the
destination key. A malicious miner can replace the treasury public output
key with an output it controls, keep the amount unchanged, and pass that
amount-only check.

The verifier must reject a coinbase unless its treasury output actually
derives from the approved Treasury **public spend and view keys**, under the
coinbase's corresponding transaction public key. Never assume an amount
check proves the recipient.

## Privacy constraint

The existing Development verification uses a committed private **view**
key. Repeating that approach with the Gas Treasury would disclose the
treasury view key in all public binaries, allowing observers to identify
other payments to that wallet. Such disclosure is not appropriate without
a distinct transparent-treasury privacy decision.

Do **not** store a private spend key or seed in consensus code. Do not
reuse the Development view key. Do not attach CryLo L1 payment IDs,
transaction IDs, integrated addresses, or other bridge linkable inputs
to any public proof.

## Candidate: verifiable shared-secret derivation without a view secret

This repo already has `crypto::generate_tx_proof` and
`crypto::check_tx_proof` (version 2), which prove a matching transaction
secret/public-key and Diffie–Hellman relation. A reviewable design can
use a *Treasury-only* public DLEQ proof:

- Let `r` be the coinbase transaction secret, `R = rG` the existing
  transaction public key, `A` the official Treasury public view key and
  `B` the Treasury public spend key.
- Publish only the shared point `D = rA` and a proof of
  `log_G(R) = log_A(D)`, bound to this particular coinbase.
- The validator verifies the proof and independently checks the treasury
  output's one-time key: `P = B + H_s(8D || output_index)G`.
  The factor of 8 is essential because CryptoNote's normal key derivation
  includes the cofactor.
- Bind the proof message domain to CryLo mainnet, immutable genesis identity,
  block height, transaction public key, approved recipient public keys, gas
  output index, output amount and one-time output key. This prevents
  transplanting a valid proof between coinbases or outputs.
- Define a unique, versioned transaction-extra serialization tag for the
  proof, with exactly one canonical encoding, strict length and uniqueness
  checks. Do not overload bridge payment IDs or generic user-supplied
  extra-nonce bytes.
- Only the Treasury shared point becomes public, not the coinbase
  transaction secret or the miner's separate recipient shared point.
  Treasury payments are deliberately recognizable; miner reward outputs
  must retain their privacy.

The above is a **protocol sketch**, not a cryptographic implementation
or a proof of security. It must be checked against the actual v2
`generate_tx_proof` semantics, canonical scalar and curve-point checks,
variant serializer rules, block-weight limits, and independent verifier
implementations before changing consensus.

## Required acceptance tests before release

1. Correctly generated mainnet coinbase, height 2+, accepts under an
   independent verifier and miner.
2. Changing **any** byte of the Treasury destination, proof, shared point,
   output index, amount, TX public key, version or prefix domain rejects.
3. A miner-provided alternative spend key or view key always rejects.
4. A valid proof copied from a different block/recipient rejects.
5. Canonical encoding, malformed/small-order points, noncanonical
   signatures, multiple or missing proofs all reject.
6. Pre-hardfork mainnet genesis/height-1 compatibility as specified;
   TESTNET/STAGENET existing miner transaction formats remain unchanged.
7. 45-day vesting, 75/0/75 bps economics, 5M supply, reward rounding,
   CPU mining, reorg, fork-split and synchronized independent nodes.
8. L1 privacy: no miner key disclosure, no public L1-to-Nexus correlation
   identifiers or change to wallet scanning assumptions.
9. Five-architecture deterministic native compilation and regression.

**Deployment condition:** until recipient-proof implementation,
adversarial tests, privacy review, and owner-confirmed public recipient
keys are complete, `mainnet-launch-preflight.js` must continue to return
BLOCK and the official signing/updater pipeline must not publish a
mainnet release.
