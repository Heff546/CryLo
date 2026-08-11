'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CONTRACT_VERIFIED,
  CONTRACT_REJECTED,
  evaluateValidatorContractVerification
} = require(
  '../src/evidence/validator-contract-verification'
);

function nodeStatus(
  overrides = {}
) {
  return {
    registered:
      true,

    isNodeWallet:
      true,

    tier:
      '1',

    tierLabel:
      'Operator',

    stakeAtomic:
      '30000000000000',

    operatorStakeRequirementAtomic:
      '30000000000000',

    validatorStakeRequirementAtomic:
      '75000000000000',

    ...overrides
  };
}

test(
  'verifies registered Operator meeting current stake requirement',
  () => {
    const result =
      evaluateValidatorContractVerification(
        nodeStatus()
      );

    assert.equal(
      result.outcome,
      CONTRACT_VERIFIED
    );

    assert.equal(
      result.verified,
      true
    );

    assert.equal(
      result.reasonCode,
      'VERIFIED'
    );
  }
);

test(
  'verifies upgraded Validator meeting current Validator stake requirement',
  () => {
    const result =
      evaluateValidatorContractVerification(
        nodeStatus({
          tier:
            '2',
          tierLabel:
            'Validator',
          stakeAtomic:
            '75000000000000'
        })
      );

    assert.equal(
      result.outcome,
      CONTRACT_VERIFIED
    );

    assert.equal(
      result.stakeRequirementAtomic,
      '75000000000000'
    );
  }
);

test(
  'rejects unregistered target',
  () => {
    const result =
      evaluateValidatorContractVerification(
        nodeStatus({
          registered:
            false,
          tier:
            '0',
          tierLabel:
            'Not Registered',
          stakeAtomic:
            '0'
        })
      );

    assert.equal(
      result.outcome,
      CONTRACT_REJECTED
    );

    assert.equal(
      result.reasonCode,
      'NOT_REGISTERED'
    );
  }
);

test(
  'rejects wallet no longer recognized as node wallet',
  () => {
    const result =
      evaluateValidatorContractVerification(
        nodeStatus({
          isNodeWallet:
            false
        })
      );

    assert.equal(
      result.outcome,
      CONTRACT_REJECTED
    );

    assert.equal(
      result.reasonCode,
      'NOT_NODE_WALLET'
    );
  }
);

test(
  'rejects Operator below current Operator stake requirement',
  () => {
    const result =
      evaluateValidatorContractVerification(
        nodeStatus({
          stakeAtomic:
            '29999999999999'
        })
      );

    assert.equal(
      result.outcome,
      CONTRACT_REJECTED
    );

    assert.equal(
      result.reasonCode,
      'INSUFFICIENT_STAKE'
    );
  }
);

test(
  'rejects Validator below current Validator stake requirement',
  () => {
    const result =
      evaluateValidatorContractVerification(
        nodeStatus({
          tier:
            '2',
          tierLabel:
            'Validator',
          stakeAtomic:
            '74999999999999'
        })
      );

    assert.equal(
      result.outcome,
      CONTRACT_REJECTED
    );

    assert.equal(
      result.reasonCode,
      'INSUFFICIENT_STAKE'
    );

    assert.equal(
      result.stakeRequirementAtomic,
      '75000000000000'
    );
  }
);

test(
  'rejects unknown on-chain node tier',
  () => {
    const result =
      evaluateValidatorContractVerification(
        nodeStatus({
          tier:
            '99',
          tierLabel:
            'Not Registered'
        })
      );

    assert.equal(
      result.outcome,
      CONTRACT_REJECTED
    );

    assert.equal(
      result.reasonCode,
      'INVALID_NODE_TIER'
    );
  }
);

test(
  'rejects malformed input',
  () => {
    assert.throws(
      () =>
        evaluateValidatorContractVerification(
          null
        ),
      /must be a plain object/
    );
  }
);
