'use strict';

function evaluateRegistration(
  node,
  configuredTier
) {
  if (!node || typeof node !== 'object') {
    throw new TypeError(
      'Node status is required'
    );
  }

  const stakeRequirementAtomic =
    node.tier === '2'
      ? node.validatorStakeRequirementAtomic
      : node.operatorStakeRequirementAtomic;

  const configuredTierMatches =
    node.registered &&
    node.tierLabel === configuredTier;

  const stakeRequirementMet =
    BigInt(node.stakeAtomic) >=
    BigInt(stakeRequirementAtomic);

  const verified =
    node.registered &&
    node.isNodeWallet &&
    configuredTierMatches &&
    stakeRequirementMet;

  return {
    verified,
    configuredTierMatches,
    stakeRequirementMet,
    stakeRequirementAtomic,
    messageCode:
      verified
        ? `REGISTERED_${node.tierLabel.toUpperCase()}`
        : node.registered
          ? 'REGISTRATION_MISMATCH'
          : 'NOT_REGISTERED'
  };
}

module.exports = {
  evaluateRegistration
};
