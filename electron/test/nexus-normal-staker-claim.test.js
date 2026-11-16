'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { claimNormalStakerRewards } = require('../security/normal-staker-reward-claim');

const DAY = 86400n;
const START = 1728000000n;
const WALLET = '0x1111111111111111111111111111111111111111';

function fixture({ pending = 0n, days = {}, next = START + 4n*DAY, failClaim = false } = {}) {
  const state = { pending, days, txs: [], claimed: 0n };
  const vault = {
    pendingRewards: async () => state.pending,
    preparedDailySettlementActivated: async day => !!state.days[day]?.active,
    stagedStakerWalletSeen: async day => !!state.days[day]?.seen,
    activatedStakerRewardClaimed: async day => !!state.days[day]?.materialized,
    stagedStakerPayoutByWallet: async day => state.days[day]?.amount ?? 0n,
    materializeActivatedStakerReward: async day => {
      state.txs.push('materialize:' + day);
      state.days[day].materialized = true;
      state.pending += state.days[day].amount;
      return { hash: '0xabc', wait: async () => ({ status: 1, blockNumber: 9 }) };
    },
    claim: async () => {
      if (failClaim) throw Error('Claim cooldown active');
      state.txs.push('claim');
      state.claimed += state.pending;
      state.pending = 0n;
      return { hash: '0xdef', wait: async () => ({ status: 1, blockNumber: 10 }) };
    }
  };
  const manager = {
    firstRewardDayStartedAt: async () => START,
    nextUnaccountedRewardDay: async () => next
  };
  const cursors = new Map();
  const claim = (extras = {}) => claimNormalStakerRewards({
    vault, manager, walletAddress: WALLET,
    cursorKey: 'chain:vault:wallet', cursors, ...extras
  });
  return { state, vault, manager, cursors, claim };
}

test('already materialized Vault balance claims once without scanning', async () => {
  const f = fixture({ pending: 50n });
  const res = await f.claim();
  assert.equal(res.claimed, 50n);
  assert.deepEqual(f.state.txs, ['claim']);
  assert.equal(f.state.pending, 0n);
});

test('activated normal-staker reward materializes and claims exact credited amount', async () => {
  const f = fixture({ days: { [START+DAY]: { active: true, seen: true, amount: 22n } } });
  const res = await f.claim();
  assert.equal(res.ok, true);
  assert.equal(res.claimed, 22n);
  assert.equal(res.materializedDay, String(START+DAY));
  assert.deepEqual(f.state.txs, ['materialize:'+(START+DAY), 'claim']);
});

test('never touches an unactivated day or an ineligible wallet', async () => {
  const f = fixture({ days: {
    [START]: { active: false, seen: true, amount: 70n },
    [START+DAY]: { active: true, seen: false, amount: 20n }
  } });
  const res = await f.claim();
  assert.equal(res.noRewards, true);
  assert.deepEqual(f.state.txs, []);
});

test('scan makes bounded oldest-first progress across calls', async () => {
  const f = fixture({ days: { [START+3n*DAY]: { active: true, seen: true, amount: 8n } } });
  assert.equal((await f.claim({ maxDaysPerCheck: 2 })).continueScan, true);
  assert.equal(f.cursors.get('chain:vault:wallet'), START+2n*DAY);
  const res = await f.claim({ maxDaysPerCheck: 2 });
  assert.equal(res.claimed, 8n);
  assert.equal(res.ok, true);
});

test('already-materialized day is skipped; never double credits', async () => {
  const f = fixture({ days: { [START]: { active: true, seen: true, amount: 50n, materialized: true } } });
  const res = await f.claim();
  assert.equal(res.noRewards, true);
  assert.deepEqual(f.state.txs, []);
});

test('zero payout does not waste transaction gas', async () => {
  const f = fixture({ days: { [START]: { active: true, seen: true, amount: 0n } } });
  const res = await f.claim();
  assert.equal(res.noRewards, true);
  assert.deepEqual(f.state.txs, []);
});

test('claim failure after materialization is reported without false success', async () => {
  const f = fixture({ days: { [START]: { active: true, seen: true, amount: 9n } }, failClaim: true });
  const res = await f.claim();
  assert.equal(res.ok, false);
  assert.equal(res.creditReady, true);
  assert.equal(f.state.pending, 9n);
  assert.deepEqual(f.state.txs, ['materialize:'+START]);
});

test('requires a valid on-chain first reward day; fails closed', async () => {
  const f = fixture();
  f.manager.firstRewardDayStartedAt = async () => 0n;
  await assert.rejects(() => f.claim(), /First reward day/);
});

test('missing manager does not block an already materialized claim', async () => {
  const f = fixture({ pending: 2n });
  const res = await f.claim({ manager: null });
  assert.equal(res.claimed, 2n);
});
