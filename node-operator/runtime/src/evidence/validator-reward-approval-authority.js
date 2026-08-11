'use strict';

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

function evaluateValidatorRewardApprovalAuthority(
  node
) {
  requirePlainObject(
    node,
    'Validator reward approval authority NodeStaking status'
  );

  if (node.registered !== true) {
    return Object.freeze({
      accepted: false,
      reasonCode:
        'APPROVING_VALIDATOR_NOT_REGISTERED'
    });
  }

  if (node.isNodeWallet !== true) {
    return Object.freeze({
      accepted: false,
      reasonCode:
        'APPROVING_VALIDATOR_NOT_NODE_WALLET'
    });
  }

  /*
   * Reward approval authority is Validator-only.
   * Unlike target reward verification, Operator tier
   * is never sufficient here.
   */
  if (
    String(node.tier) !== '2' ||
    node.tierLabel !== 'Validator'
  ) {
    return Object.freeze({
      accepted: false,
      reasonCode:
        'APPROVING_WALLET_NOT_VALIDATOR'
    });
  }

  let stake;
  let requirement;

  try {
    stake =
      BigInt(
        node.stakeAtomic
      );

    requirement =
      BigInt(
        node.validatorStakeRequirementAtomic
      );
  } catch (error) {
    throw new TypeError(
      'Approving Validator stake values are invalid',
      {
        cause:
          error
      }
    );
  }

  if (stake < requirement) {
    return Object.freeze({
      accepted: false,
      reasonCode:
        'APPROVING_VALIDATOR_STAKE_INSUFFICIENT'
    });
  }

  return Object.freeze({
    accepted: true,
    reasonCode:
      'APPROVING_VALIDATOR_VALID'
  });
}

module.exports = Object.freeze({
  evaluateValidatorRewardApprovalAuthority
});
