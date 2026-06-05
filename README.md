# CryLo (CRYLO)

**CryLo is a CPU-mined cryptocurrency focused on fair distribution, long-term miner participation, and sustainable ecosystem growth.**

Built on proven CryptoNote technology and powered by the RandomX-based **rx/c64** algorithm, CryLo combines a predictable linear emission model with miner vesting mechanics that encourage network stability and reduce immediate sell pressure.

---

## Key Features

### Fair CPU Mining

CryLo was built around a simple idea: mining should remain accessible to everyday users.

Instead of relying on large centralized mining pools, CryLo supports **CPU-only solo mining** and integrated proxy-based mining infrastructure. This allows lower-end devices to contribute hashing power while helping maintain a fair and decentralized network.

* Custom RandomX-based **rx/c64** algorithm
* CPU-only mining
* Solo mining without traditional pools
* CryLo-Proxy support for lower-end hardware
* Decentralized miner participation
* No premine
* No ICO
* No VC allocation


### Linear Emission

* Maximum Supply: **5,000,000 CRYLO**
* Starting Block Reward: **2.5 CRYLO**
* Minimum Block Reward Floor: **0.2 CRYLO**
* Linear emission schedule across **3,703,704 blocks**
* Predictable long-term issuance

### Miner Vesting System

Every block reward is automatically split:

* **50% instantly unlocked**
* **50% vested for 45 days**

This model rewards active miners while encouraging long-term network participation.

### Sustainable Ecosystem Funding

Each block includes:

* **1.0% Development Fund**
* **0.5% Liquidity Fund**

These funds support ongoing development, infrastructure, exchange liquidity, and ecosystem expansion.

### Fast Blocks

* Block Target: **210 seconds**
* Approximately **411 blocks per day**
* Faster confirmations and responsive network operation

### Bootstrap Difficulty

* Initial Network Difficulty: **125,000**
* Designed to provide stable early network operation and miner onboarding

---

# CryLo Desktop Wallet

CryLo includes a custom Electron-based desktop wallet that integrates directly with the CryLo daemon.

### Wallet Features

* Integrated daemon management
* One-click synchronization
* Built-in mining controls
* Wallet balance tracking
* Transaction history
* Network status monitoring

### Mining Dashboard

The CryLo Wallet includes a real-time mining dashboard displaying:

* Local Hashrate
* Network Hashrate
* Estimated Block Time
* Expected Blocks Per Day
* Estimated Daily Rewards
* Blocks Found
* Current Difficulty
* Block Reward
* Mining Thread Count

---

# CryLo Proxy

CryLo-Proxy is a supplemental mining service designed specifically for lower-end hardware and resource-constrained devices.

To promote fair network participation and prevent mining centralization, the CryLo Proxy operates with a strict **100 kH/s global hashrate cap**. Once the cap is reached, additional miners are directed to mine directly through the CryLo daemon or Electron wallet.

The proxy is not intended to replace solo mining. Instead, it provides an accessible entry point for small miners while encouraging higher-performance systems to contribute directly to the network.

### Features

* Designed for low-power and lower-end hardware
* Global proxy hashrate cap of **100 kH/s**
* Automatic hashrate enforcement with grace period protection
* Fair-share participation for small miners
* Miner connection tracking and monitoring
* Centralized hashrate visibility
* LAN and remote deployment support
* Direct migration path to daemon and wallet mining

### Fair Mining Philosophy

CryLo prioritizes decentralized, CPU-only solo mining.

The CryLo Proxy exists to help smaller miners participate without competing against larger systems. Higher-performance hardware is expected to mine directly through the CryLo daemon or Electron wallet, helping maintain a balanced and decentralized mining ecosystem.


---

# Current Network Status

### Testnet Live

The CryLo Testnet is currently operational and available for external miner testing.

Current goals:

* Testnet stability validation
* Mining performance testing
* Wallet testing
* Network growth
* Community miner onboarding

---

# Technical Specifications

| Parameter            | Value            |
| -------------------- | ---------------- |
| Coin Ticker          | CRYLO            |
| Maximum Supply       | 5,000,000        |
| Block Target         | 210 Seconds      |
| Starting Reward      | 2.5 CRYLO        |
| Reward Floor         | 0.2 CRYLO        |
| Emission Length      | 3,703,704 Blocks |
| Mining Algorithm     | rx/c64           |
| Instant Reward       | 50%              |
| Vested Reward        | 50%              |
| Vesting Period       | 45 Days          |
| Development Fund     | 1.0%             |
| Liquidity Fund       | 0.5%             |
| Bootstrap Difficulty | 125,000          |

---

# Roadmap

## Phase 1 — Testnet Foundation ✅ COMPLETE

The CryLo Testnet has successfully launched and all core foundation milestones have been completed.

### Completed Milestones

✅ Core CryLo blockchain launched and operating on Testnet

✅ Custom tokenomics implemented

* 5,000,000 maximum supply
* Linear emission schedule
* 50% instant miner rewards
* 50% vested miner rewards (45-day vesting)

✅ Electron Desktop Wallet released

✅ Integrated daemon mining controls

✅ CryLo-Proxy deployed and operational

✅ Real-time Mining Dashboard implemented

* Local hashrate
* Network hashrate
* Estimated block time
* Expected blocks per day
* Estimated daily rewards
* Blocks found
* Difficulty monitoring

✅ Network difficulty and emission model validated

✅ Testnet infrastructure operational

✅ External miner testing ready

### Phase 1 Status

🟢 COMPLETE

CryLo has progressed from concept to a fully functioning blockchain ecosystem with a live Testnet, desktop wallet, integrated mining infrastructure, and operational proxy network.

The project is now entering Phase 2: Network Growth and Community Testing.


### Phase 2 — Network Growth

* Public miner onboarding
* Expanded testnet participation
* Community tooling
* Mining ecosystem expansion

### Phase 3 — Ecosystem

* Advanced wallet functionality
* Additional infrastructure services
* NFT and Layer-2 experimentation
* Long-term governance initiatives

---

# Vision

CryLo is designed to create a sustainable mining economy where miners are incentivized to participate beyond immediate block rewards. Through predictable emissions, reward vesting, and ecosystem funding, CryLo aims to build a long-lived CPU-mined network focused on decentralization and community growth.


## Credits & License

CryLo is a custom blockchain project derived from the CryptoNote codebase and inspired by the open-source innovation of the Monero ecosystem.

Project lineage:

**Monero → Wownero → C64 Chain → CryLo**

CryLo introduces its own economics, mining infrastructure, wallet ecosystem, vesting model, and network architecture while building upon years of open-source development contributed by these projects.

Licensed under the **GNU General Public License v3.0 (GPL-3.0)**. See [LICENSE](LICENSE) for full details.

We thank all upstream developers and contributors whose work laid the foundation for CryLo.

