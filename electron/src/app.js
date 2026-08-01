'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────
const CRYLO_DECIMALS = 11;
const wCryLo_DECIMALS = 11;
const COIN = 100000000000; // 10^11 atomic units = 1 CryLo/wCryLo

// Nexus action estimates are client-side UX values.
// Economic policy is read live from GasManager.
const NEXUS_GAS_ESTIMATES = Object.freeze({
  // Everyday Nexus activity
  bridgeRelease: 0.006,
  nftPurchase: 0.006,
  staking: 0.006,
  unstaking: 0.006,
  claimStakingRewards: 0.006,
  standardAction: 0.006,

  // All node administration
  nodeRegistration: 0.015,
  nodeDeregistration: 0.015,
  claimNodeRewards: 0.015,
  nodeAction: 0.015,

  // NFT lifecycle
  nftBuyback: 0.050,
  nftBurn: 0.001,

  defaultAction: 0.006
});

const NEXUS_GAS_PURCHASE_MIN_WCRYLO = 0.5;

//  CryLo vesting tier unlock delays (in blocks, relative to coinbase height)
const VESTING_TIERS = [
  { tier: 1, delay: 0,     label: 'Instant Miner', cls: 't1' },
  { tier: 2, delay: 18514, label: '45-Day Vested', cls: 't2' }
];

// ─── App state ────────────────────────────────────────────────────────────────
const State = {
  ready: false,
  walletOpen: false,
  walletName: '',
  currentHeight: 0,
  activeTab: 'transactions',
  refreshTimer: null,
  blockPoller: null,
  address: '',
  unlockedBalance: 0,
  miningActive: false,
  miningStatusTimer: null,
  miningStartHeight: null,
  gasPolicy: null
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDecimalAmount(value, places = 4) {
  const n = Number(value);
  if (!Number.isFinite(n)) return (0).toFixed(places);
  return n.toFixed(places);
}

function decimalToAtomic(amountText, decimals, unitName) {
  const raw = String(amountText || '').trim();
  if (!raw || Number(raw) <= 0) throw new Error(`Enter a valid ${unitName} amount.`);
  if (!/^\d+(?:\.\d+)?$/.test(raw)) throw new Error(`Invalid ${unitName} amount.`);

  const [whole, fracRaw = ''] = raw.split('.');
  if (fracRaw.length > decimals) {
    throw new Error(`${unitName} supports at most ${decimals} decimal places.`);
  }

  const frac = fracRaw.padEnd(decimals, '0');
  return (BigInt(whole) * (10n ** BigInt(decimals)) + BigInt(frac || '0')).toString();
}

function fmt(atomic) {
  // Format atomic units →  CryLo string with 4 decimal places
  if (atomic == null || isNaN(atomic)) return '0.0000';
  const val = Number(atomic) / COIN;
  return val.toFixed(4);
}

function fmtFull(atomic) {
  if (atomic == null || isNaN(atomic)) return '0.000000000000';
  return (Number(atomic) / COIN).toFixed(12);
}

function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString();
}

function shortTxid(txid) {
  if (!txid) return '—';
  return txid.slice(0, 8) + '...' + txid.slice(-8);
}

function el(id) { return document.getElementById(id); }

// ─── Toast ────────────────────────────────────────────────────────────────────
function toast(message, type = 'info', ms = 4000) {
  const container = el('toast-container');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = message;
  container.appendChild(t);
  setTimeout(() => { t.remove(); }, ms);
}

// ─── Startup ──────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  setupPasswordEnterSubmit();
  // Listen for startup status from main process
  window.crylo.onStartupStatus(({ state, message }) => {
    el('splash-msg').textContent = message;

    if (state === 'ready') {
      State.ready = true;
      // Small delay so the "ready" message is visible briefly
      setTimeout(showSetupOrMain, 600);
    } else if (state === 'error') {
      el('splash-error').textContent = message;
      el('splash-error').classList.remove('hidden');
      el('splash-progress').style.animation = 'none';
      el('splash-progress').style.background = 'var(--danger)';
      el('splash-progress').style.width = '100%';
    }
  });

  // Daemon/wallet-rpc crash notifications
  window.crylo.onDaemonExit((code) => {
    if (code !== 0 && code !== null) {
      toast(`Daemon process exited (code ${code}). Please restart the app.`, 'error', 0);
    }
  });

  window.crylo.onWalletRpcExit((code) => {
    if (code !== 0 && code !== null) {
      toast(`Wallet RPC exited (code ${code}). Please restart the app.`, 'error', 0);
    }
  });
});

async function showSetupOrMain() {
  // Check if any wallets already exist
  const res = await window.crylo.listWallets();
  const wallets = res.ok ? res.wallets : [];

  hideSplash();
  if (wallets.length > 0) {
    showSetup(); // Show setup but with populated open list
  } else {
    showSetup();
  }
}

function hideSplash() {
  el('splash').classList.add('hidden');
}

function showSetup() {
  el('setup-screen').classList.remove('hidden');
  el('main-screen').classList.add('hidden');
  // Reset to cards view
  backToSetupCards();
  // Pre-load wallet list for the open form
  loadWalletList();
}

// ─── Setup screen ─────────────────────────────────────────────────────────────
function backToSetupCards() {
  el('setup-cards').classList.remove('hidden');
  ['form-create', 'form-open', 'form-restore'].forEach(id => {
    el(id).classList.add('hidden');
  });
}

function showSetupForm(type) {
  el('setup-cards').classList.add('hidden');
  ['form-create', 'form-open', 'form-restore'].forEach(id => {
    el(id).classList.add('hidden');
  });
  el(`form-${type}`).classList.remove('hidden');

  if (type === 'create') {
    el('create-seed-section').classList.add('hidden');
    el('create-btn').classList.remove('hidden');
    el('create-continue-btn').classList.add('hidden');
  }
}

async function loadWalletList() {
  const res = await window.crylo.listWallets();
  const sel = el('open-select');
  sel.innerHTML = '';
  if (!res.ok || res.wallets.length === 0) {
    sel.innerHTML = '<option value="">No wallets found</option>';
    if (openBtn) openBtn.disabled = false;
    if (openLoading) openLoading.classList.add('hidden');
    return;
  }
  res.wallets.forEach(w => {
    const opt = document.createElement('option');
    opt.value = w;
    opt.textContent = w;
    sel.appendChild(opt);
  });
}



// ─── Password field UX helpers ───────────────────────────────────────────────
function markPasswordInvalid(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;

  input.style.border = '2px solid #ff4d4d';
  input.style.boxShadow = '0 0 0 2px rgba(255, 77, 77, 0.25)';
  input.focus();
}

function clearPasswordInvalid(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;

  input.style.border = '';
  input.style.boxShadow = '';
}

function setupPasswordEnterSubmit() {
  ['create-pass', 'create-pass2', 'open-pass', 'restore-pass'].forEach((id) => {
    const input = document.getElementById(id);
    if (!input) return;

    input.addEventListener('input', () => clearPasswordInvalid(id));

    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();

      if (id === 'create-pass' || id === 'create-pass2') {
        createWallet();
      } else if (id === 'open-pass') {
        openWallet();
      } else if (id === 'restore-pass') {
        restoreWallet();
      }
    });
  });
}

async function createWallet() {
  const name = el('create-name').value.trim();
  const pass  = el('create-pass').value;
  const pass2 = el('create-pass2').value;

  if (!name)           return toast('Please enter a wallet name.', 'error');
  if (!/^[a-zA-Z0-9_\-]+$/.test(name))
                       return toast('Name: use only letters, numbers, - or _', 'error');
  if (pass !== pass2)  return toast('Passwords do not match.', 'error');

  el('create-btn').disabled = true;
  el('create-btn').textContent = 'Creating...';

  // Close any currently open wallet first (ignore error if none open)
  await window.crylo.walletRpc('close_wallet', { autosave_current: false }).catch(() => {});

  const res = await window.crylo.walletRpc('create_wallet', {
    filename: name,
    password: pass,
    language: 'English'
  }, 60000);

  if (!res.ok) {
    el('create-btn').disabled = false;
    el('create-btn').textContent = 'Create Wallet';
    return toast(`Failed: ${res.error}`, 'error');
  }
  // create_wallet already opens the wallet internally - no need to call open_wallet

  // Get mnemonic seed
  const seedRes = await window.crylo.walletRpc('query_key', { key_type: 'mnemonic' });
  const seed = seedRes.ok ? seedRes.result.key : '(could not retrieve seed – open the wallet and use "query_key mnemonic" in CLI)';

  el('create-seed-display').textContent = seed;
  el('create-seed-section').classList.remove('hidden');
  el('create-btn').classList.add('hidden');
  el('create-continue-btn').classList.remove('hidden');

  State.walletName = name;
  State.address = '';
  State.nexusAddress = '';
  clearNexusUiForWalletSwitch();
  await refreshWalletList();
  toast('Wallet created! Save your seed phrase now.', 'success');
}


function setOpenWalletLoading(isLoading) {
  const openBtn = document.getElementById('open-wallet-btn');
  const openLoading = document.getElementById('open-wallet-loading');

  if (openBtn) openBtn.disabled = !!isLoading;
  if (openLoading) {
    openLoading.classList.toggle('hidden', !isLoading);
  }
}


async function openWallet() {
  setOpenWalletLoading(true);
  const name = el('open-select').value;
  const pass = el('open-pass').value;
  if (!pass) { setOpenWalletLoading(false); markPasswordInvalid('open-pass'); return; }

  if (!name) { setOpenWalletLoading(false); return toast('Please select a wallet.', 'error'); }

  // Close any currently open wallet first (ignore error if none open)
  await window.crylo.walletRpc('close_wallet', { autosave_current: false }).catch(() => {});

  const res = await window.crylo.walletRpc('open_wallet', {
    filename: name,
    password: pass
  }, 30000);

  if (!res.ok) { setOpenWalletLoading(false); markPasswordInvalid('open-pass'); return; }

  State.walletName = name;
  State.address = '';
  State.nexusAddress = '';
  clearNexusUiForWalletSwitch();
  State.address = '';
  openMainScreen();
}

async function restoreWallet() {
  const name   = el('restore-name').value.trim();
  const seed   = el('restore-seed').value.trim();
  const height = parseInt(el('restore-height').value, 10) || 0;
  const pass   = el('restore-pass').value;

  if (!name) return toast('Please enter a wallet name.', 'error');
  if (!seed) return toast('Please enter your seed phrase.', 'error');
  if (seed.split(/\s+/).length !== 25) return toast('Seed must be exactly 25 words.', 'error');

  const res = await window.crylo.walletRpc('restore_deterministic_wallet', {
    filename: name,
    seed: seed,
    password: pass,
    restore_height: height,
    language: 'English',
    autosave_current: true
  }, 60000);

  if (!res.ok) return toast(`Failed: ${res.error}`, 'error');

  State.walletName = name;
  State.address = '';
  State.nexusAddress = '';
  clearNexusUiForWalletSwitch();
  await refreshWalletList();
  toast('Wallet restored successfully!', 'success');
  openMainScreen();
}

// ─── Main screen ──────────────────────────────────────────────────────────────
function openMainScreen() {
  const setupScreen = el('setup-screen');
  const mainScreen = el('main-screen');

  /*
   * Wallet switching may set inline display values while
   * navigating to the login form. Always clear those values
   * when opening the active wallet screen again.
   */
  if (setupScreen) {
    setupScreen.classList.add('hidden');
    setupScreen.style.display = 'none';
  }

  if (mainScreen) {
    mainScreen.classList.remove('hidden');
    mainScreen.style.display = '';
  }

  el('topbar-wallet-name').textContent = State.walletName;

  // Initial data load - poll a few times to let wallet finish scanning
  let initAttempts = 0;
  async function initialLoad() {
    await refreshAll();
    initAttempts++;
    if (initAttempts < 5) setTimeout(initialLoad, 2000);
  }
  initialLoad();

  // Auto-refresh every 30s
  if (State.refreshTimer) clearInterval(State.refreshTimer);
  State.refreshTimer = setInterval(refreshAll, 30000);

  // Refresh on new block - poll daemon height every 10s
  if (State.blockPoller) clearInterval(State.blockPoller);
  State.blockPoller = setInterval(async () => {
    const res = await window.crylo.daemonRpc('get_info');
    if (!res.ok) return;
    const newHeight = res.result.height || 0;
    if (newHeight > State.currentHeight) {
      State.currentHeight = newHeight;
      await refreshAll();
    }
  }, 10000);
}

let nexusRefreshPromise = null;

async function refreshNexusDashboard() {
  // Prevent the timer, button, and transaction handlers from launching
  // overlapping Nexus refreshes.
  if (nexusRefreshPromise) {
    return nexusRefreshPromise;
  }

  nexusRefreshPromise = (async () => {
    const refreshTasks = [
      ['native CRYLO gas', refreshNexusGasStatus],
      ['wCryLo balance', refreshNexusWcryloBalance],
      ['staked balance', refreshNexusStakedBalance],
      ['pending rewards', refreshNexusPendingRewards],
      ['node status', refreshNexusNodeStatus]
    ];

    if (document.getElementById('nexus-tx-list')) {
      refreshTasks.push(['Nexus transactions', loadNexusTransactions]);
    }

    if (
      document.getElementById('nexus-nft-list') &&
      getLinkedNexusAddress()
    ) {
      refreshTasks.push(['Nexus NFTs and buyback', loadNexusBuyback]);
    }

    const results = await Promise.allSettled(
      refreshTasks.map(([, refreshFn]) => refreshFn())
    );

    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.error(
          `Nexus refresh failed for ${refreshTasks[index][0]}:`,
          result.reason
        );
      }
    });

    return {
      ok: results.every(result => result.status === 'fulfilled'),
      results
    };
  })();

  try {
    return await nexusRefreshPromise;
  } finally {
    nexusRefreshPromise = null;
  }
}

function scheduleNexusDashboardRefresh(delayMs = 5000) {
  setTimeout(() => {
    refreshNexusDashboard().catch(err => {
      console.error('Delayed Nexus dashboard refresh failed:', err);
    });
  }, delayMs);
}

async function refreshAll() {
  await Promise.allSettled([
    updateSyncStatus(),
    updateBalance(),
    refreshNexusDashboard(),
    refreshActiveTab()
  ]);
}

async function refreshActiveTab() {
  if (State.activeTab === 'transactions') await loadTransactions();
  else if (State.activeTab === 'vesting')  await loadVesting();
  else if (State.activeTab === 'receive')  await loadAddress();
}

// ─── Sync status ──────────────────────────────────────────────────────────────
async function updateSyncStatus() {
  const res = await window.crylo.daemonRpc('get_info');
  if (!res.ok) {
    el('sync-dot').className = 'sync-dot offline';
    el('sync-label').textContent = 'Daemon offline';
    return;
  }
  const info = res.result;
  State.currentHeight = info.height || 0;

  el('sb-height').textContent = (info.height || 0).toLocaleString();
  el('sb-peers').textContent  = (info.outgoing_connections_count || 0) + '/' + (info.incoming_connections_count || 0);

  // NetHR based on the last 10 blocks
  if (info.height > 10) {
    try {
      const rangeRes = await window.crylo.daemonRpc('get_block_headers_range', {
        start_height: info.height - 11,
        end_height:   info.height - 1
      });
      if (rangeRes.ok && rangeRes.result.headers && rangeRes.result.headers.length >= 2) {
        const headers = rangeRes.result.headers;
        const newest  = headers[headers.length - 1];
        const oldest  = headers[0];
        const avgTime = (newest.timestamp - oldest.timestamp) / (headers.length - 1);
        if (avgTime > 0) {
          const hr = newest.difficulty / avgTime;
          el('sb-nethr').textContent = fmtHashrate(hr);
        }
      }
    } catch (_) {
      // fallback: difficulty / target
      if (info.difficulty) {
        el('sb-nethr').textContent = fmtHashrate(info.difficulty / 210);
      }
    }
  } else if (info.difficulty) {
    el('sb-nethr').textContent = fmtHashrate(info.difficulty / 210);
  }

    const height = info.height || 0;
    const target = info.target_height || 0;

    el('sync-dot').className = 'sync-dot synced';

    if (target > height) {
      const netPct = Math.floor((height / target) * 100);

      el('sync-label').textContent =
        `Wallet Synced 100% · ${height.toLocaleString()} blocks`;
    } else {
      el('sync-label').textContent =
        `Wallet Synced · ${height.toLocaleString()} blocks`;
    }
}

function fmtHashrate(hr) {
  if (hr >= 1e9)  return (hr / 1e9).toFixed(2)  + ' GH/s';
  if (hr >= 1e6)  return (hr / 1e6).toFixed(2)  + ' MH/s';
  if (hr >= 1e3)  return (hr / 1e3).toFixed(2)  + ' KH/s';
  return hr.toFixed(0) + ' H/s';
}

function fmtDuration(seconds) {
  seconds = Math.max(0, Number(seconds) || 0);

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${Math.floor(seconds)}s`;
}


async function getMinedSplitBalances() {
  const res = await window.crylo.walletRpc('get_transfers', { in: true });
  const r = res.result?.result || res.result || {};
  const txs = r.in || [];

  let instant = 0;
  let vested = 0;

  for (const tx of txs) {
    if (tx.type !== 'block') continue;

    const amounts = Array.isArray(tx.amounts) ? tx.amounts.map(Number) : [];
    if (amounts.length >= 2) {
      instant += amounts[0];
      vested += amounts[1];
    } else {
      const amount = Number(tx.amount || 0);
      const half = Math.floor(amount / 2);
      instant += half;
      vested += amount - half;
    }
  }

  return {
    found: (instant + vested) > 0,
    total: instant + vested,
    unlocked: instant,
    locked: vested
  };
}

// ─── Balance ──────────────────────────────────────────────────────────────────
async function updateBalance() {
  const res = await window.crylo.walletRpc('get_balance', { account_index: 0 });


  if (!res.ok) return;

  const r = res.result?.result || res.result || {};

  let total = Number(r.balance || 0);
  let unlocked = Number(r.unlocked_balance || 0);
  let locked = Math.max(0, total - unlocked);

  el('bal-total').innerHTML =
    `${fmt(total)}<span class="balance-unit"> CryLo</span>`;

  el('bal-unlocked').innerHTML =
    `${fmt(unlocked)}<span class="balance-unit"> CryLo</span>`;

  el('bal-locked').innerHTML =
    `${fmt(locked)}<span class="balance-unit"> CryLo</span>`;

  const maxSendLabel = el('send-max-label');
  const lockedInfo = el('send-locked-info');

  if (maxSendLabel)
    maxSendLabel.textContent = `Available: ${fmt(unlocked)} CryLo`;

  if (lockedInfo) {
    if (locked > 0) {
      const btu = r.blocks_to_unlock || 0;

      if (btu > 0 && btu <= 4) {
        lockedInfo.textContent =
          `⏳ ${fmt(locked)} CryLo locked — waiting confirmations (~${btu} blocks)`;
      } else if (btu > 4) {
        lockedInfo.textContent =
          `🔒 ${fmt(locked)} CryLo in vesting (${btu} blocks remaining)`;
      } else {
        lockedInfo.textContent =
          `🔒 ${fmt(locked)} CryLo locked`;
      }

      lockedInfo.classList.remove('hidden');
    } else {
      lockedInfo.classList.add('hidden');
    }
  }

  State.unlockedBalance = unlocked;
}

// ─── Address ──────────────────────────────────────────────────────────────────
async function loadAddress() {
  const res = await window.crylo.walletRpc('get_address', { account_index: 0 });
  if (!res.ok || !res.result || !res.result.address) return;

  const newAddress = res.result.address;
  const changed = State.address !== newAddress;

  State.address = newAddress;
  el('receive-address').textContent = State.address;

  if (changed) {
    clearNexusUiForWalletSwitch();
  }

  await loadSavedNexusLinkedAddress();
  await refreshNexusDashboard();
}

function copyAddress() {
  if (!State.address) return;
  navigator.clipboard.writeText(State.address).then(() => {
    toast('Address copied!', 'success', 2000);
  });
}

function copyPaymentRequest() {
  const amount = el('req-amount').value;
  if (!State.address) return toast('Address not loaded.', 'error');
  const req = amount
    ? `crylo:${State.address}?tx_amount=${amount}`
    : State.address;
  navigator.clipboard.writeText(req).then(() => {
    toast('Payment request copied!', 'success', 2000);
  });
}

// ─── Transactions ─────────────────────────────────────────────────────────────
async function loadTransactions() {
  const container = el('tx-list-container');
  container.innerHTML = '<div class="loading-row"><div class="spinner"></div> Loading transactions...</div>';

  const res = await window.crylo.walletRpc('get_transfers', {
    in: true,
    out: true,
    pending: true,
    failed: false,
    pool: true,
    coinbase: true
  });

  if (!res.ok) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div>${res.error}</div>`;
    return;
  }

  // Merge all transfer arrays
  // r.pending = outgoing unconfirmed (sent but not yet in a block)
  // r.pool    = incoming unconfirmed
  // r.out     = outgoing confirmed
  // r.in      = incoming confirmed
  const r = res.result;
  let txs = [
    ...(r.in      || []),
    ...(r.out     || []),
    ...(r.pool    || []),
    ...(r.pending || [])
  ];

  if (txs.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div>No transactions yet</div>`;
    return;
  }

  // Sort: pending (height=0) first, then by height desc
  txs.sort((a, b) => {
    const ha = a.height || 0;
    const hb = b.height || 0;
    if (ha === 0 && hb !== 0) return -1;
    if (hb === 0 && ha !== 0) return 1;
    return hb - ha;
  });

  // Detect change: outgoing TX txids
  const outTxids = new Set(txs.filter(t => t.type === 'out').map(t => t.txid));

  const list = document.createElement('div');
  list.className = 'tx-list';

  txs.forEach(tx => {
    const isMined   = tx.type === 'block';
    const isOut     = tx.type === 'out' || tx.type === 'pending';
    const isPending = !tx.height || tx.height === 0;
    // Change = incoming TX with same txid as an outgoing TX
    const isChange  = tx.type === 'in' && outTxids.has(tx.txid);

    const icon   = isMined ? '⛏' : (isOut ? '↑' : (isChange ? '↩' : '↓'));
    const cls    = isMined ? 'block' : (isOut ? 'out' : 'in');
    const amtCls = isMined ? 'mined' : (isOut ? 'negative' : 'positive');
    const amtSign = isOut ? '-' : '+';

    const isLocked = tx.locked || false;

    let statusBadge = '';
    if (isPending && !isMined) {
      statusBadge = '<div class="tx-locked-badge" style="background:rgba(110,69,226,0.2);color:#a78bfa">⏳ Pending</div>';
    } else if (isChange) {
      statusBadge = '<div class="tx-locked-badge" style="background:rgba(79,195,247,0.1);color:#4fc3f7">↩ Change</div>';
    } else if (isLocked) {
      statusBadge = '<div class="tx-locked-badge">🔒 locked</div>';
    }

    const item = document.createElement('div');
    item.className = 'tx-item';
    item.innerHTML = `
      <div class="tx-type-badge ${cls}">${icon}</div>
      <div class="tx-info">
        <div class="tx-txid">${tx.txid || '(pending)'}</div>
        <div class="tx-meta">
          ${isPending ? '<span style="color:var(--accent)">⏳ Unconfirmed</span>' : `Block ${(tx.height||0).toLocaleString()}`} · 
          ${fmtDate(tx.timestamp)}
          ${tx.confirmations != null && !isPending ? ` · ${tx.confirmations} conf` : ''}
        </div>
      </div>
      ${statusBadge}
      <div class="tx-amount ${amtCls}">${amtSign}${fmt(tx.amount)}  CryLo</div>
    `;
    item.title = `TXID: ${tx.txid}\nAmount: ${fmtFull(tx.amount)}  CryLo\nUnlock: ${tx.unlock_time || 0}`;
    list.appendChild(item);
  });

  container.innerHTML = '';
  container.appendChild(list);
}

// ─── Send ─────────────────────────────────────────────────────────────────────
async function sendTx() {
  const addr       = el('send-addr').value.trim();
  const amountText = el('send-amount').value.trim();
  const pid        = el('send-pid').value.trim();
  const note       = el('send-note').value.trim();
  let amountAtomic;

  if (!addr) return toast('Please enter a recipient address.', 'error');

  try {
    amountAtomic = cryloToAtomic(amountText);
  } catch (err) {
    return toast(err.message || 'Please enter a valid amount.', 'error');
  }

  const confirmed = await window.crylo.confirm({
    title: 'Confirm Send',
    message: `Send ${amountText}  CryLo to:\n${addr}\n\nThis cannot be undone.`,
    buttons: ['Send', 'Cancel']
  });
  if (!confirmed) return;

  el('send-btn').disabled = true;
  el('send-btn').textContent = 'Sending...';

  const destinations = [{ amount: Number(amountAtomic), address: addr }];
  const params = { destinations, account_index: 0 };
  if (pid) params.payment_id = pid;
  if (note) params.tx_extra = note;

  const res = await window.crylo.walletRpc('transfer', params);

  el('send-btn').disabled = false;
  el('send-btn').textContent = 'Send →';

  if (!res.ok) return toast(`Send failed: ${res.error}`, 'error');

  toast(`Sent! TXID: ${res.result.tx_hash.slice(0, 16)}...`, 'success', 6000);
  // Clear fields
  el('send-addr').value   = '';
  el('send-amount').value = '';
  el('send-pid').value    = '';
  el('send-note').value   = '';
  // Refresh balance
  setTimeout(updateBalance, 3000);
}


// ─── Consolidate UTXOs ───────────────────────────────────────────────────────
async function consolidateUtxos() {
  // Get own address
  const addrRes = await window.crylo.walletRpc('get_address', { account_index: 0 });
  if (!addrRes.ok) return toast('Failed to get wallet address: ' + addrRes.error, 'error');
  const myAddress = addrRes.result.address;

  const confirmed = await window.crylo.confirm({
    type: 'question',
    title: 'Consolidate UTXOs',
    message: 'This will merge all your small inputs (UTXOs) into one large output by sending your entire balance to yourself.\n\nThis is needed when you have many small mining rewards and want to send large amounts.\n\nA small network fee will be deducted.\n\nProceed?',
    buttons: ['Consolidate', 'Cancel']
  });
  if (!confirmed) return;

  el('consolidate-btn').disabled = true;
  el('consolidate-btn').textContent = '🔄 Consolidating...';
  el('consolidate-info').style.display = 'block';
  el('consolidate-info').textContent = 'Sweeping all outputs to your address...';

  try {
    const res = await window.crylo.walletRpc('sweep_all', {
      address: myAddress,
      account_index: 0
    }, 300000);  // 5 min timeout for large UTXO sets

    if (!res.ok) {
      toast('Consolidation failed: ' + res.error, 'error');
      el('consolidate-info').textContent = 'Failed: ' + res.error;
    } else {
      const txList = res.result.tx_hash_list || [];
      const txCount = txList.length || 1;
      toast('Consolidation sent! ' + txCount + ' transaction(s). Tracking confirmations...', 'success', 8000);
      el('consolidate-info').textContent = txCount + ' tx sent. Waiting for 4 block confirmations (0/4)...';
      setTimeout(updateBalance, 5000);

      // Track confirmation status
      if (txList.length > 0) {
        const txid = txList[0];
        const confirmInterval = setInterval(async () => {
          try {
            const txRes = await window.crylo.walletRpc('get_transfer_by_txid', { txid: txid });
            if (txRes.ok && txRes.result && txRes.result.transfer) {
              const conf = txRes.result.transfer.confirmations || 0;
              if (conf >= 4) {
                clearInterval(confirmInterval);
                el('consolidate-info').textContent = '✅ Consolidation confirmed! (' + conf + ' blocks)';
                el('consolidate-info').style.color = 'var(--success)';
                setTimeout(() => { el('consolidate-info').style.display = 'none'; }, 10000);
                updateBalance();
              } else {
                el('consolidate-info').textContent = 'Confirming: ' + conf + '/4 blocks...';
              }
            }
          } catch (e) { /* ignore polling errors */ }
        }, 30000); // check every 30s
      }
    }
  } catch (e) {
    toast('Consolidation error: ' + e.message, 'error');
    el('consolidate-info').textContent = 'Error: ' + e.message;
  }

  el('consolidate-btn').disabled = false;
  el('consolidate-btn').textContent = '🔄 Consolidate UTXOs (merge small inputs)';
}

// ─── Vesting ──────────────────────────────────────────────────────────────────
async function loadVesting() {
  const container = el('vesting-table-container');
  container.innerHTML = '<div class="loading-row"><div class="spinner"></div> Loading vesting data...</div>';

  // Fetch all incoming coinbase transfers
  const res = await window.crylo.walletRpc('get_transfers', {
    in: true,
    out: false,
    pending: false,
    failed: false,
    pool: false,
    coinbase: true
  });

  if (!res.ok) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div>${res.error}</div>`;
    return;
  }

  // Filter only coinbase (type === 'block')
  const allIn  = res.result.in || [];
  const mined  = allIn.filter(tx => tx.type === 'block');

  if (mined.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⛏</div>No mined blocks found</div>`;
    // Reset summary
    ['t1','t2'].forEach(t => { el(`vest-${t}`).textContent = '0.0000  CryLo'; });
    return;
  }

  const curH = State.currentHeight;

  // Build per-tier totals and rows
  const tierTotals = [0, 0, 0, 0];
  const rows = [];

    mined.forEach(tx => {
      const blockH = tx.height || 0;

      const instantAmount = Math.floor(tx.amount / 2);
      const vestedAmount = tx.amount - instantAmount;

      const cryloRows = [
        { tier: 1, label: 'Instant Miner',  cls: 't1', amount: instantAmount, delay: 0 },
        { tier: 2, label: '45-Day Vested',  cls: 't2', amount: vestedAmount,  delay: 18514 },
      ];

      cryloRows.forEach((tier, i) => {
        const unlockH = blockH + tier.delay;
        const unlocked = curH >= unlockH;
        const blocksLeft = unlocked ? 0 : unlockH - curH;

        tierTotals[i] += tier.amount;

        rows.push({
          txid:       tx.txid,
          blockH,
          tier:       tier.tier,
          tierLabel:  tier.label,
          tierCls:    tier.cls,
          amount:     tier.amount,
          unlockH,
          unlocked,
          blocksLeft,
          timestamp:  tx.timestamp
        });
      });
    });

  // Update summary.
  // Show real spendable balance for Instant Miner because spent/bridged CRYLO
  // reduces wallet-rpc unlocked_balance even though original mined outputs still
  // appear in historical coinbase rows.
  try {
    const balRes = await window.crylo.walletRpc('get_balance', { account_index: 0 });
    const bal = balRes.result?.result || balRes.result || {};
    const realUnlocked = Number(bal.unlocked_balance || 0);
    const minedTotal = tierTotals[0] + tierTotals[1];
    const realLocked = Math.max(0, minedTotal - realUnlocked);

    el('vest-t1').textContent = fmt(realUnlocked) + '  CryLo';
    el('vest-t2').textContent = fmt(realLocked) + '  CryLo';
  } catch (_) {
    VESTING_TIERS.forEach((t, i) => {
      el(`vest-t${t.tier}`).textContent = fmt(tierTotals[i]) + '  CryLo';
    });
  }

  // Build table
  const wrap = document.createElement('div');
  wrap.className = 'vesting-table-wrap';

  const table = document.createElement('table');
  table.className = 'vesting-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th>Block</th>
        <th>Date</th>
        <th>Category</th>
        <th>Amount</th>
        <th>Unlock Block</th>
        <th>Status</th>
      </tr>
    </thead>
  `;

  const tbody = document.createElement('tbody');

  // Sort: newest block first, then tier
  rows.sort((a, b) => b.blockH - a.blockH || a.tier - b.tier);

  rows.forEach(r => {
    const tr = document.createElement('tr');

    let statusHtml;
    if (r.unlocked) {
      statusHtml = '<span class="status-unlocked">✓ Unlocked</span>';
    } else if (r.blocksLeft < 1000) {
      statusHtml = `<span class="status-locked">🔒 ${r.blocksLeft.toLocaleString()} blocks</span>`;
    } else {
      statusHtml = `<span class="status-wait">⏳ ${r.blocksLeft.toLocaleString()} blocks</span>`;
    }

    tr.innerHTML = `
      <td>${r.blockH.toLocaleString()}</td>
      <td>${fmtDate(r.timestamp)}</td>
      <td><span class="tier-badge ${r.tierCls}">${r.tierLabel}</span></td>
      <td class="text-coin">${fmt(r.amount)}  CryLo</td>
      <td>${r.unlockH.toLocaleString()}</td>
      <td>${statusHtml}</td>
    `;
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  wrap.appendChild(table);
  container.innerHTML = '';
  container.appendChild(wrap);
}

// ─── Tab switching ────────────────────────────────────────────────────────────
function switchTab(tab) {
  State.activeTab = tab;

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `tab-${tab}`);
  });

  // Load data on first switch
  if (tab === 'transactions') loadTransactions();
  if (tab === 'vesting')      loadVesting();
  if (tab === 'receive')      loadAddress();
  if (tab === 'mining')       initMiningTab();
  if (tab === 'nexus') {
    loadSavedNexusLinkedAddress()
      .then(async () => {
        refreshBridgeAddressFields();

        try {
          await refreshNexusDashboard();
        } catch (error) {
          console.error(
            'Nexus tab refresh failed:',
            error
          );
        }
      })
      .catch(error => {
        console.error(
          'Failed to load bound Nexus wallet:',
          error
        );
      });
  }
  if (tab === 'nexusNodes') {
    loadSavedNexusLinkedAddress()
      .then(() =>
        refreshNexusOperatorDashboard()
      )
      .catch(error => {
        console.error(
          'Failed to load Nexus Nodes dashboard:',
          error
        );
      });
  }
  if (tab === 'nexusTx') loadNexusTransactions();
  if (tab === 'nexusNfts') loadSavedNexusLinkedAddress();
}

async function switchWallet() {
  const confirmed = await window.crylo.confirm({
    title: 'Switch Wallet',
    message:
      'Close current wallet and go back to wallet selection?',
    buttons: ['Yes', 'Cancel']
  });

  if (!confirmed) return;

  /*
   * Stop daemon mining before closing the wallet so the daemon
   * cannot continue mining to an address whose wallet session
   * is no longer active.
   */
  try {
    await window.crylo.minerStop();
  } catch (error) {
    console.error(
      'Failed to stop daemon mining before wallet switch:',
      error
    );
  }

  State.miningActive = false;
  State.miningStartHeight = null;

  try {
    await window.crylo.walletRpc(
      'close_wallet',
      { autosave_current: true }
    );
  } catch (error) {
    console.error(
      'Failed to close active wallet:',
      error
    );
  }

  // Stop wallet-specific refresh tasks.
  if (State.refreshTimer) {
    clearInterval(State.refreshTimer);
    State.refreshTimer = null;
  }

  if (State.blockPoller) {
    clearInterval(State.blockPoller);
    State.blockPoller = null;
  }

  if (State.miningStatusTimer) {
    clearInterval(State.miningStatusTimer);
    State.miningStatusTimer = null;
  }

  if (
    typeof nexusPostCreateRefreshTimer !==
      'undefined' &&
    nexusPostCreateRefreshTimer
  ) {
    clearInterval(
      nexusPostCreateRefreshTimer
    );

    nexusPostCreateRefreshTimer = null;
  }

  State.walletName = '';
  State.address = '';
  State.nexusAddress = '';
  State.currentHeight = 0;
  State.unlockedBalance = 0;
  State.lockedBalance = 0;
  State.miningActive = false;

  clearNexusUiForWalletSwitch();
  setOpenWalletLoading(false);
  clearPasswordInvalid('open-pass');

  const passwordInput =
    document.getElementById('open-pass');

  const select =
    document.getElementById('open-select');

  const mainScreen =
    document.getElementById('main-screen');

  const setupScreen =
    document.getElementById('setup-screen');

  const setupCards =
    document.getElementById('setup-cards') ||
    document.querySelector('.setup-cards');

  const openForm =
    document.getElementById('form-open');

  if (passwordInput) {
    passwordInput.value = '';
  }

  if (select) {
    select.value = '';
  }

  /*
   * Navigate before making any asynchronous calls.
   * This guarantees that a failed wallet-list refresh cannot
   * leave the emptied main wallet screen visible.
   */
  if (mainScreen) {
    mainScreen.classList.add('hidden');
    mainScreen.style.display = 'none';
  }

  if (setupScreen) {
    setupScreen.classList.remove('hidden');
    setupScreen.style.display = '';
  }

  document
    .querySelectorAll('.setup-form')
    .forEach(form => {
      form.classList.add('hidden');
      form.style.display = 'none';
    });

  if (setupCards) {
    setupCards.classList.add('hidden');
    setupCards.style.display = 'none';
  }

  if (openForm) {
    openForm.classList.remove('hidden');
    openForm.style.display = '';
  }

  setOpenWalletLoading(false);

  /*
   * Refreshing the chooser must not block navigation.
   */
  try {
    await refreshWalletList();
  } catch (error) {
    console.error(
      'Failed to refresh wallet list:',
      error
    );
  }

  if (passwordInput) {
    passwordInput.focus();
  }
}

// ─── Expose to HTML ───────────────────────────────────────────────────────────
function sendMax() {
  if (!State.unlockedBalance) return;
  const fee = Math.round(0.02 * COIN);
  const maxAmount = Math.max(0, State.unlockedBalance - fee);
  el('send-amount').value = (maxAmount / COIN).toFixed(9);
}

function toggleAdvanced() {
  const fields = el('advanced-fields');
  const btn = el('advanced-toggle');
  if (fields.classList.contains('hidden')) {
    fields.classList.remove('hidden');
    btn.textContent = '⚙ Hide advanced options';
  } else {
    fields.classList.add('hidden');
    btn.textContent = '⚙ Advanced options';
  }
}


// ─── Mining ───────────────────────────────────────────────────────────────────
async function initMiningTab() {

  if (!State.address) {
    await loadAddress();
  }

  const addrField =
    document.getElementById('mining-address');

  if (addrField && State.address) {
    addrField.value = State.address;
  }

  /*
   * The daemon is the source of truth. A previous wallet
   * session may have left stale mining text and statistics
   * visible even though mining was stopped during switching.
   */
  try {
    const daemonMining =
      await window.crylo.minerGetStatus();

    if (daemonMining.ok && daemonMining.running) {
      State.miningActive = true;

      const miningButton =
        document.getElementById('mining-btn');

      const miningStatus =
        document.getElementById('mining-status');

      const miningHashrate =
        document.getElementById('mining-hashrate');

      const miningStats =
        document.getElementById('mining-stats');

      const miningMode =
        document.getElementById('mining-mode');

      if (miningButton) {
        miningButton.textContent =
          '⏹ Stop Mining';

        miningButton.className =
          'btn btn-secondary';
      }

      if (miningStatus) {
        miningStatus.textContent =
          'Mining active';

        miningStatus.style.color =
          'var(--success)';
      }

      if (miningHashrate) {
        miningHashrate.textContent =
          `${daemonMining.hashrate || 0} H/s`;

        miningHashrate.style.display =
          'block';
      }

      if (miningStats) {
        miningStats.style.display =
          'block';
      }

      if (miningMode) {
        miningMode.style.display =
          'block';
      }

      const threadStat =
        document.getElementById(
          'mining-stat-threads'
        );

      if (threadStat) {
        threadStat.textContent =
          daemonMining.threads || 0;
      }
    } else {
      State.miningActive = false;
      State.miningStartHeight = null;

      if (State.miningStatusTimer) {
        clearInterval(
          State.miningStatusTimer
        );

        State.miningStatusTimer = null;
      }

      const miningButton =
        document.getElementById('mining-btn');

      const miningStatus =
        document.getElementById('mining-status');

      const miningHashrate =
        document.getElementById('mining-hashrate');

      const miningStats =
        document.getElementById('mining-stats');

      const miningMode =
        document.getElementById('mining-mode');

      if (miningButton) {
        miningButton.textContent =
          '⛏ Start Mining';

        miningButton.className =
          'btn btn-primary';
      }

      if (miningStatus) {
        miningStatus.textContent =
          'Miner stopped';

        miningStatus.style.color =
          'var(--text-dim)';
      }

      if (miningHashrate) {
        miningHashrate.textContent =
          '0 H/s';

        miningHashrate.style.display =
          'none';
      }

      if (miningStats) {
        miningStats.style.display =
          'none';
      }

      if (miningMode) {
        miningMode.style.display =
          'none';
      }

      const blocksFound =
        document.getElementById(
          'mining-stat-blocks-found'
        );

      if (blocksFound) {
        blocksFound.textContent = '0';
      }
    }
  } catch (error) {
    console.error(
      'Unable to synchronize mining UI:',
      error
    );

    State.miningActive = false;
  }

  try {
    const s = await window.crylo.minerGetInfo();
    const totalMB   = s.totalMemMB || 0;
    const cpus      = s.cpuCount   || 4;
    const maxByMem  = Math.max(1, Math.floor(totalMB / 300));
    const maxThreads = Math.min(cpus, maxByMem);
    const recommended = Math.max(1, Math.floor(maxThreads / 2));

    const slider = document.getElementById('mining-threads');
    if (slider) {
      slider.max   = maxThreads;
      slider.value = recommended;
      document.getElementById('mining-threads-val').textContent = recommended;
    }

    const memInfo = document.getElementById('mining-mem-info');
    if (memInfo) {
      memInfo.textContent =
        totalMB + ' MB RAM — max ' + maxThreads + ' threads';
    }

  } catch (_) {
    const memInfo = document.getElementById('mining-mem-info');
    if (memInfo) {
      memInfo.textContent = 'click to detect';
    }
  }
}

async function toggleMining() {
  if (State.miningActive) {
    await stopMining();
  } else {
    await startMining();
  }
}

async function startMining() {
  const address =
    document.getElementById('mining-address').value.trim();

  const threads =
    parseInt(
      document.getElementById('mining-threads').value
    ) || 2;
  if (!address || address.length < 20) {
    toast('Enter a valid CryLo wallet address', 'error');
    return;
  }
  try {
    const r = await window.crylo.minerStart({
      walletAddress: address,
      threads
    });
    if (!r.ok) throw new Error(r.error);
    State.miningActive = true;
    document.getElementById('mining-btn').textContent = '⏹ Stop Mining';
    document.getElementById('mining-btn').className = 'btn btn-secondary';
    document.getElementById('mining-status').textContent = 'Miner starting...';
    document.getElementById('mining-status').style.color = 'var(--warning)';
    document.getElementById('mining-hashrate').style.display = 'block';
    document.getElementById('mining-stats').style.display = 'block';
    document.getElementById('mining-stat-threads').textContent = threads;
    State.miningStatusTimer = setInterval(async () => {
      try {
        const s = await window.crylo.minerGetStatus();
        if (s.running) {
          document.getElementById('mining-status').textContent = 'Mining active';
          document.getElementById('mining-status').style.color = 'var(--success)';
          document.getElementById('mining-hashrate').textContent = s.hashrate + ' H/s';
	  const info = await window.crylo.daemonRpc('get_info');

	  if (info.ok) {
 	    const height = info.result.height || 0;

  	    document.getElementById('mining-stat-height').textContent =
    	      height.toLocaleString();

  	    document.getElementById('mining-stat-difficulty').textContent =
    	      (info.result.difficulty || 0).toLocaleString();

	    const difficulty = info.result.difficulty || 0;
	    const targetSeconds = 210; // CryLo current block target
	    const networkHashrate = difficulty / targetSeconds;

	    document.getElementById('mining-stat-network-hashrate').textContent =
  	      fmtHashrate(networkHashrate);

	    const minerHashrate = Number(s.hashrate) || 0;

	    if (minerHashrate > 0) {
  	      const expectedSecondsPerBlock =
    		(networkHashrate / minerHashrate) * targetSeconds;

  	      document.getElementById('mining-stat-est-block-time').textContent =
    		fmtDuration(expectedSecondsPerBlock);

	    const blocksPerDay = 86400 / expectedSecondsPerBlock;

	    document.getElementById('mining-stat-blocks-day').textContent =
  	      blocksPerDay.toFixed(4);

	    {
	      const rewardAtomic = Number(s.blockReward || info.result.block_reward || 0);
	      const displayBlockReward = rewardAtomic / COIN;
  	      const dailyRewards = blocksPerDay * displayBlockReward;

  	      document.getElementById('mining-stat-daily-rewards').textContent =
    		dailyRewards.toFixed(4) + ' CryLo';
	    }

	    } else {
  	      document.getElementById('mining-stat-est-block-time').textContent = '—';
  	      document.getElementById('mining-stat-blocks-day').textContent = '—';
  	      document.getElementById('mining-stat-daily-rewards').textContent = '—';
	    }

	    if (State.miningStartHeight === null) {
  	      State.miningStartHeight = height;
	    }

	    const blocksFound = Math.max(0, height - State.miningStartHeight);
	    const blocksFoundEl = document.getElementById('mining-stat-blocks-found');
	    if (blocksFoundEl) {
  	      blocksFoundEl.textContent = blocksFound.toLocaleString();
	    }
	  }

	  {
	    const rewardAtomic = Number(s.blockReward || info.result.block_reward || 0);
	    document.getElementById('mining-stat-reward').textContent =
              fmt(rewardAtomic) + ' CryLo';
	  }

          document.getElementById('mining-mode').style.display = 'block';
        } else {
          stopMining();
        }
      } catch(_) {}
    }, 5000);
  } catch(err) {
    toast('Failed to start miner: ' + err.message, 'error');
  }
}

async function stopMining() {
  if (State.miningStatusTimer) { clearInterval(State.miningStatusTimer); State.miningStatusTimer = null; }
  try { await window.crylo.minerStop(); } catch(_) {}
  State.miningActive = false;
  State.miningStartHeight = null;

  const blocksFoundEl = document.getElementById('mining-stat-blocks-found');
  if (blocksFoundEl) {
    blocksFoundEl.textContent = '0';
  }
  document.getElementById('mining-btn').textContent = '⛏ Start Mining';
  document.getElementById('mining-btn').className = 'btn btn-primary';
  document.getElementById('mining-status').textContent = 'Miner stopped';
  document.getElementById('mining-status').style.color = 'var(--text-dim)';
  document.getElementById('mining-hashrate').style.display = 'none';
  const stats = document.getElementById('mining-stats');
  if (stats) stats.style.display = 'none';
  const mode = document.getElementById('mining-mode');
  if (mode) mode.style.display = 'none';
}
async function loadNexusBuyback() {
  const statusEl = document.getElementById('nexus-status');
  const listEl = document.getElementById('nexus-nft-list');

  const linkedAddress =
    document.getElementById('nexus-linked-address').value.trim();

  if (!linkedAddress) {
    statusEl.textContent = 'No Nexus wallet linked.';
    return;
  }

  statusEl.textContent = 'Scanning CryLo Nexus NFTs...';
  listEl.innerHTML = '';

  try {
    const result = await window.crylo.nexusScanNfts(linkedAddress);

    if (!result.ok) {
      statusEl.textContent = result.error || 'Scan failed.';
      return;
    }

    statusEl.textContent =
      `Found ${result.nfts.length} NFT(s) | Vault: ${result.vaultBalance} wCryLo`;

    let html = '';

    for (const nft of result.nfts) {
      html += `
        <div class="card" style="margin-bottom:12px">
          <div><strong>NFT #${nft.tokenId}</strong></div>
          <div>Mint Code: ${nft.code}</div>
          <div>Eligible: ${nft.eligible ? 'YES' : 'NO'}</div>
          <div>Pool Balance: ${nft.codePool} wCryLo</div>
          <div>Redeemed: ${nft.redeemed}</div>
	  ${nft.eligible
  	    ? `<button class="btn btn-primary nexus-buyback-btn" style="margin-top:10px" data-token-id="${nft.tokenId}">Buy Back NFT</button>`
  	    : `<button class="btn btn-secondary nexus-burn-btn" style="margin-top:10px" data-token-id="${nft.tokenId}">Burn NFT</button>`
	  }
        </div>
      `;
    }

    listEl.innerHTML = html || '<div class="card">No NFTs found.</div>';
    
    document.querySelectorAll('.nexus-buyback-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        buyBackNexusNFT(btn.dataset.tokenId);
      });
    });

    document.querySelectorAll('.nexus-burn-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        burnNexusNFT(btn.dataset.tokenId);
      });
    });

  } catch (err) {
    if (openBtn) openBtn.disabled = false;
    if (openLoading) openLoading.classList.add('hidden');
    console.error(err);
    statusEl.textContent = 'Failed to load Nexus NFTs.';
  }
}

async function ensureCryLoAddressLoaded() {
  if (State.address) return true;

  const addrRes = await window.crylo.walletRpc('get_address', { account_index: 0 });
  if (addrRes.ok && addrRes.result && addrRes.result.address) {
    State.address = addrRes.result.address;
    const receiveEl = document.getElementById('receive-address');
    if (receiveEl) receiveEl.textContent = State.address;
    return true;
  }

  return false;
}

function setNexusUiAddress(addr) {
  State.nexusAddress = addr || '';

  const label =
    document.getElementById('nexus-wallet-label');

  const input =
    document.getElementById('nexus-linked-address');

  const status =
    document.getElementById('nexus-linked-status');

  const createButton =
    document.getElementById('nexus-create-wallet-btn');

  if (label) {
    label.textContent = State.nexusAddress
      ? 'Bound Nexus Wallet'
      : 'Create / Bind Nexus Wallet';
  }

  if (input) {
    input.value = State.nexusAddress;
    input.setAttribute(
      'value',
      State.nexusAddress
    );
  }

  if (createButton) {
    createButton.style.display =
      State.nexusAddress ? 'none' : '';
  }

  if (status) {
    if (State.nexusAddress) {
      status.textContent = '';
      status.style.display = 'none';
    } else {
      status.textContent =
        'No Nexus wallet created for this CryLo wallet yet.';
      status.style.display = '';
    }
  }
}


/*
 * The main process saves a newly bound Nexus wallet immediately and
 * completes Foundation registration/starter-gas onboarding in the
 * background. Refresh the currently open Nexus UI when that work
 * actually finishes instead of relying on timer-based guesses.
 */
if (
  window.crylo &&
  typeof window.crylo.onNexusWalletOnboardingResult === 'function'
) {
  window.crylo.onNexusWalletOnboardingResult(async result => {
    if (
      result?.nexusAddress &&
      State.nexusAddress &&
      String(result.nexusAddress).toLowerCase() !==
        String(State.nexusAddress).toLowerCase()
    ) {
      return;
    }

    if (!result?.ok) {
      console.error(
        'Nexus wallet onboarding result:',
        result?.error || 'Onboarding failed'
      );

      /*
       * A duplicate registration attempt may revert after onboarding
       * has already succeeded. Refresh anyway so on-chain truth is
       * displayed instead of leaving the interface stale.
       */
    }

    try {
      await loadSavedNexusLinkedAddress();

      /*
       * Paint the funded balance through the direct RPC path first.
       * The full dashboard can finish its slower contract queries later.
       */
      await refreshNexusNativeGasBalance();

      if (typeof refreshBridgeAddressFields === 'function') {
        await refreshBridgeAddressFields();
      }

      await refreshNexusDashboard();

      if (typeof loadNexusTransactions === 'function') {
        await loadNexusTransactions();
      }

      /*
       * The onboarding response may arrive before the starter-gas
       * transaction is visible through the Nexus RPC. Keep the
       * lightweight direct-balance watcher running until it observes
       * nativeGas > 0, at which point it stops itself.
       */
      startNexusPostCreateRefresh();
    } catch (error) {
      console.error(
        'Failed to refresh Nexus UI after onboarding:',
        error
      );
    }
  });
}

let nexusPostCreateRefreshTimer = null;
let nexusPostCreateRefreshRunning = false;

function stopNexusPostCreateRefresh() {
  if (nexusPostCreateRefreshTimer) {
    clearInterval(nexusPostCreateRefreshTimer);
    nexusPostCreateRefreshTimer = null;
  }

  nexusPostCreateRefreshRunning = false;
}

function startNexusPostCreateRefresh() {
  stopNexusPostCreateRefresh();

  let attempts = 0;
  const maximumAttempts = 60;

  const refresh = async () => {
    // Prevent overlapping RPC calls when one request takes longer
    // than the two-second polling interval.
    if (nexusPostCreateRefreshRunning) {
      return;
    }

    nexusPostCreateRefreshRunning = true;
    attempts += 1;

    try {
      /*
       * Use the unified Nexus dashboard refresh.
       *
       * Its first task is refreshNexusGasStatus(), which paints the
       * bottom Native Gas scorecard and the header Gas balance from
       * the exact same status response.
       */
      /*
       * Check the native balance directly. Do not wait for the full gas
       * dashboard, which also performs registry, treasury, policy, and
       * epoch queries.
       */
      const balanceResult =
        await refreshNexusNativeGasBalance();

      const nativeGas =
        Number(balanceResult?.nativeGas || 0);

      if (
        Number.isFinite(nativeGas) &&
        nativeGas > 0
      ) {
        stopNexusPostCreateRefresh();

        /*
         * The visible balance is now correct. Refresh the complete
         * dashboard once in the background so registration, starter-gas,
         * activity, vault, and claim information can catch up.
         */
        refreshNexusDashboard().catch(error => {
          console.error(
            'Final Nexus dashboard refresh failed:',
            error
          );
        });

        return;
      }
    } catch (error) {
      console.error(
        'Post-create Nexus gas refresh failed:',
        error
      );
    } finally {
      nexusPostCreateRefreshRunning = false;
    }

    if (attempts >= maximumAttempts) {
      stopNexusPostCreateRefresh();
    }
  };

  // Check immediately, then every two seconds for up to two minutes.
  refresh();

  nexusPostCreateRefreshTimer =
    setInterval(refresh, 2000);
}


async function createBoundNexusWallet() {
  const status = document.getElementById('nexus-linked-status');

  if (!(await ensureCryLoAddressLoaded())) {
    if (status) status.textContent = 'Open a CryLo wallet before creating a Nexus wallet.';
    return;
  }

  const result = await window.crylo.nexusWalletCreate(State.walletName, State.address);

  if (!result.ok) {
    if (status) status.textContent = `Failed to create Nexus wallet: ${result.error}`;
    return;
  }

  // The IPC now returns as soon as the binding file is saved.
  // Paint the address before any Nexus network requests run.
  setNexusUiAddress(result.nexusAddress);

  await new Promise(resolve => {
    requestAnimationFrame(() => {
      requestAnimationFrame(resolve);
    });
  });

  // Reload the persisted binding before making Nexus status calls.
  await loadSavedNexusLinkedAddress();

  /*
   * Perform one unified refresh immediately. This paints the Native
   * Gas scorecard and header Gas balance together from one response.
   */
  const initialDashboardResult =
    await refreshNexusDashboard();

  const initialGasTask =
    initialDashboardResult?.results?.[0];

  const initialGasStatus =
    initialGasTask?.status === 'fulfilled'
      ? initialGasTask.value
      : null;

  const initialNativeGas =
    Number(initialGasStatus?.nativeGas || 0);

  /*
   * Starter gas may still be confirming. Continue unified dashboard
   * refreshes only while the bound wallet has no native gas.
   */
  if (
    !Number.isFinite(initialNativeGas) ||
    initialNativeGas <= 0
  ) {
    startNexusPostCreateRefresh();
  }

  if (typeof loadNexusTransactions === 'function') {
    await loadNexusTransactions();
  }
}

async function loadSavedNexusLinkedAddress() {
  if (!(await ensureCryLoAddressLoaded())) {
    setNexusUiAddress('');
    return;
  }

  const result = await window.crylo.nexusWalletLoad(State.walletName, State.address);

  if (result.ok && result.nexusAddress) {
    setNexusUiAddress(result.nexusAddress);
  } else {
    setNexusUiAddress('');
  }
}

function clearNexusUiForWalletSwitch() {
  State.nexusAddress = '';

  const input = document.getElementById('nexus-linked-address');
  if (input) {
    input.value = '';
    input.setAttribute('value', '');
  }

  const linkedStatus = document.getElementById('nexus-linked-status');
  if (linkedStatus) linkedStatus.textContent = 'No Nexus wallet loaded for this CryLo wallet yet.';

  const nftList = document.getElementById('nexus-nft-list');
  if (nftList) nftList.innerHTML = '';

  const nexusStatus = document.getElementById('nexus-status');
  if (nexusStatus) nexusStatus.textContent = 'Create a Nexus wallet to access staking, NFTs, buybacks, and node features.';

  const w = document.getElementById('nexus-wcrylo-balance');
  if (w) w.textContent = '0.0000 wCryLo';

  const staked = document.getElementById('nexus-staked-balance');
  if (staked) staked.textContent = '0.0000 wCryLo';

  const pending = document.getElementById('nexus-pending-rewards');
  if (pending) pending.textContent = '0.0000 wCryLo';
}

function getLinkedNexusAddress() {
  return State.nexusAddress || '';
}


const BRIDGE_PROGRESS_TRACKS = [
  '○ ─ ○ ─ ○ ─ ○',
  '● ─ ○ ─ ○ ─ ○',
  '● ─ ● ─ ○ ─ ○',
  '● ─ ● ─ ● ─ ○',
  '● ─ ● ─ ● ─ ●'
];

function setBridgeButtonBusy(direction, busy) {
  const buttonId = direction === 'out'
    ? 'bridge-out-submit-btn'
    : 'bridge-submit-btn';

  const button = document.getElementById(buttonId);
  if (!button) return;

  button.disabled = !!busy;

  if (direction === 'out') {
    button.textContent = busy
      ? 'Release in Progress...'
      : 'Burn & Release CryLo';
  } else {
    button.textContent = busy
      ? 'Bridge in Progress...'
      : 'Generate & Send Bridge Deposit';
  }
}

function setBridgeProgress(
  direction,
  step,
  title,
  detail = ''
) {
  const prefix = direction === 'out'
    ? 'bridge-out-progress'
    : 'bridge-progress';

  const container =
    document.getElementById(prefix);

  const track =
    document.getElementById(`${prefix}-track`);

  const titleEl =
    document.getElementById(`${prefix}-title`);

  const detailEl =
    document.getElementById(`${prefix}-detail`);

  if (container) {
    container.style.display = '';
  }

  const safeStep = Math.max(
    0,
    Math.min(4, Number(step) || 0)
  );

  if (track) {
    track.textContent =
      BRIDGE_PROGRESS_TRACKS[safeStep];
  }

  if (titleEl) {
    titleEl.textContent = title || '';
  }

  if (detailEl) {
    detailEl.textContent = detail || '';
  }
}

function setBridgeFailure(direction, error) {
  const message =
    error?.message ||
    String(error || 'Bridge operation failed.');

  setBridgeProgress(
    direction,
    0,
    '❌ Bridge Failed',
    message
  );

  setBridgeButtonBusy(direction, false);
}

function setBridgeComplete(
  direction,
  sourceAmount,
  sourceAsset,
  destinationAsset,
  transactionText = ''
) {
  setBridgeProgress(
    direction,
    4,
    direction === 'out'
      ? '✅ Release Complete'
      : '✅ Bridge Complete',
    `${sourceAmount} ${sourceAsset} → ${sourceAmount} ${destinationAsset}` +
      (transactionText ? ` · ${transactionText}` : '')
  );

  setBridgeButtonBusy(direction, false);
}

function resetBridgeFormAfterMint() {
  const amount =
    document.getElementById('bridge-amount');

  if (amount) {
    amount.value = '';
  }

  setBridgeButtonBusy('in', false);
}




async function refreshBridgeRelatedViews() {
  await refreshAll();
  scheduleNexusDashboardRefresh(5000);
}

function setBridgeOutStatus(msg) {
  const el = document.getElementById('bridge-out-status');
  if (el) el.textContent = `Release status: ${msg}`;
}


let bridgeReleasePollTimer = null;

function pollBridgeReleaseStatus(nexusTxHash) {
  if (!nexusTxHash || nexusTxHash === 'sent') return;

  if (bridgeReleasePollTimer) {
    clearInterval(bridgeReleasePollTimer);
  }

  bridgeReleasePollTimer = setInterval(async () => {
    try {
      const res =
        await window.crylo.bridgeReleaseStatus(
          nexusTxHash
        );

      if (!res.ok) {
        setBridgeOutStatus(
          res.error ||
          'Release status check failed.'
        );

        setBridgeProgress(
          'out',
          3,
          '⏳ Waiting for bridge relayer',
          res.error ||
          'The release remains pending.'
        );

        return;
      }

      const status =
        String(res.status || 'pending')
          .toLowerCase();

      if (status === 'completed') {
        clearInterval(bridgeReleasePollTimer);
        bridgeReleasePollTimer = null;

        const l1Tx =
          res.releaseTxHash ||
          res.cryloTxHash ||
          'released';

        const pendingRaw =
          localStorage.getItem(
            'cryloBridgeReleasePending'
          );

        let pendingAmount = '';

        try {
          pendingAmount =
            JSON.parse(
              pendingRaw || '{}'
            ).amount || '';
        } catch (_) {}

        setBridgeOutStatus(
          `✅ Release completed. CryLo TX: ${l1Tx}`
        );

        setBridgeComplete(
          'out',
          pendingAmount || 'Requested amount',
          'wCryLo',
          'CryLo',
          `CryLo TX: ${l1Tx}`
        );

        localStorage.removeItem(
          'cryloBridgeReleasePending'
        );

        const outInput =
          document.getElementById(
            'bridge-out-amount'
          );

        if (outInput) {
          outInput.value = '';
        }

        setBridgeButtonBusy('out', false);

        await refreshBridgeRelatedViews();

        return;
      }

      if (status === 'failed') {
        clearInterval(bridgeReleasePollTimer);
        bridgeReleasePollTimer = null;

        const message =
          res.error ||
          res.message ||
          'CryLo release failed.';

        setBridgeOutStatus(
          `❌ ${message}`
        );

        setBridgeProgress(
          'out',
          0,
          'Release Failed',
          message
        );

        localStorage.removeItem(
          'cryloBridgeReleasePending'
        );

        setBridgeButtonBusy('out', false);
        return;
      }

      setBridgeButtonBusy('out', true);

      setBridgeOutStatus(
        res.message ||
        (
          status === 'processing'
            ? 'Processing CryLo release...'
            : 'Waiting for bridge relayer...'
        )
      );

      setBridgeProgress(
        'out',
        3,
        status === 'processing'
          ? 'Processing CryLo release'
          : 'Waiting for bridge relayer',
        res.message ||
        'The release remains pending.'
      );
    } catch (e) {
      console.error(
        'Release-status polling failed:',
        e
      );
    }
  }, 5000);
}

async function startCryLoBridgeOut() {
  try {
    setBridgeButtonBusy('out', true);

    setBridgeProgress(
      'out',
      1,
      'Preparing release',
      'Checking the CryLo and Nexus wallets.'
    );

    if (!(await ensureCryLoAddressLoaded())) {
      throw new Error('Open a CryLo wallet first.');
    }

    const nexusAddress = getLinkedNexusAddress();
    if (!nexusAddress) {
      throw new Error('Create/load the bound Nexus wallet first.');
    }

    const amountText = document.getElementById('bridge-out-amount')?.value || '';
    const amount = Number(amountText);

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('Invalid wCryLo amount.');
    }

    setBridgeOutStatus('Checking Nexus gas...');

    setBridgeProgress(
      'out',
      1,
      'Preparing release',
      'Checking available CRYLO gas.'
    );

    const gasCheck = await ensureNexusGasForAction('wCryLo to CRYLO bridge release', NEXUS_GAS_ESTIMATES.bridgeRelease);
    if (!gasCheck.ok) {
      const message = gasCheck.cancelled
        ? 'Release cancelled.'
        : `Release failed: ${gasCheck.error}`;

      setBridgeOutStatus(message);

      if (gasCheck.cancelled) {
        setBridgeProgress(
          'out',
          0,
          'Release Cancelled',
          'No wCryLo was burned.'
        );
        setBridgeButtonBusy('out', false);
      } else {
        setBridgeFailure('out', message);
      }

      return;
    }

    const yes = confirm(
      `Burn ${amountText} wCryLo and release CryLo back to your CryLo wallet?\n\n` +
      `Destination CryLo wallet:\n${State.address}`
    );

    if (!yes) {
      setBridgeOutStatus('Release cancelled.');

      setBridgeProgress(
        'out',
        0,
        'Release Cancelled',
        'No wCryLo was burned.'
      );

      setBridgeButtonBusy('out', false);
      return;
    }

    setBridgeOutStatus('Burning wCryLo on Nexus...');

    setBridgeProgress(
      'out',
      2,
      'Burning wCryLo',
      `${amountText} wCryLo is being burned on Nexus.`
    );

    const result = await window.crylo.nexusBurnForCryLo(amountText, State.walletName, State.address);

    if (!result.ok) {
      throw new Error(result.error || 'Burn failed.');
    }

    setBridgeOutStatus(
      `Burn confirmed. Reserve release is processing. Nexus TX: ${result.txHash}`
    );

    setBridgeProgress(
      'out',
      3,
      'Waiting for bridge relayer',
      `Burn confirmed · Nexus TX: ${result.txHash}`
    );

    localStorage.setItem(
      'cryloBridgeReleasePending',
      JSON.stringify({
        nexusTxHash: result.txHash,
        amount: amountText,
        createdAt: Date.now()
      })
    );

    pollBridgeReleaseStatus(result.txHash);

    await refreshAll();
    scheduleNexusDashboardRefresh(5000);
  } catch (err) {
    console.error(err);

    setBridgeOutStatus(
      err.message || 'Release failed.'
    );

    setBridgeFailure(
      'out',
      err.message || 'Release failed.'
    );
  }
}


function setBridgeStatus(msg) {
  const el = document.getElementById('bridge-status');
  if (el) el.textContent = `Bridge status: ${msg}`;
}

function setBridgeField(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value || '—';
}

function refreshBridgeAddressFields() {
  setBridgeField('bridge-crylo-address', State.address || '—');
  setBridgeField('bridge-nexus-address', getLinkedNexusAddress() || '—');
}

function cryloToAtomic(amountText) {
  return decimalToAtomic(amountText, CRYLO_DECIMALS, 'CRYLO');
}


async function startCryLoBridgeIn() {
  try {
    setBridgeButtonBusy('in', true);

    setBridgeProgress(
      'in',
      1,
      'Preparing bridge',
      'Checking the CryLo and Nexus wallets.'
    );

    setBridgeStatus('checking wallet');

    if (!(await ensureCryLoAddressLoaded())) {
      throw new Error('Open a CryLo wallet first.');
    }

    const nexusAddress = getLinkedNexusAddress();
    if (!nexusAddress) {
      throw new Error('Create/load the bound Nexus wallet first.');
    }

    refreshBridgeAddressFields();

    const amountText = document.getElementById('bridge-amount')?.value || '';
    const totalAmount = Number(amountText);

    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
      throw new Error('Enter a valid bridge amount.');
    }

    if (totalAmount > 150) {
      throw new Error('Bridge limit is currently 150 CryLo per session.');
    }

    const CHUNK_SIZE = 50;
    const chunks = [];
    let remaining = totalAmount;

    while (remaining > 0) {
      const chunk = Math.min(CHUNK_SIZE, remaining);
      chunks.push(Number(chunk.toFixed(11)));
      remaining = Number((remaining - chunk).toFixed(11));
    }

    setBridgeStatus(
      `preparing ${chunks.length} bridge deposit${chunks.length === 1 ? '' : 's'}`
    );

    setBridgeProgress(
      'in',
      1,
      'Preparing bridge',
      `${chunks.length} CryLo deposit${chunks.length === 1 ? '' : 's'} will be created.`
    );

    const sent = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunkAmount = chunks[i];
      const chunkText = String(chunkAmount);
      const amountAtomic = cryloToAtomic(chunkText);

      setBridgeStatus(
        `creating deposit ${i + 1}/${chunks.length} for ${chunkText} CryLo`
      );

      setBridgeProgress(
        'in',
        1,
        'Generating bridge deposit',
        `Deposit ${i + 1} of ${chunks.length} · ${chunkText} CryLo`
      );

      const req = await window.crylo.bridgeRequest({
        nexusAddress,
        cryloAddress: State.address,
        amountAtomic
      });

      if (!req.ok) throw new Error(req.error || `Bridge request ${i + 1} failed.`);

      const bridgePaymentId = req.paymentId || req.payment_id;
      const bridgeSendAddress = req.integratedAddress || req.integrated_address;

      if (!bridgePaymentId || !bridgeSendAddress) {
        throw new Error('Bridge API did not return payment ID and integrated address.');
      }

      if (i === 0) {
        setBridgeField('bridge-payment-id', bridgePaymentId);
        setBridgeField('bridge-integrated-address', bridgeSendAddress);
        setBridgeField('bridge-nexus-tx', '—');
      }

      const transferParams = {
        destinations: [{
          address: bridgeSendAddress,
          amount: Number(amountAtomic)
        }],
        account_index: 0,
        priority: 0,
        unlock_time: 0,
        get_tx_key: true
      };

      setBridgeStatus(
        `sending deposit ${i + 1}/${chunks.length} for ${chunkText} CryLo`
      );

      setBridgeProgress(
        'in',
        2,
        'Sending CryLo',
        `Deposit ${i + 1} of ${chunks.length} is being submitted.`
      );

      let tx = await window.crylo.walletRpc('transfer_split', transferParams, 120000);

      if (!tx.ok) {
        throw new Error(
          (tx.error || '').includes('not enough money')
            ? 'Not enough unlocked CryLo. Try a smaller amount.'
            : (tx.error || `CryLo transfer ${i + 1} failed.`)
        );
      }

      const txHash =
        tx.result?.tx_hash ||
        tx.result?.tx_hash_list?.[0] ||
        tx.result?.result?.tx_hash ||
        tx.result?.result?.tx_hash_list?.[0] ||
        tx.result?.txid ||
        '';

      sent.push({
        paymentId: bridgePaymentId,
        cryloTx: txHash,
        amount: chunkText
      });

      setBridgeField('bridge-crylo-tx', sent.map(x => x.cryloTx || 'sent').join(', '));
    }

    localStorage.setItem('cryloBridgePending', JSON.stringify({
      paymentId: sent[0]?.paymentId,
      paymentIds: sent.map(x => x.paymentId),
      deposits: sent,
      createdAt: Date.now()
    }));

    setBridgeStatus(
      `waiting for CryLo confirmations on ${sent.length} deposit${sent.length === 1 ? '' : 's'}`
    );

    setBridgeProgress(
      'in',
      3,
      'Waiting for confirmations',
      `${sent.length} deposit${sent.length === 1 ? '' : 's'} sent. Confirming and minting wCryLo.`
    );

    pollCryLoBridgeStatus(
      sent[0]?.paymentId
    );
  } catch (e) {
    console.error(e);

    setBridgeStatus(
      e.message || 'Bridge failed.'
    );

    setBridgeFailure(
      'in',
      e.message || 'Bridge failed.'
    );
  }
}

let cryloBridgePollTimer = null;

function pollCryLoBridgeStatus(paymentId) {
  if (cryloBridgePollTimer) clearInterval(cryloBridgePollTimer);

  cryloBridgePollTimer = setInterval(async () => {
    try {
      const res = await window.crylo.bridgeStatus(paymentId);

      if (!res.ok) {
        setBridgeStatus(res.error || 'status check failed');
        return;
      }

      if (res.processed) {
        clearInterval(cryloBridgePollTimer);
        cryloBridgePollTimer = null;

        const mintTx =
          res.processed.nexus_tx_hash ||
          res.processed.nexusTxHash ||
          res.processed.txHash ||
          res.processed.mintTxHash ||
          'processed';

        setBridgeField(
          'bridge-nexus-tx',
          mintTx
        );

        const pendingRaw =
          localStorage.getItem(
            'cryloBridgePending'
          );

        let pendingAmount = '';

        try {
          const pending =
            JSON.parse(pendingRaw || '{}');

          pendingAmount =
            (pending.deposits || [])
              .reduce(
                (sum, deposit) =>
                  sum + Number(deposit.amount || 0),
                0
              )
              .toFixed(11)
              .replace(/0+$/, '')
              .replace(/\.$/, '');
        } catch (_) {}

        setBridgeStatus(
          '✅ Mint completed — wCryLo received.'
        );

        setBridgeComplete(
          'in',
          pendingAmount || 'Deposited amount',
          'CryLo',
          'wCryLo',
          `Nexus TX: ${mintTx}`
        );

        await refreshBridgeRelatedViews();
        setTimeout(refreshBridgeRelatedViews, 3000);
        setTimeout(refreshBridgeRelatedViews, 10000);
        resetBridgeFormAfterMint();
        await refreshNexusWcryloBalance();
        await refreshNexusGasStatus();

        localStorage.removeItem('cryloBridgePending');

        if (typeof updateBalance === 'function') await updateBalance();
        await refreshNexusWcryloBalance();

        setTimeout(async () => {
          if (typeof updateBalance === 'function') await updateBalance();
          await refreshNexusWcryloBalance();
        }, 5000);

        setTimeout(async () => {
          if (typeof updateBalance === 'function') await updateBalance();
          await refreshNexusWcryloBalance();
        }, 15000);
        return;
      }

      setBridgeStatus(
        'waiting for CryLo confirmations'
      );

      setBridgeProgress(
        'in',
        3,
        'Waiting for confirmations',
        'CryLo deposit detected. Confirming and minting wCryLo.'
      );
    } catch (e) {
      console.error(e);
      setBridgeStatus(e.message || 'status error');
    }
  }, 10000);
}


async function buyBackNexusNFT(tokenId) {
  const statusEl = document.getElementById('nexus-status');

  statusEl.textContent = `Processing buyback for NFT #${tokenId}...`;

  const gasCheck = await ensureNexusGasForAction('NFT buyback', NEXUS_GAS_ESTIMATES.nftBuyback);
  if (!gasCheck.ok) {
    statusEl.textContent = gasCheck.cancelled ? 'Buyback cancelled.' : `Buyback failed: ${gasCheck.error}`;
    return;
  }

  try {
    const result = await window.crylo.nexusBuyBackNft(tokenId, State.walletName, State.address);

    if (!result.ok) {
      statusEl.textContent =
        `Buyback failed for NFT #${tokenId}: ${result.error || 'Unknown error'}`;
    }

    statusEl.textContent =
      `Buyback completed for NFT #${tokenId}. Refreshing NFT list...`;

    await loadNexusBuyback();

    statusEl.textContent =
      `Buyback completed for NFT #${tokenId}.`;
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Buyback failed.';
  }
}

async function burnNexusNFT(tokenId) {
  const statusEl = document.getElementById('nexus-status');

  statusEl.textContent = `Burning NFT #${tokenId}...`;

  const gasCheck = await ensureNexusGasForAction('NFT burn', NEXUS_GAS_ESTIMATES.nftBurn);
  if (!gasCheck.ok) {
    statusEl.textContent = gasCheck.cancelled ? 'Burn cancelled.' : `Burn failed: ${gasCheck.error}`;
    return;
  }

  try {
    const result = await window.crylo.nexusBurnNft(tokenId, State.walletName, State.address);

    if (!result.ok) {
      statusEl.textContent =
        `Burn failed for NFT #${tokenId}: ${result.error || 'Unknown error'}`;
      return;
    }

    statusEl.textContent =
      `NFT #${tokenId} burned successfully. Refreshing NFT list...`;

    await loadNexusBuyback();

    statusEl.textContent =
      `NFT #${tokenId} burned successfully. Burn refund will be processed if eligible.`;

  } catch (err) {
    console.error(err);

    statusEl.textContent =
      `Burn failed for NFT #${tokenId}`;
  }
}

async function refreshNexusWcryloBalance() {
  const el = document.getElementById('bal-wcrylo');
  if (!el) return;

  const linkedAddress = getLinkedNexusAddress();

  if (!linkedAddress) {
    el.innerHTML = `—<span class="balance-unit"> wCryLo</span>`;
    return;
  }

  try {
    const result = await window.crylo.nexusWcryloBalance(linkedAddress);

    if (!result.ok) {
      el.innerHTML = `—<span class="balance-unit"> wCryLo</span>`;
      return;
    }

    el.innerHTML = `${fmtDecimalAmount(result.balance, 4)}<span class="balance-unit"> wCryLo</span>`;
  } catch (err) {
    console.error(err);
    el.innerHTML = `—<span class="balance-unit"> wCryLo</span>`;
  }
}

async function refreshNexusStakedBalance() {
  const el = document.getElementById('bal-staked-wcrylo');
  if (!el) return;

  const linkedAddress =
    getLinkedNexusAddress();

  if (!linkedAddress) {
    el.innerHTML =
      `—<span class="balance-unit"> wCryLo</span>`;
    return;
  }

  try {
    const result =
      await window.crylo.nexusStakedBalance(linkedAddress);


    if (!result.ok) {
      el.innerHTML =
        `0.0000<span class="balance-unit"> wCryLo</span>`;
      return;
    }

    el.innerHTML =
      `${fmtDecimalAmount(result.balance, 4)}<span class="balance-unit"> wCryLo</span>`;
  } catch (err) {
    console.error(err);

    el.innerHTML =
      `0.0000<span class="balance-unit"> wCryLo</span>`;
  }
}

async function refreshNexusPendingRewards() {
  const el = document.getElementById('nexus-pending-rewards');
  if (!el) return;

  const linkedAddress =
    getLinkedNexusAddress();

  if (!linkedAddress) {
    el.textContent = '—';
    return;
  }

  try {
    const result =
      await window.crylo.nexusPendingRewards(linkedAddress);

    if (!result.ok) {
      el.textContent = '0.0000';
      return;
    }

    el.textContent = fmtDecimalAmount(result.rewards, 6);
  } catch (err) {
    console.error(err);
    el.textContent = '0.0000';
  }
}


async function ensureNexusGasForAction(
  actionLabel,
  requiredGasCryLo = NEXUS_GAS_ESTIMATES.defaultAction
) {
  const linkedAddress = getLinkedNexusAddress();

  if (!linkedAddress) {
    return {
      ok: false,
      error: 'Create or load the bound Nexus wallet first.'
    };
  }

  const status = await window.crylo.nexusGasStatus(linkedAddress);

  if (!status.ok) {
    return {
      ok: false,
      error: status.error || 'Unable to check Nexus gas.'
    };
  }

  const currentGas = Number(status.nativeGas || 0);
  const requiredGas = Number(requiredGasCryLo);

  if (
    !Number.isFinite(currentGas) ||
    currentGas < 0 ||
    !Number.isFinite(requiredGas) ||
    requiredGas <= 0
  ) {
    return {
      ok: false,
      error: 'Unable to calculate the required Nexus gas.'
    };
  }

  if (currentGas >= requiredGas) {
    return {
      ok: true,
      toppedUp: false,
      currentGas,
      requiredGas
    };
  }

  return {
    ok: false,
    insufficientGas: true,
    currentGas,
    requiredGas,
    error:
      `Not enough CRYLO gas for ${actionLabel}. ` +
      `Required balance: ${requiredGas.toFixed(6)} CRYLO. ` +
      `Current balance: ${currentGas.toFixed(6)} CRYLO. ` +
      `Open Buy Gas and purchase 0.5 wCryLo for 0.25 CRYLO.`
  };
}


async function stakeNexusWcrylo() {
  const statusEl = document.getElementById('nexus-staking-status');
  const input = document.getElementById('nexus-stake-amount');
  const amount = input.value.trim();

  if (!amount || Number(amount) <= 0) {
    statusEl.textContent = 'Enter a valid staking amount.';
    return;
  }

  const availableText = document.getElementById('bal-wcrylo')?.textContent || '0';
  const available = Number(availableText.replace(/[^0-9.]/g, '') || 0);

  if (Number(amount) > available) {
    statusEl.textContent = `Stake failed: only ${available.toFixed(4)} wCryLo available.`;
    return;
  }

  statusEl.textContent = `Checking Nexus gas for staking...`;

  const gasCheck = await ensureNexusGasForAction('staking', NEXUS_GAS_ESTIMATES.staking);

  if (!gasCheck.ok) {
    statusEl.textContent = gasCheck.cancelled
      ? 'Stake cancelled.'
      : `Stake failed: ${gasCheck.error}`;
    return;
  }

  statusEl.textContent = `Staking ${amount} wCryLo...`;

  try {
    const result = await window.crylo.nexusStakeWcrylo(amount, State.walletName, State.address);

    if (!result.ok) {
      statusEl.textContent = `Stake failed: ${(result.error || '').includes('insufficient funds') ? 'Bound Nexus wallet needs gas for staking transactions.' : (result.error || 'Unknown error')}`;
      return;
    }

    statusEl.textContent = `Staked ${amount} wCryLo successfully.`;
    input.value = '';

    await refreshNexusDashboard();
    scheduleNexusDashboardRefresh(5000);
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Stake failed.';
  }
}

async function unstakeNexusWcrylo() {
  const statusEl = document.getElementById('nexus-staking-status');
  const input = document.getElementById('nexus-stake-amount');
  const amount = input.value.trim();

  if (!amount || Number(amount) <= 0) {
    statusEl.textContent = 'Enter a valid unstaking amount.';
    return;
  }

  statusEl.textContent = 'Checking Nexus gas for unstaking...';

  const gasCheck = await ensureNexusGasForAction('unstaking', NEXUS_GAS_ESTIMATES.unstaking);
  if (!gasCheck.ok) {
    statusEl.textContent = gasCheck.cancelled ? 'Unstake cancelled.' : `Unstake failed: ${gasCheck.error}`;
    return;
  }

  statusEl.textContent = `Unstaking ${amount} wCryLo...`;

  try {
    const result = await window.crylo.nexusUnstakeWcrylo(amount, State.walletName, State.address);

    if (!result.ok) {
      statusEl.textContent = `Unstake failed: ${(result.error || '').includes('insufficient funds') ? 'Bound Nexus wallet needs gas for unstaking transactions.' : (result.error || 'Unknown error')}`;
      return;
    }

    statusEl.textContent = `Unstaked ${amount} wCryLo successfully.`;
    input.value = '';

    await refreshNexusDashboard();
    scheduleNexusDashboardRefresh(5000);
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Unstake failed.';
  }
}

async function claimNexusRewards() {
  const statusEl = document.getElementById('nexus-staking-status');

  statusEl.textContent = 'Checking Nexus gas for staking reward claim...';

  const gasCheck = await ensureNexusGasForAction('claiming staking rewards', NEXUS_GAS_ESTIMATES.claimStakingRewards);
  if (!gasCheck.ok) {
    statusEl.textContent = gasCheck.cancelled ? 'Claim cancelled.' : `Claim failed: ${gasCheck.error}`;
    return;
  }

  statusEl.textContent = 'Claiming staking rewards...';

  try {
    const result = await window.crylo.nexusClaimRewards(State.walletName, State.address);

    if (!result.ok) {
      const errorText = String(result.error || '').toLowerCase();

      if (errorText.includes('no rewards')) {
        statusEl.textContent = 'No rewards available to claim.';
        return;
      }

      statusEl.textContent =
        `Claim failed: ${result.error || 'Unknown error'}`;
      return;
    }

    statusEl.textContent =
      'Staking rewards claimed successfully.';

    await refreshNexusDashboard();
    scheduleNexusDashboardRefresh(5000);
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Claim failed.';
  }
}

function setNexusNodeDashboardText(id, value, fallback = '—') {
  const element = document.getElementById(id);

  if (!element) return;

  const usable =
    value !== undefined &&
    value !== null &&
    value !== '';

  element.textContent =
    usable ? String(value) : fallback;
}

function setNexusNodeDashboardVisible(id, visible) {
  const element = document.getElementById(id);

  if (!element) return;

  element.classList.toggle(
    'hidden',
    !visible
  );
}

function formatNexusOperatorStatusAge(seconds) {
  const value = Number(seconds);

  if (!Number.isFinite(value) || value < 0) {
    return 'Unknown';
  }

  if (value < 60) {
    return `${Math.floor(value)} sec`;
  }

  if (value < 3600) {
    return `${Math.floor(value / 60)} min`;
  }

  if (value < 86400) {
    return `${Math.floor(value / 3600)} hr`;
  }

  return `${Math.floor(value / 86400)} day`;
}

function formatNexusOperatorTimestamp(value) {
  if (!value) return 'Never';

  const timestamp = new Date(value);

  if (Number.isNaN(timestamp.getTime())) {
    return String(value);
  }

  return timestamp.toLocaleString();
}

function getConfiguredNexusOperatorAddress(configuration) {
  if (!configuration || typeof configuration !== 'object') {
    return null;
  }

  return (
    configuration.nexusAddress ||
    configuration.operatorAddress ||
    configuration.walletAddress ||
    configuration.linkedAddress ||
    configuration.address ||
    null
  );
}

function renderNexusOperatorWorkers(workers, summary) {
  const container =
    document.getElementById(
      'nexus-operator-workers'
    );

  const summaryElement =
    document.getElementById(
      'nexus-operator-worker-summary'
    );

  if (summaryElement) {
    if (!Array.isArray(workers) || workers.length === 0) {
      summaryElement.textContent =
        'No worker health records are available.';
    } else {
      summaryElement.textContent =
        `${summary?.healthy || 0} healthy · ` +
        `${summary?.unhealthy || 0} unhealthy · ` +
        `${summary?.disabled || 0} disabled`;
    }
  }

  if (!container) return;

  container.replaceChildren();

  if (!Array.isArray(workers) || workers.length === 0) {
    const empty =
      document.createElement('div');

    empty.className = 'muted';
    empty.textContent =
      'No worker status loaded.';

    container.appendChild(empty);
    return;
  }

  workers.forEach(worker => {
    const card =
      document.createElement('div');

    card.className = 'card';

    const title =
      document.createElement('strong');

    title.textContent =
      worker.name || 'Unnamed Worker';

    const state =
      document.createElement('div');

    state.className = 'muted';
    state.style.marginTop = '6px';

    if (worker.enabled === false) {
      state.textContent = 'Disabled';
    } else if (worker.healthy === true) {
      state.textContent = 'Healthy';
    } else {
      state.textContent = 'Unhealthy';
    }

    const details =
      document.createElement('div');

    details.className = 'muted';
    details.style.marginTop = '6px';
    details.style.fontSize = '12px';

    const lastSuccess =
      worker.lastSuccess ||
      worker.lastRun ||
      'Never';

    details.textContent =
      `Last activity: ${formatNexusOperatorTimestamp(lastSuccess)} · ` +
      `Errors: ${Number(worker.errors || 0)}`;

    card.appendChild(title);
    card.appendChild(state);
    card.appendChild(details);

    if (worker.message) {
      const message =
        document.createElement('div');

      message.className = 'muted';
      message.style.marginTop = '6px';
      message.style.fontSize = '12px';
      message.textContent =
        String(worker.message);

      card.appendChild(message);
    }

    container.appendChild(card);
  });
}

function renderNexusOperatorMetrics(metrics) {
  const container =
    document.getElementById(
      'nexus-operator-metrics'
    );

  if (!container) return;

  container.replaceChildren();

  const entries =
    metrics &&
    typeof metrics === 'object' &&
    !Array.isArray(metrics)
      ? Object.entries(metrics)
      : [];

  if (entries.length === 0) {
    const empty =
      document.createElement('div');

    empty.className = 'muted';
    empty.textContent =
      'No metrics loaded.';

    container.appendChild(empty);
    return;
  }

  entries.forEach(([name, rawValue]) => {
    const card =
      document.createElement('div');

    card.className = 'card';

    const label =
      document.createElement('div');

    label.className = 'muted';
    label.textContent = name;

    const value =
      document.createElement('strong');

    if (
      rawValue &&
      typeof rawValue === 'object'
    ) {
      try {
        value.textContent =
          JSON.stringify(rawValue);
      } catch {
        value.textContent =
          '[Complex value]';
      }
    } else {
      value.textContent =
        rawValue === undefined ||
        rawValue === null
          ? '—'
          : String(rawValue);
    }

    card.appendChild(label);
    card.appendChild(value);
    container.appendChild(card);
  });
}


function setNexusNodeSmartStatus({
  type = 'setup',
  eyebrow = '',
  title = '',
  message = '',
  currentStep = '—'
} = {}) {
  const statusCard =
    document.getElementById('nexus-node-status');

  if (statusCard) {
    statusCard.classList.remove(
      'setup',
      'success',
      'warning',
      'danger'
    );

    statusCard.classList.add(type);
  }

  setNexusNodeDashboardText(
    'nexus-node-status-eyebrow',
    eyebrow
  );

  setNexusNodeDashboardText(
    'nexus-node-status-title',
    title
  );

  setNexusNodeDashboardText(
    'nexus-node-status-message',
    message
  );

  setNexusNodeDashboardText(
    'nexus-node-status-current-step',
    currentStep
  );

  const icon =
    type === 'success'
      ? '✓'
      : type === 'danger'
        ? '!'
        : '●';

  setNexusNodeDashboardText(
    'nexus-node-status-icon',
    icon
  );
}

let currentNexusNodeCenterState = null;
let nexusNodeCenterRefreshPromise = null;

function requireNexusNodeCenterModules() {
  const factsApi =
    window.CryLoNodeCenterFacts;

  const stateApi =
    window.CryLoNodeCenterState;

  const rendererApi =
    window.CryLoNodeCenterRenderer;

  if (
    !factsApi ||
    !stateApi ||
    !rendererApi
  ) {
    throw new Error(
      'The Node Center production modules were not loaded.'
    );
  }

  return {
    factsApi,
    stateApi,
    rendererApi
  };
}

function renderNexusNodeCenterSnapshot({
  linkedAddress = null,
  dashboardResult = null,
  installationResult = null
} = {}) {
  const {
    factsApi,
    stateApi,
    rendererApi
  } = requireNexusNodeCenterModules();

  const facts =
    factsApi.buildNodeCenterFacts({
      linkedAddress,
      dashboardResult,
      installationResult
    });

  const nextState =
    stateApi.buildNodeCenterState(
      facts
    );

  rendererApi.renderNodeCenter(
    document,
    nextState,
    {
      actionRunning:
        nexusOperatorServiceActionRunning
    }
  );

  currentNexusNodeCenterState =
    nextState;

  return nextState;
}

function rerenderCurrentNexusNodeCenter() {
  if (!currentNexusNodeCenterState) {
    return null;
  }

  const {
    rendererApi
  } = requireNexusNodeCenterModules();

  return rendererApi.renderNodeCenter(
    document,
    currentNexusNodeCenterState,
    {
      actionRunning:
        nexusOperatorServiceActionRunning
    }
  );
}

function renderNexusInstallationDetails(
  installation,
  state
) {
  const result =
    installation || {};

  setNexusNodeDashboardText(
    'nexus-operator-installed-version',
    result.installedVersion || '—'
  );

  setNexusNodeDashboardText(
    'nexus-operator-bundled-version',
    result.bundledVersion || '—'
  );

  const messageElement =
    document.getElementById(
      'nexus-operator-install-action-message'
    );

  if (!messageElement) {
    return;
  }

  if (result.ok === false) {
    messageElement.textContent =
      result.error ||
      'Unable to inspect the operator installation.';
    return;
  }

  const action =
    state?.action;

  if (action === 'REPAIR') {
    messageElement.textContent =
      'Required runtime files are missing or incomplete. Repair the operator node to continue.';
  } else if (action === 'INSTALL') {
    messageElement.textContent =
      'Install the operator node once. The background service remains independent of Electron.';
  } else if (action === 'UPDATE') {
    messageElement.textContent =
      `Operator ${result.installedVersion || 'runtime'} is installed. Version ${result.bundledVersion || 'the latest release'} is ready.`;
  } else if (action === 'AUTHORIZE') {
    messageElement.textContent =
      `Operator ${result.installedVersion || ''} is installed and current. Authorize the node to continue.`;
  } else if (action === 'START') {
    messageElement.textContent =
      `Operator ${result.installedVersion || ''} is installed, current, and authorized. Start the background service.`;
  } else if (
    action === 'VERIFY' ||
    action === 'OPERATE'
  ) {
    messageElement.textContent =
      `Operator ${result.installedVersion || ''} is installed, current, and running.`;
  } else {
    messageElement.textContent =
      'Operator installation status loaded.';
  }
}


async function refreshNexusOperatorDashboard() {
  const linkedAddress =
    getLinkedNexusAddress();

  if (!linkedAddress) {
    renderNexusNodeCenterSnapshot({
      linkedAddress: null,
      dashboardResult: {},
      installationResult: {}
    });

    setNexusNodeDashboardText(
      'nexus-node-registration-status',
      'No Wallet'
    );

    setNexusNodeDashboardText(
      'nexus-node-tier',
      '—'
    );

    setNexusNodeDashboardText(
      'nexus-node-stake',
      '—'
    );

    setNexusNodeDashboardText(
      'nexus-node-pending',
      '—'
    );

    setNexusNodeDashboardVisible(
      'nexus-register-operator-btn',
      false
    );

    setNexusNodeDashboardVisible(
      'nexus-register-validator-btn',
      false
    );

    setNexusNodeDashboardVisible(
      'nexus-claim-node-rewards-btn',
      false
    );

    setNexusNodeDashboardVisible(
      'nexus-unregister-node-btn',
      false
    );

    renderNexusNodeCenterSnapshot({
      linkedAddress: null,
      dashboardResult: {},
      installationResult: {}
    });

    return;
  }

  setNexusNodeSmartStatus({
    type: 'setup',
    eyebrow: 'Refreshing status',
    title: 'Loading Node Center',
    message:
      'Checking registration, operator service, connection, uptime, and reward eligibility.',
    currentStep: 'Checking Node'
  });

  try {
    const [
      result,
      installation
    ] = await Promise.all([
      window.crylo
        .nexusOperatorDashboard(
          linkedAddress
        ),
      window.crylo
        .nexusOperatorInstallationStatus()
    ]);

    if (!result || result.ok === false) {
      console.error(
        'Nexus operator dashboard request failed:',
        result?.error || 'Unknown dashboard error'
      );

      const errorState =
        renderNexusNodeCenterSnapshot({
          linkedAddress,
          dashboardResult: {
            registration: {
              available: false,
              error:
                result?.error ||
                'The current node status could not be loaded.'
            }
          },
          installationResult: {}
        });

      renderNexusInstallationDetails(
        {},
        errorState
      );

      return;
    }

    const registration =
      result.registration || {};

    const registered =
      registration.registered === true;

    const tierValue =
      String(registration.tier || '0');

    const operatorRegistrationStatus =
      registration.available === false
        ? 'Unavailable'
        : registered && tierValue === '1'
          ? 'Registered'
          : 'Not Registered';

    const validatorRegistrationStatus =
      registration.available === false
        ? 'Unavailable'
        : registered && tierValue === '2'
          ? 'Registered'
          : 'Not Registered';

    setNexusNodeDashboardText(
      'nexus-node-registration-status',
      operatorRegistrationStatus
    );

    const currentTierLabel =
      registration.available === false
        ? 'Unavailable'
        : !registered
          ? 'Not Registered'
          : tierValue === '2'
            ? 'Validator'
            : 'Operator';

    setNexusNodeDashboardText(
      'nexus-node-tier',
      currentTierLabel
    );

    setNexusNodeDashboardText(
      'nexus-node-stake',
      `${registration.stake || '0'} wCryLo`
    );

    setNexusNodeDashboardText(
      'nexus-node-pending',
      `${registration.pending || '0'} wCryLo`
    );

    setNexusNodeDashboardText(
      'nexus-node-operator-required',
      `${registration.operatorStake || '300'} wCryLo`
    );

    setNexusNodeDashboardText(
      'nexus-node-validator-required',
      `${registration.validatorStake || '750'} wCryLo`
    );

    setNexusNodeDashboardVisible(
      'nexus-register-operator-btn',
      !registered
    );

    setNexusNodeDashboardVisible(
      'nexus-register-validator-btn',
      registered && tierValue === '1'
    );

    setNexusNodeDashboardVisible(
      'nexus-claim-node-rewards-btn',
      registered
    );

    setNexusNodeDashboardVisible(
      'nexus-unregister-node-btn',
      registered
    );

    const authorization =
      result.authorization || {};

    const operatorServiceRunning =
      result.service?.installed === true &&
      (
        result.service?.active === true ||
        result.service?.running === true ||
        result.service?.status === 'active' ||
        result.service?.state === 'active' ||
        result.service?.activeState === 'active'
      );

    setNexusNodeDashboardVisible(
      'nexus-operator-authorization-panel',
      registered && operatorServiceRunning
    );

    setNexusNodeDashboardText(
      'nexus-operator-authorization-status',
      authorization.status ||
        'Not Authorized'
    );

    setNexusNodeDashboardText(
      'nexus-operator-authorization-expires',
      authorization.expiresAt
        ? new Date(
            authorization.expiresAt
          ).toLocaleString()
        : '—'
    );

    const remainingSeconds =
      Number(
        authorization.remainingSeconds || 0
      );

    const remainingHours =
      Math.floor(
        remainingSeconds / 3600
      );

    const remainingMinutes =
      Math.floor(
        (remainingSeconds % 3600) / 60
      );

    setNexusNodeDashboardText(
      'nexus-operator-authorization-remaining',
      authorization.valid
        ? `${remainingHours}h ${remainingMinutes}m`
        : authorization.expired
          ? 'Expired'
          : '—'
    );

    const authorizationButton =
      document.getElementById(
        'nexus-authorize-operator-btn'
      );

    if (authorizationButton) {
      authorizationButton.textContent =
        authorization.valid
          ? 'Renew 72-Hour Authorization'
          : 'Authorize Node for 72 Hours';
    }

    const configuration =
      result.configuration || {};

    const service =
      result.service || {};

    const runtime =
      result.runtime || {};

    setNexusNodeDashboardText(
      'nexus-operator-installed',
      service.installed ? 'Yes' : 'No'
    );

    setNexusNodeDashboardText(
      'nexus-operator-running',
      service.running
        ? 'Running'
        : service.installed
          ? service.activeState || 'Stopped'
          : 'Not Installed'
    );

    setNexusNodeDashboardText(
      'nexus-operator-service-scope',
      service.serviceScope || '—'
    );

    setNexusNodeDashboardText(
      'nexus-operator-config-loaded',
      configuration.loaded
        ? 'Loaded'
        : configuration.exists
          ? 'Invalid'
          : 'Not Found'
    );

    const configuredAddress =
      getConfiguredNexusOperatorAddress(
        configuration.data
      );

    let walletMatch = 'Unknown';

    if (configuredAddress) {
      walletMatch =
        String(configuredAddress).toLowerCase() ===
        String(linkedAddress).toLowerCase()
          ? 'Matched'
          : 'Mismatch';
    } else if (configuration.loaded) {
      walletMatch = 'Address Missing';
    }

    setNexusNodeDashboardText(
      'nexus-operator-wallet-match',
      walletMatch
    );

    setNexusNodeDashboardText(
      'nexus-operator-node-id',
      runtime.nodeId || '—'
    );

    setNexusNodeDashboardText(
      'nexus-operator-updated-at',
      formatNexusOperatorTimestamp(
        runtime.updatedAt
      )
    );

    const ageText =
      formatNexusOperatorStatusAge(
        runtime.ageSeconds
      );

    setNexusNodeDashboardText(
      'nexus-operator-status-age',
      runtime.stale === true
        ? `${ageText} · Stale`
        : ageText
    );

    const serviceMessage =
      document.getElementById(
        'nexus-operator-service-message'
      );

    if (serviceMessage) {
      const messages = [];

      if (service.message) {
        messages.push(service.message);
      }

      if (configuration.error) {
        messages.push(
          `Configuration: ${configuration.error}`
        );
      }

      if (runtime.statusError) {
        messages.push(
          `Runtime status: ${runtime.statusError}`
        );
      }

      if (runtime.stale === true) {
        messages.push(
          'The saved operator status is stale.'
        );
      }

      if (messages.length === 0) {
        messages.push(
          service.running
            ? 'The operator service is running.'
            : 'The operator service is not running.'
        );
      }

      serviceMessage.textContent =
        messages.join(' ');
    }

    const verification =
      result.rewardVerification || {};

    setNexusNodeDashboardText(
      'nexus-reward-verification-status',
      verification.status ||
      'Not Connected'
    );

    setNexusNodeDashboardText(
      'nexus-reward-eligibility',
      verification.connected
        ? registered
          ? 'Pending Verification'
          : 'Not Registered'
        : 'Unavailable'
    );

    setNexusNodeDashboardText(
      'nexus-reward-verification-message',
      verification.message ||
      'Uptime verification and operator reward validation are not connected yet.'
    );

    renderNexusOperatorWorkers(
      result.workers,
      result.workerSummary
    );

    renderNexusOperatorMetrics(
      result.metrics
    );

    const nodeCenterState =
      renderNexusNodeCenterSnapshot({
        linkedAddress,
        dashboardResult: result,
        installationResult:
          installation
      });

    renderNexusInstallationDetails(
      installation,
      nodeCenterState
    );

    if (registration.error) {
      console.error(
        'Nexus registration verification failed:',
        registration.error
      );

      setNexusNodeSmartStatus({
        type: 'danger',
        eyebrow: 'Verification unavailable',
        title: 'Registration could not be verified',
        message:
          'The wallet could not securely verify the current node registration. Check the Nexus connection and refresh the Node Center.',
        currentStep: 'Retry Verification'
      });
    }
  } catch (error) {
    console.error(
      'Unable to load Nexus operator dashboard:',
      error
    );

    const errorState =
      renderNexusNodeCenterSnapshot({
        linkedAddress,
        dashboardResult: {
          registration: {
            available: false,
            error:
              error?.message ||
              'The current node status could not be loaded.'
          }
        },
        installationResult: {}
      });

    renderNexusInstallationDetails(
      {},
      errorState
    );
  }
}

async function refreshNexusNodeStatus() {
  return refreshNexusOperatorDashboard();
}



let nexusOperatorServiceActionRunning = false;

async function refreshNexusOperatorInstallationControls() {
  rerenderCurrentNexusNodeCenter();
  return currentNexusNodeCenterState;
}


async function installOrUpdateNexusOperator() {
  if (nexusOperatorServiceActionRunning) {
    return;
  }

  const messageElement =
    document.getElementById(
      'nexus-operator-install-action-message'
    );

  nexusOperatorServiceActionRunning = true;

  rerenderCurrentNexusNodeCenter();

  if (messageElement) {
    messageElement.textContent =
      'Installing the CryLoNexus operator runtime...';
  }

  try {
    const result =
      await window.crylo
        .nexusInstallOperatorService();

    if (!result?.ok) {
      throw new Error(
        result?.error ||
        'Operator installation failed.'
      );
    }

    const warnings =
      Array.isArray(result.warnings)
        ? result.warnings.filter(Boolean)
        : [];

    if (messageElement) {
      messageElement.textContent =
        warnings.length
          ? `Operator ${result.runtimeVersion || ''} installed. Authorize the node to start the service. ${warnings.join(' ')}`
          : `Operator ${result.runtimeVersion || ''} installed. Authorize the node to start the service.`;
    }

    await refreshNexusOperatorDashboard();
  } catch (error) {
    console.error(
      'Operator installation failed:',
      error
    );

    if (messageElement) {
      messageElement.textContent =
        error?.message ||
        'Operator installation failed.';
    }
  } finally {
    nexusOperatorServiceActionRunning = false;

    rerenderCurrentNexusNodeCenter();
  }
}

async function controlNexusOperatorService(action) {
  if (nexusOperatorServiceActionRunning) {
    return;
  }

  const supported =
    new Set([
      'start',
      'stop',
      'restart'
    ]);

  if (!supported.has(action)) {
    return;
  }

  const messageElement =
    document.getElementById(
      'nexus-operator-install-action-message'
    );

  nexusOperatorServiceActionRunning = true;

  rerenderCurrentNexusNodeCenter();

  if (messageElement) {
    messageElement.textContent =
      `${action[0].toUpperCase()}${action.slice(1)}ing the operator service...`;
  }

  try {
    const result =
      await window.crylo
        .nexusControlOperatorService(
          action
        );

    if (!result?.ok) {
      throw new Error(
        result?.error ||
        `Unable to ${action} the operator service.`
      );
    }

    if (messageElement) {
      messageElement.textContent =
        `Operator service ${action} completed.`;
    }

    await refreshNexusOperatorDashboard();
  } catch (error) {
    console.error(
      'Operator service control failed:',
      error
    );

    if (messageElement) {
      messageElement.textContent =
        error?.message ||
        `Unable to ${action} the operator service.`;
    }
  } finally {
    nexusOperatorServiceActionRunning = false;

    rerenderCurrentNexusNodeCenter();
  }
}


async function authorizeNexusOperator() {
  try {
    const button =
      document.getElementById(
        'nexus-authorize-operator-btn'
      );

    if (button) {
      button.disabled = true;
      button.textContent = 'Authorizing...';
    }

    const result =
      await window.crylo
        .nexusAuthorizeOperator(
          State.walletName,
        State.address
        );

    if (!result?.ok) {
      if (!result?.cancelled) {
        alert(
          result?.error ||
          'Unable to authorize this node'
        );
      }

      return;
    }

    alert(
      'Node authorized for 72 hours.\n\n' +
      `Expires: ${new Date(
        result.expiresAt
      ).toLocaleString()}`
    );

    await refreshNexusOperatorDashboard();
  } catch (error) {
    console.error(
      'Operator authorization failed:',
      error
    );

    alert(
      error?.message ||
      'Unable to authorize this node'
    );
  } finally {
    const button =
      document.getElementById(
        'nexus-authorize-operator-btn'
      );

    if (button) {
      button.disabled = false;
      button.textContent =
        'Authorize Node for 72 Hours';
    }
  }
}

async function registerNexusOperator() {
  const statusEl =
    document.getElementById('nexus-node-action-status');

  statusEl.textContent =
    'Checking CRYLO gas for Operator registration...';

  const gasCheck = await ensureNexusGasForAction(
    'Operator registration',
    NEXUS_GAS_ESTIMATES.nodeRegistration
  );

  if (!gasCheck.ok) {
    statusEl.textContent =
      `Operator registration stopped: ${gasCheck.error}`;
    return;
  }

  statusEl.textContent =
    'Registering Operator node with 300 wCryLo...';

  try {
    const result =
      await window.crylo.nexusRegisterOperator(
        State.walletName,
        State.address
      );

    if (!result.ok) {
      const errorText =
        String(result.error || 'Unknown error');

      const lowerError = errorText.toLowerCase();

      statusEl.textContent =
        lowerError.includes('insufficient funds')
          ? 'Operator registration stopped: Not enough CRYLO gas. ' +
            'Use the Buy Gas button first.'
          : `Operator registration failed: ${errorText}`;

      return;
    }

    statusEl.textContent =
      'Operator node registered successfully.';

    await refreshNexusDashboard();
    scheduleNexusDashboardRefresh(5000);
  } catch (err) {
    console.error(err);

    const errorText =
      String(err?.message || err || '').toLowerCase();

    statusEl.textContent =
      errorText.includes('insufficient funds')
        ? 'Operator registration stopped: Not enough CRYLO gas. ' +
          'Use the Buy Gas button first.'
        : 'Operator registration failed.';
  }
}

async function registerNexusValidator() {
  const statusEl =
    document.getElementById('nexus-node-action-status');

  statusEl.textContent =
    'Checking CRYLO gas for Validator registration...';

  const gasCheck = await ensureNexusGasForAction(
    'Validator registration',
    NEXUS_GAS_ESTIMATES.nodeRegistration
  );

  if (!gasCheck.ok) {
    statusEl.textContent =
      `Validator registration stopped: ${gasCheck.error}`;
    return;
  }

  statusEl.textContent =
    'Registering Validator node with 750 wCryLo...';

  try {
    const result =
      await window.crylo.nexusRegisterValidator(
        State.walletName,
        State.address
      );

    if (!result.ok) {
      const errorText =
        String(result.error || 'Unknown error');

      const lowerError = errorText.toLowerCase();

      statusEl.textContent =
        lowerError.includes('insufficient funds')
          ? 'Validator registration stopped: Not enough CRYLO gas. ' +
            'Use the Buy Gas button first.'
          : `Validator registration failed: ${errorText}`;

      return;
    }

    statusEl.textContent =
      'Validator node registered successfully.';

    await refreshNexusDashboard();
    scheduleNexusDashboardRefresh(5000);
  } catch (err) {
    console.error(err);

    const errorText =
      String(err?.message || err || '').toLowerCase();

    statusEl.textContent =
      errorText.includes('insufficient funds')
        ? 'Validator registration stopped: Not enough CRYLO gas. ' +
          'Use the Buy Gas button first.'
        : 'Validator registration failed.';
  }
}


async function unregisterNexusNode() {
  const statusEl = document.getElementById('nexus-node-action-status');

  const yes = confirm(
    'Deregister this Nexus node?\n\nYour staked wCryLo and available node rewards will be returned.'
  );

  if (!yes) return;

  statusEl.textContent = 'Checking Nexus gas for node deregistration...';

  const gasCheck = await ensureNexusGasForAction('node deregistration', NEXUS_GAS_ESTIMATES.nodeDeregistration);
  if (!gasCheck.ok) {
    statusEl.textContent = gasCheck.cancelled ? 'Node deregistration cancelled.' : `Node deregistration failed: ${gasCheck.error}`;
    return;
  }

  statusEl.textContent = 'Deregistering node...';

  try {
    const result = await window.crylo.nexusUnregisterNode(State.walletName, State.address);

    if (!result.ok) {
      statusEl.textContent = `Node deregistration failed: ${result.error || 'Unknown error'}`;
      return;
    }

    statusEl.textContent = 'Node deregistered successfully.';
    await refreshNexusDashboard();
    scheduleNexusDashboardRefresh(5000);
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Node deregistration failed.';
  }
}


async function claimNexusNodeRewards() {
  const statusEl = document.getElementById('nexus-node-action-status');
  statusEl.textContent = 'Checking Nexus gas for node reward claim...';

  const gasCheck = await ensureNexusGasForAction('claiming node rewards', NEXUS_GAS_ESTIMATES.claimNodeRewards);
  if (!gasCheck.ok) {
    statusEl.textContent = gasCheck.cancelled ? 'Node reward claim cancelled.' : `Node reward claim failed: ${gasCheck.error}`;
    return;
  }

  statusEl.textContent = 'Claiming node rewards...';

  try {
    const result = await window.crylo.nexusClaimNodeRewards(State.walletName, State.address);

    if (!result.ok) {
      const errorText = String(result.error || '').toLowerCase();

      if (
        errorText.includes('no rewards') ||
        errorText.includes('execution reverted')
      ) {
        statusEl.textContent = 'No node rewards available to claim.';
        return;
      }

      statusEl.textContent = `Node reward claim failed: ${result.error || 'Unknown error'}`;
      return;
    }

    statusEl.textContent = 'Node rewards claimed successfully.';
    await refreshNexusDashboard();
    scheduleNexusDashboardRefresh(5000);
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Node reward claim failed.';
  }
}



function fmtUnix(ts) {
  if (!ts) return 'Never';
  return new Date(Number(ts) * 1000).toLocaleString();
}

async function refreshNexusNativeGasBalance() {
  const linkedAddress = getLinkedNexusAddress();

  if (
    !linkedAddress ||
    !window.crylo ||
    typeof window.crylo.nexusNativeGasBalance !== 'function'
  ) {
    return null;
  }

  try {
    const result =
      await window.crylo.nexusNativeGasBalance(linkedAddress);

    if (!result?.ok) {
      return null;
    }

    const nativeGas = Number(result.nativeGas || 0);

    if (!Number.isFinite(nativeGas)) {
      return null;
    }

    const formattedNativeGas =
      fmtDecimalAmount(nativeGas, 6);

    const nativeEl =
      document.getElementById('nexus-gas-native');

    if (nativeEl) {
      nativeEl.textContent =
        `Native Gas: ${formattedNativeGas} CRYLO`;
    }

    const headerGasEl =
      document.getElementById('bal-crylo-gas');

    if (headerGasEl) {
      headerGasEl.innerHTML =
        `${formattedNativeGas}` +
        `<span class="balance-unit"> CRYLO</span>`;
    }

    return {
      ok: true,
      nativeGas
    };
  } catch (error) {
    console.error(
      'Fast Nexus native-gas refresh failed:',
      error
    );

    return null;
  }
}


async function refreshNexusGasStatus() {
  const statusEl = document.getElementById('nexus-gas-status');
  const nativeEl = document.getElementById('nexus-gas-native');
  const starterEl = document.getElementById('nexus-gas-starter');
  const dailyEl = document.getElementById('nexus-gas-daily');
  const activityEl = document.getElementById('nexus-gas-activity');
  const purchaseValueEl =
    document.getElementById('nexus-gas-purchase-value');

  const linkedAddress = getLinkedNexusAddress();

  if (!linkedAddress) {
    if (statusEl) {
      statusEl.textContent =
        'Gas status: Create/bind a Nexus wallet first.';
    }

    const headerGasEl =
      document.getElementById('bal-crylo-gas');

    if (headerGasEl) {
      headerGasEl.innerHTML =
        '—<span class="balance-unit"> CRYLO</span>';
    }

    const starterRow =
      document.getElementById('nexus-starter-gas-row');

    if (starterRow) {
      starterRow.style.display = '';
    }

    return;
  }

  try {
    const result = await window.crylo.nexusGasStatus(linkedAddress);

    if (!result.ok) {
      if (statusEl) {
        statusEl.textContent =
          `Gas status: ${result.error || 'Unavailable'}`;
      }

      return null;
    }

    State.gasPolicy = {
      starterGasAmount:
        Number(result.starterGasAmount),
      lowGasThreshold:
        Number(result.lowGasThreshold),
      purchaseRateNativePerWcrylo:
        Number(result.purchaseRateNativePerWcrylo),
      minimumTreasuryReserve:
        Number(result.minimumTreasuryReserve)
    };

    if (purchaseValueEl) {
      const minimumPurchaseValue =
        NEXUS_GAS_PURCHASE_MIN_WCRYLO *
        State.gasPolicy.purchaseRateNativePerWcrylo;

      purchaseValueEl.textContent =
        `0.5 wCryLo purchases ` +
        `${fmtDecimalAmount(minimumPurchaseValue, 6)} CRYLO`;
    }

    const now = Date.now() / 1000;
    const active = result.lastActivityAt && (now - result.lastActivityAt) <= (3 * 24 * 60 * 60);

    if (statusEl) {
      statusEl.textContent = result.canClaim
        ? 'Gas status: Daily gas available'
        : `Gas status: ${active ? 'Active / cooldown' : 'Inactive until Nexus activity'}`;
    }

    const formattedNativeGas =
      fmtDecimalAmount(result.nativeGas, 6);

    if (nativeEl) {
      nativeEl.textContent =
        `Native Gas: ${formattedNativeGas} CRYLO`;
    }

    const headerGasEl =
      document.getElementById('bal-crylo-gas');

    if (headerGasEl) {
      headerGasEl.innerHTML =
        `${formattedNativeGas}` +
        `<span class="balance-unit"> CRYLO</span>`;
    }

    const starterRow =
      document.getElementById('nexus-starter-gas-row');

    if (starterRow) {
      starterRow.style.display =
        result.starterGasClaimed ? 'none' : '';
    }

    if (starterEl && !result.starterGasClaimed) {
      const registryState = result.registered
        ? 'Registered'
        : 'Not registered';

      starterEl.textContent =
        `Starter Gas: ${fmtDecimalAmount(result.starterGasAmount, 6)} CRYLO` +
        ` · Not sent` +
        ` · Wallet: ${registryState}`;
    }

    if (dailyEl) {
      dailyEl.textContent =
        `Daily Gas: ${fmtDecimalAmount(result.dailyGasAmount, 6)} CRYLO` +
        ` · Vault: ${fmtDecimalAmount(result.vaultBalance, 4)} CRYLO`;
    }
    if (activityEl) {
      activityEl.textContent =
        `Last Activity: ${fmtUnix(result.lastActivityAt)} · Last Claim: ${fmtUnix(result.lastGasClaimAt)}`;
    }

    const refreshedEl =
      document.getElementById('nexus-gas-last-refreshed');

    if (refreshedEl) {
      refreshedEl.textContent =
        `Last refreshed: ${new Date().toLocaleString()}`;
    }

    // Return the same status used to paint the UI so callers can
    // determine whether starter gas has actually reached the wallet.
    return result;
  } catch (err) {
    console.error(err);

    if (statusEl) {
      statusEl.textContent = 'Gas status: error';
    }

    return null;
  }
}

async function claimNexusDailyGas() {
  const statusEl = document.getElementById('nexus-gas-action-status');
  if (statusEl) statusEl.textContent = 'Claiming daily gas...';

  try {
    const result = await window.crylo.nexusClaimDailyGas(State.walletName, State.address);

    if (!result.ok) {
      const err = String(result.error || '').toLowerCase();
      if (statusEl) {
        statusEl.textContent = err.includes('daily gas unavailable') || err.includes('execution reverted')
          ? 'Daily gas is not available yet. Wait for the 24-hour cooldown or perform a Nexus activity if inactive.'
          : `Claim failed: ${result.error || 'Unknown error'}`;
      }
      return;
    }

    if (statusEl) statusEl.textContent = `Daily gas claimed: ${result.txHash}`;
    await refreshNexusDashboard();
    scheduleNexusDashboardRefresh(5000);
  } catch (err) {
    console.error(err);
    if (statusEl) statusEl.textContent = 'Claim failed.';
  }
}

function openNexusGasPurchase() {
  switchTab('nexus');

  setTimeout(() => {
    const input =
      document.getElementById('nexus-buy-gas-amount');

    const statusEl =
      document.getElementById('nexus-gas-action-status');

    if (input) {
      const currentAmount = Number(input.value || 0);

      if (
        !Number.isFinite(currentAmount) ||
        currentAmount < NEXUS_GAS_PURCHASE_MIN_WCRYLO
      ) {
        input.value =
          String(NEXUS_GAS_PURCHASE_MIN_WCRYLO);
      }

      input.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });

      input.focus();
      input.select();
    }

    if (statusEl) {
      statusEl.textContent =
        `Enter at least ` +
        `${NEXUS_GAS_PURCHASE_MIN_WCRYLO} wCryLo, ` +
        `then select Buy Gas.`;
    }
  }, 100);
}


async function buyNexusGasWithWcrylo() {
  const statusEl = document.getElementById('nexus-gas-action-status');
  const input = document.getElementById('nexus-buy-gas-amount');
  const amount = input ? input.value.trim() : '';

  const numericAmount = Number(amount);

  if (!amount || !Number.isFinite(numericAmount) || numericAmount <= 0) {
    if (statusEl) {
      statusEl.textContent = 'Enter a valid wCryLo amount.';
    }
    return;
  }

  if (numericAmount < NEXUS_GAS_PURCHASE_MIN_WCRYLO) {
    if (statusEl) {
      statusEl.textContent =
        `The minimum gas purchase is ` +
        `${NEXUS_GAS_PURCHASE_MIN_WCRYLO} wCryLo.`;
    }
    return;
  }

  if (statusEl) {
    statusEl.textContent =
      `Buying gas with ${amount} wCryLo...`;
  }

  try {
    const result = await window.crylo.nexusBuyGasWithWcrylo(amount, State.walletName, State.address);

    if (!result.ok) {
      if (statusEl) statusEl.textContent = `Buy gas failed: ${result.error || 'Unknown error'}`;
      return;
    }

    if (input) input.value = '';
    if (statusEl) statusEl.textContent = `Gas purchased: ${result.txHash}`;

    await refreshNexusDashboard();
    scheduleNexusDashboardRefresh(5000);
  } catch (err) {
    console.error(err);
    if (statusEl) statusEl.textContent = 'Buy gas failed.';
  }
}



async function loadNexusTransactions() {
  const statusEl = document.getElementById('nexus-tx-status');
  const listEl = document.getElementById('nexus-tx-list');
  const linkedAddress = getLinkedNexusAddress();

  if (!linkedAddress) {
    if (statusEl) statusEl.textContent = 'No bound Nexus wallet loaded.';
    return;
  }

  if (statusEl) statusEl.textContent = 'Loading Nexus transactions...';

  try {
    const result = await window.crylo.nexusTransactions(linkedAddress);

    if (!result.ok) {
      if (statusEl) statusEl.textContent = `Failed to load Nexus transactions: ${result.error || 'Unknown error'}`;
      return;
    }

    const txs = result.transactions || [];

    if (statusEl) {
      statusEl.textContent = `Showing ${txs.length} Nexus transactions from blocks ${result.fromBlock}–${result.latest}.`;
    }

    if (!listEl) return;

    if (txs.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🔗</div>
          No Nexus transactions found yet.
        </div>
      `;
      return;
    }

    listEl.innerHTML = txs.map((tx) => {
      const date = tx.timestamp
        ? new Date(tx.timestamp * 1000).toLocaleString()
        : 'Unknown date';

      const shortHash = tx.hash
        ? `${tx.hash.slice(0, 10)}...${tx.hash.slice(-8)}`
        : '—';

      return `
        <div class="tx-item">
          <div class="tx-main">
            <div class="tx-title">${tx.type}</div>
            <div class="tx-sub">${date} · Block ${tx.blockNumber}</div>
            <div class="tx-sub">TX: ${tx.hash || '—'}</div>
            <div class="tx-sub">Contract: ${tx.address || '—'}</div>
          </div>
          <div class="tx-amount">${tx.amount || ''}</div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error(err);
    if (statusEl) statusEl.textContent = 'Failed to load Nexus transactions.';
  }
}


function resumePendingBridgeOperations() {
  try {
    const inboundRaw =
      localStorage.getItem('cryloBridgePending');

    if (inboundRaw) {
      const inbound = JSON.parse(inboundRaw);

      const paymentId =
        inbound.paymentId ||
        inbound.paymentIds?.[0];

      if (paymentId) {
        setBridgeButtonBusy('in', true);

        setBridgeProgress(
          'in',
          3,
          'Waiting for confirmations',
          'Resuming the pending CryLo → wCryLo bridge.'
        );

        pollCryLoBridgeStatus(paymentId);
      }
    }
  } catch (error) {
    console.error(
      'Failed to resume inbound bridge:',
      error
    );
  }

  try {
    const outboundRaw =
      localStorage.getItem(
        'cryloBridgeReleasePending'
      );

    if (outboundRaw) {
      const outbound =
        JSON.parse(outboundRaw);

      if (outbound.nexusTxHash) {
        setBridgeButtonBusy('out', true);

        setBridgeProgress(
          'out',
          3,
          'Waiting for bridge relayer',
          'Resuming the pending wCryLo → CryLo release.'
        );

        pollBridgeReleaseStatus(
          outbound.nexusTxHash
        );
      }
    }
  } catch (error) {
    console.error(
      'Failed to resume outbound bridge:',
      error
    );
  }
}

if (document.readyState === 'loading') {
  window.addEventListener(
    'DOMContentLoaded',
    () => setTimeout(
      resumePendingBridgeOperations,
      500
    )
  );
} else {
  setTimeout(
    resumePendingBridgeOperations,
    500
  );
}


window.App = {
  installOrUpdateNexusOperator,
  controlNexusOperatorService,
  authorizeNexusOperator,
  sendMax,
  toggleAdvanced,
  showSetupForm,
  backToSetupCards,
  createWallet,
  openWallet,
  restoreWallet,
  openMainScreen,
  refreshAll,
  refreshNexusDashboard,
  switchTab,
  switchWallet,
  sendTx,
  consolidateUtxos,
  copyAddress,
  copyPaymentRequest,
  toggleMining,
  refreshNexusWcryloBalance,
  refreshNexusStakedBalance,
  openNexusGasPurchase,
  buyNexusGasWithWcrylo,
  claimNexusDailyGas,
  refreshNexusGasStatus,
  refreshNexusPendingRewards,
  claimNexusRewards,
  stakeNexusWcrylo,
  unstakeNexusWcrylo,
  refreshNexusNodeStatus,
  refreshNexusOperatorDashboard,
  registerNexusOperator,
  registerNexusValidator,
  claimNexusNodeRewards,
  unregisterNexusNode,
  startCryLoBridgeIn,
  startCryLoBridgeOut,
  createBoundNexusWallet,
  loadNexusBuyback,
  loadNexusTransactions,
  buyBackNexusNFT,
  burnNexusNFT,
  initMiningTab
};
