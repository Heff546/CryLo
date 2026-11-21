# CryLo contributor source policy: Testnet to Mainnet

**Updated November 21, 2026.** This file describes code integration and release boundaries. It is NOT permission to launch Mainnet.

## Find the correct source

| Goal | GitHub reference | Rule |
| --- | --- | --- |
| Released Testnet V4 source | [`v1.1.1-testnet.27`](https://github.com/Heff546/CryLo/tree/v1.1.1-testnet.27) | Immutable signed-release source, commit `27c8c3b1fe974f00e7f1c2ce196562135837831f` |
| Ongoing Testnet code | [`testnet`](https://github.com/Heff546/CryLo/tree/testnet) | Shared bug fixes and Testnet-specific maintenance, reviewed and validated before merging |
| Mainnet preparation | [`main`](https://github.com/Heff546/CryLo/tree/main) | Unreleased; branch name does not imply production safety |
| Mainnet three-proof security candidate | [Draft PR #26](https://github.com/Heff546/CryLo/pull/26) | Built on the existing Mainnet template-padding candidate; unmerged and not production-validated |
| Mainnet existing template-padding work | [Draft PR #17](https://github.com/Heff546/CryLo/pull/17) | Parent security work for PR #26; not released |

The Testnet.27 release comprises five architectures from the same frozen source revision. Windows x64, Linux x64 and Linux ARM64 have undergone real installation tests. macOS installer runtime checks remain deferred; **macOS packages are unsigned and unnotarized**. Published software is not evidence that public peers or relay/anchor services are currently running.

## Mandatory development order

1. **Shared, network-neutral correction:** isolate the minimal change; review it against the latest `testnet` source; validate it on Pi1 and relevant CI platforms; merge it into `testnet` when safe. Then reconcile the **same proven change** into a separate Mainnet integration branch by exact file comparison. Do not reimplement it differently on every operating system.
2. **Testnet V4 consensus change:** do not silently alter an active historical validation rule. Test historical blocks on an isolated LMDB snapshot first. If a consensus change is needed, propose an explicit Testnet activation/fork plan and a new signed Testnet release; never rewrite the Testnet.27 tag.
3. **Mainnet-only consensus feature:** maintain on a separate review branch until tested. Independent genesis, recipient addresses, proof formats, Mainnet hardfork schedule, chain ID, network separation and updater authentication **must not be transplanted into the live Testnet V4 path**.
4. **Mainnet reconciliation:** start from the verified shared Testnet source, identify remaining Mainnet-only changes, and require native full-block admission/rejection, historical Testnet V4 replay, peer-sync/reorg and five-architecture release gates before merging or launching Mainnet.
5. **Release:** keep Testnet and Mainnet release tags, signing keys, manifests and rollback sequences separate. Preserve user wallet and blockchain files across updates. The normal supported user command is `crylo update`.

**Do not merge `testnet` into `main` wholesale**, and do not merge draft Mainnet branches back into active Testnet V4 without reviewing consensus compatibility and wallet-data safety.

## Treasury wallet custody gate

**Before the Testnet V4 treasury recipient hardfork:** read [the treasury wallet custody and offline creation runbook](security/TESTNET_TREASURY_WALLET_CUSTODY.md). Existing hard-coded public recipient keys do not establish that an owner possesses the corresponding private spending keys; newly generated wallets cannot retroactively take custody of historical outputs. Verify recipients and backups before selecting any forward-only activation height. Do not publish or transmit private wallet material.

## Security boundary: historical Development Fund viewing key

Testnet V4 source publicly contains `CryLo_DEV_FUND_VIEWKEY_SECRET`, a **private viewing** key used to verify historical Development Fund coinbase outputs. This key cannot alone spend funds, but it is already disclosed and **must never be reused for the Mainnet Development Fund**. Removing or replacing this value in the legacy Testnet V4 consensus path without a protocol migration could invalidate historical block validation.

Mainnet draft PR #26 replaces the MAINNET-only use of that old key with a new, **independently controlled Mainnet Development wallet** and a public Development Fund DLEQ recipient proof. The Mainnet proof design now has three canonical proof fields: Development [2], Liquidity [3], Gas Treasury [4], preserving the owner-approved **75/25/50 basis point** block reward allocation.

**All Mainnet Development wallet public keys are intentionally unset** on the review candidate. Mainnet code must fail closed until new keys are provisioned offline. Never commit a wallet file, mnemonic, private view/spend key or signing key. The old viewing key's presence in public Testnet history is not a spend-key compromise, but requires separation for Mainnet privacy.

These three-proof changes are **not activated on Testnet V4**. Before enabling the same new consensus design on any Testnet network, define and validate a separately versioned hardfork/activation and preserve already-mined history.

## Evidence and open gates as of November 21, 2026

Pi1 reviewed the unmerged Mainnet security candidate at `36d875b4ad1dd2b5106434edb63b6b648447990b`:

- **12 / 12 JavaScript source-level tests passed.** These validate source structure, NOT native cryptographic correctness.
- Mainnet preflight remained **BLOCKED** by (1) an independent, correctly configured Mainnet Development wallet; (2) native three-proof consensus/history replay evidence; and (3) a dedicated, authenticated Mainnet update/release channel.
- Native compilation, in-memory adversarial proof GTests, isolated full-block acceptance/rejection, Testnet V4 historical replay and five-platform runtime consensus are NOT yet certified by this result.

Do not label PR #26 or `main` a production release based on source checks alone.

## Contributor review checklist

Before requesting a merge, state:

- Source and target branch; immutable baseline commit; exact changed files and relevant network.
- Whether changes affect miner coinbase, transactions, hardfork activation, `tx.extra`, treasury recipients, genesis, address prefixes, daemon flags, wallet-data storage or signed update behavior.
- Native and source test commands, exit codes, Pi1 results and whether Testnet V4 history was replayed on a **copy**.
- How the feature remains separate from Mainnet-only secrets/network identity; no private keys, wallet files, live node data or release credentials in the PR.
- Whether a signed release is actually needed; do not rebuild five packages merely because a draft branch or documentation changed.

Do not remove an explicit safety gate to make a check pass. **A failing security gate is a blocker, not a request to lower the guard.**
