'use strict';

const { ethers } = require('ethers');

const {
  createProvider,
  verifyProvider
} = require('./provider');

const {
  createNodeStakingContract,
  readNodeStatus,
  normalizeAddress
} = require('./node');

const {
  createRewardVaultContract,
  readRewardStatus
} = require('./rewards');

const {
  createRewardManagerContract,
  readRewardManagerLinks
} = require('./manager');

function addressesEqual(left, right) {
  return (
    ethers.getAddress(left) ===
    ethers.getAddress(right)
  );
}

async function createReadOnlyContractClient(
  config,
  options = {}
) {
  if (!config || typeof config !== 'object') {
    throw new TypeError(
      'Contract client configuration is required'
    );
  }

  if (!config.contracts) {
    throw new TypeError(
      'Contract configuration is required'
    );
  }

  const provider =
    options.provider ||
    createProvider(config.rpcUrl, {
      timeout: config.rpcTimeout,
      staticNetwork: false
    });

  const connection = await verifyProvider(provider, {
    expectedChainId: config.chainId
  });

  const configuredNodeStaking =
    normalizeAddress(
      config.contracts.nodeStaking
    );

  const configuredRewardManager =
    normalizeAddress(
      config.contracts.rewardManager
    );

  const rewardManager =
    options.rewardManagerContract ||
    createRewardManagerContract(
      provider,
      configuredRewardManager,
      options
    );

  const managerLinks =
    options.managerLinks ||
    await readRewardManagerLinks(
      rewardManager
    );

  if (
    !addressesEqual(
      managerLinks.nodeStaking,
      configuredNodeStaking
    )
  ) {
    throw new Error(
      'RewardManager nodeStaking address does not match operator configuration'
    );
  }

  const nodeStaking =
    options.nodeStakingContract ||
    createNodeStakingContract(
      provider,
      configuredNodeStaking,
      options
    );

  const rewardVault =
    options.rewardVaultContract ||
    createRewardVaultContract(
      provider,
      managerLinks.rewardVault,
      options
    );

  return {
    provider,

    addresses: {
      nodeStaking: configuredNodeStaking,
      rewardManager: configuredRewardManager,
      rewardVault: managerLinks.rewardVault,
      staking: managerLinks.staking
    },

    initialConnection: connection,

    async verifyConnection() {
      return verifyProvider(provider, {
        expectedChainId: config.chainId
      });
    },

    async readNode(walletAddress) {
      return readNodeStatus(
        nodeStaking,
        walletAddress
      );
    },

    async readOperator(walletAddress) {
      const [node, rewards] = await Promise.all([
        readNodeStatus(
          nodeStaking,
          walletAddress
        ),
        readRewardStatus(
          rewardVault,
          walletAddress
        )
      ]);

      return {
        node,
        rewards
      };
    }
  };
}

module.exports = {
  addressesEqual,
  createReadOnlyContractClient,
  createProvider,
  verifyProvider,
  createNodeStakingContract,
  readNodeStatus,
  createRewardManagerContract,
  readRewardManagerLinks,
  createRewardVaultContract,
  readRewardStatus
};
