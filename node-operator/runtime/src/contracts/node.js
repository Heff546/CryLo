'use strict';

const { ethers } = require('ethers');
const { loadContractAbi } = require('./abi-loader');

const NODE_TIER = Object.freeze({
  NONE: '0',
  OPERATOR: '1',
  VALIDATOR: '2'
});

function normalizeAddress(address) {
  if (!ethers.isAddress(address)) {
    throw new Error(`Invalid Nexus address: ${address}`);
  }

  return ethers.getAddress(address);
}

function tierLabel(tier) {
  switch (tier.toString()) {
    case NODE_TIER.OPERATOR:
      return 'Operator';
    case NODE_TIER.VALIDATOR:
      return 'Validator';
    default:
      return 'Not Registered';
  }
}

function createNodeStakingContract(
  provider,
  contractAddress,
  options = {}
) {
  if (!provider) {
    throw new TypeError('Provider is required');
  }

  const address = normalizeAddress(contractAddress);
  const { abi } = loadContractAbi(
    'NodeStaking',
    options
  );

  return new ethers.Contract(address, abi, provider);
}

async function readNodeStatus(contract, walletAddress) {
  if (!contract) {
    throw new TypeError('NodeStaking contract is required');
  }

  const address = normalizeAddress(walletAddress);

  const [
    tier,
    stake,
    operatorStakeRequirement,
    validatorStakeRequirement,
    isNodeWallet
  ] = await Promise.all([
    contract.nodeTier(address),
    contract.nodeStake(address),
    contract.operatorStakeRequirement(),
    contract.validatorStakeRequirement(),
    contract.isNodeWallet(address)
  ]);

  const normalizedTier = tier.toString();
  const registered = normalizedTier !== NODE_TIER.NONE;

  return {
    address,
    registered,
    isNodeWallet: Boolean(isNodeWallet),
    tier: normalizedTier,
    tierLabel: tierLabel(normalizedTier),
    stakeAtomic: stake.toString(),
    operatorStakeRequirementAtomic:
      operatorStakeRequirement.toString(),
    validatorStakeRequirementAtomic:
      validatorStakeRequirement.toString()
  };
}

module.exports = {
  NODE_TIER,
  createNodeStakingContract,
  normalizeAddress,
  readNodeStatus,
  tierLabel
};
