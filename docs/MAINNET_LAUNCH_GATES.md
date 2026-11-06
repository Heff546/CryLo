# CryLo L1 mainnet — launch gates and minimal Nexus handoff

**Status: NOT READY FOR MAINNET / source-only launch candidate.** This record is
based on unified Testnet.25 source commit
`e0326c141900e1c7a830df3108d9be3a8c019a40`.
It does not authorize mining on mainnet, publishing artifacts, using mainnet
reserve keys, or switching user wallets.

## Scope and sequencing

1. Start the independent CPU-mineable CryLo L1 **after** consensus, genesis,
   security and five-platform release gates pass.
2. Activate only wallet onboarding, starter native CRYLO gas, and the CryLo ↔
   wCryLo bridge on Nexus, after the separate Nexus contract, privacy and
   testnet operational gates pass. **L1 must not require the Nexus API to mine.**
3. Keep staking, node rewards, validators, Orbit, NFTs, buyback, and daily gas
   epoch distribution disabled in the initial Nexus configuration.

## Gate A — immutable L1 consensus (PARTIAL SOURCE CHANGE; STILL BLOCKED)

The documented policy in `CryLo-Nexus/docs/MAINNET_CHECKLIST.md` requires
**75 bp Development / 0 bp Liquidity / 75 bp CryLo Gas Treasury**.
A mainnet-only source change now implements the 150 bp allocation:

- `src/cryptonote_config.h` defines a separate 75 bp mainnet Gas rate,
  while testnet/stagenet retain their original 75/25/50 bp split.
- `src/cryptonote_core/cryptonote_tx_utils.cpp` constructs 4 mainnet
  HF19+ outputs: miner instant, miner vested, Development, Gas Treasury.
  TESTNET/STAGENET continue to construct 5.
- `src/cryptonote_core/blockchain.cpp` mirrors the separate allocation,
  output count, amounts and output indices and chooses matching `max_outs`.
- `tests/launch/mainnet-coinbase-source.test.js` provides read-only,
  integer reward conservation and source-structure regressions.

**This is not an implementation-complete consensus change:** it has only
passed source tests; no native C++ compile, testnet history replay,
adversarial destination test or multi-node chain proof has passed yet.

**Critical destination verification — OPEN:** the block verifier derives
and verifies the **Development** payout key, but still checks only the Gas
Treasury output *amount*. An arbitrary miner can put its own output key in
the Treasury position and claim a valid-sized allocation. Reject mainnet
release until a consensus-checkable recipient proof is implemented and
adversarially tested. Simply verifying a public address string is
insufficient for CryptoNote one-time output keys.

A straightforward view-secret-based derivation would disclose the treasury
view secret in every public node binary, allowing third parties to trace
other payments to that wallet. Prefer a privacy-reviewed public proof of
correct derivation, or explicitly review the tracing implications of a
dedicated transparent treasury wallet. Do not reuse other private wallet
keys, request a seed phrase, insert an unverified key, or put spend keys in
the codebase.

**Mandatory native regression tests:** genesis; mainnet height 1 → 2
hardfork transition (v17 → v21); coinbase payout amounts and exact recipient;
50/50 immediate/45-day vesting; difficulty floor; 5M emission cap; malicious
miner replacement of Gas payout; invalid address/output/count rejection;
testnet v4 historical replay compatibility; cross-platform determinism.

Do not change the already-published Testnet.25 tag to implement this.

## Gate B — mainnet network identity and launch (UNVERIFIED)

- Verify mainnet genesis transaction, nonce and resulting block hash from a
  clean new data directory on at least two independent native machines.
- Verify fresh mainnet P2P network ID, public address prefixes, peer discovery,
  ports, anchor and independent peers; no mainnet/testnet cross-contamination.
- Confirm native startup without `--testnet`, source chain identity, sync,
  solo mining, miner unlock and vesting after new block production.
- Verify treasury and development **public receiving addresses** independently
  against intended owner-controlled wallets; never place spend keys or mnemonic
  seeds in repository, logs, CI or documentation.
- Maintain independent mainnet and testnet wallet databases with no automatic
  wallet import, migration or private-key rotation.

The Electron candidate supports `CRYLO_NETWORK=mainnet` with distinct native
wallet directories and verifies the daemon network before mining, but that
source remains untested and does not deploy or start a mainnet chain.

## Gate C — signed release and one-command updater (BLOCKED)

The current `scripts/crylo.js` is explicitly pinned to `network.mode =
'testnet'`, testnet release tags and `--testnet` daemon launch. The signed
Testnet.25 release therefore **must not be repurposed as mainnet**.

Build an independent authenticated mainnet update channel with a verified
mainnet public release key, signed manifest and tag identity, separate
anti-rollback floor, precise target architecture provenance, correct mainnet
daemon launch and initial installation path. Reconcile all five OS/architecture
targets from the unified source without new platform-specific features:
Windows x64, Linux x64/ARM64 and macOS Intel/Apple Silicon. Keep
`crylo update` as the sole normal-user update command; Windows users must
not need PowerShell. Only the authorized release process signs and publishes
official artifacts. Preserve existing user wallet files and configuration.

Mandatory gates: binary hashes, platform architecture, dependency audit,
installer and `crylo update` E2E, clean-install fresh node, restart,
rollback/replay protection and preservation of both network's data.

## Gate D — launch wallet and minimum Nexus (SOURCE PATCHES PREPARED)

The wallet candidate replaces legacy public bridge status GET with a private
capability-authenticated POST, retains the bearer capability in its main
process, requires HTTPS for remote APIs, verifies wallet/daemon network
identity, and recognizes privacy-preserving `status: minted`.

The Nexus safety candidate disables unsigned relayed gas purchases and
quarantines ambiguous transaction broadcasts. A wallet-signed on-chain gas
purchase remains possible, as does signed onboarding / starter gas.

**Still required before enabling actual bridge deposits:**
- Merge and test both source patches, including Electron ↔ hardened API
  request/status lifecycle and crash/restart recovery.
- Provision a verified HTTPS Foundation API endpoint in signed wallet
  configuration without a hardcoded public IP or insecure redirect.
- Test starter gas so a fresh user can approve and buy gas without being
  stranded by insufficient native CRYLO.
- Reconcile existing in-flight bridge records and legacy status requests
  manually; never auto-reissue status capabilities by payment ID alone.
- Validate exact 1:1 CryLo (11 decimals) ↔ wCryLo (11 decimals), native
  CRYLO gas (18 decimals), confirmations, duplicate prevention, reserve
  reconciliation, outbound failure recovery, and L1 privacy boundary.
- Verify minimal contracts/relayers against actually deployed testnet code
  and then mainnet deployment; do not assume a source manifest means that
  contracts are live or upgraded.
- Security audit service credentials, database backup/private permissions,
  HTTPS proxy logs, and single authoritative bridge state before any
  transfer with value.

## Launch decision

Run the source-only preflight with `node scripts/release/mainnet-launch-preflight.js`.
It currently exits nonzero on unresolved consensus/updater gates and must not
be mistaken for proof of runtime correctness if it passes.

**Do not launch L1 mainnet now.** A mainnet launch is authorized only after
all L1 gates A/B/C pass independently of Nexus. Nexus can be enabled later
after gate D; the CryLo L1 chain must keep producing blocks when Nexus is
offline.

The review has not performed key actions, chain resets, signed release
publication, Pi daemon restarts, or cloud VM activation.
