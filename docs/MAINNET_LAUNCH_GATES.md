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

## Gate A — immutable L1 consensus (APPROVED ECONOMICS; VALIDATION IN PROGRESS)

**Owner-confirmed November 18, 2026: CryLo MAINNET, TESTNET and STAGENET use
75 bp Development / 25 bp Liquidity / 50 bp CryLo Gas Treasury.** Each
allocates exactly 1.50% of the block reward. The earlier proposed mainnet
75/0/75 change is **rejected** and must never enter a signed release.

The isolated economic correction `fix/mainnet-approved-75-25-50-20261118`
restores five HF19+ coinbase outputs, ordered **miner instant [0],
miner vested [1], Dev [2], Liquidity [3], Gas Treasury [4]**. The
follow-on `security/mainnet-dual-recipient-proof-20261118` source candidate
requires separate public DLEQ recipient proofs for **Liquidity [3] and Gas
Treasury [4]**, each checked against the configured public receiving keys.
The proof fields must be canonically ordered **Liquidity first, Gas second**,
with distinct transcript domains. No Liquidity/Gas wallet private view or
spend keys are added to daemon source. These changes are **UNRELEASED**.
Neither isolated branch is authorized for publication or production consensus.

**CRITICAL VALIDATION HOLD:** The economic-correction branch by itself
only amount-checks Liquidity [3]. The separate dual-proof branch now
implements public recipient verification in source, but **that new
implementation has NOT yet been compiled, executed, or independently
audited**. Signing remains blocked until actual native tests confirm
valid paired proofs, destination substitutions, signature tampering,
duplicates, canonical suffix layout, full block acceptance/rejection,
replay, and cross-platform determinism.

Prior validation on Pi1: 13 native Gas Treasury tests, 31 combined
CryptoNote regressions and 36 emission/hardfork tests passed on the
*earlier four-output mainnet candidate*. These results support the
existing Gas proof implementation but **do not validate the revised
five-output dual-proof candidate**. Compile and run its 26 in-memory
native proof tests plus full-block acceptance/rejection regressions.

**Proof-aware miner template weight convergence — NOT YET NATIVE VERIFIED**
(the follow-up `fix/mainnet-proof-safe-block-template-padding-20261119`).
The original block-template builder could append trailing zero bytes to
`tx.extra` after both recipient proofs were signed, violating the mandatory
[Liquidity][Gas] suffix and making some miner templates invalid. The
review branch now places any needed weight-adjustment padding inside the
coinbase extra nonce BEFORE rebuilding and signing both proofs. Mainnet
only; the established testnet template behavior is unchanged. Pi1 must
compile this change and exercise several extra nonce lengths and actual
full-block acceptance before considering the risk closed. The mainnet
preflight remains unconditionally blocked.

Other mandatory gates: independent genesis and network IDs; mainnet
height 1→2 hardfork transition; complete miner coinbase recipient
validation; 50/50 instant and 45-day vesting; emission cap; full-block
consensus rejection of malicious recipient substitutions; testnet v4
history replay; peer synchronization, reorg and multi-architecture
determinism.

Do not modify the already published signed Testnet.25 release.

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
It deliberately exits nonzero because **dual-recipient native/full-chain
consensus evidence** and the mainnet authenticated updater are unfinished.
**The 75/25/50 economic policy is approved**, but that approval is not
a release authorization. Keep the explicit launch hold until all recipients
and full chain acceptance/rejection tests pass in a reviewed change.

**Do not launch L1 mainnet now.** A mainnet launch is authorized only after
all L1 gates A/B/C pass independently of Nexus. Nexus can be enabled later
after gate D; the CryLo L1 chain must keep producing blocks when Nexus is
offline.

No source review here has performed key actions, chain resets, signed
release publication, Pi daemon restarts, or cloud VM activation.
