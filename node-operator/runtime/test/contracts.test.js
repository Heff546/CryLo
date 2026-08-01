'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  NODE_TIER,
  readNodeStatus,
  tierLabel
} = require('../src/contracts/node');

const {
  readRewardStatus
} = require('../src/contracts/rewards');

const TEST_ADDRESS =
  '0x1111111111111111111111111111111111111111';

test('tierLabel maps known node tiers', () => {
  assert.equal(
    tierLabel(NODE_TIER.NONE),
    'Not Registered'
  );

  assert.equal(
    tierLabel(NODE_TIER.OPERATOR),
    'Operator'
  );

  assert.equal(
    tierLabel(NODE_TIER.VALIDATOR),
    'Validator'
  );

  assert.equal(tierLabel('99'), 'Not Registered');
});

test('readNodeStatus normalizes contract results', async () => {
  const contract = {
    nodeTier: async () => 1n,
    nodeStake: async () => 30000000000000n,
    operatorStakeRequirement:
      async () => 30000000000000n,
    validatorStakeRequirement:
      async () => 75000000000000n,
    isNodeWallet: async () => true
  };

  const result = await readNodeStatus(
    contract,
    TEST_ADDRESS
  );

  assert.equal(result.registered, true);
  assert.equal(result.isNodeWallet, true);
  assert.equal(result.tier, '1');
  assert.equal(result.tierLabel, 'Operator');
  assert.equal(
    result.stakeAtomic,
    '30000000000000'
  );
  assert.equal(
    result.operatorStakeRequirementAtomic,
    '30000000000000'
  );
  assert.equal(
    result.validatorStakeRequirementAtomic,
    '75000000000000'
  );
});

test('readNodeStatus identifies an unregistered wallet', async () => {
  const contract = {
    nodeTier: async () => 0n,
    nodeStake: async () => 0n,
    operatorStakeRequirement:
      async () => 30000000000000n,
    validatorStakeRequirement:
      async () => 75000000000000n,
    isNodeWallet: async () => false
  };

  const result = await readNodeStatus(
    contract,
    TEST_ADDRESS
  );

  assert.equal(result.registered, false);
  assert.equal(result.isNodeWallet, false);
  assert.equal(result.tierLabel, 'Not Registered');
});

test('readRewardStatus normalizes reward values', async () => {
  const contract = {
    pendingRewards: async () => 125000000000n,
    vaultBalance: async () => 9000000000000n,
    totalAssignedPending: async () => 500000000000n,
    unassignedBalance: async () => 8500000000000n,
    lastClaimTime: async () => 1720000000n,
    CLAIM_COOLDOWN: async () => 86400n
  };

  const result = await readRewardStatus(
    contract,
    TEST_ADDRESS
  );

  assert.equal(
    result.pendingRewardsAtomic,
    '125000000000'
  );

  assert.equal(
    result.vaultBalanceAtomic,
    '9000000000000'
  );

  assert.equal(
    result.assignedPendingAtomic,
    '500000000000'
  );

  assert.equal(
    result.unassignedBalanceAtomic,
    '8500000000000'
  );

  assert.equal(result.lastClaimTime, 1720000000);
  assert.equal(result.claimCooldownSeconds, 86400);
});

test('read functions reject invalid wallet addresses', async () => {
  const nodeContract = {
    nodeTier: async () => 0n
  };

  const rewardContract = {
    pendingRewards: async () => 0n
  };

  await assert.rejects(
    () => readNodeStatus(nodeContract, 'invalid'),
    /Invalid Nexus address/
  );

  await assert.rejects(
    () => readRewardStatus(rewardContract, 'invalid'),
    /Invalid Nexus address/
  );
});

test('loads the bundled production contract ABIs', () => {
  const {
    loadContractAbi
  } = require('../src/contracts/abi-loader');

  for (const contractName of [
    'NodeStaking',
    'RewardManager',
    'RewardVault',
    'Staking'
  ]) {
    const loaded = loadContractAbi(contractName);

    assert.ok(Array.isArray(loaded.abi));
    assert.ok(loaded.abi.length > 0);
    assert.ok(loaded.path.endsWith('.json'));
  }
});

test('bundled production ABIs expose required read-only methods', () => {
  const {
    loadContractAbi
  } = require('../src/contracts/abi-loader');

  const nodeAbi = loadContractAbi('NodeStaking').abi;
  const rewardAbi = loadContractAbi('RewardVault').abi;

  const nodeFunctions = new Set(
    nodeAbi
      .filter(item => item.type === 'function')
      .map(item => item.name)
  );

  const rewardFunctions = new Set(
    rewardAbi
      .filter(item => item.type === 'function')
      .map(item => item.name)
  );

  for (const name of [
    'nodeTier',
    'nodeStake',
    'operatorStakeRequirement',
    'validatorStakeRequirement',
    'isNodeWallet'
  ]) {
    assert.ok(
      nodeFunctions.has(name),
      `NodeStaking ABI is missing ${name}`
    );
  }

  for (const name of [
    'pendingRewards',
    'vaultBalance',
    'totalAssignedPending',
    'unassignedBalance',
    'lastClaimTime',
    'CLAIM_COOLDOWN'
  ]) {
    assert.ok(
      rewardFunctions.has(name),
      `RewardVault ABI is missing ${name}`
    );
  }
});

test('contract client rejects mismatched manager links', async () => {
  const {
    createReadOnlyContractClient
  } = require('../src/contracts');

  const provider = {
    getNetwork: async () => ({
      chainId: 5546n
    }),
    getBlockNumber: async () => 123
  };

  const config = {
    rpcUrl: 'https://example.invalid',
    chainId: 5546,
    contracts: {
      nodeStaking:
        '0x1111111111111111111111111111111111111111',
      rewardManager:
        '0x2222222222222222222222222222222222222222'
    }
  };

  await assert.rejects(
    () =>
      createReadOnlyContractClient(
        config,
        {
          provider,
          rewardManagerContract: {},
          managerLinks: {
            nodeStaking:
              '0x3333333333333333333333333333333333333333',
            rewardVault:
              '0x4444444444444444444444444444444444444444',
            staking:
              '0x5555555555555555555555555555555555555555'
          }
        }
      ),
    /does not match operator configuration/
  );
});
