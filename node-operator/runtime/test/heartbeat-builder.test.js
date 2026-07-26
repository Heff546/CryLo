'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildUnsignedHeartbeat,
  heartbeatPayloadHash,
  statusHash
} = require('../src/evidence');

function validOptions() {
  return {
    protocolVersion: '1.0.0',
    chainId: 5546,
    operatorAddress:
      '0x1111111111111111111111111111111111111111',
    nodeId: 'operator-node-001',
    sequence: 42,
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
  };
}

test('builds a deterministic unsigned heartbeat', () => {
  const options = validOptions();
  const heartbeat = buildUnsignedHeartbeat(options);

  const expectedPayload = {
    protocolVersion: options.protocolVersion,
    chainId: options.chainId,
    operatorAddress: options.operatorAddress,
    nodeId: options.nodeId,
    sequence: options.sequence,
    issuedAt: options.issuedAt,
    expiresAt: options.expiresAt,
    nonce: options.nonce,
    statusHash: statusHash(options.status)
  };

  assert.deepEqual(
    heartbeat,
    {
      ...expectedPayload,
      payloadHash:
        heartbeatPayloadHash(expectedPayload)
    }
  );
});

test('defaults protocolVersion to 1.0.0', () => {
  const options = validOptions();
  delete options.protocolVersion;

  const heartbeat = buildUnsignedHeartbeat(options);

  assert.equal(
    heartbeat.protocolVersion,
    '1.0.0'
  );
});

test('returns an immutable heartbeat object', () => {
  const heartbeat =
    buildUnsignedHeartbeat(validOptions());

  assert.equal(
    Object.isFrozen(heartbeat),
    true
  );

  assert.throws(
    () => {
      heartbeat.sequence = 99;
    },
    TypeError
  );
});

test('does not include raw status evidence', () => {
  const heartbeat =
    buildUnsignedHeartbeat(validOptions());

  assert.equal(
    Object.prototype.hasOwnProperty.call(
      heartbeat,
      'status'
    ),
    false
  );

  assert.equal(
    typeof heartbeat.statusHash,
    'string'
  );
});

test('does not generate sequence, nonce, or timestamps', () => {
  const requiredFields = [
    'sequence',
    'nonce',
    'issuedAt',
    'expiresAt'
  ];

  for (const field of requiredFields) {
    const options = validOptions();
    delete options[field];

    assert.throws(
      () => buildUnsignedHeartbeat(options)
    );
  }
});

test('rejects invalid chain IDs', () => {
  for (const chainId of [
    undefined,
    null,
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1
  ]) {
    assert.throws(
      () =>
        buildUnsignedHeartbeat({
          ...validOptions(),
          chainId
        }),
      /chainId must be a positive safe integer/
    );
  }
});

test('rejects invalid sequences', () => {
  for (const sequence of [
    undefined,
    null,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1
  ]) {
    assert.throws(
      () =>
        buildUnsignedHeartbeat({
          ...validOptions(),
          sequence
        }),
      /sequence must be a non-negative safe integer/
    );
  }
});

test('accepts sequence zero', () => {
  const heartbeat =
    buildUnsignedHeartbeat({
      ...validOptions(),
      sequence: 0
    });

  assert.equal(
    heartbeat.sequence,
    0
  );
});

test('rejects missing string fields', () => {
  const fields = [
    'protocolVersion',
    'operatorAddress',
    'nodeId',
    'issuedAt',
    'expiresAt',
    'nonce'
  ];

  for (const field of fields) {
    const options = validOptions();
    options[field] = '';

    assert.throws(
      () => buildUnsignedHeartbeat(options),
      /must be a non-empty string/
    );
  }
});

test('rejects invalid top-level objects', () => {
  for (const value of [
    null,
    undefined,
    true,
    'heartbeat',
    [],
    42
  ]) {
    assert.throws(
      () => buildUnsignedHeartbeat(value),
      /Heartbeat options must be a plain object/
    );
  }
});

test('rejects invalid status evidence', () => {
  for (const status of [
    null,
    undefined,
    true,
    'status',
    [],
    42
  ]) {
    assert.throws(
      () =>
        buildUnsignedHeartbeat({
          ...validOptions(),
          status
        }),
      /status must be a plain object/
    );
  }
});
