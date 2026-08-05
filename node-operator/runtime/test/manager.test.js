'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  readRewardManagerLinks
} = require('../src/contracts/manager');

const NODE =
  '0x1111111111111111111111111111111111111111';

const VAULT =
  '0x2222222222222222222222222222222222222222';

const STAKING =
  '0x3333333333333333333333333333333333333333';

test('reads authoritative RewardManager links', async () => {
  const contract = {
    nodeStaking: async () => NODE,
    rewardVault: async () => VAULT,
    staking: async () => STAKING
  };

  const links =
    await readRewardManagerLinks(contract);

  assert.equal(links.nodeStaking, NODE);
  assert.equal(links.rewardVault, VAULT);
  assert.equal(links.staking, STAKING);
});

test('rejects a missing RewardManager contract', async () => {
  await assert.rejects(
    () => readRewardManagerLinks(null),
    /RewardManager contract is required/
  );
});
