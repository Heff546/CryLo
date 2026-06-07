'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────
const COIN = 100000000000; // 10^11 atomic units = 1  CryLo

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
  });

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
  toast('Wallet created! Save your seed phrase now.', 'success');
}

async function openWallet() {
  const name = el('open-select').value;
  const pass = el('open-pass').value;

  if (!name) return toast('Please select a wallet.', 'error');

  // Close any currently open wallet first (ignore error if none open)
  await window.c64.walletRpc('close_wallet', { autosave_current: false }).catch(() => {});

  const res = await window.c64.walletRpc('open_wallet', {
    filename: name,
    password: pass
  }, 120000);

  if (!res.ok) return toast(`Failed: ${res.error}`, 'error');

  State.walletName = name;
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
  });

  if (!res.ok) return toast(`Failed: ${res.error}`, 'error');

  State.walletName = name;
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
        el('sb-nethr').textContent = fmtHashrate(info.difficulty / 300);
      }
    }
  } else if (info.difficulty) {
    el('sb-nethr').textContent = fmtHashrate(info.difficulty / 300);
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

// ─── Balance ──────────────────────────────────────────────────────────────────
async function updateBalance() {
  const res = await window.c64.walletRpc('get_balance', { account_index: 0 });

  console.log("get_balance response:", res);

  if (!res.ok) return;

  const r = res.result?.result || res.result || {};

  const total = Number(r.balance || 0);
  const unlocked = Number(r.unlocked_balance || 0);
  const locked = total - unlocked;

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
  if (State.address) {
    el('receive-address').textContent = State.address;
    return;
  }
  const res = await window.c64.walletRpc('get_address', { account_index: 0 });
  if (!res.ok) return;
  State.address = res.result.address;
  el('receive-address').textContent = State.address;
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

  // Update summary
  VESTING_TIERS.forEach((t, i) => {
    el(`vest-t${t.tier}`).textContent = fmt(tierTotals[i]) + '  CryLo';
  });

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
  if (tab === 'nexus')        loadSavedNexusLinkedAddress();
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

	    if (s.blockReward) {
  	      const dailyRewards = blocksPerDay * (Number(s.blockReward) / COIN);

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

	  if (s.blockReward) {
            document.getElementById('mining-stat-reward').textContent =
              fmt(s.blockReward) + ' CryLo';
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
	  ${nft.eligible ? `<button class="btn btn-primary nexus-buyback-btn" style="margin-top:10px" data-token-id="${nft.tokenId}">Buy Back NFT</button>` : ''}
        </div>
      `;
    }

    listEl.innerHTML = html || '<div class="card">No NFTs found.</div>';
    
    document.querySelectorAll('.nexus-buyback-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        buyBackNexusNFT(btn.dataset.tokenId);
      });
    });

  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Failed to load Nexus NFTs.';
  }
}

function saveNexusLinkedAddress() {
  const addr = document.getElementById('nexus-linked-address').value.trim();

  localStorage.setItem('crylo_nexus_address', addr);

  const status = document.getElementById('nexus-linked-status');
  status.textContent = `Linked Nexus wallet: ${addr}`;
}

function loadSavedNexusLinkedAddress() {
  const addr = localStorage.getItem('crylo_nexus_address') || '';

  const input = document.getElementById('nexus-linked-address');
  const status = document.getElementById('nexus-linked-status');

  if (input) input.value = addr;

  if (addr) {
    status.textContent = `Linked Nexus wallet: ${addr}`;
  }
}

async function buyBackNexusNFT(tokenId) {
  const statusEl = document.getElementById('nexus-status');

  statusEl.textContent = `Processing buyback for NFT #${tokenId}...`;

  try {
    const result = await window.c64.nexusBuyBackNft(tokenId);

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
  loadNexusBuyback,
  saveNexusLinkedAddress,
  buyBackNexusNFT,
  initMiningTab
};
