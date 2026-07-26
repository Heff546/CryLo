'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateRegistration
} = require('../src/contracts/verification');

function operatorNode(overrides = {}) {
  return {
    registered: true,
    isNodeWallet: true,
    tier: '1',
    tierLabel: 'Operator',
    stakeAtomic: '30000000000000',
    operatorStakeRequirementAtomic:
      '30000000000000',
    validatorStakeRequirementAtomic:
      '75000000000000',
    ...overrides
  };
}

test('verifies a correctly registered operator', () => {
  const result = evaluateRegistration(
    operatorNode(),
    'Operator'
  );

  assert.equal(result.verified, true);
  assert.equal(
    result.messageCode,
    'REGISTERED_OPERATOR'
  );
});

test('rejects a configured tier mismatch', () => {
  const result = evaluateRegistration(
    operatorNode(),
    'Validator'
  );

  assert.equal(result.verified, false);
  assert.equal(
    result.configuredTierMatches,
    false
  );
  assert.equal(
    result.messageCode,
    'REGISTRATION_MISMATCH'
  );
});

test('rejects insufficient node stake', () => {
  const result = evaluateRegistration(
    operatorNode({
      stakeAtomic: '29999999999999'
    }),
    'Operator'
  );

  assert.equal(result.verified, false);
  assert.equal(
    result.stakeRequirementMet,
    false
  );
});

test('reports an unregistered wallet', () => {
  const result = evaluateRegistration(
    operatorNode({
      registered: false,
      isNodeWallet: false,
      tier: '0',
      tierLabel: 'Not Registered',
      stakeAtomic: '0'
    }),
    'Operator'
  );

  assert.equal(result.verified, false);
  assert.equal(
    result.messageCode,
    'NOT_REGISTERED'
  );
});
