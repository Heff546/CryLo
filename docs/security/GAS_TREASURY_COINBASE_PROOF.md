# CryLo Gas Treasury coinbase recipient proof — security design gate

**Status: GAS DLEQ PROOF NATIVE-TESTED ON EARLIER FOUR-OUTPUT CANDIDATE; REVISED FIVE-OUTPUT CANDIDATE AND LIQUIDITY RECIPIENT STILL UNVERIFIED. NO MAINNET RELEASE AUTHORIZED.**

## Historical defect and current candidate

Earlier source checked the Treasury output amount and position but not
its destination key. That would allow a malicious miner to substitute its
own output while retaining the expected amount.

The current **unreleased mainnet source candidate** adds
`src/cryptonote_core/crylo_gas_treasury_proof.h`. The miner constructs a
height-bound transaction proof, and the MAINNET validator calls
`verify_crylo_mainnet_treasury_proof` to check a public proof and derive
the one-time Treasury output key from the configured Treasury **public**
spend and view keys. It rejects invalid proof or output checks. On the
owner-approved five-output mainnet layout, Gas is output **4**.

The earlier four-output candidate passed 13 native Gas proof tests on Pi1
and a combined set of 31 CryptoNote regressions; 36 emission/hardfork
tests also passed. Those results are **not** proof of independent
cryptographic correctness or of this revised five-output candidate.
Never assume a source string check alone proves correct recipient payment.

## Liquidity recipient protection — mandatory separate gate

**Owner-approved on November 18, 2026:** all networks pay **0.75%
Development, 0.25% Liquidity and 0.50% Gas Treasury**, with exactly
five outputs after vesting activation.

The Gas public DLEQ proof protects output [4]. It also commits to the
coinbase prefix, but that **does not** prove the identity of output [3]
(Liquidity). A malicious miner with its own transaction secret can
generate a valid Gas proof over a coinbase whose Liquidity output pays
an attacker. Independent Liquidity recipient verification is mandatory
before mainnet release. A separate public DLEQ or an equivalently
auditable recipient proof may be used only after canonical transaction-extra
format, proof ordering, replay protection, output index and version are
specified and tested; never embed a private Liquidity view/spend key.

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

## Candidate source: verifiable shared-secret derivation without a Treasury view secret

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

The candidate now implements this design in source, but this is **not a
cryptographic proof of correctness**. The v2 `generate_tx_proof` /
`check_tx_proof` semantics, height/prefix binding, canonical scalar and
curve-point checks, extra-field parsing, tx size limits, malformed-input
behavior, and independent miner/validator agreement require native
adversarial tests and security review before consensus is approved.

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
7. 45-day vesting, **approved 75/25/50 bp allocation for all networks**, 5M
   supply, reward rounding, CPU mining, reorg, fork-split and synchronized independent nodes.
8. L1 privacy: no miner key disclosure, no public L1-to-Nexus correlation
   identifiers or change to wallet scanning assumptions.
9. Five-architecture deterministic native compilation and regression.

**Deployment condition:** the source implementation must not be
promoted until native adversarial consensus tests, independent
cryptographic/privacy review, owner-confirmed public Liquidity and Gas
Treasury recipient keys, and independently verified Liquidity proof are complete.
`mainnet-launch-preflight.js` explicitly holds official release signing
closed pending those security items, separately from the mainnet updater gate.
The economic allocation itself is approved and is no longer a blocker.
Unsigned validation builds may be used for testing only.
