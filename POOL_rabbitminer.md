# ⛏️ Mining C64 Chain on RabbitMiner

**RabbitMiner** — fast as a rabbit, reliable as a rock. A dedicated pool for CPU miners who want low latency connections and consistent payouts without the hassle.

## 🌐 Pool URL
**https://rabbitminer.cc/c64/**

> 💡 RabbitMiner provides a **"How To Connect"** guide on their C64 Chain page with stratum URLs, port numbers and miner configuration examples.

## 🚀 Quick Start

### 1. Create an account
Register at [rabbitminer.cc](https://rabbitminer.cc/c64/) and create your worker.

### 2. Configure your miner
```json
{
  "pools": [
    {
      "url": "stratum+tcp://rabbitminer.cc:PORT",
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
- ✅ Low latency stratum servers
- ✅ PPLNS payout scheme
- ✅ Real-time earnings tracker
- ✅ Automatic payouts
- ✅ Dedicated C64 Chain support

## 🔗 Links
- Pool: https://rabbitminer.cc/c64/
- Node: https://github.com/oxynaz/c64chain-mainnet
- Miner: https://github.com/oxynaz/c64miner

**Happy mining! ⛏️🕹️**
