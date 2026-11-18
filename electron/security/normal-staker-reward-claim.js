'use strict';

// Read-only day scans are bounded and chronological. The cursor is only
// an in-memory performance hint; Vault state remains payout authority.
const UTC_DAY = 86400n;
const MAX_DAYS_PER_CHECK = 31;

function validDay(value, label) {
  const day = BigInt(value);
  if (day <= 0n || day > 0xffffffffffffffffn || day % UTC_DAY !== 0n) {
    throw new Error(label + ' must be a positive UTC-aligned day');
  }
  return day;
}

async function confirmed(tx) {
  const receipt = await tx.wait();
  if (!receipt || (receipt.status !== 1 && receipt.status !== 1n)) {
    throw new Error('Nexus reward transaction was not confirmed');
  }
  return receipt;
}

async function claimNormalStakerRewards({
  vault, manager = null, walletAddress, cursorKey, cursors,
  maxDaysPerCheck = MAX_DAYS_PER_CHECK
}) {
  if (!vault || typeof vault.pendingRewards !== 'function' ||
      typeof vault.claim !== 'function' || !walletAddress ||
      typeof cursorKey !== 'string' || !cursorKey ||
      !(cursors instanceof Map)) {
    throw new TypeError('Verified RewardVault, wallet and scan state required');
  }
  if (!Number.isSafeInteger(maxDaysPerCheck) ||
      maxDaysPerCheck < 1 || maxDaysPerCheck > 31) {
    throw new RangeError('Daily reward scan size must be 1..31');
  }

  async function claimPending() {
    const amount = BigInt(await vault.pendingRewards(walletAddress));
    if (amount === 0n) return null;
    const tx = await vault.claim();
    const receipt = await confirmed(tx);
    return { ok: true, claimed: amount, txHash: tx.hash,
      blockNumber: receipt.blockNumber };
  }

  // A Vault pending balance can include node and already-materialized
  // normal-staker payouts. Never double-credit or claim either twice.
  const ready = await claimPending();
  if (ready) return ready;

  if (!manager || typeof manager.firstRewardDayStartedAt !== 'function' ||
      typeof manager.nextUnaccountedRewardDay !== 'function') {
    return { ok: false, error: 'RewardManager is not available for historical staking claims.' };
  }

  const first = validDay(await manager.firstRewardDayStartedAt(), 'First reward day');
  const next = validDay(await manager.nextUnaccountedRewardDay(), 'Next reward day');
  if (next < first) throw new Error('Invalid chronological reward-day cursor');

  let day = cursors.get(cursorKey) ?? first;
  if (day < first || day >= next) day = first;
  let scanned = 0;
  while (day < next && scanned < maxDaysPerCheck) {
    const current = day;
    day += UTC_DAY;
    scanned++;
    if (!await vault.preparedDailySettlementActivated(current) ||
        !await vault.stagedStakerWalletSeen(current, walletAddress) ||
        await vault.activatedStakerRewardClaimed(current, walletAddress)) {
      continue;
    }
    const amount = BigInt(await vault.stagedStakerPayoutByWallet(current, walletAddress));
    if (amount === 0n) continue;
    const materializeTx = await vault.materializeActivatedStakerReward(current);
    await confirmed(materializeTx);
    cursors.set(cursorKey, day);
    try {
      const claimed = await claimPending();
      if (!claimed || claimed.claimed < amount) {
        throw new Error('Materialized staker balance was not available in RewardVault');
      }
      return { ...claimed, materializedDay: current.toString() };
    } catch (error) {
      // The materialization is already on-chain. Never report that the
      // subsequent claim succeeded when it did not.
      return { ok: false, creditReady: true, materializedDay: current.toString(),
        error: 'Daily reward was materialized, but the Vault claim is not complete: ' +
          (error?.shortMessage || error?.message || String(error)) };
    }
  }
  if (day < next) {
    cursors.set(cursorKey, day);
    return { ok: false, continueScan: true, scannedDays: scanned,
      error: 'Historical reward review is not finished; check again to continue.' };
  }
  cursors.delete(cursorKey);
  return { ok: false, noRewards: true, error: 'No claimable or unmaterialized rewards found.' };
}

module.exports = { claimNormalStakerRewards };
