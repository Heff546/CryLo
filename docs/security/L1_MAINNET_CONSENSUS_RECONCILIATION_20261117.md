# CryLo L1 mainnet consensus reconciliation — 2026-11-17

Status: **BLOCKED / NOT MERGED / NOT APPROVED FOR MAINNET**. This record is source review only. Do not start or sign a mainnet release from these findings.

## Preserved sources

- Signed Testnet.25 baseline: `e0326c141900e1c7a830df3108d9be3a8c019a40`.
- Modern Electron private-V3 and node-evidence branch: `500e23f95d460251da12575ed51ae4612719a9fe`, integrated as `a09a92919cc6d61ca6e7918d848714b478cad50c`.
- Separate L1 mainnet candidate: `f3b1c4df33c825ca2008197214cbc57655d1044f`, retained in draft PR #10.
- Older daemon-side signed-proxy candidate: `48b53caac0bfd487e11f4838f3bfad8e3f4821df`, **not** in signed Testnet.25.
- Hardened 40 kH/s proxy: `14e04eadcd8ae8a583580abda6866cf9495bacce`.

## Confirmed source-gate conflicts

1. In `tests/launch/mainnet-coinbase-source.test.js`, the test named `treasury destination must remain an explicit mainnet blocker until verified` checks `assert.doesNotMatch(validator, /Gas Treasury output key MISMATCH/)`. This no longer matches `src/cryptonote_core/blockchain.cpp`: its MAINNET path calls `verify_crylo_mainnet_treasury_proof(...)` and explicitly rejects a bad key/proof with a `Gas Treasury output key MISMATCH or invalid proof` message. This is the concrete source of the failed November 7 consensus-source workflow; do **not** remove the validator's rejection.
2. `scripts/release/mainnet-launch-preflight.js` checks for `gas_treasury_derivation` and `gas_treasury_view_skey` in `blockchain.cpp`. The candidate instead contains a mainnet-only public DLEQ verifier in `src/cryptonote_core/crylo_gas_treasury_proof.h`. Update the preflight and tests to validate the actual public proof *after* independent crypto review; do **not** embed treasury private or view secrets in public daemon builds.
3. Mainnet candidate source switches the coinbase treasury allocations to Development 0.75%, Liquidity 0%, Gas Treasury 0.75% and four outputs. Signed testnet and earlier economics specify Development 0.75%, Liquidity 0.25%, Gas Treasury 0.50% and five outputs. This economic/consensus change must not be adopted silently. Confirm the approved mainnet split, output ordering and matching miner/validator logic **before** merging.
4. The candidate and integrated Electron branches both modify `electron/main.js` and `electron/src/app.js`, plus shared bridge-status files and test fixtures. The latest private-V3 bridge, normal staking and reward-claim logic must survive reconciliation; do not wholesale replace with the earlier candidate versions.
5. Daemon proxy authentication implementation with the **40,000 H/s** limit exists on separate historical source, not the signed Testnet.25 baseline. Integration requires its exact signed-lease, nonce budget and RPC contract, a fresh native build, replay tests and proxy interoperability tests. Do not use the mistakenly prepared 100 kH/s branches.

## Required acceptance checks

- Preserve testnet genesis, chain replay, wallet databases, signed Testnet.25 artifacts and separate update channel.
- Validate mainnet-specific allocation and payout recipients, malicious treasury-output substitution, canonical DLEQ proof binding, nonce/range replay, testnet compatibility and native C++ consensus tests.
- Ensure test and preflight assertions match the intended rejection behavior, not a stale expected vulnerability.
- Re-run L1 mainnet source gate and native build; verify Windows x64, Linux x64/ARM64, macOS Intel/Apple Silicon, and single-command `crylo update` network separation.
- Keep all changes on integration or draft candidate branches; do not merge into `main` or `testnet` or publish mainnet until approved and verified.

## Evidence

- GitHub CI failed at `https://github.com/Heff546/CryLo/actions/runs/42323047492` on the stale `assert.doesNotMatch` test.
- Draft L1 reconciliation: `https://github.com/Heff546/CryLo/pull/10`.
- Modern Electron merge: `https://github.com/Heff546/CryLo/pull/9`.

No executable genesis, chain state, private key, mainnet wallet, production signers or operational deployments are created by this record.
