# ⛏️ Mining C64 Chain on Suprnova

**Suprnova** is one of the most established and trusted mining pool networks in the cryptocurrency space — rock-solid infrastructure, real-time stats, and a clean dashboard that miners actually love.

## 🌐 Pool URL
**https://c64.suprnova.cc/index.html**

> 💡 Suprnova provides a detailed **"How To"** section directly on the pool page with step-by-step connection instructions specific to C64 Chain.

## 🚀 Quick Start

### 1. Create an account
Register at [c64.suprnova.cc](https://c64.suprnova.cc/index.html) and create a worker.

### 2. Configure your miner
```json
{
  "pools": [
    {
      "url": "stratum+tcp://c64.suprnova.cc:PORT",
      "user": "YOUR_USERNAME.YOUR_WORKER",
      "pass": "x"
    }
  ]
}
```

### 3. Start mining
```bash
./c64miner -c config.json
```

## 📊 Features
- ✅ Real-time hashrate & earnings dashboard
- ✅ PPLNS payout scheme
- ✅ Automatic payouts
- ✅ SSL/TLS stratum support
- ✅ Mobile-friendly interface

## 🔗 Links
- Pool: https://c64.suprnova.cc/index.html
- Node: https://github.com/oxynaz/c64chain-mainnet
- Miner: https://github.com/oxynaz/c64miner

**Happy mining! ⛏️🕹️**
