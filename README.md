# CryLo

CryLo is a CPU-mined blockchain ecosystem built around accessible solo mining, long-term network participation, and user-controlled infrastructure.

The ecosystem consists of:

- **CryLo** — the mineable Layer 1 asset
- **wCryLo** — the bridged CryLo asset used on CryLoNexus
- **CRYLO** — the native CryLoNexus gas asset
- **CryLo Wallet** — the Electron desktop wallet and control interface
- **CryLoNexus** — the companion execution network for bridge, staking, node services, and additional CryLo functionality
- **CryLo-Proxy** — an optional capped mining proxy for lower-hashrate local mining setups

CryLo is currently in public testnet development ahead of mainnet release.

## CryLo Network

| Parameter | Value |
| --- | --- |
| Maximum supply | 5,000,000 CryLo |
| Mining | CPU-only |
| Algorithm | rx/crylo |
| Block target | 210 seconds |
| Starting block reward | 2.5 CryLo |
| Reward floor | 0.2 CryLo |
| Linear emission | 3,703,704 blocks |
| Miner unlock | 50% immediate |
| Miner vesting | 50% over 45 days |
| Development allocation | 1.0% |
| Liquidity allocation | 0.5% |
| P2P port | 22640 |
| RPC port | 22641 |
| ZMQ port | 22642 |

CryLo and wCryLo use **11 decimal places**.

## Mining

CryLo uses native daemon-based solo mining.

Supported mining interfaces are:

- CryLo Wallet mining
- direct CryLo daemon mining
- CryLo-Proxy mining

Every normal mining machine runs its own CryLo daemon and connects independently to the CryLo P2P network.

CryLo-Proxy may be used when multiple lower-hashrate machines share one local daemon while remaining within the configured proxy hashrate cap.

CryLo does not use public mining gateways, pooled template distribution, or Stratum-style shared mining infrastructure.

## CryLo Wallet

The CryLo Electron wallet provides the primary desktop interface for the ecosystem.

Current wallet functionality includes:

- create, open, and restore CryLo wallets
- send and receive CryLo
- transaction history
- vested mining reward tracking
- integrated daemon mining controls
- live mining statistics
- CryLoNexus wallet binding
- CryLo ↔ wCryLo bridge controls
- wCryLo balances
- CryLoNexus gas management
- staking and reward controls
- Operator and Validator registration
- Node Center installation, connection, verification, and operation
- node diagnostics and service controls
- CryLoNexus transaction history

Wallet data and bound CryLoNexus wallet information remain in the user's existing CryLo Wallet application-data directories across updates.

## CryLoNexus

CryLoNexus extends the CryLo ecosystem without replacing CryLo Layer 1.

Current testnet network parameters include:

| Parameter | Value |
| --- | --- |
| Chain ID | 5546 |
| Native gas asset | CRYLO |
| Bridged asset | wCryLo |
| CryLo / wCryLo decimals | 11 |
| CRYLO gas decimals | 18 |

A CryLo wallet can be permanently bound to a CryLoNexus wallet for Nexus activity.

The Electron wallet retrieves active CryLoNexus runtime and contract configuration from the CryLoNexus Foundation service rather than relying on user-entered contract addresses.

## Bridge

The CryLo bridge connects the mineable Layer 1 CryLo asset with wCryLo on CryLoNexus.

Supported directions are:

- **CryLo → wCryLo**
- **wCryLo → CryLo**

Bridge activity is handled through the CryLo Wallet and the CryLoNexus bridge services.

## Staking and Nodes

CryLoNexus currently supports two node staking tiers:

| Tier | Required stake |
| --- | ---: |
| Operator | 300 wCryLo |
| Validator | 750 wCryLo |

Validator is treated as an upgrade from Operator within the unified Node Center workflow.

The Node Center guides operators through:

1. Register
2. Install
3. Connect
4. Verify
5. Operate

The persistent CryLoNexus Node Service provides runtime status, diagnostics, RPC monitoring, bridge monitoring, gas monitoring, revenue monitoring, metrics, and verification functions used by the wallet.

## Release Architecture

CryLo releases support native packaging for the host operating system and architecture.

The release pipeline detects the current platform and selects the matching CryLo binaries before packaging the Electron wallet.

Supported release targets include:

- Linux ARM64
- Linux x64
- Windows x64
- macOS x64
- macOS ARM64

Release packaging verifies that bundled CryLo daemon and wallet-RPC binaries match the intended architecture.

## Repository Layout

Major project areas include:

```text
electron/        CryLo Electron wallet
node-operator/   CryLoNexus Node Service runtime and protocol
src/             CryLo core source
cmake/           CMake support
scripts/         build and release tooling
tests/           CryLo core tests
external/        upstream third-party dependencies
```

Files under `external/` may retain upstream project naming, metadata, contract-address filenames, and attribution required by those dependencies.

## Security

Never commit wallet files, wallet key files, private keys, seeds, credentials, or local runtime secrets to the repository.

Local wallet and node configuration belongs in the user's application-data or service configuration directories, not in Git.

## Community

CryLo Discord:

https://discord.gg/Vd5HtkGHQU

## Credits and License

CryLo is derived from the CryptoNote ecosystem and builds upon open-source work from Monero, Wownero, and their contributors.

CryLo includes substantial project-specific work covering its network economics, mining architecture, Electron wallet, CryLoNexus integration, bridge, staking, Node Center, and supporting infrastructure.

CryLo is released under the **GNU General Public License v3.0 (GPL-3.0)**.

See [LICENSE](LICENSE) for complete licensing information.

All applicable upstream copyright and attribution notices remain preserved.
