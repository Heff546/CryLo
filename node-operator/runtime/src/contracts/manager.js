'use strict';

const { ethers } = require('ethers');
const { loadContractAbi } = require('./abi-loader');
const { normalizeAddress } = require('./node');

function createRewardManagerContract(
  provider,
  contractAddress,
  options = {}
) {
  if (!provider) {
    throw new TypeError('Provider is required');
  }

  const address = normalizeAddress(contractAddress);
  const { abi } = loadContractAbi(
    'RewardManager',
    options
  );

  return new ethers.Contract(address, abi, provider);
}

async function readRewardManagerLinks(contract) {
  if (!contract) {
    throw new TypeError('RewardManager contract is required');
  }

  const [
    nodeStaking,
    rewardVault,
    staking
  ] = await Promise.all([
    contract.nodeStaking(),
    contract.rewardVault(),
    contract.staking()
  ]);

  return {
    nodeStaking: normalizeAddress(nodeStaking),
    rewardVault: normalizeAddress(rewardVault),
    staking: normalizeAddress(staking)
  };
}

module.exports = {
  createRewardManagerContract,
  readRewardManagerLinks
};
