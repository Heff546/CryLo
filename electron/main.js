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

// CryLo and wCryLo use 11 decimal places. Nexus native CRYLO uses 18.
const CRYLO_DECIMALS = 11;
const wCryLo_DECIMALS = 11;
const NEXUS_GAS_DECIMALS = 18;

function parseWcryloUnits(amountText) {
  return ethers.parseUnits(String(amountText), wCryLo_DECIMALS);
}

function formatWcryloUnits(amount) {
  return ethers.formatUnits(amount, wCryLo_DECIMALS);
}

function formatNexusGasUnits(amount) {
  return ethers.formatUnits(amount, NEXUS_GAS_DECIMALS);
}

const BRIDGE_API_URL =
  process.env.CRYLONEXUS_API_URL ||
  'http://34.118.135.234/crylonexus-api';

const NEXUS_RUNTIME_CACHE_MS = 60_000;

let nexusRuntimeCache = null;
let nexusRuntimeLoadedAt = 0;

const REQUIRED_NEXUS_CONTRACTS = [
  'wCryLo',
  'BridgeManager',
  'BridgeLedger',
  'BridgeReserveVault',
  'WalletRegistry',
  'GasManager',
  'GasTreasuryVault',
  'RewardManager',
  'RewardVault',
  'Staking',
  'NodeStaking',
  'RevenueRouter',
  'RevenuePolicy'
];

const OPTIONAL_NEXUS_CONTRACTS = [
  'CryLoInteractiveNFT',
  'CryLoBuybackVault',
  'NFTRevenueSplitter'
];

async function getNexusRuntimeConfig(forceRefresh = false) {
  const now = Date.now();

  if (
    !forceRefresh &&
    nexusRuntimeCache &&
    now - nexusRuntimeLoadedAt < NEXUS_RUNTIME_CACHE_MS
  ) {
    return nexusRuntimeCache;
  }

  const response = await fetch(
    `${BRIDGE_API_URL}/nexus/bridge-config`,
    {
      headers: {
        Accept: 'application/json'
      }
    }
  );

  const raw = await response.text();

  let data;
  try {
    data = JSON.parse(raw);
  } catch (_) {
    throw new Error(
      `CryLoNexus Foundation returned invalid JSON: ${raw.slice(0, 200)}`
    );
  }

  if (!response.ok || !data?.ok) {
    throw new Error(
      data?.error ||
      `CryLoNexus Foundation configuration failed with HTTP ${response.status}`
    );
  }

  const rpc = String(data.rpc || '').trim();
  const chainId = Number(data.chainId);
  const sourceContracts = data.contracts || {};

  if (!/^https?:\/\//i.test(rpc)) {
    throw new Error('CryLoNexus Foundation returned an invalid RPC URL.');
  }

  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error('CryLoNexus Foundation returned an invalid chain ID.');
  }

  const contracts = {};

  for (const name of REQUIRED_NEXUS_CONTRACTS) {
    const address = sourceContracts[name];

    if (!ethers.isAddress(address)) {
      throw new Error(
        `CryLoNexus Foundation returned an invalid ${name} address.`
      );
    }

    const normalized = ethers.getAddress(address);

    if (normalized === ethers.ZeroAddress) {
      throw new Error(
        `CryLoNexus Foundation returned a zero ${name} address.`
      );
    }

    contracts[name] = normalized;
  }

  /*
   * NFT and buyback contracts are optional until those features are
   * deployed on the active CryLoNexus network. A missing optional
   * contract must not block balances, staking, gas, bridge, or nodes.
   */
  for (const name of OPTIONAL_NEXUS_CONTRACTS) {
    const address = sourceContracts[name];

    if (!address) {
      continue;
    }

    if (!ethers.isAddress(address)) {
      console.warn(
        `Ignoring invalid optional Nexus contract ${name}:`,
        address
      );
      continue;
    }

    const normalized = ethers.getAddress(address);

    if (normalized === ethers.ZeroAddress) {
      console.warn(
        `Ignoring zero optional Nexus contract ${name}.`
      );
      continue;
    }

    contracts[name] = normalized;
  }

  const provider = new ethers.JsonRpcProvider(rpc);
  const network = await provider.getNetwork();

  if (Number(network.chainId) !== chainId) {
    throw new Error(
      `CryLoNexus chain mismatch: Foundation reports ${chainId}, RPC reports ${network.chainId}.`
    );
  }

  const runtime = Object.freeze({
    platform: data.platform,
    configVersion: data.configVersion,
    environment: data.environment,
    networkName: data.networkName,
    version: data.version,
    chainId,
    chainIdHex: data.chainIdHex,
    blockchainId: data.blockchainId,
    rpc,
    nativeToken: Object.freeze({ ...(data.nativeToken || {}) }),
    features: Object.freeze({ ...(data.features || {}) }),
    contracts: Object.freeze(contracts),
    provider,
    generatedAt: data.generatedAt
  });

  nexusRuntimeCache = runtime;
  nexusRuntimeLoadedAt = now;

  return runtime;
}

function clearNexusRuntimeConfig() {
  nexusRuntimeCache = null;
  nexusRuntimeLoadedAt = 0;
}

ipcMain.handle('nexus-runtime-status', async () => {
  try {
    const runtime = await getNexusRuntimeConfig(true);
    const latestBlock = await runtime.provider.getBlockNumber();

    return {
      ok: true,
      platform: runtime.platform,
      environment: runtime.environment,
      networkName: runtime.networkName,
      version: runtime.version,
      chainId: runtime.chainId,
      chainIdHex: runtime.chainIdHex,
      blockchainId: runtime.blockchainId,
      rpc: runtime.rpc,
      latestBlock,
      contractCount: Object.keys(runtime.contracts).length,
      contracts: runtime.contracts,
      features: runtime.features,
      generatedAt: runtime.generatedAt
    };
  } catch (e) {
    clearNexusRuntimeConfig();

    return {
      ok: false,
      error: e.shortMessage || e.reason || e.message
    };
  }
});

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
    const dir = getWalletDir();
    const files = fs.readdirSync(dir);

    const wallets = files
      .filter(f => {
        const fullPath = path.join(dir, f);
        const keysPath = path.join(dir, `${f}.keys`);

        return (
          fs.existsSync(keysPath) &&
          fs.statSync(fullPath).isFile() &&
          !f.endsWith('.keys') &&
          !f.endsWith('.address.txt') &&
          !f.endsWith('.lock')
        );
      })
      .sort();

    return { ok: true, wallets };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Create/load Nexus wallet bound to opened CryLo wallet address
function safeNexusFileName(cryloAddress) {
  return String(cryloAddress || '').replace(/[^a-zA-Z0-9]/g, '_');
}


async function performBoundNexusWalletRegistration(wallet) {
  if (!wallet || !wallet.address || !wallet.privateKey) {
    throw new Error(
      'A bound Nexus wallet is required for onboarding'
    );
  }

  const challengeResponse = await fetch(
    `${BRIDGE_API_URL}/nexus/onboarding-challenge`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        nexusAddress: wallet.address
      })
    }
  );

  const challenge = await challengeResponse.json();

  if (!challengeResponse.ok || !challenge.ok) {
    throw new Error(
      challenge.error ||
      'Failed to request Nexus onboarding challenge'
    );
  }

  const signature =
    await wallet.signMessage(challenge.message);

  const registerResponse = await fetch(
    `${BRIDGE_API_URL}/nexus/register-bound-wallet`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        nexusAddress: wallet.address,
        signature
      })
    }
  );

  const registration = await registerResponse.json();

  if (!registerResponse.ok || !registration.ok) {
    throw new Error(
      registration.error ||
      'Failed to register Nexus wallet'
    );
  }

  return registration;
}

/*
 * Only one Foundation onboarding request may run at a time for a
 * particular bound Nexus wallet.
 *
 * This prevents two Electron lifecycle paths from requesting separate
 * challenges for the same address and invalidating one another.
 */
const nexusOnboardingRequests = new Map();

async function registerBoundNexusWallet(wallet) {
  if (!wallet || !wallet.address) {
    return performBoundNexusWalletRegistration(wallet);
  }

  const addressKey =
    ethers.getAddress(wallet.address).toLowerCase();

  const existingRequest =
    nexusOnboardingRequests.get(addressKey);

  if (existingRequest) {
    return existingRequest;
  }

  const request =
    performBoundNexusWalletRegistration(wallet)
      .finally(() => {
        if (
          nexusOnboardingRequests.get(addressKey) === request
        ) {
          nexusOnboardingRequests.delete(addressKey);
        }
      });

  nexusOnboardingRequests.set(addressKey, request);

  return request;
}


ipcMain.handle('nexus-wallet-create', async (_, walletName, cryloAddress) => {
  try {
    if (!walletName || !cryloAddress) {
      throw new Error('Open a CryLo wallet before creating a Nexus wallet');
    }

    const file = path.join(getWalletDir(), `${safeNexusFileName(walletName)}.nexus.json`);

    if (fs.existsSync(file)) {
      const existing = JSON.parse(fs.readFileSync(file, 'utf8'));
      let registration = null;

      if (
        existing.nexusAddress &&
        existing.privateKey
      ) {
        const existingWallet =
          new ethers.Wallet(existing.privateKey);

        if (
          ethers.getAddress(existingWallet.address) !==
          ethers.getAddress(existing.nexusAddress)
        ) {
          throw new Error(
            'Stored Nexus private key does not match the bound address'
          );
        }

        registration =
          await registerBoundNexusWallet(existingWallet);
      }

      return {
        ok: true,
        alreadyExists: true,
        nexusAddress: existing.nexusAddress || '',
        gasRegistered: !!registration?.ok
      };
    }

    const wallet = ethers.Wallet.createRandom();

    fs.writeFileSync(file, JSON.stringify({
      walletName,
      cryloAddress,
      nexusAddress: wallet.address,
      privateKey: wallet.privateKey,
      createdAt: new Date().toISOString()
    }, null, 2), { mode: 0o600 });

    /*
     * Return the newly created address immediately.
     *
     * Registration and starter gas continue using the exact
     * same saved wallet and binding. No second Nexus wallet is
     * created and the CryLo-to-Nexus binding remains one-to-one.
     */
    registerBoundNexusWallet(wallet)
      .then(registration => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(
            'nexus-wallet-onboarding-result',
            {
              ok: true,
              nexusAddress: wallet.address,
              registration
            }
          );
        }
      })
      .catch(error => {
        console.error(
          'Nexus wallet onboarding failed:',
          error
        );

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(
            'nexus-wallet-onboarding-result',
            {
              ok: false,
              nexusAddress: wallet.address,
              error:
                error?.shortMessage ||
                error?.reason ||
                error?.message ||
                String(error)
            }
          );
        }
      });

    return {
      ok: true,
      alreadyExists: false,
      nexusAddress: wallet.address,
      onboardingPending: true,
      gasRegistered: false
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('nexus-wallet-load', async (_, walletName, cryloAddress) => {
  try {
    if (!walletName || !cryloAddress) {
      return { ok: true, nexusAddress: '' };
    }

    const file = path.join(getWalletDir(), `${safeNexusFileName(walletName)}.nexus.json`);

    if (!fs.existsSync(file)) {
      return { ok: true, nexusAddress: '' };
    }

    const data = JSON.parse(fs.readFileSync(file, 'utf8'));

    if (data.cryloAddress !== cryloAddress) {
      return { ok: true, nexusAddress: '' };
    }

    if (!data.nexusAddress || !data.privateKey) {
      throw new Error(
        'Bound Nexus wallet file is incomplete'
      );
    }

    const existingWallet =
      new ethers.Wallet(data.privateKey);

    if (
      ethers.getAddress(existingWallet.address) !==
      ethers.getAddress(data.nexusAddress)
    ) {
      throw new Error(
        'Stored Nexus private key does not match the bound address'
      );
    }

    /*
     * Reconcile the permanent Nexus binding in the background.
     *
     * This does not create or replace a Nexus wallet. The
     * Foundation onboarding route is idempotent and completes
     * any missing registration, activity, or starter-gas state
     * for the exact wallet already bound to this CryLo wallet.
     */
    registerBoundNexusWallet(existingWallet)
      .then(registration => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(
            'nexus-wallet-onboarding-result',
            {
              ok: true,
              nexusAddress: existingWallet.address,
              registration
            }
          );
        }
      })
      .catch(error => {
        console.error(
          'Nexus wallet reconciliation failed:',
          error
        );

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(
            'nexus-wallet-onboarding-result',
            {
              ok: false,
              nexusAddress: existingWallet.address,
              error:
                error?.shortMessage ||
                error?.reason ||
                error?.message ||
                String(error)
            }
          );
        }
      });

    return {
      ok: true,
      nexusAddress: data.nexusAddress,
      onboardingPending: true
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

function loadBoundNexusWallet(walletName, cryloAddress) {
  if (!walletName || !cryloAddress) {
    throw new Error('Open a CryLo wallet first');
  }

  const file = path.join(
    getWalletDir(),
    `${safeNexusFileName(walletName)}.nexus.json`
  );

  if (!fs.existsSync(file)) {
    throw new Error('Create a Nexus wallet for this CryLo wallet first');
  }

  const data = JSON.parse(fs.readFileSync(file, 'utf8'));

  if (data.cryloAddress !== cryloAddress) {
    throw new Error('Invalid Nexus wallet binding');
  }

  if (!data.privateKey) {
    throw new Error('Missing Nexus private key');
  }

  return new ethers.Wallet(data.privateKey);
}


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

async function stopDaemonMining() {
  try {
    await daemonHttp('/stop_mining', {});
    console.log('CryLo daemon mining stopped.');
  } catch (error) {
    /*
     * Safe to ignore when mining is already stopped or the
     * daemon is unavailable during shutdown.
     */
    console.log(
      'Daemon mining stop completed with no active miner:',
      error?.message || String(error)
    );
  }
}

let backendShutdownPromise = null;

async function shutdownBackendsSafely() {
  if (backendShutdownPromise) {
    return backendShutdownPromise;
  }

  backendShutdownPromise = (async () => {
    shuttingDown = true;

    // Required shutdown order:
    // 1. Stop daemon mining.
    // 2. Stop wallet-rpc.
    // 3. Stop an optional miner process.
    // 4. Stop the daemon.
    await stopDaemonMining();
    await killProc(walletProc, 'wallet-rpc');
    await killProc(minerProc, 'miner');
    await killProc(daemonProc, 'daemon');
  })();

  return backendShutdownPromise;
}


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
    await stopDaemonMining();
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e.message
    };
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
    const normalizedLinked = String(linkedAddress || '').toLowerCase();

    if (!ethers.isAddress(normalizedLinked)) {
      return { ok: false, error: 'Invalid linked Nexus address' };
    }

    const runtime = await getNexusRuntimeConfig();

    const tokenArtifact = require('./src/abis/WrappedCryLo.json');
    const nftArtifact = require('./src/abis/CryLoInteractiveNFT.json');
    const vaultArtifact = require('./src/abis/CryLoBuybackVault.json');

    const token = new ethers.Contract(
      runtime.contracts.wCryLo,
      tokenArtifact.abi,
      runtime.provider
    );

    const nft = new ethers.Contract(
      runtime.contracts.CryLoInteractiveNFT,
      nftArtifact.abi,
      runtime.provider
    );

    const vault = new ethers.Contract(
      runtime.contracts.CryLoBuybackVault,
      vaultArtifact.abi,
      runtime.provider
    );

    const nextTokenId = Number(await nft.nextTokenId());
    const vaultBalance = await token.balanceOf(
      runtime.contracts.CryLoBuybackVault
    );

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

        owned.push({
          tokenId,
          owner,
          code,
          eligible: !!poolData[0],
          codePool: formatWcryloUnits(poolData[1]),
          redeemed: poolData[2].toString()
        });
      } catch (_) {
        // Burned, nonexistent, or unreadable token; skip it.
      }
    }

    return {
      ok: true,
      linkedAddress,
      nextTokenId,
      vaultBalance: formatWcryloUnits(vaultBalance),
      nfts: owned
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('nexus-buyback-nft', async (_, tokenId, walletName, cryloAddress) => {
  try {
    const runtime = await getNexusRuntimeConfig();
    const provider = runtime.provider;

    const wallet = loadBoundNexusWallet(
      walletName,
      cryloAddress
    ).connect(provider);

    const nftArtifact = require('./src/abis/CryLoInteractiveNFT.json');
    const vaultArtifact = require('./src/abis/CryLoBuybackVault.json');

    const nft = new ethers.Contract(
      runtime.contracts.CryLoInteractiveNFT,
      nftArtifact.abi,
      wallet
    );

    const vault = new ethers.Contract(
      runtime.contracts.CryLoBuybackVault,
      vaultArtifact.abi,
      wallet
    );

    const id = Number(tokenId);
    const owner = await nft.ownerOf(id);

    if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
      return { ok: false, error: 'Linked wallet does not own this NFT.' };
    }

    let nonce = await provider.getTransactionCount(wallet.address, 'pending');

    let tx = await nft.approve(
      runtime.contracts.CryLoBuybackVault,
      id,
      { nonce }
    );
    await tx.wait();
    nonce++;

    tx = await vault.buyBack(id, { nonce });
    const receipt = await tx.wait();

    const newOwner = await nft.ownerOf(id);

    if (
      newOwner.toLowerCase() !==
      runtime.contracts.CryLoBuybackVault.toLowerCase()
    ) {
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

ipcMain.handle('nexus-burn-nft', async (_, tokenId, walletName, cryloAddress) => {
  try {
    const runtime = await getNexusRuntimeConfig();
    const provider = runtime.provider;

    const wallet = loadBoundNexusWallet(
      walletName,
      cryloAddress
    ).connect(provider);

    const nftArtifact = require('./src/abis/CryLoInteractiveNFT.json');

    const nft = new ethers.Contract(
      runtime.contracts.CryLoInteractiveNFT,
      nftArtifact.abi,
      wallet
    );

    const id = Number(tokenId);
    const owner = await nft.ownerOf(id);

    if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
      return { ok: false, error: 'Linked wallet does not own this NFT.' };
    }

    const nonce = await provider.getTransactionCount(wallet.address, 'pending');
    const tx = await nft.burn(id, { nonce });
    const receipt = await tx.wait();

    try {
      await nft.ownerOf(id);

      return {
        ok: false,
        error: `Burn transaction completed, but NFT #${id} still exists.`,
        txHash: tx.hash
      };
    } catch (_) {
      return {
        ok: true,
        tokenId: id,
        txHash: tx.hash,
        blockNumber: receipt.blockNumber
      };
    }
  } catch (e) {
    return {
      ok: false,
      error: e.shortMessage || e.reason || e.message
    };
  }
});


ipcMain.handle('nexus-burn-for-crylo', async (_, amountText, walletName, cryloAddress) => {
  try {
    const runtime = await getNexusRuntimeConfig();
    const provider = runtime.provider;

    const wallet = loadBoundNexusWallet(
      walletName,
      cryloAddress
    ).connect(provider);

    const bridgeArtifact = require('./src/abis/BridgeManager.json');

    const bridge = new ethers.Contract(
      runtime.contracts.BridgeManager,
      bridgeArtifact.abi,
      wallet
    );

    const amount = parseWcryloUnits(amountText);
    const nonce = await provider.getTransactionCount(wallet.address, 'pending');

    const burnId = ethers.keccak256(
      ethers.solidityPacked(
        ['address', 'string', 'uint256', 'uint256'],
        [
          wallet.address,
          cryloAddress,
          amount,
          BigInt(Date.now())
        ]
      )
    );

    const tx = await bridge.burnForCryLo(
      burnId,
      cryloAddress,
      amount,
      { nonce }
    );

    const receipt = await tx.wait();

    return {
      ok: true,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      burnId
    };
  } catch (e) {
    return {
      ok: false,
      error: e.shortMessage || e.reason || e.message
    };
  }
});


ipcMain.handle('bridge-request', async (_, payload) => {
  try {
    const res = await fetch(`${BRIDGE_API_URL}/bridge/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (_) { data = { error: text }; }

    if (!res.ok) {
      return { ok: false, error: data.error || text || `HTTP ${res.status}` };
    }

    return { ok: true, ...data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('bridge-status', async (_, paymentId) => {
  try {
    const res = await fetch(`${BRIDGE_API_URL}/bridge/status/${encodeURIComponent(paymentId)}`);

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (_) { data = { error: text }; }

    if (!res.ok) {
      return { ok: false, error: data.error || text || `HTTP ${res.status}` };
    }

    return { ok: true, ...data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});


ipcMain.handle('bridge-release-status', async (_, nexusTxHash) => {
  try {
    const res = await fetch(`${BRIDGE_API_URL}/bridge/release-status/${encodeURIComponent(nexusTxHash)}`);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (_) { data = { error: text }; }

    if (!res.ok) {
      return { ok: false, error: data.error || text || `HTTP ${res.status}` };
    }

    return { ok: true, ...data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});


ipcMain.handle('nexus-wcrylo-balance', async (_, linkedAddress) => {
  try {
    if (!ethers.isAddress(linkedAddress)) {
      return { ok: false, error: 'Invalid Nexus address' };
    }

    const runtime = await getNexusRuntimeConfig();
    const tokenArtifact = require('./src/abis/WrappedCryLo.json');

    const token = new ethers.Contract(
      runtime.contracts.wCryLo,
      tokenArtifact.abi,
      runtime.provider
    );

    const balance = await token.balanceOf(linkedAddress);

    return {
      ok: true,
      balance: formatWcryloUnits(balance)
    };
  } catch (e) {
    console.error('[nexus-wcrylo-balance] failed', {
      message: e?.message,
      shortMessage: e?.shortMessage,
      reason: e?.reason,
      code: e?.code
    });

    return {
      ok: false,
      error: e?.shortMessage || e?.reason || e?.message || String(e)
    };
  }
});

ipcMain.handle('nexus-staked-balance', async (_, linkedAddress) => {
  try {
    if (!ethers.isAddress(linkedAddress)) {
      return { ok: false, error: 'Invalid Nexus address' };
    }

    const runtime = await getNexusRuntimeConfig();
    const stakingArtifact = require('./src/abis/CryLoStaking.json');

    const staking = new ethers.Contract(
      runtime.contracts.Staking,
      stakingArtifact.abi,
      runtime.provider
    );

    const balance = await staking.stakedBalance(linkedAddress);

    return {
      ok: true,
      balance: formatWcryloUnits(balance)
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('nexus-pending-rewards', async (_, linkedAddress) => {
  try {
    if (!ethers.isAddress(linkedAddress)) {
      return { ok: false, error: 'Invalid Nexus address' };
    }

    const runtime = await getNexusRuntimeConfig();
    const stakingArtifact = require('./src/abis/CryLoStaking.json');

    const staking = new ethers.Contract(
      runtime.contracts.Staking,
      stakingArtifact.abi,
      runtime.provider
    );

    const rewards = await staking.pendingRewards(linkedAddress);

    return {
      ok: true,
      rewards: formatWcryloUnits(rewards)
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('nexus-claim-rewards', async (_, walletName, cryloAddress) => {
  try {
    const runtime = await getNexusRuntimeConfig();
    const wallet = loadBoundNexusWallet(
      walletName,
      cryloAddress
    ).connect(runtime.provider);

    const stakingArtifact = require('./src/abis/CryLoStaking.json');

    const staking = new ethers.Contract(
      runtime.contracts.Staking,
      stakingArtifact.abi,
      wallet
    );

    const tx = await staking.claimRewards();
    const receipt = await tx.wait();

    return {
      ok: true,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber
    };
  } catch (e) {
    return {
      ok: false,
      error: e.shortMessage || e.reason || e.message
    };
  }
});

ipcMain.handle('nexus-stake-wcrylo', async (_, amountText, walletName, cryloAddress) => {
  try {
    const runtime = await getNexusRuntimeConfig();
    const provider = runtime.provider;

    const wallet = loadBoundNexusWallet(
      walletName,
      cryloAddress
    ).connect(provider);

    const tokenArtifact = require('./src/abis/WrappedCryLo.json');
    const stakingArtifact = require('./src/abis/CryLoStaking.json');

    const token = new ethers.Contract(
      runtime.contracts.wCryLo,
      tokenArtifact.abi,
      wallet
    );

    const staking = new ethers.Contract(
      runtime.contracts.Staking,
      stakingArtifact.abi,
      wallet
    );

    const amount = parseWcryloUnits(amountText);
    let nonce = await provider.getTransactionCount(wallet.address, 'pending');

    let tx = await token.approve(
      runtime.contracts.Staking,
      amount,
      { nonce }
    );
    await tx.wait();
    nonce++;

    tx = await staking.stake(amount, { nonce });
    const receipt = await tx.wait();

    return {
      ok: true,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber
    };
  } catch (e) {
    return {
      ok: false,
      error: e.shortMessage || e.reason || e.message
    };
  }
});

ipcMain.handle('nexus-unstake-wcrylo', async (_, amountText, walletName, cryloAddress) => {
  try {
    const runtime = await getNexusRuntimeConfig();
    const provider = runtime.provider;

    const wallet = loadBoundNexusWallet(
      walletName,
      cryloAddress
    ).connect(provider);

    const stakingArtifact = require('./src/abis/CryLoStaking.json');

    const staking = new ethers.Contract(
      runtime.contracts.Staking,
      stakingArtifact.abi,
      wallet
    );

    const amount = parseWcryloUnits(amountText);
    const nonce = await provider.getTransactionCount(wallet.address, 'pending');

    const tx = await staking.unstake(amount, { nonce });
    const receipt = await tx.wait();

    return {
      ok: true,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber
    };
  } catch (e) {
    return {
      ok: false,
      error: e.shortMessage || e.reason || e.message
    };
  }
});

ipcMain.handle('nexus-node-status', async (_, linkedAddress) => {
  try {
    if (!ethers.isAddress(linkedAddress)) {
      return { ok: false, error: 'Invalid Nexus address' };
    }

    const runtime = await getNexusRuntimeConfig();
    const provider = runtime.provider;

    const nodeArtifact =
      require('./src/abis/CryLoNodeStaking.json');

    const rewardVaultArtifact =
      require('./src/abis/RewardVault.json');

    const node = new ethers.Contract(
      runtime.contracts.NodeStaking,
      nodeArtifact.abi,
      provider
    );

    const rewardVault = new ethers.Contract(
      runtime.contracts.RewardVault,
      rewardVaultArtifact.abi,
      provider
    );

    const [
      registered,
      tier,
      stake,
      pending,
      operatorStake,
      validatorStake
    ] = await Promise.all([
      node.isNodeWallet(linkedAddress),
      node.nodeTier(linkedAddress),
      node.nodeStake(linkedAddress),
      rewardVault.pendingRewards(linkedAddress),
      node.operatorStakeRequirement(),
      node.validatorStakeRequirement()
    ]);

    return {
      ok: true,
      registered: !!registered,
      tier: tier.toString(),
      stake: formatWcryloUnits(stake),
      pending: formatWcryloUnits(pending),
      operatorStake: formatWcryloUnits(operatorStake),
      validatorStake: formatWcryloUnits(validatorStake)
    };
  } catch (e) {
    return {
      ok: false,
      error: e.shortMessage || e.reason || e.message
    };
  }
});


function saveOperatorConfig({
  operatorAddress,
  tier,
  rpcUrl,
  chainId,
  wrappedCryLoContract,
  nodeStakingContract,
  rewardManagerContract
}) {
  const dir = path.join(
    os.homedir(),
    '.config',
    'crylo-wallet',
    'operator'
  );

  fs.mkdirSync(dir, {
    recursive: true,
    mode: 0o700
  });

  const file = path.join(dir, 'operator.json');

  const requireEvmAddress = (value, fieldName) => {
    if (
      typeof value !== 'string' ||
      !/^0x[0-9a-fA-F]{40}$/.test(value)
    ) {
      throw new Error(
        `Invalid operator configuration ${fieldName}`
      );
    }

    return value;
  };

  if (!['Operator', 'Validator'].includes(tier)) {
    throw new Error(
      `Invalid operator tier: ${tier}`
    );
  }

  if (Number(chainId) !== 5546) {
    throw new Error(
      `Invalid CryLoNexus chain ID: ${chainId}`
    );
  }

  const normalizedOperatorAddress =
    requireEvmAddress(
      operatorAddress,
      'operatorAddress'
    );

  const config = {
    schemaVersion: 1,
    protocolVersion: 1,
    network: 'CryLoNexus Mainnet',
    chainId: 5546,
    operatorAddress: normalizedOperatorAddress,
    tier,
    rpcUrl,
    contracts: {
      wrappedCryLo: requireEvmAddress(
        wrappedCryLoContract,
        'contracts.wrappedCryLo'
      ),
      nodeStaking: requireEvmAddress(
        nodeStakingContract,
        'contracts.nodeStaking'
      ),
      rewardManager: requireEvmAddress(
        rewardManagerContract,
        'contracts.rewardManager'
      )
    },
    service: {
      serviceName:
        'crylo-nexus-operator.service',
      statusPath:
        '/var/lib/crylonexus-operator/status.json',
      dataDirectory:
        '/var/lib/crylonexus-operator',
      logDirectory:
        '/var/log/crylonexus-operator'
    },
    nodeIdentity: {
      publicId:
        `operator-${normalizedOperatorAddress
          .slice(2)
          .toLowerCase()}`,
      pairingRequired: true
    },
    generatedAt: new Date().toISOString(),
    expiresAt: null
  };

  const temporaryFile =
    `${file}.${process.pid}.${Date.now()}.tmp`;

  fs.writeFileSync(
    temporaryFile,
    `${JSON.stringify(config, null, 2)}\n`,
    {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'w'
    }
  );

  fs.chmodSync(temporaryFile, 0o600);
  fs.renameSync(temporaryFile, file);
  fs.chmodSync(file, 0o600);

  return config;
}

ipcMain.handle('nexus-register-operator', async (_, walletName, cryloAddress) => {
  try {
    const runtime = await getNexusRuntimeConfig();
    const provider = runtime.provider;

    const wallet = loadBoundNexusWallet(
      walletName,
      cryloAddress
    ).connect(provider);

    const tokenArtifact =
      require('./src/abis/WrappedCryLo.json');

    const nodeArtifact =
      require('./src/abis/CryLoNodeStaking.json');

    const token = new ethers.Contract(
      runtime.contracts.wCryLo,
      tokenArtifact.abi,
      wallet
    );

    const node = new ethers.Contract(
      runtime.contracts.NodeStaking,
      nodeArtifact.abi,
      wallet
    );

    const amount = await node.operatorStakeRequirement();

    let nonce = await provider.getTransactionCount(
      wallet.address,
      'pending'
    );

    let tx = await token.approve(
      runtime.contracts.NodeStaking,
      amount,
      { nonce }
    );

    await tx.wait();
    nonce++;

    tx = await node.registerOperator({ nonce });
    const receipt = await tx.wait();

    const operatorConfig = saveOperatorConfig({
      operatorAddress: wallet.address,
      tier: 'Operator',
      rpcUrl: runtime.rpc,
      chainId: runtime.chainId,
      wrappedCryLoContract:
        runtime.contracts.wCryLo,
      nodeStakingContract:
        runtime.contracts.NodeStaking,
      rewardManagerContract:
        runtime.contracts.RewardManager
    });

    return {
      ok: true,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      operatorConfig
    };
  } catch (e) {
    return {
      ok: false,
      error: e.shortMessage || e.reason || e.message
    };
  }
});

ipcMain.handle('nexus-register-validator', async (_, walletName, cryloAddress) => {
  try {
    const runtime = await getNexusRuntimeConfig();
    const provider = runtime.provider;

    const wallet = loadBoundNexusWallet(
      walletName,
      cryloAddress
    ).connect(provider);

    const tokenArtifact =
      require('./src/abis/WrappedCryLo.json');

    const nodeArtifact =
      require('./src/abis/CryLoNodeStaking.json');

    const token = new ethers.Contract(
      runtime.contracts.wCryLo,
      tokenArtifact.abi,
      wallet
    );

    const node = new ethers.Contract(
      runtime.contracts.NodeStaking,
      nodeArtifact.abi,
      wallet
    );

    const amount = await node.validatorStakeRequirement();

    let nonce = await provider.getTransactionCount(
      wallet.address,
      'pending'
    );

    let tx = await token.approve(
      runtime.contracts.NodeStaking,
      amount,
      { nonce }
    );

    await tx.wait();
    nonce++;

    tx = await node.registerValidator({ nonce });
    const receipt = await tx.wait();

    const operatorConfig = saveOperatorConfig({
      operatorAddress: wallet.address,
      tier: 'Validator',
      rpcUrl: runtime.rpc,
      chainId: runtime.chainId,
      wrappedCryLoContract:
        runtime.contracts.wCryLo,
      nodeStakingContract:
        runtime.contracts.NodeStaking,
      rewardManagerContract:
        runtime.contracts.RewardManager
    });

    return {
      ok: true,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      operatorConfig
    };
  } catch (e) {
    return {
      ok: false,
      error: e.shortMessage || e.reason || e.message
    };
  }
});

ipcMain.handle('nexus-unregister-node', async (_, walletName, cryloAddress) => {
  try {
    const runtime = await getNexusRuntimeConfig();
    const provider = runtime.provider;

    const wallet = loadBoundNexusWallet(
      walletName,
      cryloAddress
    ).connect(provider);

    const nodeArtifact =
      require('./src/abis/CryLoNodeStaking.json');

    const node = new ethers.Contract(
      runtime.contracts.NodeStaking,
      nodeArtifact.abi,
      wallet
    );

    const nonce = await provider.getTransactionCount(
      wallet.address,
      'pending'
    );

    const tx = await node.unregisterNode({ nonce });
    const receipt = await tx.wait();

    return {
      ok: true,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber
    };
  } catch (e) {
    return {
      ok: false,
      error: e.shortMessage || e.reason || e.message
    };
  }
});

ipcMain.handle('nexus-claim-node-rewards', async (_, walletName, cryloAddress) => {
  try {
    const runtime = await getNexusRuntimeConfig();
    const provider = runtime.provider;

    const wallet = loadBoundNexusWallet(
      walletName,
      cryloAddress
    ).connect(provider);

    const rewardVaultArtifact =
      require('./src/abis/RewardVault.json');

    const rewardVault = new ethers.Contract(
      runtime.contracts.RewardVault,
      rewardVaultArtifact.abi,
      wallet
    );

    const pending =
      await rewardVault.pendingRewards(wallet.address);

    if (pending <= 0n) {
      return {
        ok: false,
        error:
          'No node rewards are currently available to claim.'
      };
    }

    const nonce = await provider.getTransactionCount(
      wallet.address,
      'pending'
    );

    const tx = await rewardVault.claim({ nonce });
    const receipt = await tx.wait();

    return {
      ok: true,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      claimed: formatWcryloUnits(pending)
    };
  } catch (e) {
    return {
      ok: false,
      error: e.shortMessage || e.reason || e.message
    };
  }
});




// ─── Nexus Operator Dashboard ─────────────────────────────────────────────────

function readJsonFileSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return { exists: false, data: null, error: null };
    }

    return {
      exists: true,
      data: JSON.parse(fs.readFileSync(filePath, 'utf8')),
      error: null
    };
  } catch (error) {
    return {
      exists: true,
      data: null,
      error: error.message
    };
  }
}

function getOperatorPaths() {
  const operatorDir = path.join(
    os.homedir(),
    '.config',
    'crylo-wallet',
    'operator'
  );

  return {
    directory: operatorDir,
    config: path.join(operatorDir, 'operator.json'),
    authorization: path.join(
      operatorDir,
      'authorization.json'
    ),
    signingKey: path.join(
      operatorDir,
      'signing-key'
    ),
    statusCandidates: [
      path.join(operatorDir, 'status.json'),
      path.join(operatorDir, 'operator-status.json'),
      path.join(operatorDir, 'runtime', 'status.json')
    ]
  };
}

function findOperatorStatusFile(statusCandidates) {
  for (const candidate of statusCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return statusCandidates[0];
}

function runLocalCommand(command, args, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let finished = false;

    let child;

    try {
      child = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (error) {
      resolve({
        ok: false,
        code: null,
        stdout: '',
        stderr: error.message
      });
      return;
    }

    const timeout = setTimeout(() => {
      if (finished) return;

      finished = true;
      child.kill('SIGTERM');

      resolve({
        ok: false,
        code: null,
        stdout,
        stderr: `Command timed out after ${timeoutMs}ms`
      });
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      if (finished) return;

      finished = true;
      clearTimeout(timeout);

      resolve({
        ok: false,
        code: null,
        stdout,
        stderr: error.message
      });
    });

    child.on('close', (code) => {
      if (finished) return;

      finished = true;
      clearTimeout(timeout);

      resolve({
        ok: code === 0,
        code,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      });
    });
  });
}


function getOperatorInstallPaths() {
  const os = require('node:os');
  const path = require('node:path');

  const operatorDirectory = path.join(
    os.homedir(),
    '.config',
    'crylo-wallet',
    'operator'
  );

  return {
    operatorDirectory,
    configPath: path.join(
      operatorDirectory,
      'operator.json'
    ),
    authorizationPath: path.join(
      operatorDirectory,
      'authorization.json'
    ),
    signingKeyPath: path.join(
      operatorDirectory,
      'signing-key'
    ),
    statusPath: path.join(
      operatorDirectory,
      'status.json'
    ),
    runtimesDirectory: path.join(
      operatorDirectory,
      'runtimes'
    ),
    currentRuntimePath: path.join(
      operatorDirectory,
      'runtime-current'
    ),
    userSystemdDirectory: path.join(
      os.homedir(),
      '.config',
      'systemd',
      'user'
    ),
    servicePath: path.join(
      os.homedir(),
      '.config',
      'systemd',
      'user',
      'crylo-nexus-operator.service'
    )
  };
}

async function pathExists(candidatePath) {
  const fs = require('node:fs');

  try {
    await fs.promises.access(candidatePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFileStrict(filePath) {
  const fs = require('node:fs');

  const text = await fs.promises.readFile(
    filePath,
    'utf8'
  );

  return JSON.parse(text);
}

async function inspectOperatorInstallationHealth() {
  const path = require('node:path');
  const paths = getOperatorInstallPaths();

  const runtimePackagePath = path.join(
    paths.currentRuntimePath,
    'package.json'
  );

  const runtimeEntryPath = path.join(
    paths.currentRuntimePath,
    'src',
    'main.js'
  );

  const [
    configured,
    runtimePresent,
    runtimePackagePresent,
    runtimeEntryPresent,
    serviceFilePresent
  ] = await Promise.all([
    pathExists(paths.configPath),
    pathExists(paths.currentRuntimePath),
    pathExists(runtimePackagePath),
    pathExists(runtimeEntryPath),
    pathExists(paths.servicePath)
  ]);

  const runtimeValid =
    runtimePresent &&
    runtimePackagePresent &&
    runtimeEntryPresent;

  const healthy =
    configured &&
    runtimeValid &&
    serviceFilePresent;

  return {
    configured,
    runtimePresent,
    runtimePackagePresent,
    runtimeEntryPresent,
    runtimeValid,
    serviceFilePresent,
    healthy,
    repairRequired:
      configured && !healthy,
    configPath: paths.configPath,
    runtimePath: paths.currentRuntimePath,
    runtimePackagePath,
    runtimeEntryPath,
    servicePath: paths.servicePath
  };
}

async function resolveBundledOperatorRuntimePath() {
  const path = require('node:path');

  const candidates = [
    path.join(
      process.resourcesPath || '',
      'operator-runtime'
    ),
    path.join(
      app.getAppPath(),
      'operator-runtime'
    ),
    path.join(
      app.getAppPath(),
      'node-operator',
      'runtime'
    ),
    path.resolve(
      __dirname,
      '..',
      'node-operator',
      'runtime'
    )
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;

    const packagePath = path.join(
      candidate,
      'package.json'
    );

    const mainPath = path.join(
      candidate,
      'src',
      'main.js'
    );

    if (
      await pathExists(packagePath) &&
      await pathExists(mainPath)
    ) {
      return candidate;
    }
  }

  throw new Error(
    'The bundled CryLoNexus operator runtime could not be found.'
  );
}

async function resolveSystemNodeBinary() {
  const configured =
    process.env.CRYLONEXUS_NODE_BINARY;

  if (
    configured &&
    await pathExists(configured)
  ) {
    return configured;
  }

  const whichResult = await runLocalCommand(
    'which',
    ['node']
  );

  if (
    whichResult.ok &&
    whichResult.stdout &&
    await pathExists(whichResult.stdout)
  ) {
    return whichResult.stdout;
  }

  const commonPaths = [
    '/usr/bin/node',
    '/usr/local/bin/node'
  ];

  for (const candidate of commonPaths) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    'Node.js 18 or newer is required to run the operator service.'
  );
}

async function copyBundledRuntime(
  sourceDirectory,
  destinationDirectory
) {
  const fs = require('node:fs');
  const path = require('node:path');

  await fs.promises.cp(
    sourceDirectory,
    destinationDirectory,
    {
      recursive: true,
      force: false,
      errorOnExist: true,
      filter(sourcePath) {
        const relative = path.relative(
          sourceDirectory,
          sourcePath
        );

        if (!relative) return true;

        const firstPart =
          relative.split(path.sep)[0];

        return ![
          'test',
          '.git',
          '.github'
        ].includes(firstPart);
      }
    }
  );

  const protocolSourceDirectory =
    path.resolve(
      sourceDirectory,
      '..',
      'protocol'
    );

  const protocolDestinationDirectory =
    path.join(
      destinationDirectory,
      'protocol'
    );

  if (!(await pathExists(protocolSourceDirectory))) {
    throw new Error(
      `Bundled operator protocol directory was not found: ${protocolSourceDirectory}`
    );
  }

  await fs.promises.cp(
    protocolSourceDirectory,
    protocolDestinationDirectory,
    {
      recursive: true,
      force: false,
      errorOnExist: true,
      filter(sourcePath) {
        const relative = path.relative(
          protocolSourceDirectory,
          sourcePath
        );

        if (!relative) return true;

        const firstPart =
          relative.split(path.sep)[0];

        return ![
          'tests',
          '.git',
          '.github',
          'node_modules'
        ].includes(firstPart);
      }
    }
  );
}

async function replaceRuntimeSymlink(
  targetDirectory,
  symlinkPath
) {
  const fs = require('node:fs');
  const path = require('node:path');

  const temporaryLink =
    `${symlinkPath}.next-${process.pid}`;

  await fs.promises.rm(
    temporaryLink,
    {
      force: true,
      recursive: true
    }
  );

  await fs.promises.symlink(
    targetDirectory,
    temporaryLink,
    'dir'
  );

  await fs.promises.rename(
    temporaryLink,
    symlinkPath
  ).catch(async error => {
    if (
      error.code !== 'EEXIST' &&
      error.code !== 'ENOTEMPTY'
    ) {
      throw error;
    }

    const previousLink =
      `${symlinkPath}.previous-${process.pid}`;

    await fs.promises.rm(
      previousLink,
      {
        force: true,
        recursive: true
      }
    );

    if (await pathExists(symlinkPath)) {
      await fs.promises.rename(
        symlinkPath,
        previousLink
      );
    }

    try {
      await fs.promises.rename(
        temporaryLink,
        symlinkPath
      );

      await fs.promises.rm(
        previousLink,
        {
          force: true,
          recursive: true
        }
      );
    } catch (replaceError) {
      if (await pathExists(previousLink)) {
        await fs.promises.rename(
          previousLink,
          symlinkPath
        );
      }

      throw replaceError;
    }
  });

  const resolved = await fs.promises.realpath(
    symlinkPath
  );

  if (
    path.resolve(resolved) !==
    path.resolve(targetDirectory)
  ) {
    throw new Error(
      'The active runtime link does not point to the installed runtime.'
    );
  }
}

function buildOperatorServiceUnit({
  nodeBinary,
  currentRuntimePath,
  operatorDirectory,
  operatorAddress
}) {
  return [
    '[Unit]',
    'Description=CryLoNexus Operator Service',
    'Documentation=https://crylonexus.com',
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    `WorkingDirectory=${currentRuntimePath}`,
    `ExecStart=${nodeBinary} ${currentRuntimePath}/src/main.js`,
    `Environment=CRYLONEXUS_LINKED_ADDRESS=${operatorAddress}`,
    'Environment=CRYLONEXUS_LOCAL_HEARTBEATS=1',
    `Environment=CRYLONEXUS_ELECTRON_STATUS_PATH=${operatorDirectory}/status.json`,
    'Restart=always',
    'RestartSec=5',
    'TimeoutStopSec=30',
    'KillSignal=SIGTERM',
    'NoNewPrivileges=true',
    'PrivateTmp=true',
    'ProtectSystem=strict',
    'ProtectHome=read-only',
    `ReadWritePaths=${operatorDirectory}`,
    '',
    '[Install]',
    'WantedBy=default.target',
    ''
  ].join('\n');
}

async function writeOperatorServiceUnit({
  servicePath,
  serviceText
}) {
  const fs = require('node:fs');
  const path = require('node:path');

  await fs.promises.mkdir(
    path.dirname(servicePath),
    {
      recursive: true,
      mode: 0o700
    }
  );

  const temporaryPath =
    `${servicePath}.tmp-${process.pid}`;

  await fs.promises.writeFile(
    temporaryPath,
    serviceText,
    {
      encoding: 'utf8',
      mode: 0o600
    }
  );

  await fs.promises.chmod(
    temporaryPath,
    0o600
  );

  await fs.promises.rename(
    temporaryPath,
    servicePath
  );
}

async function installBundledOperatorRuntime() {
  if (!IS_LINUX) {
    throw new Error(
      'The CryLoNexus operator service installer currently supports Linux only.'
    );
  }

  const fs = require('node:fs');
  const path = require('node:path');

  const paths = getOperatorInstallPaths();

  if (!(await pathExists(paths.configPath))) {
    throw new Error(
      'Register the Operator or Validator before installing the service.'
    );
  }

  const operatorConfig =
    await readJsonFileStrict(
      paths.configPath
    );

  if (
    !operatorConfig ||
    typeof operatorConfig !== 'object' ||
    !ethers.isAddress(
      operatorConfig.operatorAddress
    )
  ) {
    throw new Error(
      'operator.json does not contain a valid operatorAddress.'
    );
  }

  const sourceDirectory =
    await resolveBundledOperatorRuntimePath();

  const sourcePackage =
    await readJsonFileStrict(
      path.join(
        sourceDirectory,
        'package.json'
      )
    );

  const runtimeVersion =
    typeof sourcePackage.version === 'string' &&
    sourcePackage.version.trim()
      ? sourcePackage.version.trim()
      : '0.0.0';

  const releaseId = [
    runtimeVersion,
    new Date()
      .toISOString()
      .replace(/[-:.TZ]/g, '')
  ].join('-');

  const destinationDirectory =
    path.join(
      paths.runtimesDirectory,
      releaseId
    );

  await fs.promises.mkdir(
    paths.operatorDirectory,
    {
      recursive: true,
      mode: 0o700
    }
  );

  await fs.promises.mkdir(
    paths.runtimesDirectory,
    {
      recursive: true,
      mode: 0o700
    }
  );

  await copyBundledRuntime(
    sourceDirectory,
    destinationDirectory
  );

  const installedMainPath =
    path.join(
      destinationDirectory,
      'src',
      'main.js'
    );

  const installedPackagePath =
    path.join(
      destinationDirectory,
      'package.json'
    );

  const installedConfigSchemaPath =
    path.join(
      destinationDirectory,
      'protocol',
      'schemas',
      'operator-config.schema.json'
    );

  const installedStatusSchemaPath =
    path.join(
      destinationDirectory,
      'protocol',
      'schemas',
      'operator-status.schema.json'
    );

  if (
    !(await pathExists(installedMainPath)) ||
    !(await pathExists(installedPackagePath)) ||
    !(await pathExists(installedConfigSchemaPath)) ||
    !(await pathExists(installedStatusSchemaPath))
  ) {
    await fs.promises.rm(
      destinationDirectory,
      {
        force: true,
        recursive: true
      }
    );

    throw new Error(
      'The bundled operator runtime failed installation validation.'
    );
  }

  const nodeBinary =
    await resolveSystemNodeBinary();

  const nodeVersionResult =
    await runLocalCommand(
      nodeBinary,
      ['--version']
    );

  if (!nodeVersionResult.ok) {
    throw new Error(
      nodeVersionResult.stderr ||
      'Unable to validate the system Node.js installation.'
    );
  }

  const majorVersion =
    Number.parseInt(
      String(nodeVersionResult.stdout)
        .replace(/^v/, '')
        .split('.')[0],
      10
    );

  if (
    !Number.isInteger(majorVersion) ||
    majorVersion < 18
  ) {
    throw new Error(
      `Node.js 18 or newer is required. Found ${nodeVersionResult.stdout}.`
    );
  }

  await replaceRuntimeSymlink(
    destinationDirectory,
    paths.currentRuntimePath
  );

  const serviceText =
    buildOperatorServiceUnit({
      nodeBinary,
      currentRuntimePath:
        paths.currentRuntimePath,
      operatorDirectory:
        paths.operatorDirectory,
      operatorAddress:
        operatorConfig.operatorAddress
    });

  await writeOperatorServiceUnit({
    servicePath: paths.servicePath,
    serviceText
  });

  const daemonReload =
    await runLocalCommand(
      'systemctl',
      [
        '--user',
        'daemon-reload'
      ]
    );

  if (!daemonReload.ok) {
    throw new Error(
      daemonReload.stderr ||
      'systemctl --user daemon-reload failed.'
    );
  }

  const enableResult =
    await runLocalCommand(
      'systemctl',
      [
        '--user',
        'enable',
        'crylo-nexus-operator.service'
      ]
    );

  if (!enableResult.ok) {
    throw new Error(
      enableResult.stderr ||
      'The operator service could not be enabled and started.'
    );
  }

  const warnings = [];

  const lingerResult =
    await runLocalCommand(
      'loginctl',
      [
        'enable-linger',
        process.env.USER ||
          require('node:os').userInfo().username
      ]
    );

  if (!lingerResult.ok) {
    warnings.push(
      'The service is running, but Linux lingering could not be enabled automatically. It may require administrator approval to start before login.'
    );
  }

  const installedManifest = {
    schemaVersion: 1,
    runtimeVersion,
    releaseId,
    sourcePackage:
      sourcePackage.name || null,
    installedAt:
      new Date().toISOString(),
    runtimePath:
      destinationDirectory,
    activeRuntimePath:
      paths.currentRuntimePath,
    nodeBinary,
    serviceName:
      'crylo-nexus-operator.service'
  };

  const manifestPath =
    path.join(
      paths.operatorDirectory,
      'runtime-installation.json'
    );

  const temporaryManifest =
    `${manifestPath}.tmp-${process.pid}`;

  await fs.promises.writeFile(
    temporaryManifest,
    JSON.stringify(
      installedManifest,
      null,
      2
    ) + '\n',
    {
      encoding: 'utf8',
      mode: 0o600
    }
  );

  await fs.promises.rename(
    temporaryManifest,
    manifestPath
  );

  const service =
    await readOperatorServiceStatus();

  return {
    ok: true,
    installed: true,
    updated: true,
    runtimeVersion,
    releaseId,
    runtimePath:
      destinationDirectory,
    activeRuntimePath:
      paths.currentRuntimePath,
    service,
    warnings
  };
}

async function controlOperatorService(action) {
  if (!IS_LINUX) {
    throw new Error(
      'Operator service controls are currently available on Linux only.'
    );
  }

  const supportedActions = new Set([
    'start',
    'stop',
    'restart'
  ]);

  if (!supportedActions.has(action)) {
    throw new Error(
      'Unsupported operator service action.'
    );
  }

  const result = await runLocalCommand(
    'systemctl',
    [
      '--user',
      action,
      'crylo-nexus-operator.service'
    ]
  );

  if (!result.ok) {
    throw new Error(
      result.stderr ||
      `Unable to ${action} the operator service.`
    );
  }

  await new Promise(resolve => {
    setTimeout(resolve, 500);
  });

  return {
    ok: true,
    action,
    service:
      await readOperatorServiceStatus()
  };
}


async function readOperatorServiceStatus() {
  if (!IS_LINUX) {
    return {
      supported: false,
      installed: false,
      running: false,
      activeState: 'unsupported',
      subState: 'unsupported',
      serviceScope: null,
      serviceName: 'crylo-nexus-operator.service',
      message: 'Operator service status is currently available on Linux only.'
    };
  }

  const serviceName = 'crylo-nexus-operator.service';
  const installation =
    await inspectOperatorInstallationHealth();

  const checks = [
    {
      scope: 'system',
      args: [
        'show',
        serviceName,
        '--no-page',
        '--property=LoadState,ActiveState,SubState,MainPID,ExecMainStartTimestamp'
      ]
    },
    {
      scope: 'user',
      args: [
        '--user',
        'show',
        serviceName,
        '--no-page',
        '--property=LoadState,ActiveState,SubState,MainPID,ExecMainStartTimestamp'
      ]
    }
  ];

  for (const check of checks) {
    const result = await runLocalCommand('systemctl', check.args);

    if (!result.stdout) continue;

    const values = {};

    for (const line of result.stdout.split(/\r?\n/)) {
      const separator = line.indexOf('=');
      if (separator < 0) continue;

      const key = line.slice(0, separator);
      const value = line.slice(separator + 1);
      values[key] = value;
    }

    if (values.LoadState && values.LoadState !== 'not-found') {
      return {
        supported: true,
        installed: installation.healthy,
        running:
          installation.healthy &&
          values.ActiveState === 'active',
        activeState: values.ActiveState || 'unknown',
        subState: values.SubState || 'unknown',
        mainPid: values.MainPID || '0',
        startedAt: values.ExecMainStartTimestamp || null,
        serviceScope: check.scope,
        serviceName,
        ...installation,
        message:
          installation.healthy
            ? result.stderr || null
            : 'The operator service installation is incomplete and must be repaired.'
      };
    }
  }

  return {
    supported: true,
    installed: false,
    running: false,
    activeState: 'not-found',
    subState: 'not-found',
    mainPid: '0',
    startedAt: null,
    serviceScope: null,
    serviceName,
    ...installation,
    message:
      installation.repairRequired
        ? 'The operator service installation is incomplete and must be repaired.'
        : 'Operator service is not installed.'
  };
}

function normalizeOperatorWorkers(statusData) {
  if (!statusData || typeof statusData !== 'object') return [];

  const rawWorkers =
    statusData.health?.workers ||
    statusData.workers ||
    statusData.workerHealth ||
    statusData.health ||
    {};

  if (Array.isArray(rawWorkers)) {
    return rawWorkers.map((worker, index) => ({
      name: worker.name || `Worker ${index + 1}`,
      enabled: worker.enabled !== false,
      healthy: worker.enabled === false ? null : worker.healthy === true,
      lastRun: worker.lastRun || null,
      lastSuccess: worker.lastSuccess || null,
      errors: Number(worker.errors || worker.errorCount || 0),
      message: worker.message || null
    }));
  }

  if (!rawWorkers || typeof rawWorkers !== 'object') return [];

  return Object.entries(rawWorkers)
    .filter(([, value]) => value && typeof value === 'object')
    .map(([name, worker]) => ({
      name: worker.name || name,
      enabled: worker.enabled !== false,
      healthy: worker.enabled === false ? null : worker.healthy === true,
      lastRun: worker.lastRun || null,
      lastSuccess: worker.lastSuccess || null,
      errors: Number(worker.errors || worker.errorCount || 0),
      message: worker.message || null
    }));
}


// CRYLONEXUS_OPERATOR_AUTHORIZATION_V1
const OPERATOR_AUTHORIZATION_LIFETIME_MS =
  72 * 60 * 60 * 1000;

function writePrivateJsonAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  const temporaryPath =
    `${filePath}.${process.pid}.${Date.now()}.tmp`;

  fs.mkdirSync(directory, {
    recursive: true,
    mode: 0o700
  });

  fs.writeFileSync(
    temporaryPath,
    `${JSON.stringify(value, null, 2)}\n`,
    {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'w'
    }
  );

  fs.chmodSync(temporaryPath, 0o600);
  fs.renameSync(temporaryPath, filePath);
  fs.chmodSync(filePath, 0o600);
}

function writePrivateTextAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  const temporaryPath =
    `${filePath}.${process.pid}.${Date.now()}.tmp`;

  fs.mkdirSync(directory, {
    recursive: true,
    mode: 0o700
  });

  fs.writeFileSync(
    temporaryPath,
    `${String(value).trim()}\n`,
    {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'w'
    }
  );

  fs.chmodSync(temporaryPath, 0o600);
  fs.renameSync(temporaryPath, filePath);
  fs.chmodSync(filePath, 0o600);
}

function readOperatorAuthorization(filePath, expectedAddress) {
  const result = readJsonFileSafe(filePath);

  if (!result.exists) {
    return {
      exists: false,
      valid: false,
      expired: false,
      status: 'Not Authorized',
      expiresAt: null,
      remainingSeconds: 0,
      sessionAddress: null,
      error: null
    };
  }

  if (!result.data) {
    return {
      exists: true,
      valid: false,
      expired: false,
      status: 'Invalid Authorization',
      expiresAt: null,
      remainingSeconds: 0,
      sessionAddress: null,
      error: result.error || 'Authorization file is invalid'
    };
  }

  const authorization = result.data;
  const expiresMs =
    Date.parse(authorization.delegation?.expiresAt || '');

  const addressMatches =
    ethers.isAddress(expectedAddress) &&
    ethers.isAddress(
      authorization.delegation?.operatorAddress
    ) &&
    ethers.getAddress(
      authorization.delegation.operatorAddress
    ) === ethers.getAddress(expectedAddress);

  const validExpiration =
    Number.isFinite(expiresMs);

  const remainingSeconds =
    validExpiration
      ? Math.max(
          0,
          Math.floor((expiresMs - Date.now()) / 1000)
        )
      : 0;

  const expired =
    validExpiration && remainingSeconds === 0;

  const structurallyValid =
    authorization.version === 1 &&
    authorization.delegation?.purpose ===
      'operator-heartbeat' &&
    authorization.delegation?.chainId === 5546 &&
    ethers.isAddress(
      authorization.delegation?.sessionAddress
    ) &&
    !Object.prototype.hasOwnProperty.call(
      authorization,
      'sessionPrivateKey'
    ) &&
    typeof authorization.delegationSignature ===
      'string';

  const valid =
    structurallyValid &&
    addressMatches &&
    validExpiration &&
    !expired;

  return {
    exists: true,
    valid,
    expired,
    status: valid
      ? 'Authorized'
      : expired
        ? 'Authorization Expired'
        : 'Invalid Authorization',
    issuedAt:
      authorization.delegation?.issuedAt || null,
    expiresAt:
      authorization.delegation?.expiresAt || null,
    remainingSeconds,
    sessionAddress:
      authorization.delegation?.sessionAddress ||
      null,
    sessionId:
      authorization.delegation?.sessionId || null,
    error:
      valid || expired
        ? null
        : 'Authorization does not match this registered operator'
  };
}



ipcMain.handle(
  'nexus-operator-installation-status',
  async () => {
    try {
      const path = require('node:path');

      if (!IS_LINUX) {
        return {
          ok: true,
          supported: false,
          installed: false,
          updateAvailable: false,
          bundledVersion: null,
          installedVersion: null
        };
      }

      const paths =
        getOperatorInstallPaths();

      const health =
        await inspectOperatorInstallationHealth();

      const sourceDirectory =
        await resolveBundledOperatorRuntimePath();

      const bundledPackage =
        await readJsonFileStrict(
          path.join(
            sourceDirectory,
            'package.json'
          )
        );

      const bundledVersion =
        typeof bundledPackage.version === 'string'
          ? bundledPackage.version
          : null;

      const manifestPath =
        path.join(
          paths.operatorDirectory,
          'runtime-installation.json'
        );

      let installation = null;

      if (await pathExists(manifestPath)) {
        try {
          installation =
            await readJsonFileStrict(
              manifestPath
            );
        } catch (error) {
          return {
            ok: false,
            supported: true,
            installed: health.healthy,
            healthy: health.healthy,
            repairRequired:
              health.repairRequired,
            ...health,
            bundledVersion,
            installedVersion: null,
            updateAvailable: false,
            error:
              `Unable to read the installed runtime manifest: ${error.message}`
          };
        }
      }

      const installedVersion =
        typeof installation?.runtimeVersion ===
          'string'
          ? installation.runtimeVersion
          : null;

      return {
        ok: true,
        supported: true,
        installed: health.healthy,
        healthy: health.healthy,
        repairRequired:
          health.repairRequired,
        ...health,
        bundledVersion,
        installedVersion,
        updateAvailable:
          Boolean(
            bundledVersion &&
            installedVersion &&
            bundledVersion !==
              installedVersion
          ),
        installedAt:
          installation?.installedAt ||
          null,
        releaseId:
          installation?.releaseId ||
          null,
        runtimePath:
          installation?.runtimePath ||
          null
      };
    } catch (error) {
      return {
        ok: false,
        supported: IS_LINUX,
        installed: false,
        updateAvailable: false,
        bundledVersion: null,
        installedVersion: null,
        error:
          error?.message ||
          'Unable to inspect the operator installation.'
      };
    }
  }
);

ipcMain.handle(
  'nexus-install-operator-service',
  async () => {
    try {
      return await installBundledOperatorRuntime();
    } catch (error) {
      console.error(
        'Operator service installation failed:',
        error
      );

      return {
        ok: false,
        error:
          error?.message ||
          'Operator service installation failed.'
      };
    }
  }
);

ipcMain.handle(
  'nexus-control-operator-service',
  async (_event, action) => {
    try {
      return await controlOperatorService(
        action
      );
    } catch (error) {
      console.error(
        'Operator service control failed:',
        error
      );

      return {
        ok: false,
        action,
        error:
          error?.message ||
          'Operator service control failed.'
      };
    }
  }
);

ipcMain.handle(
  'nexus-authorize-operator',
  async (_, walletName, cryloAddress) => {
    try {
      const paths = getOperatorPaths();
      const configResult =
        readJsonFileSafe(paths.config);

      if (!configResult.data) {
        throw new Error(
          'Install and configure the node operator service first'
        );
      }

      const service =
        await readOperatorServiceStatus();

      if (!service.installed) {
        throw new Error(
          'Install the CryLoNexus operator service before authorizing this node'
        );
      }

      const runtime =
        await getNexusRuntimeConfig();

      const wallet =
        loadBoundNexusWallet(
          walletName,
          cryloAddress
        ).connect(runtime.provider);

      const configuredAddress =
        configResult.data.operatorAddress;

      if (
        !ethers.isAddress(configuredAddress) ||
        ethers.getAddress(configuredAddress) !==
          ethers.getAddress(wallet.address)
      ) {
        throw new Error(
          'The operator configuration does not match the bound Nexus wallet'
        );
      }

      const nodeStakingAddress =
        ethers.isAddress(
          configResult.data.nodeStakingContract
        )
          ? ethers.getAddress(
              configResult.data.nodeStakingContract
            )
          : runtime.contracts.NodeStaking;

      const nodeArtifact =
        require('./src/abis/CryLoNodeStaking.json');

      const node =
        new ethers.Contract(
          nodeStakingAddress,
          nodeArtifact.abi,
          runtime.provider
        );

      const [
        tier,
        network
      ] = await Promise.all([
        node.nodeTier(wallet.address),
        runtime.provider.getNetwork()
      ]);

      const tierText = tier.toString();

      if (
        tierText !== '1' &&
        tierText !== '2'
      ) {
        throw new Error(
          'Only registered Operators and Validators can authorize a node'
        );
      }

      if (network.chainId !== 5546n) {
        throw new Error(
          `Unexpected CryLoNexus chain ID: ${network.chainId}`
        );
      }

      const nodeId =
        configResult.data.nodeIdentity?.publicId ||
        `operator-${wallet.address.slice(2)}`;

      const confirmation =
        await dialog.showMessageBox(mainWindow, {
          type: 'question',
          buttons: [
            'Authorize Node',
            'Cancel'
          ],
          defaultId: 0,
          cancelId: 1,
          title: 'Authorize CryLoNexus Node',
          message:
            'Authorize this registered node for 72 hours?',
          detail:
            'Electron will create a temporary session key. ' +
            'Your bound Nexus wallet private key remains inside Electron ' +
            'and is not stored in the operator service.'
        });

      if (confirmation.response !== 0) {
        return {
          ok: false,
          cancelled: true,
          error: 'Authorization cancelled'
        };
      }

      const sessionWallet =
        ethers.Wallet.createRandom();

      const issuedAt =
        new Date().toISOString();

      const expiresAt =
        new Date(
          Date.now() +
          OPERATOR_AUTHORIZATION_LIFETIME_MS
        ).toISOString();

      const delegation = {
        version: 1,
        purpose: 'operator-heartbeat',
        chainId: 5546,
        operatorAddress:
          ethers.getAddress(wallet.address),
        nodeId,
        sessionAddress:
          ethers.getAddress(
            sessionWallet.address
          ),
        issuedAt,
        expiresAt,
        sessionId:
          ethers.hexlify(
            ethers.randomBytes(32)
          ),
        nonce:
          ethers.hexlify(
            ethers.randomBytes(32)
          )
      };

      /*
       * JSON insertion order is intentionally fixed.
       * The runtime verifier will use the same canonical field order.
       */
      const delegationMessage =
        JSON.stringify(delegation);

      const delegationSignature =
        await wallet.signMessage(
          delegationMessage
        );

      const recoveredAddress =
        ethers.verifyMessage(
          delegationMessage,
          delegationSignature
        );

      if (
        ethers.getAddress(recoveredAddress) !==
        ethers.getAddress(wallet.address)
      ) {
        throw new Error(
          'Delegation signature self-verification failed'
        );
      }

      const authorization = {
        version: 1,
        delegation,
        delegationSignature,
        createdBy: 'CryLo Electron',
        createdAt: issuedAt
      };

      /*
       * Write the session private key separately from the public
       * authorization document. The bound Nexus wallet key remains
       * inside Electron and is never written to the operator service.
       */
      writePrivateTextAtomic(
        paths.signingKey,
        sessionWallet.privateKey
      );

      try {
        writePrivateJsonAtomic(
          paths.authorization,
          authorization
        );
      } catch (writeError) {
        try {
          fs.rmSync(
            paths.signingKey,
            {
              force: true
            }
          );
        } catch (_) {}

        throw writeError;
      }

      const restartResult =
        await runLocalCommand(
          'systemctl',
          [
            '--user',
            'restart',
            'crylo-nexus-operator.service'
          ],
          15000
        );

      if (!restartResult.ok) {
        throw new Error(
          restartResult.stderr ||
          'The authorized operator service could not be started'
        );
      }

      await new Promise(resolve => {
        setTimeout(resolve, 1500);
      });

      const authorizedService =
        await readOperatorServiceStatus();

      if (!authorizedService.running) {
        throw new Error(
          authorizedService.message ||
          `The authorized service did not become active ` +
          `(${authorizedService.activeState}/${authorizedService.subState})`
        );
      }

      return {
        ok: true,
        status: 'Authorized',
        operatorAddress:
          delegation.operatorAddress,
        sessionAddress:
          delegation.sessionAddress,
        issuedAt,
        expiresAt,
        remainingSeconds:
          Math.floor(
            OPERATOR_AUTHORIZATION_LIFETIME_MS /
            1000
          ),
        authorizationPath:
          paths.authorization
      };
    } catch (error) {
      return {
        ok: false,
        error:
          error.shortMessage ||
          error.reason ||
          error.message
      };
    }
  }
);

ipcMain.handle('nexus-operator-dashboard', async (_, linkedAddress) => {
  const paths = getOperatorPaths();
  const configResult = readJsonFileSafe(paths.config);
  const statusFile = findOperatorStatusFile(paths.statusCandidates);
  const statusResult = readJsonFileSafe(statusFile);
  const service = await readOperatorServiceStatus();

  const authorization =
    readOperatorAuthorization(
      paths.authorization,
      linkedAddress
    );

  const now = Date.now();
  const statusUpdatedAt =
    statusResult.data?.updatedAt ||
    statusResult.data?.timestamp ||
    null;

  const statusUpdatedMs = statusUpdatedAt
    ? Date.parse(statusUpdatedAt)
    : NaN;

  const statusAgeSeconds = Number.isFinite(statusUpdatedMs)
    ? Math.max(0, Math.floor((now - statusUpdatedMs) / 1000))
    : null;

  const workers = normalizeOperatorWorkers(statusResult.data);

  const workerSummary = workers.reduce(
    (summary, worker) => {
      if (!worker.enabled) {
        summary.disabled += 1;
      } else if (worker.healthy) {
        summary.healthy += 1;
      } else {
        summary.unhealthy += 1;
      }

      return summary;
    },
    {
      total: workers.length,
      healthy: 0,
      unhealthy: 0,
      disabled: 0
    }
  );

  const response = {
    ok: true,

    registration: {
      available: false,
      registered: false,
      tier: '0',
      tierLabel: 'Not Registered',
      stake: '0',
      pending: '0',
      operatorStake: '300',
      validatorStake: '750',
      error: null
    },

    configuration: {
      exists: configResult.exists,
      loaded: Boolean(configResult.data),
      path: paths.config,
      error: configResult.error,
      data: configResult.data
    },

    service,

    authorization,

    runtime: {
      statusExists: statusResult.exists,
      statusLoaded: Boolean(statusResult.data),
      statusPath: statusFile,
      statusError: statusResult.error,
      nodeId: statusResult.data?.nodeId || null,
      updatedAt: statusUpdatedAt,
      ageSeconds: statusAgeSeconds,
      stale: statusAgeSeconds != null ? statusAgeSeconds > 120 : null
    },

    workers,
    workerSummary,

    metrics:
      statusResult.data?.metrics &&
      typeof statusResult.data.metrics === 'object'
        ? statusResult.data.metrics
        : {},

    rewardVerification: {
      connected: false,
      status: 'Not Connected',
      message:
        'Uptime verification and operator reward validation are not connected yet.'
    }
  };

  try {
    if (!ethers.isAddress(linkedAddress)) {
      response.registration.error = 'Invalid Nexus address';
      return response;
    }

    const nexusRuntime =
      await getNexusRuntimeConfig();

    const configuredNodeStakingAddress =
      configResult.data?.nodeStakingContract;

    const nodeStakingAddress =
      ethers.isAddress(configuredNodeStakingAddress)
        ? ethers.getAddress(configuredNodeStakingAddress)
        : nexusRuntime.contracts.NodeStaking;

    const nodeArtifact =
      require('./src/abis/CryLoNodeStaking.json');

    const rewardVaultArtifact =
      require('./src/abis/RewardVault.json');

    const provider = new ethers.JsonRpcProvider(
      nexusRuntime.rpc
    );

    const node = new ethers.Contract(
      nodeStakingAddress,
      nodeArtifact.abi,
      provider
    );

    const rewardVault = new ethers.Contract(
      nexusRuntime.contracts.RewardVault,
      rewardVaultArtifact.abi,
      provider
    );

    const [
      tier,
      stake,
      pending,
      operatorStake,
      validatorStake,
      network
    ] = await Promise.all([
      node.nodeTier(linkedAddress),
      node.nodeStake(linkedAddress),
      rewardVault.pendingRewards(linkedAddress),
      node.operatorStakeRequirement(),
      node.validatorStakeRequirement(),
      provider.getNetwork()
    ]);

    const tierText = tier.toString();

    response.registration = {
      available: true,
      registered: tierText !== '0',
      tier: tierText,
      tierLabel:
        tierText === '1'
          ? 'Operator'
          : tierText === '2'
            ? 'Validator'
            : 'Not Registered',
      stake: formatWcryloUnits(stake),
      pending: formatWcryloUnits(pending),
      operatorStake: formatWcryloUnits(operatorStake),
      validatorStake: formatWcryloUnits(validatorStake),
      contract: nodeStakingAddress,
      chainId: network.chainId.toString(),
      linkedAddress,
      error: null
    };
  } catch (error) {
    response.registration.error =
      error.shortMessage ||
      error.reason ||
      error.message;
  }

  return response;
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
  await shutdownBackendsSafely();
  app.quit();
});

let quitCleanupStarted = false;

app.on('before-quit', event => {
  if (quitCleanupStarted) {
    return;
  }

  quitCleanupStarted = true;
  event.preventDefault();

  shutdownBackendsSafely()
    .catch(error => {
      console.error(
        'Safe backend shutdown failed:',
        error
      );
    })
    .finally(() => {
      app.quit();
    });
});


let signalShutdownStarted = false;

async function handleProcessShutdownSignal(signal) {
  if (signalShutdownStarted) {
    return;
  }

  signalShutdownStarted = true;

  console.log(
    `Received ${signal}; stopping CryLo services safely.`
  );

  try {
    await shutdownBackendsSafely();
  } catch (error) {
    console.error(
      `Shutdown after ${signal} failed:`,
      error
    );
  } finally {
    /*
     * Exit directly after cleanup. Calling app.quit() here can
     * re-enter before-quit while the process is already handling
     * an operating-system termination signal.
     */
    process.exit(0);
  }
}

process.once('SIGTERM', () => {
  handleProcessShutdownSignal('SIGTERM');
});

process.once('SIGINT', () => {
  handleProcessShutdownSignal('SIGINT');
});

process.once('SIGHUP', () => {
  handleProcessShutdownSignal('SIGHUP');
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

async function getLatestGasEpoch(gm, walletAddress) {
  const count = Number(await gm.epochCount());

  if (!Number.isFinite(count) || count <= 0) {
    return {
      epochId: null,
      epoch: null,
      eligible: false,
      claimed: false
    };
  }

  for (
    let epochId = count;
    epochId >= Math.max(0, count - 25);
    epochId--
  ) {
    try {
      const epoch = await gm.epochs(epochId);

      const [eligible, claimed] = await Promise.all([
        gm.eligible(epochId, walletAddress),
        gm.claimed(epochId, walletAddress)
      ]);

      return {
        epochId,
        epoch,
        eligible: !!eligible,
        claimed: !!claimed
      };
    } catch (_) {}
  }

  return {
    epochId: null,
    epoch: null,
    eligible: false,
    claimed: false
  };
}

async function getClaimableGasEpoch(gm, walletAddress) {
  const count = Number(await gm.epochCount());

  if (!Number.isFinite(count) || count <= 0) {
    return null;
  }

  for (
    let epochId = count;
    epochId >= Math.max(0, count - 50);
    epochId--
  ) {
    try {
      const [eligible, claimed] = await Promise.all([
        gm.eligible(epochId, walletAddress),
        gm.claimed(epochId, walletAddress)
      ]);

      if (eligible && !claimed) {
        return epochId;
      }
    } catch (_) {}
  }

  return null;
}

/*
 * Lightweight native-gas balance lookup.
 *
 * This intentionally performs only provider.getBalance(). The complete
 * nexus-gas-status handler also queries registry state, GasManager policy,
 * treasury state, and gas epochs, so it is too slow for post-onboarding
 * balance detection.
 */
ipcMain.handle('nexus-native-gas-balance', async (_, linkedAddress) => {
  try {
    if (!ethers.isAddress(linkedAddress)) {
      return {
        ok: false,
        error: 'Invalid Nexus address'
      };
    }

    const runtime = await getNexusRuntimeConfig();
    const nativeBalance =
      await runtime.provider.getBalance(linkedAddress);

    return {
      ok: true,
      nativeGas: formatNexusGasUnits(nativeBalance)
    };
  } catch (e) {
    console.error('[nexus-native-gas-balance] failed', {
      message: e?.message,
      shortMessage: e?.shortMessage,
      reason: e?.reason,
      code: e?.code
    });

    return {
      ok: false,
      error:
        e?.shortMessage ||
        e?.reason ||
        e?.message ||
        String(e)
    };
  }
});


ipcMain.handle('nexus-gas-status', async (_, linkedAddress) => {
  try {
    if (!ethers.isAddress(linkedAddress)) {
      return {
        ok: false,
        error: 'Invalid Nexus address'
      };
    }

    const runtime = await getNexusRuntimeConfig();
    const provider = runtime.provider;

    const gasArtifact = require('./src/abis/GasManager.json');
    const registryArtifact = require('./src/abis/WalletRegistry.json');

    const gm = new ethers.Contract(
      runtime.contracts.GasManager,
      gasArtifact.abi,
      provider
    );

    const registry = new ethers.Contract(
      runtime.contracts.WalletRegistry,
      registryArtifact.abi,
      provider
    );

    const [
      nativeBalance,
      starterGasAmount,
      lowGasThreshold,
      purchaseRateNativePerWcrylo,
      minimumTreasuryReserve,
      starterClaimed,
      lastActivityAt,
      registered,
      active,
      treasuryBalance,
      latest
    ] = await Promise.all([
      provider.getBalance(linkedAddress),
      gm.starterGasAmount(),
      gm.lowGasThreshold(),
      gm.purchaseRateNativePerWcrylo(),
      gm.minimumTreasuryReserve(),
      gm.starterGasClaimed(linkedAddress),
      registry.lastActivityAt(linkedAddress),
      registry.isRegistered(linkedAddress),
      registry.isActive(linkedAddress),
      provider.getBalance(runtime.contracts.GasTreasuryVault),
      getLatestGasEpoch(gm, linkedAddress)
    ]);

    let dailyGasAmount = 0n;

    if (latest.epoch) {
      dailyGasAmount =
        latest.epoch.amountPerWallet ??
        latest.epoch.gasAmountPerWallet ??
        latest.epoch.claimAmount ??
        latest.epoch[2] ??
        0n;
    }

    return {
      ok: true,
      nativeGas: formatNexusGasUnits(nativeBalance),
      dailyGasAmount: formatNexusGasUnits(dailyGasAmount),
      starterGasAmount: formatNexusGasUnits(starterGasAmount),
      lowGasThreshold: formatNexusGasUnits(lowGasThreshold),
      purchaseRateNativePerWcrylo:
        formatNexusGasUnits(purchaseRateNativePerWcrylo),
      minimumTreasuryReserve:
        formatNexusGasUnits(minimumTreasuryReserve),
      lastGasClaimAt: 0,
      lastActivityAt: Number(lastActivityAt),
      canClaim: latest.eligible && !latest.claimed,
      vaultBalance: formatNexusGasUnits(treasuryBalance),
      starterGasClaimed: !!starterClaimed,
      registered: !!registered,
      active: !!active,
      epochId: latest.epochId
    };
  } catch (e) {
    console.error('[nexus-gas-status] failed', {
      message: e?.message,
      shortMessage: e?.shortMessage,
      reason: e?.reason,
      code: e?.code
    });

    return {
      ok: false,
      error: e?.shortMessage || e?.reason || e?.message || String(e)
    };
  }
});

ipcMain.handle('nexus-claim-daily-gas', async (_, walletName, cryloAddress) => {
  try {
    const runtime = await getNexusRuntimeConfig();
    const provider = runtime.provider;

    const wallet = loadBoundNexusWallet(
      walletName,
      cryloAddress
    ).connect(provider);

    const gasArtifact = require('./src/abis/GasManager.json');

    const gm = new ethers.Contract(
      runtime.contracts.GasManager,
      gasArtifact.abi,
      wallet
    );

    const epochId = await getClaimableGasEpoch(
      gm,
      wallet.address
    );

    if (epochId === null) {
      return {
        ok: false,
        error: 'No eligible unclaimed gas epoch is currently available.'
      };
    }

    const nonce = await provider.getTransactionCount(
      wallet.address,
      'pending'
    );

    const tx = await gm.claimGas(
      epochId,
      { nonce }
    );

    const receipt = await tx.wait();

    return {
      ok: true,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      epochId
    };
  } catch (e) {
    return {
      ok: false,
      error: e.shortMessage || e.reason || e.message
    };
  }
});

ipcMain.handle('nexus-buy-gas-wcrylo', async (_, amountText, walletName, cryloAddress) => {
  let stage = 'initialization';

  try {
    const runtime = await getNexusRuntimeConfig();
    const provider = runtime.provider;

    const wallet = loadBoundNexusWallet(
      walletName,
      cryloAddress
    ).connect(provider);

    const tokenArtifact =
      require('./src/abis/WrappedCryLo.json');

    const gasArtifact =
      require('./src/abis/GasManager.json');

    const token = new ethers.Contract(
      runtime.contracts.wCryLo,
      tokenArtifact.abi,
      wallet
    );

    const gm = new ethers.Contract(
      runtime.contracts.GasManager,
      gasArtifact.abi,
      wallet
    );

    const amount = parseWcryloUnits(amountText);

    if (amount <= 0n) {
      throw new Error('Gas purchase amount must be greater than zero');
    }

    const [
      nativeBalance,
      tokenBalance,
      currentAllowance
    ] = await Promise.all([
      provider.getBalance(wallet.address),
      token.balanceOf(wallet.address),
      token.allowance(
        wallet.address,
        runtime.contracts.GasManager
      )
    ]);

    if (tokenBalance < amount) {
      throw new Error(
        `Insufficient wCryLo. Available: ${formatWcryloUnits(tokenBalance)}`
      );
    }

    let nonce = await provider.getTransactionCount(
      wallet.address,
      'pending'
    );

    let approvalHash = null;

    if (currentAllowance < amount) {
      stage = 'approval estimation';

      const approvalGas =
        await token.approve.estimateGas(
          runtime.contracts.GasManager,
          amount,
          { nonce }
        );

      const feeData = await provider.getFeeData();
      const gasPrice =
        feeData.maxFeePerGas ||
        feeData.gasPrice ||
        0n;

      const estimatedApprovalCost =
        approvalGas * gasPrice;

      if (
        estimatedApprovalCost > 0n &&
        nativeBalance < estimatedApprovalCost
      ) {
        return {
          ok: false,
          stage,
          stranded: true,
          nativeBalance:
            ethers.formatEther(nativeBalance),
          estimatedApprovalCost:
            ethers.formatEther(estimatedApprovalCost),
          error:
            'Native CRYLO balance is too low to authorize the gas purchase.'
        };
      }

      stage = 'approval submission';

      const approvalTx = await token.approve(
        runtime.contracts.GasManager,
        amount,
        { nonce }
      );

      approvalHash = approvalTx.hash;

      stage = 'approval confirmation';
      await approvalTx.wait();
      nonce++;
    }

    stage = 'purchase estimation';

    const purchaseGas =
      await gm.buyGasWithWcrylo.estimateGas(
        amount,
        { nonce }
      );

    const feeData = await provider.getFeeData();
    const gasPrice =
      feeData.maxFeePerGas ||
      feeData.gasPrice ||
      0n;

    const estimatedPurchaseCost =
      purchaseGas * gasPrice;

    const balanceBeforePurchase =
      await provider.getBalance(wallet.address);

    if (
      estimatedPurchaseCost > 0n &&
      balanceBeforePurchase <
        estimatedPurchaseCost
    ) {
      return {
        ok: false,
        stage,
        stranded: true,
        approvalHash,
        nativeBalance:
          ethers.formatEther(balanceBeforePurchase),
        estimatedPurchaseCost:
          ethers.formatEther(estimatedPurchaseCost),
        error:
          'Native CRYLO balance is too low to submit the gas purchase.'
      };
    }

    stage = 'purchase submission';

    const tx = await gm.buyGasWithWcrylo(
      amount,
      { nonce }
    );

    stage = 'purchase confirmation';

    const receipt = await tx.wait();

    return {
      ok: true,
      txHash: tx.hash,
      approvalHash,
      blockNumber: receipt.blockNumber
    };
  } catch (e) {
    return {
      ok: false,
      stage,
      error:
        e?.shortMessage ||
        e?.reason ||
        e?.message ||
        String(e)
    };
  }
});

ipcMain.handle('nexus-transactions', async (_, linkedAddress) => {
  try {
    if (!ethers.isAddress(linkedAddress)) {
      return { ok: false, error: 'Invalid Nexus address' };
    }

    const runtime = await getNexusRuntimeConfig();
    const provider = runtime.provider;
    const contracts = runtime.contracts;
    const user = ethers.getAddress(linkedAddress);

    const latest = await provider.getBlockNumber();
    const fromBlock = Math.max(0, latest - 50000);

    const wcrylo = contracts.wCryLo;
    const gasManager = contracts.GasManager;
    const staking = contracts.Staking;
    const nodeStaking = contracts.NodeStaking;

    const erc20Iface = new ethers.Interface([
      'event Transfer(address indexed from,address indexed to,uint256 value)'
    ]);

    const gasIface = new ethers.Interface([
      'event DailyGasClaimed(address indexed wallet,uint256 amount)',
      'event GasPurchased(address indexed wallet,uint256 wcryloAmount,uint256 nativeGasAmount)',
      'event StarterGasSent(address indexed wallet,uint256 amount)'
    ]);

    const stakingIface = new ethers.Interface([
      'event Staked(address indexed user,uint256 amount)',
      'event Unstaked(address indexed user,uint256 amount)',
      'event RewardsClaimed(address indexed user,uint256 amount)',
      'event OperatorRegistered(address indexed user)',
      'event ValidatorRegistered(address indexed user)'
    ]);

    const zeroTopicUser = ethers.zeroPadValue(user, 32);

    const logs = [];

    async function safeLogs(filter, parser, label) {
      try {
        const got = await provider.getLogs(filter);
        for (const log of got) {
          try {
            const parsed = parser.parseLog(log);
            logs.push({ log, parsed, label });
          } catch (_) {}
        }
      } catch (_) {}
    }

    await safeLogs({
      address: wcrylo,
      fromBlock,
      toBlock: latest,
      topics: [erc20Iface.getEvent('Transfer').topicHash, zeroTopicUser]
    }, erc20Iface, 'wCryLo Sent');

    await safeLogs({
      address: wcrylo,
      fromBlock,
      toBlock: latest,
      topics: [erc20Iface.getEvent('Transfer').topicHash, null, zeroTopicUser]
    }, erc20Iface, 'wCryLo Received');

    for (const eventName of ['DailyGasClaimed', 'GasPurchased', 'StarterGasSent']) {
      await safeLogs({
        address: gasManager,
        fromBlock,
        toBlock: latest,
        topics: [gasIface.getEvent(eventName).topicHash, zeroTopicUser]
      }, gasIface, eventName);
    }

    for (const eventName of ['Staked', 'Unstaked', 'RewardsClaimed']) {
      await safeLogs({
        address: staking,
        fromBlock,
        toBlock: latest,
        topics: [stakingIface.getEvent(eventName).topicHash, zeroTopicUser]
      }, stakingIface, eventName);
    }

    for (const eventName of ['OperatorRegistered', 'ValidatorRegistered', 'RewardsClaimed']) {
      await safeLogs({
        address: nodeStaking,
        fromBlock,
        toBlock: latest,
        topics: [stakingIface.getEvent(eventName).topicHash, zeroTopicUser]
      }, stakingIface, eventName);
    }


    const bridge = contracts.BridgeManager;
    const bridgeIface = new ethers.Interface([
      'event MintedFromCryLo(bytes32 indexed depositId,address indexed to,uint256 amount)',
      'event BurnedForCryLo(address indexed from,string cryloAddress,uint256 amount,uint256 indexed nonce)'
    ]);

    await safeLogs({
      address: bridge,
      fromBlock,
      toBlock: latest,
      topics: [bridgeIface.getEvent('MintedFromCryLo').topicHash, null, zeroTopicUser]
    }, bridgeIface, 'Bridge Minted');

    await safeLogs({
      address: bridge,
      fromBlock,
      toBlock: latest,
      topics: [bridgeIface.getEvent('BurnedForCryLo').topicHash, zeroTopicUser]
    }, bridgeIface, 'Bridge Burned');

    const txs = [];

    for (const item of logs) {
      const block = await provider.getBlock(item.log.blockNumber);
      const p = item.parsed;
      let amount = '';

      if (p.name === 'Transfer') {
        amount = formatWcryloUnits(p.args.value) + ' wCryLo';
      } else if (p.name === 'MintedFromCryLo' || p.name === 'BurnedForCryLo') {
        amount = formatWcryloUnits(p.args.amount) + ' wCryLo';
      } else if (p.args.amount != null) {
        amount = formatWcryloUnits(p.args.amount);
        if (p.name.includes('Gas') || p.name === 'StarterGasSent') amount += ' CRYLO';
        else amount += ' wCryLo';
      } else if (p.args.wcryloAmount != null) {
        amount =
          formatWcryloUnits(p.args.wcryloAmount) +
          ' wCryLo → ' +
          formatNexusGasUnits(p.args.nativeGasAmount) +
          ' CRYLO';
      }

      txs.push({
        type: p.name === 'Transfer' ? item.label : p.name,
        hash: item.log.transactionHash,
        blockNumber: item.log.blockNumber,
        timestamp: block?.timestamp || 0,
        amount,
        address: item.log.address
      });
    }

    txs.sort((a, b) => b.blockNumber - a.blockNumber);

    return { ok: true, latest, fromBlock, transactions: txs.slice(0, 100) };
  } catch (e) {
    return { ok: false, error: e.shortMessage || e.reason || e.message };
  }
});
