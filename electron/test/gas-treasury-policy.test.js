'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');

function epochHelpers() {
  const start = main.indexOf('async function getLatestGasEpoch(');
  const nextSection = main.indexOf('Lightweight native-gas balance lookup.', start);
  const end = nextSection >= 0 ? main.lastIndexOf('/*', nextSection) : -1;
  assert.ok(start > 0 && end > start, 'Gas epoch helper boundaries must exist');
  const context = {};
  vm.runInNewContext(
    main.slice(start, end) +
      '\nthis.helpers = { getLatestGasEpoch, getClaimableGasEpoch };',
    context,
    { timeout: 1000 }
  );
  return context.helpers;
}

function manager(deadline, timestamp, eligible = true, claimed = false) {
  return {
    runner: { getBlock: async () => ({ timestamp }) },
    epochCount: async () => 1n,
    epochs: async () => ({ deadline: BigInt(deadline), claimAmount: 2500000000000000n }),
    eligible: async () => eligible,
    claimed: async () => claimed
  };
}

test('expired Nexus user grant is not claimable even when on-chain eligibility remains true', async () => {
  const { getLatestGasEpoch, getClaimableGasEpoch } = epochHelpers();
  const expired = manager(999, 1000);
  const current = await getLatestGasEpoch(expired, '0xuser');
  assert.equal(current.eligible, false);
  assert.equal(await getClaimableGasEpoch(expired, '0xuser'), null);
});

test('unexpired eligible grant can be claimed once, before the deadline', async () => {
  const { getLatestGasEpoch, getClaimableGasEpoch } = epochHelpers();
  const current = manager(1000, 1000);
  const latest = await getLatestGasEpoch(current, '0xuser');
  assert.equal(latest.eligible, true);
  assert.equal(latest.claimed, false);
  assert.equal(await getClaimableGasEpoch(current, '0xuser'), 1);
  assert.equal(await getClaimableGasEpoch(manager(1001, 1000, false), '0xuser'), null);
  assert.equal(await getClaimableGasEpoch(manager(1001, 1000, true, true), '0xuser'), null);
});

test('wallet and daily gas display cannot present treasury total as one user claim', () => {
  assert.match(app, /Daily allocation:/);
  assert.match(app, /Treasury \(not claimable\):/);
  assert.match(app, /result\.canClaim \? 'Yes' : 'No'/);
  assert.doesNotMatch(app, /\`Daily Gas: \$\{fmtDecimalAmount\(result\.dailyGasAmount/);
  assert.match(main, /gm\.buyGasWithWcrylo\(/);
  assert.doesNotMatch(main, /gm\.buyGasFor\(/);
});
