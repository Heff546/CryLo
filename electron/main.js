'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const http = require('http');
const os = require('os');

// ─── Constants ───────────────────────────────────────────────────────────────
const DAEMON_RPC_PORT   = 19641;
const WALLET_RPC_PORT   = 19740;
const WALLET_DIR_NAME   = 'wallets';
const LOG_DIR_NAME      = 'logs';
const DATA_DIR_NAME     = 'c64chain';

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
function rpcCall(port, method, params = {}) {
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
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function daemonRpc(method, params = {}) {
  return rpcCall(DAEMON_RPC_PORT, method, params);
}

function walletRpc(method, params = {}) {
  return rpcCall(WALLET_RPC_PORT, method, params);
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
  const bin = getBinPath('c64chaind');
  if (!fs.existsSync(bin)) {
    sendStatus('error', `Daemon binary not found: ${bin}`);
    return null;
  }
  const logger = makeLogger('daemon');
  const args = [
    `--rpc-bind-port=${DAEMON_RPC_PORT}`,
    `--data-dir=${getDataDir()}`,
    '--non-interactive',
    '--log-level=1',
    '--no-zmq'
  ];
  logger.write(`Spawning daemon: ${bin} ${args.join(' ')}\n`);
  const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, C64_NO_TUI: '1' } });
  proc.stdout.on('data', (d) => logger.write(d.toString()));
  proc.stderr.on('data', (d) => logger.write(d.toString()));
  proc.on('exit', (code) => {
    logger.write(`Daemon exited with code ${code}\n`);
    if (!shuttingDown && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('daemon-exit', code);
    }
  });
  return proc;
}

function spawnWalletRpc() {
  const bin = getBinPath('c64chain-wallet-rpc');
  if (!fs.existsSync(bin)) {
    sendStatus('error', `Wallet-RPC binary not found: ${bin}`);
    return null;
  }
  const logger = makeLogger('wallet-rpc');
  const args = [
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
    sendStatus('starting', 'Starting C64 Chain daemon...');
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
ipcMain.handle('wallet-rpc', async (_, method, params) => {
  try { return { ok: true,  result: await walletRpc(method, params) }; }
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
function spawnMiner(opts) {
  const bin = getBinPath('c64miner');
  if (!fs.existsSync(bin)) throw new Error('Miner binary not found: ' + bin);
  const logger = makeLogger('miner');
  const user = opts.walletAddress + '.' + (opts.workerName || 'desktop');
  const args = [
    '--algo=rx/c64',
    '--coin=c64chain',
    '--url=' + opts.poolUrl,
    '--user=' + user,
    '--pass=x',
    '--threads=' + (opts.threads || 2),
    '--no-color',
    '--print-time=5'
  ];
  logger.write('Spawning miner: ' + bin + ' ' + args.join(' ') + '\n');
  minerStats = { hashrate: 0, sharesAccepted: 0, sharesRejected: 0, running: true };
  const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', (d) => {
    const txt = d.toString();
    logger.write(txt);
    // speed 10s/60s/15m 10041.3 10074.1 n/a H/s
    const hrMatch = txt.match(/speed\s+10s\/60s\/15m\s+(\d+\.?\d*)/i);
    if (hrMatch) minerStats.hashrate = parseFloat(hrMatch[1]);
    // accepted (8/0)
    const accMatch = txt.match(/accepted\s+\((\d+)\/(\d+)\)/i);
    if (accMatch) {
      minerStats.sharesAccepted = parseInt(accMatch[1]);
      minerStats.sharesRejected = parseInt(accMatch[2]);
    }
  });
  proc.stderr.on('data', (d) => logger.write(d.toString()));
  proc.on('exit', (code) => {
    logger.write('Miner exited with code ' + code + '\n');
    minerStats.running = false;
    minerProc = null;
  });
  return proc;
}

// Miner IPC
ipcMain.handle('miner-get-info', async () => {
  return {
    ok: true,
    cpuCount: os.cpus().length,
    totalMemMB: Math.floor(os.totalmem() / 1024 / 1024)
  };
});

ipcMain.handle('miner-start', async (_, opts) => {
  try {
    if (minerProc) { try { minerProc.kill(); } catch(_) {} minerProc = null; }
    minerProc = spawnMiner(opts);
    return { ok: true };
  } catch(e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('miner-stop', async () => {
  try {
    if (minerProc) { await killProc(minerProc, 'miner'); minerProc = null; }
    minerStats.running = false;
    return { ok: true };
  } catch(e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('miner-get-status', async () => {
  return { ok: true, ...minerStats };
});

// ─── Window ───────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 850,
    minWidth: 900,
    minHeight: 700,
    backgroundColor: '#0d0d1a',
    title: 'C64 Chain Wallet',
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
      label: 'C64 Chain Wallet',
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
