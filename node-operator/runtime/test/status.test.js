'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createInitialStatus
} = require('../src/status');

const {
  validateStatus,
  formatValidationErrors
} = require('../src/schema');

test('initial status satisfies the protocol schema', () => {
  const timestamp =
    '2026-07-01T12:00:00.000Z';

  const status = createInitialStatus({
    serviceVersion: '1.0.0',
    operatorAddress:
      '0x1111111111111111111111111111111111111111',
    nodeId:
      'example-node-public-identity-0001',
    startedAt: timestamp
  });

  assert.equal(
    validateStatus(status),
    true,
    formatValidationErrors(
      validateStatus.errors
    )
  );

  assert.equal(
    status.rewardEligible,
    false
  );

  assert.equal(
    status.registered,
    false
  );
});
