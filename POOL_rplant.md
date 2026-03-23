# ⛏️ Mining C64 Chain on Rplant

**Rplant** is a high-performance mining pool known for its exceptional reliability, low fees, and support for a wide range of CPU-mineable coins. A favourite among serious miners.

## 🌐 Pool URL
**https://pool.rplant.xyz/#c64chain**

> 💡 Rplant has a dedicated **"Connect"** section on the C64 Chain pool page with all stratum endpoints, ports, and configuration examples ready to copy-paste.

## 🚀 Quick Start

### 1. No registration required
Rplant uses a wallet-based system — just point your miner to the pool with your C64 wallet address.

### 2. Configure your miner
```json
{
  "pools": [
    {
      "url": "stratum+tcp://c64chain.pool.rplant.xyz:PORT",
      "user": "YOUR_C64_WALLET_ADDRESS",
      "pass": "YourWorkerName"
    }
  ]
}
```

### 3. Start mining
```bash
./c64miner -c config.json
```

## 📊 Features
- ✅ No registration — mine directly to your wallet
- ✅ PPLNS payout scheme
- ✅ Accurate real-time hashrate calculation
- ✅ Low minimum payout threshold
- ✅ Detailed per-worker statistics

## 🔗 Links
- Pool: https://pool.rplant.xyz/#c64chain
- Node: https://github.com/oxynaz/c64chain-mainnet
- Miner: https://github.com/oxynaz/c64miner

**Happy mining! ⛏️🕹️**
