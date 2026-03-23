# ⛏️ Mining C64 Chain on FairMiningPool

**FairMiningPool** lives up to its name — transparent fees, fair reward distribution, and a straightforward setup that gets you mining in minutes. No surprises, just honest mining.

## 🌐 Pool URL
**https://fairminingpool.com/c64**

> 💡 FairMiningPool includes a **"How To Mine"** section on the C64 Chain page with detailed connection instructions, recommended settings and port numbers.

## 🚀 Quick Start

### 1. Create an account
Register at [fairminingpool.com](https://fairminingpool.com/c64) and set up your worker.

### 2. Configure your miner
```json
{
  "pools": [
    {
      "url": "stratum+tcp://fairminingpool.com:PORT",
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
- ✅ Transparent fee structure
- ✅ Fair PPLNS reward distribution
- ✅ Live pool statistics
- ✅ Reliable uptime
- ✅ Friendly community support

## 🔗 Links
- Pool: https://fairminingpool.com/c64
- Node: https://github.com/oxynaz/c64chain-mainnet
- Miner: https://github.com/oxynaz/c64miner

**Happy mining! ⛏️🕹️**
