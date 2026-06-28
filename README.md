# CryLo (CRYLO)

![Status](https://img.shields.io/badge/status-testnet_live-brightgreen)
![Mining](https://img.shields.io/badge/mining-CPU_only-blue)
![Supply](https://img.shields.io/badge/max_supply-5M_CRYLO-purple)
![License](https://img.shields.io/badge/license-GPL--3.0-green)
[![Release](https://img.shields.io/github/v/release/Heff546/CryLo)](https://github.com/Heff546/CryLo/releases)

Need help getting started?
Join the official CryLo Discord: https://discord.gg/Vd5HtkGHQU


**CryLo (CRYLO) is a CPU-mined digital asset with a fixed supply of 5 million coins, built to support a fair, decentralized, and sustainable blockchain ecosystem.**

CryLo is currently live on **Testnet** and ready for external miner testing.

**Current Status:** Phase 1 Complete ✅ | External Miner Testing Active

## Core Features

CryLo is a CPU-mined cryptocurrency designed around fair distribution, accessible mining, and long-term network sustainability.

### Fair CPU Mining

* RandomX-based **rx/crylo** mining algorithm
* CPU-only mining
* Native solo mining support
* Integrated daemon mining
* Electron wallet mining
* CryLo-Proxy support for lower-end hardware
* No premine
* No ICO
* No VC allocation

### Network Economics

* Fixed maximum supply of **5,000,000 CRYLO**
* Starting block reward of **2.5 CRYLO**
* Floor reward of **0.2 CRYLO**
* Linear emission across **3,703,704 blocks**
* **210-second** target block time
* **125,000** bootstrap difficulty

### Reward Distribution

Each block reward is distributed as follows:

* **50% instantly unlocked** for miners
* **50% vested for 45 days**
* **1.0% Development Fund**
* **0.5% Liquidity Fund**

This model rewards active miners immediately while encouraging long-term participation and sustainable network growth.

### Built-In Mining Infrastructure

* Electron desktop wallet with integrated mining controls
* Real-time mining dashboard
* Live hashrate monitoring
* Network difficulty tracking
* Estimated block discovery statistics
* Expected daily reward projections
* Blocks-found tracking
* Integrated daemon management

## Quick Start — Mine CryLo in 5 Minutes

### Step 1 — Start the Testnet Daemon

```bash
./build/bin/CryLo-daemon --testnet --data-dir ~/.CryLo-testnet-v2
```

Wait until the daemon has synchronized with the network.

### Step 2 — Create a Wallet

```bash
./build/bin/CryLo-wallet \
  --testnet \
  --daemon-address=127.0.0.1:22641 \
  --generate-new-wallet=$HOME/.CryLo-testnet-v2/mywallet
```

Save your wallet password, wallet address, and 25-word recovery seed phrase.

### Step 3 — Choose a Mining Method

CryLo currently supports three mining methods:

* **Electron Wallet Mining** — Recommended for most users. Open the Mining tab and start mining directly from the wallet.
* **Daemon Mining** — Mine directly through the CryLo daemon using the built-in mining RPC commands.
* **CryLo-Proxy Mining** — Intended for lower-end hardware and shared mining environments. CryLo-Proxy is limited to a global hashrate cap of **100 kH/s** to promote fair network participation.

For maximum network decentralization, miners are encouraged to use Electron Wallet Mining or direct Daemon Mining whenever possible.

### Step 4 — Start Mining

Navigate to the **Mining** tab.

Select the number of CPU threads you wish to use and click **Start Mining**.

The wallet automatically uses your active CryLo wallet address.

### Step 5 — Monitor Your Progress

The mining dashboard displays:

* Local Hashrate
* Network Hashrate
* Current Difficulty
* Estimated Block Time
* Expected Blocks Per Day
* Estimated Daily Rewards
* Blocks Found
* Current Block Reward

## Create a Wallet

Before creating a wallet, make sure the CryLo Testnet daemon is running and synchronized.

Create a new wallet:

```bash
./build/bin/CryLo-wallet \
  --testnet \
  --daemon-address=127.0.0.1:22641 \
  --generate-new-wallet=$HOME/.CryLo-testnet-v2/mywallet
```

When prompted:

1. Enter a wallet password.
2. Confirm the wallet password.
3. Record your wallet address.
4. Record your 25-word recovery seed phrase.

**Important:** Your recovery seed phrase is the only way to restore access to your wallet if the wallet file is lost.

After the wallet is created, the CryLo wallet will connect to the local Testnet daemon and begin synchronizing.

To display your wallet address at any time:

```text
address
```

To check synchronization status:

```text
status
```

## Open an Existing Wallet

If you have already created a wallet, open it with:

```bash
./build/bin/CryLo-wallet \
  --testnet \
  --daemon-address=127.0.0.1:22641 \
  --wallet-file=$HOME/.CryLo-testnet-v2/mywallet
```

When prompted, enter your wallet password.

After the wallet opens, verify synchronization:

```text
status
```

Display your mining address:

```text
address
```

This wallet address is the address used for daemon mining, Electron wallet mining, and CryLo-Proxy mining.


### Wallet Commands

| Command                   | Description                                          |
| ------------------------- | ---------------------------------------------------- |
| `balance`                 | Display total, unlocked, locked, and vested balances |
| `address`                 | Display your CryLo wallet address                    |
| `transfer ADDRESS AMOUNT` | Send CRYLO to another wallet                         |
| `seed`                    | Display your 25-word recovery seed phrase            |
| `status`                  | Show wallet synchronization status                   |
| `help`                    | Display available wallet commands                    |
| `exit`                    | Close the wallet                                     |

## Testnet Mining

CryLo supports CPU-only mining through the integrated Electron desktop wallet, direct daemon mining, and CryLo-Proxy for lower-end hardware.

### Option 1 — Electron Wallet Mining (Recommended)

The easiest way to mine CryLo is through the Electron desktop wallet.

1. Launch the CryLo Wallet.
2. Open or create a wallet.
3. Navigate to the **Mining** tab.
4. Configure the number of mining threads.
5. Click **Start Mining**.

The wallet automatically uses your active wallet address and provides a live mining dashboard displaying:

* Local Hashrate
* Network Hashrate
* Estimated Block Time
* Expected Blocks Per Day
* Estimated Daily Rewards
* Blocks Found
* Current Difficulty
* Current Block Reward

### Option 2 — Daemon Mining

CryLo can be mined directly through the daemon without any external mining software.

#### Step 1 — Start the CryLo Testnet Daemon

```bash
./build/bin/CryLo-daemon --testnet --data-dir ~/.CryLo-testnet-v2
```

Wait for the daemon to synchronize with the network before starting mining.

Check sync status:

```bash
curl http://127.0.0.1:22641/get_info
```

Wait until the response shows:

```json
"synchronized": true
```

#### Step 2 — Open Your Wallet

```bash
./build/bin/CryLo-wallet \
  --testnet \
  --daemon-address=127.0.0.1:22641 \
  --wallet-file=$HOME/.CryLo-testnet-v2/mywallet
```

Display your wallet address:

```text
address
```

Copy the wallet address shown by the wallet.

#### Step 3 — Start Mining

Replace `YOUR_CRYLO_ADDRESS` with the wallet address returned by the `address` command.

Adjust `threads_count` to the number of CPU threads you want to dedicate to mining.

```bash
curl http://127.0.0.1:22641/start_mining \
  -d '{"miner_address":"YOUR_CRYLO_ADDRESS","threads_count":2}' \
  -H 'Content-Type: application/json'
```

#### Step 4 — Check Mining Status

```bash
curl http://127.0.0.1:22641/mining_status
```

A successful response will show the miner as active along with hashrate and thread information.

#### Step 5 — Stop Mining

```bash
curl http://127.0.0.1:22641/stop_mining
```


### Option 3 — CryLo-Proxy

CryLo-Proxy is intended for lower-end hardware and resource-constrained systems.

To maintain fair participation and discourage mining centralization, CryLo-Proxy operates with a strict **100 kH/s global hashrate cap**. Once the cap is reached, miners are expected to mine directly through the CryLo daemon or Electron wallet.

CryLo-Proxy provides:

* Shared mining access for lower-end systems
* Hashrate monitoring
* Connection management
* Grace-period enforcement
* LAN and remote deployment support

### LAN Mining Setup

If you have multiple miners on the same local network, you can run a single CryLo node and allow other systems to mine against it.

This setup is ideal for home mining, small testnet deployments, and multi-machine CPU mining environments.

**On the node machine** — start the CryLo Testnet daemon with RPC access enabled:

```bash
./build/bin/CryLo-daemon \
  --testnet \
  --data-dir ~/.CryLo-testnet-v2 \
  --rpc-bind-ip=0.0.0.0 \
  --confirm-external-bind \
  --log-level=1
```

**On LAN miner machines** — configure the miner to connect to the local IP address of the machine running the CryLo daemon.

Replace `192.168.X.X` with the node machine's actual LAN IP address. Port `22641` is the CryLo Testnet RPC port and should not be changed.

```json
{
  "url": "192.168.X.X:22641",
  "daemon": true
}
```

Example:

```json
{
  "url": "192.168.1.100:22641",
  "daemon": true
}
```

Requirements:

* The CryLo daemon must be running on the node machine.
* The daemon must be started with `--rpc-bind-ip=0.0.0.0`.
* TCP port `22641` must be accessible from other machines on the local network.
* No additional node is required on miner-only systems.


## Network Configuration

| Parameter            | Value            |
| -------------------- | ---------------- |
| Network              | CryLo Testnet    |
| P2P Port             | 22640            |
| RPC Port             | 22641            |
| ZMQ Port             | 22642            |
| Mining Algorithm     | rx/crylo           |
| Block Target         | 210 Seconds      |
| Maximum Supply       | 5,000,000 CRYLO  |
| Starting Reward      | 2.5 CRYLO        |
| Reward Floor         | 0.2 CRYLO        |
| Emission Length      | 3,703,704 Blocks |
| Development Fund     | 1.0%             |
| Liquidity Fund       | 0.5%             |
| Bootstrap Difficulty | 125,000          |

## Network Discovery

CryLo nodes automatically discover peers through the network's built-in peer discovery system.

Seed nodes are embedded within the CryLo daemon and assist new nodes in locating peers when joining the network for the first time.

Once connected, nodes exchange peer information automatically, allowing the network to operate in a decentralized manner without manual configuration.

## Block Explorer

### Coming Soon

A dedicated CryLo Block Explorer is planned for a future release and will provide:

* Block and transaction lookup
* Network hashrate monitoring
* Difficulty tracking
* Supply and emission statistics
* Rich address and transaction details
* Real-time network metrics

## Why CryLo?

CryLo was designed around a simple principle: keep mining accessible, fair, and decentralized.

Key design goals include:

| Feature                | CryLo                            |
| ---------------------- | -------------------------------- |
| Mining Model           | CPU-Only                         |
| Algorithm              | rx/crylo                           |
| Supply Model           | Fixed 5,000,000 Maximum Supply   |
| Block Target           | 210 Seconds                      |
| Miner Rewards          | 50% Instant / 50% 45-Day Vesting |
| Development Fund       | 1.0%                             |
| Liquidity Fund         | 0.5%                             |
| Solo Mining            | Native Support                   |
| Daemon Mining          | Integrated                       |
| Electron Wallet Mining | Integrated                       |
| CryLo-Proxy Support    | Yes                              |
| Premine                | None                             |
| ICO                    | None                             |
| VC Allocation          | None                             |

## Roadmap

### Phase 1 — Testnet Foundation ✅ COMPLETE

* ✅ Custom CryLo blockchain launched
* ✅ Core network infrastructure operational
* ✅ CryLo tokenomics implemented
* ✅ Electron desktop wallet released
* ✅ Integrated daemon mining
* ✅ Mining dashboard completed
* ✅ CryLo-Proxy deployed
* ✅ Network emission model validated
* ✅ External miner testing ready

### Phase 2 — Public Testnet Growth

* Community miner onboarding
* Expanded network participation
* Wallet testing and feedback
* Infrastructure hardening
* Network performance optimization

### Phase 3 — Mainnet Preparation

* Mainnet launch candidate testing
* Block explorer deployment
* Additional ecosystem tooling
* Public documentation expansion
* Community growth initiatives

### Phase 4 — Ecosystem Expansion

* Advanced wallet features
* NFT experimentation
* Layer-2 research and development
* Additional CryLo infrastructure services
* Long-term governance initiatives

## Credits & License

CryLo is a custom blockchain project derived from the CryptoNote codebase and built upon years of open-source research and development within the privacy-focused cryptocurrency ecosystem.

Project lineage:

**Monero → Wownero → CryLo**

While CryLo inherits technology from these projects, it introduces its own network economics, mining infrastructure, wallet ecosystem, reward distribution model, and long-term development vision.

CryLo remains deeply appreciative of the developers, researchers, and contributors whose work made this project possible.

### License

CryLo is released under the **GNU General Public License v3.0 (GPL-3.0)**.

See the [LICENSE](LICENSE) file for complete licensing information.

All applicable upstream copyrights, licenses, and attribution notices from Monero, Wownero, and CryLo remain preserved in accordance with their respective open-source licenses.

