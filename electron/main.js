'use strict';

require('dotenv').config();

const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const http = require('http');
const os = require('os');
const { ethers } = require('ethers');

// ─── Constants ───────────────────────────────────────────────────────────────
const DAEMON_RPC_PORT   = 22641;
const WALLET_RPC_PORT   = 22643;
const WALLET_DIR_NAME   = 'wallets';
const LOG_DIR_NAME      = 'logs';
const DATA_DIR_NAME     = 'CryLo-testnet';

// Detect OS
const IS_WIN   = process.platform === 'win32';
const IS_MAC   = process.platform === 'darwin';
const IS_LINUX = process.platform === 'linux';

// ─── Paths ───────────────────────────────────────────────────────────────────
function getResourcesPath() {
  // In packaged app: process.resourcesPath
  // In dev mode: __dirname/..  (electron/ folder)
  return app.isPackaged ? process.resourcesPath : path.join(__dirname);
}

function getBinPath(name) {
  const platform = IS_WIN ? 'win' : IS_MAC ? 'mac' : 'linux';
  const ext      = IS_WIN ? '.exe' : '';
  return path.join(getResourcesPath(), 'bin', platform, name + ext);
}

function getUserDataPath() {
  return path.join(app.getPath('userData'));
}

function getWalletDir() {
  const p = path.join(getUserDataPath(), WALLET_DIR_NAME);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  return p;
}

function getDataDir() {
  const p = path.join(getUserDataPath(), DATA_DIR_NAME);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  return p;
}

function getLogDir() {
  const p = path.join(getUserDataPath(), LOG_DIR_NAME);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  return p;
}

// ─── State ───────────────────────────────────────────────────────────────────
let mainWindow  = null;
let daemonProc  = null;
let walletProc  = null;
let minerProc   = null;
let minerStats  = { hashrate: 0, sharesAccepted: 0, sharesRejected: 0, running: false };
let shuttingDown = false;

// ─── Logging ─────────────────────────────────────────────────────────────────
function makeLogger(name) {
  const logFile = path.join(getLogDir(), `${name}.log`);
  // Rotate: keep only last 2MB
  try {
    const st = fs.statSync(logFile);
    if (st.size > 2 * 1024 * 1024) fs.unlinkSync(logFile);
  } catch (_) {}
  const stream = fs.createWriteStream(logFile, { flags: 'a' });
  return {
    write: (data) => {
      const line = `[${new Date().toISOString()}] ${data}`;
      stream.write(line);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('log', { source: name, line: line.trim() });
      }
    }
  };
}

// ─── RPC helpers ─────────────────────────────────────────────────────────────
function rpcCall(port, method, params = {}, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: '0',
      method,
      params
    });
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/json_rpc',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) reject(new Error(parsed.error.message));
            else resolve(parsed.result);
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function daemonHttp(path, bodyObj = {}, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(bodyObj);

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: DAEMON_RPC_PORT,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      }
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error('timeout'));
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function daemonRpc(method, params = {}) {
  return rpcCall(DAEMON_RPC_PORT, method, params);
}

function walletRpc(method, params = {}, timeoutMs = 10000) {
  return rpcCall(WALLET_RPC_PORT, method, params, timeoutMs);
}

// Poll until port responds or timeout
function waitForRpc(port, maxMs = 120000) {
  // daemon uses get_info, wallet-rpc uses get_languages
  const method = (port === DAEMON_RPC_PORT) ? 'get_info' : 'get_languages';
  return new Promise((resolve, reject) => {
    const start    = Date.now();
    const interval = 1000;
    function attempt() {
      if (shuttingDown) return reject(new Error('shutting down'));
      rpcCall(port, method)
        .then(() => resolve())
        .catch(() => {
          if (Date.now() - start > maxMs) {
            reject(new Error(`RPC on port ${port} did not start within ${maxMs / 1000}s`));
          } else {
            setTimeout(attempt, interval);
          }
        });
    }
    attempt();
  });
}

// ─── Process management ──────────────────────────────────────────────────────
function spawnDaemon() {
  const logger = makeLogger('daemon');

  logger.write(
    `Using existing CryLo daemon on 127.0.0.1:${DAEMON_RPC_PORT}\n`
  );

  return {
    exitCode: null,
    once: () => {},
    kill: () => {}
  };
}

function spawnWalletRpc() {
  const bin = getBinPath('CryLo-wallet-rpc');
  if (!fs.existsSync(bin)) {
    sendStatus('error', `Wallet-RPC binary not found: ${bin}`);
    return null;
  }
  const logger = makeLogger('wallet-rpc');
  const args = [
    '--testnet',
    `--rpc-bind-port=${WALLET_RPC_PORT}`,
    `--daemon-address=127.0.0.1:${DAEMON_RPC_PORT}`,
    `--wallet-dir=${getWalletDir()}`,
    '--disable-rpc-login',
    '--log-level=1'
  ];
  logger.write(`Spawning wallet-rpc: ${bin} ${args.join(' ')}\n`);
  const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', (d) => logger.write(d.toString()));
  proc.stderr.on('data', (d) => logger.write(d.toString()));
  proc.on('exit', (code) => {
    logger.write(`Wallet-RPC exited with code ${code}\n`);
    if (!shuttingDown && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('wallet-rpc-exit', code);
    }
  });
  return proc;
}

function killProc(proc, name) {
  return new Promise((resolve) => {
    if (!proc || proc.exitCode !== null) return resolve();
    proc.once('exit', resolve);
    proc.kill('SIGTERM');
    // Force kill after 5s
    setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch (_) {}
      resolve();
    }, 5000);
  });
}

function sendStatus(state, message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('startup-status', { state, message });
  }
}

// ─── Startup sequence ─────────────────────────────────────────────────────────
async function startBackend() {
  try {
    sendStatus('starting', 'Starting CryLo daemon...');
    daemonProc = spawnDaemon();
    if (!daemonProc) return;

    sendStatus('starting', 'Waiting for daemon RPC...');
    await waitForRpc(DAEMON_RPC_PORT, 180000);

    sendStatus('starting', 'Daemon ready. Starting wallet RPC...');
    walletProc = spawnWalletRpc();
    if (!walletProc) return;

    sendStatus('starting', 'Waiting for wallet RPC...');
    await waitForRpc(WALLET_RPC_PORT, 60000);

    sendStatus('ready', 'All services ready.');
  } catch (err) {
    sendStatus('error', `Startup failed: ${err.message}`);
  }
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────
// Daemon RPC
ipcMain.handle('daemon-rpc', async (_, method, params) => {
  try { return { ok: true,  result: await daemonRpc(method, params) }; }
  catch (e) { return { ok: false, error: e.message }; }
});

// Wallet RPC
ipcMain.handle('wallet-rpc', async (_, method, params, timeoutMs) => {
  try { return { ok: true,  result: await walletRpc(method, params, timeoutMs || 10000) }; }
  catch (e) { return { ok: false, error: e.message }; }
});

// List wallet files in wallet dir
ipcMain.handle('list-wallets', async () => {
  try {
    const dir   = getWalletDir();
    const files = fs.readdirSync(dir)
      .filter(f => !f.endsWith('.keys') && !f.endsWith('.address.txt') && !f.endsWith('.lock'))
      .map(f => path.basename(f));
    return { ok: true, wallets: files };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Open log directory
ipcMain.handle('open-log-dir', async () => {
  shell.openPath(getLogDir());
});

// Open wallet data directory
ipcMain.handle('open-data-dir', async () => {
  shell.openPath(getUserDataPath());
});

// Get app version
ipcMain.handle('get-version', async () => {
  return app.getVersion();
});

// Confirm dialog
ipcMain.handle('confirm-dialog', async (_, opts) => {
  const result = await dialog.showMessageBox(mainWindow, {
    type: opts.type || 'question',
    buttons: opts.buttons || ['OK', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    title: opts.title || '',
    message: opts.message || ''
  });
  return result.response === 0;
});


// ─── Miner ───────────────────────────────────────────────────────────────────

// Miner IPC — CryLo daemon mining
ipcMain.handle('miner-get-info', async () => {
  return {
    ok: true,
    cpuCount: os.cpus().length,
    totalMemMB: Math.floor(os.totalmem() / 1024 / 1024)
  };
});

ipcMain.handle('miner-start', async (_, opts) => {
  try {
    const result = await daemonHttp('/start_mining', {
      miner_address: opts.walletAddress,
      threads_count: opts.threads || 2,
      do_background_mining: false,
      ignore_battery: true
    });

    return { ok: true, result };
  } catch(e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('miner-stop', async () => {
  try {
    const result = await daemonHttp('/stop_mining', {});
    return { ok: true, result };
  } catch(e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('miner-get-status', async () => {
  try {
    const result = await daemonHttp('/mining_status', {});

    return {
      ok: true,
      running: !!result.active,
      hashrate: result.speed || 0,
      threads: result.threads_count || 0,
      blockReward: result.block_reward || 0
    };
  } catch(e) {
    return { ok: false, error: e.message };
  }
});

// ─── CryLo Nexus ──────────────────────────────────────────────────────────────
ipcMain.handle('nexus-scan-nfts', async (_, linkedAddress) => {
  try {
    const rpc =
      'http://127.0.0.1:9654/ext/bc/gGYTz63DfSqVhJNfa4QkD6Za7LteYrsdMGUoToGN1X6kiPmKs/rpc';

    const tokenAddress = '0xA2240adb73E11a368600efc0F68DF85daE843C83';
    const nftAddress = '0xA2BF9e819fD481a00AD1e559c2B4676e188BBFEe';
    const vaultAddress = '0x476052d25599356bd9A2d25CBE75fbe7Fdf15aC4';

    const tokenArtifact = require('./src/abis/WrappedCryLo.json');
    const nftArtifact = require('./src/abis/CryLoInteractiveNFT.json');
    const vaultArtifact = require('./src/abis/CryLoBuybackVault.json');

    const provider = new ethers.JsonRpcProvider(rpc);

    const token = new ethers.Contract(tokenAddress, tokenArtifact.abi, provider);
    const nft = new ethers.Contract(nftAddress, nftArtifact.abi, provider);
    const vault = new ethers.Contract(vaultAddress, vaultArtifact.abi, provider);

    const normalizedLinked = String(linkedAddress || '').toLowerCase();

    if (!ethers.isAddress(normalizedLinked)) {
      return { ok: false, error: 'Invalid linked Nexus address' };
    }

    const nextTokenId = Number(await nft.nextTokenId());
    const vaultBalance = await token.balanceOf(vaultAddress);

    const owned = [];

    for (let tokenId = 0; tokenId < nextTokenId; tokenId++) {
      try {
        const owner = await nft.ownerOf(tokenId);

        if (owner.toLowerCase() !== normalizedLinked) {
          continue;
        }

        const code = await nft.getMintCode(tokenId);
        const codeHash = ethers.keccak256(ethers.toUtf8Bytes(code));
        const poolData = await vault.codePools(codeHash);

        const approved = poolData[0];
        const poolBalance = poolData[1];
        const redeemedCount = poolData[2];

        owned.push({
          tokenId,
          owner,
          code,
          eligible: !!approved,
          codePool: ethers.formatEther(poolBalance),
          redeemed: redeemedCount.toString()
        });
      } catch (_) {
        // burned/nonexistent token or unreadable token; skip
      }
    }

    return {
      ok: true,
      linkedAddress,
      nextTokenId,
      vaultBalance: ethers.formatEther(vaultBalance),
      nfts: owned
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('nexus-buyback-nft', async (_, tokenId) => {
  try {
    const rpc =
      'http://127.0.0.1:9654/ext/bc/gGYTz63DfSqVhJNfa4QkD6Za7LteYrsdMGUoToGN1X6kiPmKs/rpc';

    const nftAddress = '0xA2BF9e819fD481a00AD1e559c2B4676e188BBFEe';
    const vaultAddress = '0x476052d25599356bd9A2d25CBE75fbe7Fdf15aC4';

    const nftArtifact = require('./src/abis/CryLoInteractiveNFT.json');
    const vaultArtifact = require('./src/abis/CryLoBuybackVault.json');

    const provider = new ethers.JsonRpcProvider(rpc);
    const wallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);

    const nft = new ethers.Contract(nftAddress, nftArtifact.abi, wallet);
    const vault = new ethers.Contract(vaultAddress, vaultArtifact.abi, wallet);

    const id = Number(tokenId);

    const owner = await nft.ownerOf(id);
    if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
      return { ok: false, error: 'Linked wallet does not own this NFT.' };
    }

    let nonce = await provider.getTransactionCount(wallet.address, 'pending');

    let tx = await nft.approve(vaultAddress, id, { nonce });
    await tx.wait();
    nonce++;

    tx = await vault.buyBack(id, { nonce });
    const receipt = await tx.wait();

    const newOwner = await nft.ownerOf(id);

    if (newOwner.toLowerCase() !== vaultAddress.toLowerCase()) {
      return {
        ok: false,
        error: `Buyback transaction completed, but NFT #${id} is still owned by ${newOwner}`,
        txHash: tx.hash
      };
    }

    return {
      ok: true,
      tokenId: id,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      newOwner
    };
  } catch (e) {
    return {
      ok: false,
      error: e.shortMessage || e.reason || e.message
    };
  }
});

// ─── Window ───────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 850,
    minWidth: 900,
    minHeight: 700,
    backgroundColor: '#0d0d1a',
    title: 'CryLo Wallet',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    // No native frame for custom titlebar feel
    frame: true,
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    startBackend();
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}


// ─── macOS Edit menu (enables Cmd+C/V/X/A in text fields) ────────────────────
if (process.platform === 'darwin') {
  const template = [
    {
      label: 'CryLo Wallet',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(createWindow);

app.on('window-all-closed', async () => {
  shuttingDown = true;
  // Gracefully stop wallet-rpc first, then daemon
  await killProc(minerProc,  'miner');
  await killProc(walletProc, 'wallet-rpc');
  await killProc(daemonProc, 'daemon');
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Open external URLs in system browser, prevent in-app navigation
app.on('web-contents-created', (_, contents) => {
  contents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
});
