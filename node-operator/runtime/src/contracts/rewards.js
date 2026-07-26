'use strict';

const { ethers } = require('ethers');
const { loadContractAbi } = require('./abi-loader');
const { normalizeAddress } = require('./node');

function createRewardVaultContract(
  provider,
  contractAddress,
  options = {}
) {
  if (!provider) {
    throw new TypeError('Provider is required');
  }

  const address = normalizeAddress(contractAddress);
  const { abi } = loadContractAbi(
    'RewardVault',
    options
  );

  return new ethers.Contract(address, abi, provider);
}

async function readRewardStatus(contract, walletAddress) {
  if (!contract) {
    throw new TypeError('RewardVault contract is required');
  }

  const address = normalizeAddress(walletAddress);

  const [
    pendingRewards,
    vaultBalance,
    assignedPending,
    unassignedBalance,
    lastClaimTime,
    claimCooldown
  ] = await Promise.all([
    contract.pendingRewards(address),
    contract.vaultBalance(),
    contract.totalAssignedPending(),
    contract.unassignedBalance(),
    contract.lastClaimTime(address),
    contract.CLAIM_COOLDOWN()
  ]);

  return {
    address,
    pendingRewardsAtomic: pendingRewards.toString(),
    vaultBalanceAtomic: vaultBalance.toString(),
    assignedPendingAtomic: assignedPending.toString(),
    unassignedBalanceAtomic: unassignedBalance.toString(),
    lastClaimTime: Number(lastClaimTime),
    claimCooldownSeconds: Number(claimCooldown)
  };
}

module.exports = {
  createRewardVaultContract,
  readRewardStatus
};
