# CryLo Wallet — Electron Build Guide

## Overview

This Electron app bundles `crylod` and `crylo-wallet-rpc` into a single
desktop wallet for Windows (and Linux).  
It is built on Linux using `electron-builder` with Wine for the Windows installer.

---

## Prerequisites (Ubuntu 20.04+ / Debian 11+)

### 1. Node.js 18+
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # should be v18+
npm --version
```

### 2. Wine (for Windows NSIS installer generation)
```bash
sudo dpkg --add-architecture i386
sudo apt update
sudo apt install -y wine64 wine32
wine --version
```

### 3. Dependencies (for electron-builder)
```bash
sudo apt install -y icnsutils graphicsmagick fakeroot rpm
```

---

## Step 1 — Place compiled binaries

Before building, copy the compiled Windows `.exe` files into `bin/win/`:

| File | Source |
|------|--------|
| `bin/win/crylod.exe` | Cross-compiled with MinGW or Docker |
| `bin/win/crylo-wallet-rpc.exe` | Same build |

```bash
cd electron/
ls bin/win/
# crylod.exe  crylo-wallet-rpc.exe  README.txt
```

For Linux builds, place binaries in `bin/linux/`:
```bash
ls bin/linux/
# crylod  crylo-wallet-rpc  README.txt
```

Make Linux binaries executable:
```bash
chmod +x bin/linux/crylod bin/linux/crylo-wallet-rpc
```

---

## Step 2 — Add icons

Place the following icon files in `assets/`:

| File | Description |
|------|-------------|
| `assets/icon.ico` | Windows icon (256×256 recommended) |
| `assets/icon.png` | Linux icon (512×512 recommended) |

If you don't have icons yet, create a placeholder to allow the build to run:
```bash
# Quick placeholder (requires ImageMagick)
convert -size 256x256 xc:#0d0d1a -fill '#ffd700' \
  -font DejaVu-Sans-Bold -pointsize 72 -gravity center \
  -annotate 0 "CryLo" assets/icon.png

# Convert to .ico
convert assets/icon.png assets/icon.ico
```

---

## Step 3 — Install Node dependencies

```bash
cd electron/
npm install
```

This installs `electron` and `electron-builder` locally.

---

## Step 4 — Build

### Windows installer (NSIS .exe) + portable .exe
```bash
npm run build-win
```

Output in `dist/`:
- `CryLo Wallet Setup 1.0.0.exe`  — installer
- `CryLo Wallet 1.0.0.exe`         — portable (no install needed)

### Linux AppImage + .deb
```bash
npm run build-linux
```

### Both at once
```bash
npm run build-all
```

---

## Step 5 — Test (dev mode, Linux only)

Without packaging, you can run the app directly on Linux:

```bash
# Make sure the Linux binaries exist and are executable
npm start
```

The app will launch, start the daemon and wallet-rpc from `bin/linux/`,
and display the wallet UI.

---

## Architecture notes

```
electron/
├── main.js              ← Electron main process
│                           - Spawns crylod (port 19641)
│                           - Spawns crylo-wallet-rpc (port 19740)
│                           - Manages IPC between UI and daemons
├── preload.js           ← Secure bridge (contextIsolation=true)
├── src/
│   ├── index.html       ← App shell
│   ├── app.js           ← UI logic (vanilla JS)
│   └── styles.css       ← Dark CryLo-themed stylesheet
├── bin/
│   ├── win/             ← Windows .exe binaries (bundled at build time)
│   └── linux/           ← Linux binaries (for dev/Linux release)
├── assets/
│   ├── icon.ico         ← Windows icon
│   └── icon.png         ← Linux icon
└── dist/                ← Build output (generated)
```

### Ports used
| Service | Port |
|---------|------|
| crylod RPC | 19641 |
| crylo-wallet-rpc | 19740 |

### Data directories (Windows)
- **Daemon blockchain**: `%APPDATA%\crylo-wallet\crylo\`
- **Wallet files**: `%APPDATA%\crylo-wallet\wallets\`
- **Logs**: `%APPDATA%\crylo-wallet\logs\`

### Vesting display
The vesting tab reconstructs per-tier unlock data from coinbase transfers:
- Each mined block = 4 vesting outputs (25% each) + 1 dev fund output
- Tier 1: unlock at `blockHeight + 288`   (~24h)
- Tier 2: unlock at `blockHeight + 8640`  (~30d)
- Tier 3: unlock at `blockHeight + 17280` (~60d)
- Tier 4: unlock at `blockHeight + 25920` (~90d)

---

## Troubleshooting

**`wine: command not found`**  
→ Install Wine: `sudo apt install -y wine64`

**`Error: ENOENT assets/icon.ico`**  
→ Add icon files to the `assets/` directory (see Step 2)

**`bin/win/crylod.exe not found`**  
→ Cross-compile the CryLo node for Windows first (see MinGW guide)

**App starts but daemon fails to launch**  
→ Check `%APPDATA%\crylo-wallet\logs\daemon.log` on Windows  
→ Or `~/.config/crylo-wallet/logs/daemon.log` on Linux

**Wallet-RPC fails to start**  
→ Check `logs/wallet-rpc.log`  
→ Make sure port 19740 is not already in use

---

## Cross-compiling the .exe binaries (MinGW)

From the `crylo-mainnet-main/` root:

```bash
# Install MinGW toolchain
sudo apt install -y g++-mingw-w64-x86-64 mingw-w64-tools

# Build dependencies
cd contrib/depends
make HOST=x86_64-w64-mingw32 -j$(nproc)
cd ../..

# Configure and build
mkdir build-win && cd build-win
cmake -DCMAKE_TOOLCHAIN_FILE=../cmake/64-bit-toolchain.cmake \
      -DCMAKE_BUILD_TYPE=Release \
      -DSTATIC=ON \
      -DBUILD_64=ON \
      -DCMAKE_SYSTEM_NAME=Windows \
      ..
make -j$(nproc) daemon simplewallet wallet_rpc_server

# Copy to electron/bin/win/
cp bin/crylod.exe          ../electron/bin/win/
cp bin/crylo-wallet-rpc.exe ../electron/bin/win/
```
