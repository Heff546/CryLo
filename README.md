# CryLo (CRYLO) — source code and network status

> **Current status (November 21, 2026): Testnet release available. Mainnet has NOT launched.** This repository contains multiple development histories. A branch name alone is **not** evidence of a production-ready network or approved release.

## Choose the right code

| What you need | Authoritative reference | Status |
| --- | --- | --- |
| **Current Testnet development source** | [`testnet` branch](https://github.com/Heff546/CryLo/tree/testnet) | Active Testnet source |
| **Verified Testnet release source** | [`v1.1.1-testnet.27` tag](https://github.com/Heff546/CryLo/tree/v1.1.1-testnet.27) | Fixed source revision: `27c8c3b1fe974f00e7f1c2ce196562135837831f` |
| **Testnet installers and checksums** | [Testnet.27 release](https://github.com/Heff546/CryLo/releases/tag/v1.1.1-testnet.27) | Published Testnet prerelease; signed release manifest |
| **Mainnet development** | [`main` branch](https://github.com/Heff546/CryLo/tree/main) | **Preparation only — not a launched Mainnet release** |
| **Unfinished Mainnet source reconciliation** | [`integration/mainnet-source-20261117`](https://github.com/Heff546/CryLo/tree/integration/mainnet-source-20261117) | Historical work in progress; not approved for deployment |

**Do not use `main`, `release/crylo-mainnet`, Mainnet integration branches, or open draft pull requests as a Mainnet release.** Mainnet-specific consensus, treasury-recipient proofs, genesis, and validation must be completed and approved first.

The `testnet` branch includes follow-up CI/workflow commits after the signed release. To reproduce **exactly** the published Testnet.27 source, use the release tag above, **not the moving branch HEAD**.

## Getting the Testnet software

Use the [published Testnet.27 release](https://github.com/Heff546/CryLo/releases/tag/v1.1.1-testnet.27) rather than downloading binaries from arbitrary branches or old release candidates.

Release targets:
- Windows x64
- Linux x64
- Linux ARM64 (including Raspberry Pi)
- macOS Intel (x64)
- macOS Apple Silicon (ARM64)

The five platform artifacts were prepared from the same frozen source commit. The signed release manifest provides artifact authenticity verification. **macOS packages are unsigned/unnotarized** and require the documented user-approved installation process; a signed release manifest does not mean Apple has notarized the installer.

For an existing supported installation, the standard update command is:

```bash
crylo update
```

This command must be run from an existing correctly configured CryLo installation. Never point a Testnet daemon at Mainnet data, or a Mainnet daemon at Testnet data. Network keys, chain data, and wallets must remain network-separated.

**Network service availability:** Published binaries and source do not imply that a public Testnet relay, anchor, or peer is currently running.

## What is CryLo?

CryLo is a CPU-mined CryptoNote-derived Layer 1 with native solo mining, a five-million-coin maximum supply, a 210-second target block interval, and integrated desktop-wallet tooling. The ecosystem also includes the wCryLo bridge and CryLoNexus development, maintained separately from the CryLo L1 release.

| Related project | Repository |
| --- | --- |
| CryLo L1 and Electron wallet | [Heff546/CryLo](https://github.com/Heff546/CryLo) |
| CryLoNexus (may require repository access) | [Heff546/CryLo-Nexus](https://github.com/Heff546/CryLo-Nexus) |
| CryLo proxy | [Heff546/CryLoProxy](https://github.com/Heff546/CryLoProxy) |

The full current Testnet project description and source layout live in the [Testnet README](https://github.com/Heff546/CryLo/blob/testnet/README.md). This landing page deliberately does not repeat obsolete Testnet V2 installation commands or outdated treasury percentages.

## Development and release rules

- **Testnet:** Testnet source, testing, and signed `testnet` prereleases stay separate from Mainnet.
- **Mainnet:** No production status until an independent Mainnet genesis, consensus/security gates, and an explicitly authorized Mainnet release pass.
- **Release integrity:** Do not rewrite published tags or bypass signature, checksum, or rollback checks. Do not merge the Testnet branch wholesale into Mainnet: selectively reconcile audited common changes.
- **Security:** Never commit private keys, wallet files, seed phrases, or infrastructure secrets to GitHub.

## Community and license

[CryLo Discord](https://discord.gg/Vd5HtkGHQU) · [Releases](https://github.com/Heff546/CryLo/releases)

CryLo is developed from the CryptoNote ecosystem with attribution to its upstream contributors. Licensed under the GNU GPL v3.0; see [LICENSE](LICENSE).
