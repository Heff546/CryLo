'use strict';

const {
  createProvider,
  verifyProvider
} = require('./provider');

const {
  createNodeStakingContract,
  readNodeStatus
} = require('./node');

const {
  createRewardVaultContract,
  readRewardStatus
} = require('./rewards');

async function createReadOnlyContractClient(config, options = {}) {
  if (!config || typeof config !== 'object') {
    throw new TypeError('Contract client configuration is required');
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

  const nodeStaking =
    options.nodeStakingContract ||
    createNodeStakingContract(
      provider,
      config.nodeStakingAddress,
      options
    );

  const rewardVault =
    options.rewardVaultContract ||
    createRewardVaultContract(
      provider,
      config.rewardVaultAddress,
      options
    );

  return {
    provider,
    connection,

    async readOperator(walletAddress) {
      const [node, rewards] = await Promise.all([
        readNodeStatus(nodeStaking, walletAddress),
        readRewardStatus(rewardVault, walletAddress)
      ]);

      return {
        connection,
        node,
        rewards
      };
    }
  };
}

module.exports = {
  createReadOnlyContractClient,
  createProvider,
  verifyProvider,
  createNodeStakingContract,
  readNodeStatus,
  createRewardVaultContract,
  readRewardStatus
};
