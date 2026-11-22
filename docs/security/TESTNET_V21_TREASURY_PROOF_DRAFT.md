# UNSCHEDULED Testnet v21 recipient-authentication prototype

**Security review candidate — November 21, 2026. DO NOT MERGE, RELEASE, ENABLE MINING, OR ACTIVATE THIS FORK.**

The goal is to correct the confirmed Testnet V4 recipient-authentication gap without rewriting a single existing block. This candidate is separate from **Mainnet** and uses only the **existing hard-coded Testnet public treasury keys**; it neither creates wallets nor moves existing coins.

## What the current Testnet V4 consensus does

- HF19+ coinbase: exactly five outputs, including miner instant [0], miner vested [1], Development [2], Liquidity [3] and CryLo Gas Treasury [4].
- Percentages: Development **75 bps**, Liquidity **25 bps**, Gas **50 bps**; the miner receives the remainder with 50/50 instant/vesting.
- Existing Development [2] one-time recipient key is checked using the previously disclosed historical **viewing** secret key. It cannot spend funds, but is permanently public.
- Existing Liquidity [3] and Gas [4] outputs are checked for amount, **not for cryptographically proved recipient destination**. The code cannot be called complete/security-approved until this is corrected.

## What this draft adds

- **Future-only** `HF_VERSION_TESTNET_TREASURY_PROOFS = 21`; the active `testnet_hard_forks` table **still ends at v20 at block 2100**. No activation date/height has been chosen or coded.
- Three fixed 96-byte public transaction proofs using canonical tx.extra suffix **Development [0x07] + Liquidity [0x06] + Gas [0x05]**. Every proof has a 1-byte tag, canonical 1-byte length, 32-byte shared point and 64-byte DLEQ signature; full field is 98 bytes.
- Three separate versioned **`CryLo:testnet-v4+:`** proof domains, bound to `config::testnet::NETWORK_ID`, `config::testnet::GENESIS_TX`, generation height and coinbase transaction prefix. Mainnet-proof messages are not interchangeable.
- The future v21 miner constructs all five coinbase outputs exactly as before and then signs all three *public* recipients with its **transaction secret**. No treasury private viewing or spending key is required for the miner.
- A separate future v21 **consensus verifier** checks the three proof fields, their canonical ordering, signatures, recipient public keys, one-time output keys and view tags. Its legacy rule remains in the `else` branch for pre-v21 blocks.
- Future-v21 nonce serialization and block-template weight convergence are prepared so extra padding is inserted **before** signing; proof bytes remain a canonical suffix. The legacy V4 path is unchanged.
- **37** in-memory/adversarial C++ test cases from the existing isolated three-proof candidate, adapted to Testnet keys and domains, including a version-20 no-proof compatibility case. **Eight** source-level Node assertions also check that v21 remains unscheduled.
- Coin allocation, chain identity, genesis, V4 hardfork schedule, actual wallet data and signed Testnet.27 packages remain unchanged.

## Important existing v21 interaction — Bulletproof Plus

`src/cryptonote_config.h` already defines `HF_VERSION_BP_PLUS_FULL_COMMIT = 21`. The active `blockchain.cpp` enables additional RingCT verification and cache behavior when the network reaches v21. **A Testnet fork to v21 therefore changes more than treasury proofs**, even if the treasury patch itself is correct. The whole transition must be assessed for transaction compatibility, wallet creation, mempool handling, wallet serialization and cross-platform consensus before activation. Do not assume that choosing v21 is a treasury-only upgrade. If necessary, revise the planned fork version and test the prior version's effects explicitly.

The generic `tx_extra` parser is also extended on this draft branch. Before merging, verify that recognizing proof tags does not alter pre-v21 transaction acceptance or historical block replay. That is why this is an isolated review candidate, not active Testnet code.

## Pi1 native validation already completed

On November 21, 2026, the operator compiled this candidate on Pi1 Linux ARM64 and reported **37/37** new native proof-helper tests passed, **8/8** source checks passed, and **57/57** existing transaction-extra/hardfork/reward regressions passed. These results are recorded in draft PR #30. They are valid only for the tested commit, not for changes made after that run.

The **next incremental native fixture**, `tests/unit_tests/crylo_testnet_block_validator.cpp`, directly exercises the production `Blockchain::prevalidate_miner_transaction` and `Blockchain::validate_miner_transaction` with `m_nettype=TESTNET` and a dummy, in-memory `BaseTestDB`. It asserts v21 acceptance/rejection and preserves the pre-v21 amount-only Liquidity/Gas behavior. The fixture does **not** invoke `add_new_block`, PoW, P2P, or a real chain database. Its 10 cases still need compilation and execution on Pi1; do not claim they passed until tested.

The upstream `core_tests` generator currently hard-codes `MAINNET` in relevant coinbase-creation paths and cannot by itself certify this **TESTNET-only** consensus change. A Testnet full-block-admission harness with a strictly isolated fork configuration is still required.

## Latest Pi1 inventory and narrow next gate (November 21, 2026)

This is not a general rewrite of Testnet. It fixes only the known **Liquidity and Gas coinbase recipient redirection weakness**, and replaces Dev's historical private-view-key-based check with a public proof **after a future fork**.

- The first candidate passed **8** structural checks, **37** native proof checks, **57** existing parser/hardfork/emission regressions, plus later **9** structural and **47** native production-coinbase-validator checks on SHA `32f3ef87aea285409d360e50f6bddd05e93c0479`. These are overlapping test runs, not 113 unique security invariants.
- Pi1 original chain contains **2,778 blocks (0–2777)**. An earlier Pi1 ABI-check copy contains **2,958 blocks (0–2957)**. They were inspected from separate byte-for-byte verified copies. Both originals remained stopped and unchanged.
- Neither Pi1 copy contains corrected history at **2958 or 2959**. Pi2 is not an up-to-date anchor; the user's prior canonical anchor ran on Google VM. Do not promote the Pi1 ABI-test copy to canonical merely from its height.
- `tests/launch/compare_testnet_lmdb_blocks.py` uses `mdb_dump -s blocks` to compare the shared prefix **read-only**; it reports byte-for-byte content match, not network canonicality. It does not require a daemon.
- Added six unexecuted nonce/legacy cases to the actual Testnet coinbase-validator suite: nonce lengths 127/128/255 accepted, 256 rejected, signed-nonce tamper rejected, historical v20 Gas destination check remains legacy. These changes **must be compiled and executed** before counting as passes.
- Do not require Pi2 setup or Mainnet wallets. Google VM authoritative history is only needed for the **final replay/canonical-chain gate**, after local tests complete.

**Repeatable Pi1 gate:** `tests/launch/run_testnet_treasury_pi1_gate.sh` now orchestrates source checks, incremental native build, treasury production-validator/crypto cases, the prior parser/hardfork/emission regression suite, and saved-chain byte-for-byte prefix comparison in one command. The script uses only `~/CryLo-Testing/` worktrees and copies, writes results to `/tmp/crylo-testnet-v21-gate`, and never starts a daemon. It must be executed on Pi1 **after fetching the latest PR branch**; no results have been claimed for the new code yet.

**Single focused next step:** rerun source plus incremental native Testnet validator suites against the current PR head and run the prefix comparison against the two existing Pi1 **audit copies**. Afterwards, retrieve a consistent, stopped Google VM anchor snapshot for 2958+ if present, verify identity against the matching 0–2957 Pi1 chain, and perform real full-block admission/replay. Stop any activation or merge until those results are recorded.

## Risks and gates still OPEN

**The initial candidate compiled and passed 37 proof-helper native tests, but the new direct-validator fixture has NOT yet been compiled or executed.** Adapted code from another chain domain is not automatically correct. Native C++ compilation on Pi1, public recipient cryptographic validity, adversarial proof coverage, and real full-block tests are mandatory; source-only inspection does not certify the proof.

Before activation or merging:
1. Recompile `unit_tests` on Pi1 ARM64 after adding the direct-validator fixture. Run the isolated native `CryLoTestnetV21TreasuryProof.*` and `CryLoLegacyV4TreasuryProof.*` tests, plus the new `CryLoTestnetV21BlockValidator.*` suite. Do not suppress failures.
2. Test the actual **Testnet** block-admission path with valid v20 blocks immediately before activation and v21 valid/redirected Development, Liquidity and Gas blocks immediately after. Include missing, duplicate, reordered, malformed points/signatures, wrong heights, output keys, fees and extra nonce lengths **127/128**; deliberately trigger the template weight-padding branch. A helper-only unit test is insufficient.
3. Obtain **canonical** Testnet V4 history that includes height 2958/2959 and replay it against a **consistent, isolated read-only snapshot** through at least the planned new activation boundary. Prior Pi1 local source stopped at height 2777; that did not prove the correction boundary.
4. Validate reorgs/alternative branches, independent-node synchronization, identical consensus on Linux ARM64, x64, Windows and both macOS architectures; review parser behavior on all historical tx.extra formats.
5. Decide the actual future activation only **after** confirming canonical height, upgraded-node propagation, wallet/consensus safety and a new signed Testnet release schedule. Do not set a fictitious activation height to make tests green.
6. Inspect the existing public recipient keys. Spending historical or future treasury funds still requires control of the matching wallet private spend key; newly created keys would require a **separately approved future-only** recipient migration. No Development/Liquidity wallet creation is necessary for these public-proof tests.

**Do not merge Mainnet PR #26 into Testnet**, change Mainnet genesis, or create the Nexus Mainnet chain during this Testnet work.

## Pi1 local source test (isolated checkout)

```bash
node --test tests/launch/testnet-v21-treasury-source.test.js
```

Native build should use a **fresh build directory outside the review worktree**, `-DBUILD_TESTS=ON`, single compile job on ARM64, and unit `gtest_filter` for the two named suites. Do not access live wallet, relay, anchor, or LMDB data.
