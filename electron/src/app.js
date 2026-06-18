'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────
const COIN = 1000000000000; // 10^12 atomic units = 1 CryLo

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
  miningStartHeight: null
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
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
  window.c64.onStartupStatus(({ state, message }) => {
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
  window.c64.onDaemonExit((code) => {
    if (code !== 0 && code !== null) {
      toast(`Daemon process exited (code ${code}). Please restart the app.`, 'error', 0);
    }
  });

  window.c64.onWalletRpcExit((code) => {
    if (code !== 0 && code !== null) {
      toast(`Wallet RPC exited (code ${code}). Please restart the app.`, 'error', 0);
    }
  });
});

async function showSetupOrMain() {
  // Check if any wallets already exist
  const res = await window.c64.listWallets();
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
  const res = await window.c64.listWallets();
  const sel = el('open-select');
  sel.innerHTML = '';
  if (!res.ok || res.wallets.length === 0) {
    sel.innerHTML = '<option value="">No wallets found</option>';
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
  await window.c64.walletRpc('close_wallet', { autosave_current: false }).catch(() => {});

  const res = await window.c64.walletRpc('create_wallet', {
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
  const seedRes = await window.c64.walletRpc('query_key', { key_type: 'mnemonic' });
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

async function openWallet() {
  const name = el('open-select').value;
  const pass = el('open-pass').value;
  if (!pass) { markPasswordInvalid('open-pass'); return; }

  if (!name) return toast('Please select a wallet.', 'error');

  // Close any currently open wallet first (ignore error if none open)
  await window.c64.walletRpc('close_wallet', { autosave_current: false }).catch(() => {});

  const res = await window.c64.walletRpc('open_wallet', {
    filename: name,
    password: pass
  }, 30000);

  if (!res.ok) { markPasswordInvalid('open-pass'); return; }

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

  const res = await window.c64.walletRpc('restore_deterministic_wallet', {
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
  el('setup-screen').classList.add('hidden');
  el('main-screen').classList.remove('hidden');

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
    const res = await window.c64.daemonRpc('get_info');
    if (!res.ok) return;
    const newHeight = res.result.height || 0;
    if (newHeight > State.currentHeight) {
      State.currentHeight = newHeight;
      await refreshAll();
    }
  }, 10000);
}

async function refreshAll() {
  await Promise.all([
    updateSyncStatus(),
    updateBalance(),
    refreshNexusWcryloBalance(),
    refreshNexusStakedBalance(),
    refreshNexusPendingRewards(),
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
  const res = await window.c64.daemonRpc('get_info');
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
      const rangeRes = await window.c64.daemonRpc('get_block_headers_range', {
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
  const res = await window.c64.walletRpc('get_transfers', { in: true });
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
  const res = await window.c64.walletRpc('get_balance', { account_index: 0 });

  console.log("get_balance response:", res);

  if (!res.ok) return;

  const r = res.result?.result || res.result || {};

  let total = Number(r.balance || 0);
  let unlocked = Number(r.unlocked_balance || 0);
  let locked = total - unlocked;

  // Keep spendable/available balance grounded in wallet-rpc unlocked_balance.
  // The mined split estimate is useful for total/vesting display, but it can
  // overstate what wallet-rpc can actually spend.
  try {
    const mined = await getMinedSplitBalances();
    if (mined.found) {
      total = mined.total;
      locked = Math.max(0, total - unlocked);
    }
  } catch (_) {}

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
  const res = await window.c64.walletRpc('get_address', { account_index: 0 });
  if (!res.ok || !res.result || !res.result.address) return;

  const newAddress = res.result.address;
  const changed = State.address !== newAddress;

  State.address = newAddress;
  el('receive-address').textContent = State.address;

  if (changed) {
    clearNexusUiForWalletSwitch();
  }

  await loadSavedNexusLinkedAddress();
  await refreshNexusWcryloBalance();
  await refreshNexusStakedBalance();
  await refreshNexusPendingRewards();
  await refreshNexusNodeStatus();
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

  const res = await window.c64.walletRpc('get_transfers', {
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
  const addr   = el('send-addr').value.trim();
  const amount = parseFloat(el('send-amount').value);
  const pid    = el('send-pid').value.trim();
  const note   = el('send-note').value.trim();

  if (!addr)         return toast('Please enter a recipient address.', 'error');
  if (!amount || amount <= 0) return toast('Please enter a valid amount.', 'error');

  const confirmed = await window.c64.confirm({
    title: 'Confirm Send',
    message: `Send ${amount}  CryLo to:\n${addr}\n\nThis cannot be undone.`,
    buttons: ['Send', 'Cancel']
  });
  if (!confirmed) return;

  el('send-btn').disabled = true;
  el('send-btn').textContent = 'Sending...';

  const destinations = [{ amount: Math.round(amount * COIN), address: addr }];
  const params = { destinations, account_index: 0 };
  if (pid) params.payment_id = pid;
  if (note) params.tx_extra = note;

  const res = await window.c64.walletRpc('transfer', params);

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
  const addrRes = await window.c64.walletRpc('get_address', { account_index: 0 });
  if (!addrRes.ok) return toast('Failed to get wallet address: ' + addrRes.error, 'error');
  const myAddress = addrRes.result.address;

  const confirmed = await window.c64.confirm({
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
    const res = await window.c64.walletRpc('sweep_all', {
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
            const txRes = await window.c64.walletRpc('get_transfer_by_txid', { txid: txid });
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
  const res = await window.c64.walletRpc('get_transfers', {
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
    const balRes = await window.c64.walletRpc('get_balance', { account_index: 0 });
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
  if (tab === 'nexus') { clearNexusUiForWalletSwitch(); loadSavedNexusLinkedAddress(); }
}

async function switchWallet() {
  const confirmed = await window.c64.confirm({
    title: 'Switch Wallet',
    message: 'Close current wallet and go back to wallet selection?',
    buttons: ['Yes', 'Cancel']
  });
  if (!confirmed) return;

  // Close current wallet
  await window.c64.walletRpc('close_wallet', { autosave_current: true });

  // Reset state
  State.walletName = '';
  State.address    = '';
  if (State.refreshTimer) {
    clearInterval(State.refreshTimer);
    State.refreshTimer = null;
  }
  if (State.blockPoller) {
    clearInterval(State.blockPoller);
    State.blockPoller = null;
  }

  showSetup();
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

  const addrField = document.getElementById('mining-address');
  if (addrField && State.address) {
    addrField.value = State.address;
  }

  try {
    const s = await window.c64.minerGetInfo();
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
  const address = document.getElementById('mining-address').value.trim();
  const worker  = document.getElementById('mining-worker').value.trim() || 'desktop';
  const pool    = document.getElementById('mining-pool').value.trim();
  const threads = parseInt(document.getElementById('mining-threads').value) || 2;
  if (!address || address.length < 20) {
    toast('Enter a valid CryLo wallet address', 'error');
    return;
  }
  try {
    const r = await window.c64.minerStart({ walletAddress: address, workerName: worker, poolUrl: pool, threads });
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
        const s = await window.c64.minerGetStatus();
        if (s.running) {
          document.getElementById('mining-status').textContent = 'Mining active';
          document.getElementById('mining-status').style.color = 'var(--success)';
          document.getElementById('mining-hashrate').textContent = s.hashrate + ' H/s';
	  const info = await window.c64.daemonRpc('get_info');

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
  	      const displayBlockReward = 2.5;
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
            document.getElementById('mining-stat-reward').textContent =
              '2.5000 CryLo';
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
  try { await window.c64.minerStop(); } catch(_) {}
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
    const result = await window.c64.nexusScanNfts(linkedAddress);

    if (!result.ok) {
      statusEl.textContent = result.error || 'Scan failed.';
      return;
    }

    statusEl.textContent =
      `Found ${result.nfts.length} NFT(s) | Vault: ${result.vaultBalance} wCRYLO`;

    let html = '';

    for (const nft of result.nfts) {
      html += `
        <div class="card" style="margin-bottom:12px">
          <div><strong>NFT #${nft.tokenId}</strong></div>
          <div>Mint Code: ${nft.code}</div>
          <div>Eligible: ${nft.eligible ? 'YES' : 'NO'}</div>
          <div>Pool Balance: ${nft.codePool} wCRYLO</div>
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
    console.error(err);
    statusEl.textContent = 'Failed to load Nexus NFTs.';
  }
}

async function ensureCryLoAddressLoaded() {
  if (State.address) return true;

  const addrRes = await window.c64.walletRpc('get_address', { account_index: 0 });
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

  const label = document.getElementById('nexus-wallet-label');
  if (label) {
    label.textContent = State.nexusAddress
      ? 'Bound Nexus Wallet'
      : 'Create / Bind Nexus Wallet';
  }

  const input = document.getElementById('nexus-linked-address');
  const status = document.getElementById('nexus-linked-status');

  if (input) {
    input.value = State.nexusAddress;
    input.setAttribute('value', State.nexusAddress);
  }

  if (status) {
    status.textContent = State.nexusAddress
      ? `Bound Nexus wallet: ${State.nexusAddress}`
      : 'No Nexus wallet created for this CryLo wallet yet.';
  }
}

async function createBoundNexusWallet() {
  const status = document.getElementById('nexus-linked-status');

  if (!(await ensureCryLoAddressLoaded())) {
    if (status) status.textContent = 'Open a CryLo wallet before creating a Nexus wallet.';
    return;
  }

  const result = await window.c64.nexusWalletCreate(State.walletName, State.address);

  if (!result.ok) {
    if (status) status.textContent = `Failed to create Nexus wallet: ${result.error}`;
    return;
  }

  setNexusUiAddress(result.nexusAddress);

  await refreshNexusWcryloBalance();
  await refreshNexusStakedBalance();
  await refreshNexusPendingRewards();
  await refreshNexusNodeStatus();
}

async function loadSavedNexusLinkedAddress() {
  if (!(await ensureCryLoAddressLoaded())) {
    setNexusUiAddress('');
    return;
  }

  const result = await window.c64.nexusWalletLoad(State.walletName, State.address);

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
  if (w) w.textContent = '0.0000 wCRYLO';

  const staked = document.getElementById('nexus-staked-balance');
  if (staked) staked.textContent = '0.0000 wCRYLO';

  const pending = document.getElementById('nexus-pending-rewards');
  if (pending) pending.textContent = '0.0000 wCRYLO';
}

function getLinkedNexusAddress() {
  return State.nexusAddress || '';
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
  const raw = String(amountText || '').trim();
  if (!raw || Number(raw) <= 0) throw new Error('Enter a valid CRYLO amount.');

  const [wholeRaw, fracRaw = ''] = raw.split('.');
  const whole = wholeRaw || '0';
  const frac = (fracRaw + '000000000000').slice(0, 12);

  if (!/^\d+$/.test(whole) || !/^\d{12}$/.test(frac)) {
    throw new Error('Invalid CRYLO amount.');
  }

  return (BigInt(whole) * 1000000000000n + BigInt(frac)).toString();
}

async function startCryLoBridgeIn() {
  try {
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
    const amountAtomic = cryloToAtomic(amountText);

    setBridgeStatus('creating deposit request');

    const req = await window.c64.bridgeRequest({
      nexusAddress,
      cryloAddress: State.address,
      amountAtomic
    });

    if (!req.ok) throw new Error(req.error || 'Bridge request failed.');

    setBridgeField('bridge-payment-id', req.paymentId);
    setBridgeField('bridge-integrated-address', req.integratedAddress);
    setBridgeField('bridge-nexus-tx', '—');

    setBridgeStatus('sending CryLo deposit');

    const tx = await window.c64.walletRpc('transfer', {
      destinations: [{
        address: req.integratedAddress,
        amount: amountAtomic
      }],
      account_index: 0,
      subaddr_indices: [0],
      priority: 0,
      unlock_time: 0,
      get_tx_key: true
    }, 60000);

    if (!tx.ok) throw new Error(
      (tx.error || '').includes('not enough money')
        ? 'Not enough unlocked CRYLO. Try a smaller amount.'
        : (tx.error || 'CryLo transfer failed.')
    );

    const txHash =
      tx.result?.tx_hash ||
      tx.result?.tx_hash_list?.[0] ||
      tx.result?.txid ||
      '';

    setBridgeField('bridge-crylo-tx', txHash || 'sent');

    localStorage.setItem('cryloBridgePending', JSON.stringify({
      paymentId: req.paymentId,
      cryloTx: txHash,
      createdAt: Date.now()
    }));

    setBridgeStatus('waiting for CryLo confirmations');
    pollCryLoBridgeStatus(req.paymentId);
  } catch (e) {
    console.error(e);
    setBridgeStatus(e.message || 'bridge failed');
  }
}

let cryloBridgePollTimer = null;

function pollCryLoBridgeStatus(paymentId) {
  if (cryloBridgePollTimer) clearInterval(cryloBridgePollTimer);

  cryloBridgePollTimer = setInterval(async () => {
    try {
      const res = await window.c64.bridgeStatus(paymentId);

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

        setBridgeField('bridge-nexus-tx', mintTx);
        setBridgeStatus('minted');

        localStorage.removeItem('cryloBridgePending');

        await refreshNexusWcryloBalance();
        setTimeout(() => refreshNexusWcryloBalance(), 5000);
        setTimeout(() => refreshNexusWcryloBalance(), 15000);

        if (typeof updateBalance === 'function') await updateBalance();
        return;
      }

      setBridgeStatus('waiting for CryLo confirmations');
    } catch (e) {
      console.error(e);
      setBridgeStatus(e.message || 'status error');
    }
  }, 10000);
}


async function buyBackNexusNFT(tokenId) {
  const statusEl = document.getElementById('nexus-status');

  statusEl.textContent = `Processing buyback for NFT #${tokenId}...`;

  try {
    const result = await window.c64.nexusBuyBackNft(tokenId, State.walletName, State.address);

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

  try {
    const result = await window.c64.nexusBurnNft(tokenId, State.walletName, State.address);

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
    el.innerHTML = `—<span class="balance-unit"> wCRYLO</span>`;
    return;
  }

  try {
    const result = await window.c64.nexusWcryloBalance(linkedAddress);

    if (!result.ok) {
      el.innerHTML = `—<span class="balance-unit"> wCRYLO</span>`;
      return;
    }

    el.innerHTML = `${Number(result.balance).toFixed(4)}<span class="balance-unit"> wCRYLO</span>`;
  } catch (err) {
    console.error(err);
    el.innerHTML = `—<span class="balance-unit"> wCRYLO</span>`;
  }
}

async function refreshNexusStakedBalance() {
  const el = document.getElementById('bal-staked-wcrylo');
  if (!el) return;

  const linkedAddress =
    getLinkedNexusAddress();

  if (!linkedAddress) {
    el.innerHTML =
      `—<span class="balance-unit"> wCRYLO</span>`;
    return;
  }

  try {
    const result =
      await window.c64.nexusStakedBalance(linkedAddress);

    console.log('STAKED RESULT:', result);

    if (!result.ok) {
      el.innerHTML =
        `0.0000<span class="balance-unit"> wCRYLO</span>`;
      return;
    }

    el.innerHTML =
      `${Number(result.balance).toFixed(4)}<span class="balance-unit"> wCRYLO</span>`;
  } catch (err) {
    console.error(err);

    el.innerHTML =
      `0.0000<span class="balance-unit"> wCRYLO</span>`;
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
      await window.c64.nexusPendingRewards(linkedAddress);

    if (!result.ok) {
      el.textContent = '0.0000';
      return;
    }

    el.textContent = Number(result.rewards).toFixed(6);
  } catch (err) {
    console.error(err);
    el.textContent = '0.0000';
  }
}

async function stakeNexusWcrylo() {
  const statusEl = document.getElementById('nexus-staking-status');
  const input = document.getElementById('nexus-stake-amount');
  const amount = input.value.trim();

  if (!amount || Number(amount) <= 0) {
    statusEl.textContent = 'Enter a valid staking amount.';
    return;
  }

  statusEl.textContent = `Staking ${amount} wCRYLO...`;

  try {
    const result = await window.c64.nexusStakeWcrylo(amount, State.walletName, State.address);

    if (!result.ok) {
      statusEl.textContent = `Stake failed: ${result.error || 'Unknown error'}`;
      return;
    }

    statusEl.textContent = `Staked ${amount} wCRYLO successfully.`;
    input.value = '';

    await refreshNexusWcryloBalance();
    await refreshNexusStakedBalance();
    await refreshNexusPendingRewards();
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

  statusEl.textContent = `Unstaking ${amount} wCRYLO...`;

  try {
    const result = await window.c64.nexusUnstakeWcrylo(amount, State.walletName, State.address);

    if (!result.ok) {
      statusEl.textContent = `Unstake failed: ${result.error || 'Unknown error'}`;
      return;
    }

    statusEl.textContent = `Unstaked ${amount} wCRYLO successfully.`;
    input.value = '';

    await refreshNexusWcryloBalance();
    await refreshNexusStakedBalance();
    await refreshNexusPendingRewards();
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Unstake failed.';
  }
}

async function claimNexusRewards() {
  const statusEl = document.getElementById('nexus-staking-status');

  statusEl.textContent = 'Claiming staking rewards...';

  try {
    const result = await window.c64.nexusClaimRewards(State.walletName, State.address);

    if (!result.ok) {
      const errorText = String(result.error || '').toLowerCase();

      if (
        errorText.includes('no rewards') ||
        errorText.includes('execution reverted')
      ) {
        statusEl.textContent = 'No rewards available to claim.';
        return;
      }

      statusEl.textContent =
        `Claim failed: ${result.error || 'Unknown error'}`;
      return;
    }

    statusEl.textContent =
      'Staking rewards claimed successfully.';

    await refreshNexusWcryloBalance();
    await refreshNexusStakedBalance();
    await refreshNexusPendingRewards();
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Claim failed.';
  }
}

async function refreshNexusNodeStatus() {
  const statusEl = document.getElementById('nexus-node-status');
  if (!statusEl) return;

  const linkedAddress =
    getLinkedNexusAddress();

  if (!linkedAddress) {
    statusEl.textContent = 'No Nexus wallet linked.';
    return;
  }

  try {
    const result = await window.c64.nexusNodeStatus(linkedAddress);

    if (!result.ok) {
      statusEl.textContent = result.error || 'Unable to load node status.';
      return;
    }

    const tierName =
      result.tier === '2' ? 'Validator' :
      result.tier === '1' ? 'Operator' :
      'None';

    statusEl.innerHTML =
      `Tier: <strong>${tierName}</strong> · ` +
      `Stake: <strong>${Number(result.stake).toFixed(4)} wCRYLO</strong> · ` +
      `Pending: <strong>${Number(result.pending).toFixed(6)} wCRYLO</strong>`;
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Unable to load node status.';
  }
}

async function registerNexusOperator() {
  const statusEl = document.getElementById('nexus-node-action-status');
  statusEl.textContent = 'Registering Operator node with 300 wCRYLO...';

  try {
    const result = await window.c64.nexusRegisterOperator(State.walletName, State.address);

    if (!result.ok) {
      statusEl.textContent = `Operator registration failed: ${result.error || 'Unknown error'}`;
      return;
    }

    statusEl.textContent = 'Operator node registered successfully.';
    await refreshNexusWcryloBalance();
    await refreshNexusNodeStatus();
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Operator registration failed.';
  }
}

async function registerNexusValidator() {
  const statusEl = document.getElementById('nexus-node-action-status');
  statusEl.textContent = 'Registering Validator node with 750 wCRYLO...';

  try {
    const result = await window.c64.nexusRegisterValidator(State.walletName, State.address);

    if (!result.ok) {
      statusEl.textContent = `Validator registration failed: ${result.error || 'Unknown error'}`;
      return;
    }

    statusEl.textContent = 'Validator node registered successfully.';
    await refreshNexusWcryloBalance();
    await refreshNexusNodeStatus();
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Validator registration failed.';
  }
}

async function claimNexusNodeRewards() {
  const statusEl = document.getElementById('nexus-node-action-status');
  statusEl.textContent = 'Claiming node rewards...';

  try {
    const result = await window.c64.nexusClaimNodeRewards(State.walletName, State.address);

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
    await refreshNexusWcryloBalance();
    await refreshNexusNodeStatus();
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Node reward claim failed.';
  }
}


window.App = {
  sendMax,
  toggleAdvanced,
  showSetupForm,
  backToSetupCards,
  createWallet,
  openWallet,
  restoreWallet,
  openMainScreen,
  refreshAll,
  switchTab,
  switchWallet,
  sendTx,
  consolidateUtxos,
  copyAddress,
  copyPaymentRequest,
  toggleMining,
  refreshNexusWcryloBalance,
  refreshNexusStakedBalance,
  refreshNexusPendingRewards,
  claimNexusRewards,
  stakeNexusWcrylo,
  unstakeNexusWcrylo,
  refreshNexusNodeStatus,
  registerNexusOperator,
  registerNexusValidator,
  claimNexusNodeRewards,
  startCryLoBridgeIn,
  createBoundNexusWallet,
  loadNexusBuyback,
  buyBackNexusNFT,
  burnNexusNFT,
  initMiningTab
};
