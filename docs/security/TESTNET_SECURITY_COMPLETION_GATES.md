# CryLo Testnet security completion gates

**November 21, 2026 — Work in progress. Testnet V4 is NOT yet declared feature-complete or security-complete.**

The published [Testnet.27 release](https://github.com/Heff546/CryLo/releases/tag/v1.1.1-testnet.27) is a tested, signed five-platform L1/wallet release, **not** certification of the complete L1 + Electron + Nexus + proxy system. The exact release source commit remains `27c8c3b1fe974f00e7f1c2ce196562135837831f`. Do not rewrite that tag or replace installed user blockchain/wallet data.

## Confirmed Testnet bridge mismatch and security correction

The current `CryLo-Nexus` **`testnet`** branch already implements the private bridge status protocol:
- `bridge-api/server.ts`: `POST /bridge/request` creates a random status token and returns it once; `POST /bridge/status` requires the `X-Bridge-Status-Token` bearer header and returns only `{ok:true,status}`.
- `bridge-api/bridge-status-privacy.js`: stores domain-separated token hashes; legacy requests without a token cannot disclose private L1 settlement records; payment ID alone conveys no authority.
- The legacy public `GET /bridge/status/:paymentId` is not available in the current Testnet API.

The **published CryLo Electron Testnet source** instead called the unauthenticated legacy GET endpoint and used a hard-coded **public HTTP** API fallback. This is both an integration mismatch and a private-data exposure risk.

The isolated review branch `security/testnet-electron-private-bridge-20261121` addresses that mismatch:
1. POST private bridge status from Electron **main process only** with an owner-only persisted capability, never returning the bearer secret to renderer/localStorage/logs.
2. Use HTTPS for remote Foundation API and RPC URLs, allowing plaintext HTTP **only for loopback** local development. Remove the old public-IP HTTP fallback and reject redirects.
3. Poll only minimal lifecycle statuses (`minted` and `failed`). Never use a public mint transaction hash from the private status endpoint.
4. **Fail closed** for old pending bridge requests that predate capability tokens; retain their local pending records and require manual operator reconciliation rather than reintroducing unauthenticated GET.
5. Add Node tests for token storage, permissions, symlinks, collisions, transport restrictions and source/renderer boundaries.

**Operational prerequisite:** `CRYLONEXUS_API_URL` must be set to the operator's verified HTTPS endpoint (or local `http://127.0.0.1:PORT` when the API is on the same machine or accessed through an operator-controlled local tunnel). Any remote plaintext RPC supplied by the Foundation config must be replaced with HTTPS or local loopback. This change intentionally blocks insecure bridge operation until the network endpoints are configured securely. Test it on Pi1 before merging or rebuilding any release.

## Testnet V4 treasury/consensus security: separate release gate

**Do not backport the unreleased Mainnet three-proof code directly into existing Testnet V4 consensus.**

Verified existing Testnet V4 code:
- Requires five mining outputs and correct **75 / 25 / 50 basis-point** allocations for Development [2], Liquidity [3] and Gas Treasury [4].
- Verifies the Development recipient through a historically published **private viewing key** in the validator. It **cannot spend** by itself, but the key was already disclosed and cannot be made secret again.
- Checks Liquidity and Gas **amounts**, but unlike the new *unreleased* Mainnet candidate does **not** independently authenticate both destination keys under Testnet V4 consensus.

The missing recipient authentication is a **protocol security blocker** for full Testnet certification. A malicious miner could potentially redirect a matching-amount Liquidity or Gas output; it must be tested and corrected. Do not label existing amount-only validation as recipient-proof secure.

**Required safe remediation path:** design and test a *forward-only versioned Testnet activation* that uses public recipient proofs for all treasury outputs, a fresh separately protected Development wallet (no reliance on the disclosed key for future payments), Testnet-specific transcript domains/chain identity, and an explicitly approved activation height. The validator must continue to accept historical V4 blocks using their original rules and enforce the new proof rules only for blocks in the new epoch. A chain reset, rewrite, or arbitrary reuse of Mainnet genesis/recipient keys is not an acceptable shortcut. Compile, replay, sync, reorg-test and validate the fork on isolated Pi1 data first; then publish an intentional new signed Testnet release only if required.

## Other Testnet security gates before claiming 100% complete

| Area | Required verification | Current evidence |
| --- | --- | --- |
| L1 V4 mining and historical compatibility | Reject redirected treasury outputs under the *new* explicitly versioned rule while replaying historical V4 unchanged | Existing V4 amount-only checks; forward proof/fork not implemented |
| Electron ↔ Nexus bridge | Test private inbound request/status, credential persistence/restart, HTTPS, old pending requests and reverse-bridge status with actual Testnet service | Source patch prepared; real integrated test still needed |
| Nexus reverse bridge | Public-chain address/txid correlation privacy, relayer crash/retry safety, payout reserve accounting and anti-replay | Previous review flagged unresolved privacy and settlement work |
| Nexus staking and rewards | 3 Operator / 3 Validator quorum, signed evidence, 72 heartbeat windows, penalties, zero-staker exception and normal-staker opening/closing snapshots | Existing source and earlier tests; full deployed/integration tests not certified |
| Nexus gas | 72-hour eligible wallet activity, 24-hour epoch, expiry-to-treasury, safe gas funding and fee policy | Policy and prior implementation exist; verify current Testnet deployment and behavior |
| Proxy and proxy authentication | Mining fair-use caps, enrollment/identity, auth and platform runtime testing | Separate repositories require security review |
| Release and wallet data | Five-platform signed builds, updater rollback protections, preserved wallets; macOS installs and full Electron bridge E2E | Testnet.27 L1 updater validated on Windows x64, Linux x64/ARM64; macOS installs deferred |

## Exit criteria

A Testnet security issue is **complete** only when its change has been reviewed against the live Testnet branch, tested on Pi1 or an isolated Testnet environment, proven compatible with chain history and existing wallets, merged into the correct Testnet repository, and included in a signed release **if binary users need it**.

Do not bypass a failing release gate, do not copy unfinished Mainnet code into Testnet, and do not claim Testnet 100% complete from source-only tests. All software updates must remain explicit and reproducible. Only after these Testnet checks are complete should independent CryLo and Nexus Mainnet genesis/chain initialization begin.
