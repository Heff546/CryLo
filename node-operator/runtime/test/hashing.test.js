'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  canonicalHash,
  canonicalJson,
  heartbeatPayloadHash,
  isCanonicalHash,
  statusHash
} = require('../src/evidence');

test('same logical object produces the same hash', () => {
  const first = {
    connected: true,
    metrics: {
      failures: 0,
      successes: 10
    },
    nodeId: 'node-001'
  };

  const second = {
    nodeId: 'node-001',
    metrics: {
      successes: 10,
      failures: 0
    },
    connected: true
  };

  assert.equal(
    canonicalJson(first),
    canonicalJson(second)
  );

  assert.equal(
    canonicalHash(first),
    canonicalHash(second)
  );
});

test('different evidence produces a different hash', () => {
  assert.notEqual(
    canonicalHash({
      connected: true
    }),
    canonicalHash({
      connected: false
    })
  );
});

test('canonical hash is lowercase Keccak-256', () => {
  const hash = canonicalHash({
    chainId: 5546
  });

  assert.match(
    hash,
    /^0x[0-9a-f]{64}$/
  );

  assert.equal(
    isCanonicalHash(hash),
    true
  );
});

test('statusHash hashes normalized status evidence', () => {
  const status = {
    chainId: 5546,
    connected: true,
    operatorAddress:
      '0x1111111111111111111111111111111111111111',
    rewardEligible: false
  };

  assert.equal(
    statusHash(status),
    canonicalHash(status)
  );
});

test('statusHash rejects invalid top-level values', () => {
  for (const value of [
    null,
    'status',
    1,
    true,
    []
  ]) {
    assert.throws(
      () => statusHash(value),
      /plain object/
    );
  }
});

test('heartbeat payload hash excludes self-reference fields', () => {
  const payload = {
    protocolVersion: '1.0.0',
    chainId: 5546,
    nodeId: 'node-001',
    sequence: 1,
    nonce:
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    statusHash:
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  };

  assert.equal(
    heartbeatPayloadHash(payload),
    canonicalHash(payload)
  );

  assert.throws(
    () =>
      heartbeatPayloadHash({
        ...payload,
        payloadHash:
          '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
      }),
    /must not include payloadHash/
  );

  assert.throws(
    () =>
      heartbeatPayloadHash({
        ...payload,
        signature: null
      }),
    /must not include signature/
  );
});

test('heartbeat payload hash rejects invalid top-level values', () => {
  for (const value of [
    null,
    'heartbeat',
    1,
    true,
    []
  ]) {
    assert.throws(
      () => heartbeatPayloadHash(value),
      /plain object/
    );
  }
});

test('isCanonicalHash rejects malformed values', () => {
  const malformed = [
    null,
    '',
    'abcd',
    `0x${'a'.repeat(63)}`,
    `0x${'a'.repeat(65)}`,
    `0X${'a'.repeat(64)}`,
    `0x${'A'.repeat(64)}`,
    `0x${'g'.repeat(64)}`
  ];

  for (const value of malformed) {
    assert.equal(
      isCanonicalHash(value),
      false
    );
  }
});
