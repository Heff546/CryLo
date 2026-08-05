'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildUnsignedHeartbeat,
  validateUnsignedHeartbeat
} = require('../src/evidence');

function heartbeat() {
  return buildUnsignedHeartbeat({
    protocolVersion: '2.0.0',
    chainId: 5546,
    operatorAddress:
      '0x1111111111111111111111111111111111111111',
    sessionAddress:
      '0x2222222222222222222222222222222222222222',
    delegationHash:
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    authorizationExpiresAt:
      '2099-01-01T00:00:00.000Z',
    nodeId: 'operator-node-001',
    sequence: 1,
    issuedAt: '2026-07-26T20:00:00.000Z',
    expiresAt: '2026-07-26T20:02:00.000Z',
    nonce:
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    status: {
      chainId: 5546,
      connected: true,
      registered: true,
      rewardEligible: false
    }
  });
}

test('valid heartbeat passes validation', () => {
  assert.equal(
    validateUnsignedHeartbeat(heartbeat()),
    true
  );
});

test('modified payloadHash fails', () => {
  const h = { ...heartbeat() };

  h.payloadHash =
    '0x' + '0'.repeat(64);

  assert.throws(
    () => validateUnsignedHeartbeat(h),
    /payloadHash/
  );
});

test('modified statusHash fails', () => {
  const h = { ...heartbeat() };

  h.statusHash =
    '0x' + '1'.repeat(64);

  assert.throws(
    () => validateUnsignedHeartbeat(h)
  );
});

test('wrong chain fails', () => {
  const h = {
    ...heartbeat(),
    chainId: 9999
  };

  assert.throws(
    () => validateUnsignedHeartbeat(h)
  );
});

test('bad address fails', () => {
  const h = {
    ...heartbeat(),
    operatorAddress: 'abc'
  };

  assert.throws(
    () => validateUnsignedHeartbeat(h)
  );
});

test('bad nonce fails', () => {
  const h = {
    ...heartbeat(),
    nonce: 'abc'
  };

  assert.throws(
    () => validateUnsignedHeartbeat(h)
  );
});

test('expiration before issue fails', () => {
  const h = {
    ...heartbeat(),
    expiresAt: '2026-07-26T19:59:59.000Z'
  };

  assert.throws(
    () => validateUnsignedHeartbeat(h)
  );
});
