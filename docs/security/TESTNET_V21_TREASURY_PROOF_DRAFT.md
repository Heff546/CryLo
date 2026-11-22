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

## Risks and gates still OPEN

**This code has NOT yet been compiled or executed.** Adapted code from another chain domain is not automatically correct. Native C++ compilation on Pi1, public recipient cryptographic validity, adversarial proof coverage, and real full-block tests are mandatory; source-only inspection does not certify the proof.

Before activation or merging:
1. Compile `unit_tests` on Pi1 ARM64. Run the isolated native `CryLoTestnetV21TreasuryProof.*` and `CryLoLegacyV4TreasuryProof.*` tests. Do not suppress failures.
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
