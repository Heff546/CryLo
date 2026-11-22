# UNSCHEDULED Testnet v21 recipient-authentication prototype

**Security review candidate — November 21, 2026. DO NOT MERGE, RELEASE, ENABLE MINING, OR ACTIVATE THIS FORK.**

The goal is to correct the confirmed Testnet V4 recipient-authentication gap without rewriting a single existing block. This candidate is separate from **Mainnet** and uses only the **existing hard-coded Testnet public treasury keys**; it neither creates wallets nor moves existing coins.

## Confirmed canonical anchor and latest Pi1 gate

**Live anchor identity verified on 2026-11-21** at `crylo-anchor` x86_64 (NOT `crylo-relay-01`): `crylo-anchor.service` active; RPC `127.0.0.1:22641` status `OK`; 2,958 block records, highest block **2957**. Its CryLo block hashes are:

- height 0: `f99717f84f61e3a7f7229bbfe57333cfef7b290faaa7c2d0aaa74fe691c6d213`
- height 2777: `a89fe55c3419d829fe53f1a25a52af3ba9d2c0dae3d92ea0a9c80a750ebb54b5`
- height 2957: `5de1300bc2fb095143d3b0b5d9e76ea4dd8ad88fc578062858eaafab652da9de`

The daemon's `getblock` endpoint supplied actual serialized-block bytes. Their SHA256 digests (not CryptoNote block IDs) are pinned in `tests/launch/verify_testnet_anchor_checkpoints.py`: height 0 `2e7a9caf6fccf27d2d3bca47695e5a238dcc089a731c847a5379f155f0ab7f08`, height 2777 `a177632e7274881b3fbb57816ecb57aea41a6e11f82953cceecfa43f25cc5496`, and height 2957 `1f17b4467e246d810ea273fbe114c8e8a47c91a3d2d0d4f7641072cc8788d92f`.

Anchor's serialized **genesis** equals Pi1's prior ARM64 ABI-test snapshot, not Pi1's original-v4 snapshot. The original-v4 versus prior-ABI prefix comparison properly **failed at entry 0** because those are different histories, so it has been replaced in the one-command gate with direct snapshot-versus-anchor checkpoint verification. The latter check has **not yet been executed on Pi1**. A matched genesis alone does not certify the rest of the chain.

**Latest executed Pi1 candidate SHA `c9ae8965b212d6869a412b70cd13ab5b1ffc8664`:** 10/10 Node security checks, 53/53 native proof/production-coinbase validator tests, and 57/57 existing parser/reward/hardfork tests all passed, for **120 passing checks**. The native build passed. The only failure was the now-explained cross-genesis prefix comparison.

The live anchor has **NO canonical blocks 2958 or 2959 yet**; those cannot be replayed as if they existed. A valid *isolated* full-block admission/future-fork transition fixture, plus interaction with existing v21 Bulletproof Plus rules, remains mandatory before activating or merging this prototype. No release, fork scheduling, wallet changes, or live DB writes are authorized.

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

The **next incremental native fixture**, `tests/unit_tests/crylo_testnet_block_validator.cpp`, directly exercises the production `Blockchain::prevalidate_miner_transaction` and `Blockchain::validate_miner_transaction` with `m_nettype=TESTNET` and a dummy, in-memory `BaseTestDB`. It asserts v21 acceptance/rejection and preserves the pre-v21 amount-only Liquidity/Gas behavior. The fixture does **not** invoke `add_new_block`, PoW, P2P, or a real chain database. Its 16 cases have now compiled and passed on Pi1 at the tested SHA noted above; it remains a direct coinbase-validator test, NOT a full PoW/block-admission test.

The upstream `core_tests` generator currently hard-codes `MAINNET` in relevant coinbase-creation paths and cannot by itself certify this **TESTNET-only** consensus change. A Testnet full-block-admission harness with a strictly isolated fork configuration is still required.

## Latest Pi1 inventory and narrow next gate (November 21, 2026)

This is not a general rewrite of Testnet. It fixes only the known **Liquidity and Gas coinbase recipient redirection weakness**, and replaces Dev's historical private-view-key-based check with a public proof **after a future fork**.

- The first candidate passed **8** structural checks, **37** native proof checks, **57** existing parser/hardfork/emission regressions, plus later **9** structural and **47** native production-coinbase-validator checks on SHA `32f3ef87aea285409d360e50f6bddd05e93c0479`. These are overlapping test runs, not 113 unique security invariants.
- Pi1 original chain contains **2,778 blocks (0–2777)**. An earlier Pi1 ABI-check copy contains **2,958 blocks (0–2957)**. They were inspected from separate byte-for-byte verified copies. Both originals remained stopped and unchanged.
- Neither Pi1 copy contains corrected history at **2958 or 2959**. Pi2 is not an up-to-date anchor; the user's prior canonical anchor ran on Google VM. Do not promote the Pi1 ABI-test copy to canonical merely from its height.
- `tests/launch/compare_testnet_lmdb_blocks.py` uses `mdb_dump -s blocks` to compare the shared prefix **read-only**; it reports byte-for-byte content match, not network canonicality. It does not require a daemon.
- Added six nonce/legacy cases to the actual Testnet coinbase-validator suite: nonce lengths 127/128/255 accepted, 256 rejected, signed-nonce tamper rejected, historical v20 Gas destination check remains legacy. All six compiled and passed on Pi1 at the recorded tested SHA.
- Do not require Pi2 setup or Mainnet wallets. Google VM authoritative history is only needed for the **final replay/canonical-chain gate**, after local tests complete.

**Repeatable Pi1 gate:** `tests/launch/run_testnet_treasury_pi1_gate.sh` now orchestrates source checks, incremental native build, treasury production-validator/crypto cases, the prior parser/hardfork/emission regression suite, and saved-chain byte-for-byte prefix comparison in one command. The script uses only `~/CryLo-Testing/` worktrees and audit copies, writes results to `/tmp/crylo-testnet-v21-gate`, and never starts a daemon. The source/native/regression sections have passed; the new fixed checkpoint section still needs execution on Pi1.

**Single focused next step:** run `verify_testnet_anchor_checkpoints.py` directly on Pi1's existing `prior-abi` audit copy and compare serialized blocks 0, 2777 and 2957 to the confirmed live anchor. Do not rerun the 120 passing tests merely to repeat old evidence. Then add isolated full-block admission tests; replay the existing canonical range 0–2957 only. Heights 2958+ must be legitimately mined/available before claiming canonical history beyond the tip.

## Risks and gates still OPEN

**The latest tested candidate compiled and passed 53 native treasury and direct-production-validator tests, plus 57 existing regressions.** A direct coinbase-validator pass is not full block admission/replay. Those separate PoW, transaction, reorg and consensus gates remain open.

Before activation or merging:
1. **Completed at tested SHA:** compiled `unit_tests` on Pi1 ARM64; ran the isolated treasury, legacy, production-validator, parser, hardfork and reward suites. Re-run if production code changes or new test cases are added, not merely for documentation edits.
2. Test the actual **Testnet** block-admission path with valid v20 blocks immediately before activation and v21 valid/redirected Development, Liquidity and Gas blocks immediately after. Include missing, duplicate, reordered, malformed points/signatures, wrong heights, output keys, fees and extra nonce lengths **127/128**; deliberately trigger the template weight-padding branch. A helper-only unit test is insufficient.
3. Compare the saved Pi1 prior-ABI snapshot against confirmed canonical anchor checkpoints at heights 0, 2777 and 2957, then replay the available canonical range 0–2957 on an isolated DB. The anchor has not mined 2958/2959 yet: replay those heights only when real canonical data exists, never manufacture a history.
4. Validate reorgs/alternative branches, independent-node synchronization, identical consensus on Linux ARM64, x64, Windows and both macOS architectures; review parser behavior on all historical tx.extra formats.
5. Decide the actual future activation only **after** confirming canonical height, upgraded-node propagation, wallet/consensus safety and a new signed Testnet release schedule. Do not set a fictitious activation height to make tests green.
6. Inspect the existing public recipient keys. Spending historical or future treasury funds still requires control of the matching wallet private spend key; newly created keys would require a **separately approved future-only** recipient migration. No Development/Liquidity wallet creation is necessary for these public-proof tests.

**Do not merge Mainnet PR #26 into Testnet**, change Mainnet genesis, or create the Nexus Mainnet chain during this Testnet work.

## Pi1 local source test (isolated checkout)

```bash
node --test tests/launch/testnet-v21-treasury-source.test.js
```

Native build should use a **fresh build directory outside the review worktree**, `-DBUILD_TESTS=ON`, single compile job on ARM64, and unit `gtest_filter` for the two named suites. Do not access live wallet, relay, anchor, or LMDB data.
