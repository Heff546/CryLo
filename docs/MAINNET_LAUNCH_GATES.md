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

The existing L1 mainnet source candidate implements **75 bp Development /
0 bp Liquidity / 75 bp CryLo Gas Treasury**. The signed Testnet.25 source uses
**75 bp Development / 25 bp Liquidity / 50 bp Gas Treasury**. An older Nexus
checklist describes the candidate mainnet split, but that does **not** establish
owner approval to change the L1 distribution. The mainnet split must be confirmed
before merging consensus source or approving a mainnet release.

The *unapproved candidate* currently contains the following changes:

- `src/cryptonote_config.h` defines a separate 75 bp mainnet Gas rate,
  while testnet/stagenet retain their original 75/25/50 bp split.
- `src/cryptonote_core/cryptonote_tx_utils.cpp` constructs 4 mainnet
  HF19+ outputs: miner instant, miner vested, Development, Gas Treasury.
  TESTNET/STAGENET continue to construct 5.
- `src/cryptonote_core/blockchain.cpp` mirrors the separate allocation,
  output count, amounts and output indices and chooses matching `max_outs`.
- `tests/launch/mainnet-coinbase-source.test.js` provides read-only,
  integer reward conservation and source-structure regressions.

**This is still not a verified consensus implementation.** The source candidate
now contains `src/cryptonote_core/crylo_gas_treasury_proof.h`: its miner
constructs a public DLEQ transaction proof and its MAINNET validator calls
`verify_crylo_mainnet_treasury_proof` to check the proof, intended public
recipient keys, and one-time output key. The validator rejects an invalid
proof. This corrects the earlier amount-only *source* design, but does **not**
establish that the proof implementation is cryptographically secure.

A stale source test incorrectly asserted that the validator must **not**
contain the Gas Treasury mismatch rejection; the old preflight demanded a
private-view-key-based verification instead of the new public proof. The isolated
`fix/mainnet-dleq-source-gate-20261117` branch aligns those source checks with
the implementation and retains a mandatory launch hold. These revisions have
not been established as passing native C++ compilation or a complete Node CI
suite, and do not prove testnet history replay, malformed-proof rejection,
malicious destination rejection, chain convergence or consensus correctness.

Do not embed a Treasury private view or spend key in public daemon binaries.
See [`docs/security/GAS_TREASURY_COINBASE_PROOF.md`](security/GAS_TREASURY_COINBASE_PROOF.md)
for the source implementation and outstanding cryptographic acceptance gates.

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

The Electron candidate supports `CRYLO_NETWORK=mainnet` with separate wallet
directories and daemon-network checks. A later Electron branch passed targeted
three-OS CI smoke checks, but full integrated mainnet native-wallet, bridge,
installer and updater testing remains outstanding. No chain is started here.

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
It deliberately exits nonzero because mainnet economic approval and native DLEQ
proof evidence are missing, independently of the unfinished mainnet updater.
Static source checks can support code review; they do **not** constitute release
approval. The explicit hold may only be removed in a reviewed change after
the consensus policy is approved and native evidence is verified.

**Do not launch L1 mainnet now.** A mainnet launch is authorized only after
all L1 gates A/B/C pass independently of Nexus. Nexus can be enabled later
after gate D; the CryLo L1 chain must keep producing blocks when Nexus is
offline.

The review has not performed key actions, chain resets, signed release
publication, Pi daemon restarts, or cloud VM activation.
