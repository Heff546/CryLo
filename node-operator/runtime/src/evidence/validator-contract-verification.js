'use strict';

const CONTRACT_VERIFIED =
  'CONTRACT_VERIFIED';

const CONTRACT_REJECTED =
  'CONTRACT_REJECTED';

function requirePlainObject(
  value,
  name
) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !==
      Object.prototype
  ) {
    throw new TypeError(
      `${name} must be a plain object`
    );
  }

  return value;
}

function evaluateValidatorContractVerification(
  node
) {
  requirePlainObject(
    node,
    'Validator contract verification node status'
  );

  const registered =
    node.registered === true;

  const nodeWallet =
    node.isNodeWallet === true;

  const tier =
    String(
      node.tier
    );

  const validTier =
    tier === '1' ||
    tier === '2';

  let stakeRequirementAtomic =
    null;

  if (tier === '1') {
    stakeRequirementAtomic =
      node.operatorStakeRequirementAtomic;
  } else if (tier === '2') {
    stakeRequirementAtomic =
      node.validatorStakeRequirementAtomic;
  }

  let stakeRequirementMet =
    false;

  if (
    validTier &&
    stakeRequirementAtomic !== null
  ) {
    stakeRequirementMet =
      BigInt(
        node.stakeAtomic
      ) >=
      BigInt(
        stakeRequirementAtomic
      );
  }

  const verified =
    registered &&
    nodeWallet &&
    validTier &&
    stakeRequirementMet;

  let reasonCode =
    'VERIFIED';

  if (!registered) {
    reasonCode =
      'NOT_REGISTERED';
  } else if (!nodeWallet) {
    reasonCode =
      'NOT_NODE_WALLET';
  } else if (!validTier) {
    reasonCode =
      'INVALID_NODE_TIER';
  } else if (!stakeRequirementMet) {
    reasonCode =
      'INSUFFICIENT_STAKE';
  }

  return Object.freeze({
    outcome:
      verified
        ? CONTRACT_VERIFIED
        : CONTRACT_REJECTED,

    verified,
    reasonCode,

    nodeTier:
      tier,

    nodeTierLabel:
      node.tierLabel,

    stakeAtomic:
      String(
        node.stakeAtomic
      ),

    stakeRequirementAtomic:
      stakeRequirementAtomic === null
        ? null
        : String(
            stakeRequirementAtomic
          ),

    registered,
    nodeWallet,
    stakeRequirementMet
  });
}

module.exports = Object.freeze({
  CONTRACT_VERIFIED,
  CONTRACT_REJECTED,
  evaluateValidatorContractVerification
});
