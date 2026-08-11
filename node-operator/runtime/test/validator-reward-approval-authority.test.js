'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateValidatorRewardApprovalAuthority
} = require(
  '../src/evidence/validator-reward-approval-authority'
);

function nodeStatus(
  overrides = {}
) {
  return {
    registered: true,
    isNodeWallet: true,
    tier: '2',
    tierLabel: 'Validator',

    stakeAtomic:
      '75000000000000',

    validatorStakeRequirementAtomic:
      '75000000000000',

    ...overrides
  };
}

test(
  'accepts current registered sufficiently staked Validator',
  () => {
    const result =
      evaluateValidatorRewardApprovalAuthority(
        nodeStatus()
      );

    assert.equal(
      result.accepted,
      true
    );

    assert.equal(
      result.reasonCode,
      'APPROVING_VALIDATOR_VALID'
    );
  }
);

test(
  'rejects unregistered approving Validator',
  () => {
    const result =
      evaluateValidatorRewardApprovalAuthority(
        nodeStatus({
          registered: false
        })
      );

    assert.equal(
      result.reasonCode,
      'APPROVING_VALIDATOR_NOT_REGISTERED'
    );
  }
);

test(
  'rejects wallet no longer recognized as node wallet',
  () => {
    const result =
      evaluateValidatorRewardApprovalAuthority(
        nodeStatus({
          isNodeWallet: false
        })
      );

    assert.equal(
      result.reasonCode,
      'APPROVING_VALIDATOR_NOT_NODE_WALLET'
    );
  }
);

test(
  'rejects Operator tier as reward approver',
  () => {
    const result =
      evaluateValidatorRewardApprovalAuthority(
        nodeStatus({
          tier: '1',
          tierLabel: 'Operator'
        })
      );

    assert.equal(
      result.reasonCode,
      'APPROVING_WALLET_NOT_VALIDATOR'
    );
  }
);

test(
  'rejects inconsistent Validator tier label',
  () => {
    const result =
      evaluateValidatorRewardApprovalAuthority(
        nodeStatus({
          tierLabel: 'Operator'
        })
      );

    assert.equal(
      result.reasonCode,
      'APPROVING_WALLET_NOT_VALIDATOR'
    );
  }
);

test(
  'rejects Validator below current stake requirement',
  () => {
    const result =
      evaluateValidatorRewardApprovalAuthority(
        nodeStatus({
          stakeAtomic:
            '74999999999999'
        })
      );

    assert.equal(
      result.reasonCode,
      'APPROVING_VALIDATOR_STAKE_INSUFFICIENT'
    );
  }
);

test(
  'accepts Validator above current stake requirement',
  () => {
    const result =
      evaluateValidatorRewardApprovalAuthority(
        nodeStatus({
          stakeAtomic:
            '90000000000000'
        })
      );

    assert.equal(
      result.accepted,
      true
    );
  }
);

test(
  'rejects malformed authority input',
  () => {
    assert.throws(
      () =>
        evaluateValidatorRewardApprovalAuthority(
          null
        ),
      /plain object/
    );

    assert.throws(
      () =>
        evaluateValidatorRewardApprovalAuthority(
          nodeStatus({
            stakeAtomic:
              'not-a-number'
          })
        ),
      /stake values are invalid/
    );
  }
);
