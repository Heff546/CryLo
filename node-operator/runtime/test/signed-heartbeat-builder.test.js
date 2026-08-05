'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSignedHeartbeat,
  isCanonicalSignature,
  recoverHeartbeatSigner,
  validateUnsignedHeartbeat,
  verifyHeartbeatSignature
} = require('../src/evidence');

const PRIVATE_KEY =
  '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const OPERATOR_ADDRESS =
  '0xFCAd0B19bB29D4674531d6f115237E16AfCE377c';

function validOptions() {
  return {
    privateKey: PRIVATE_KEY,
    protocolVersion: '2.0.0',
    chainId: 5546,
    operatorAddress:
      '0x1111111111111111111111111111111111111111',
    sessionAddress: OPERATOR_ADDRESS,
    delegationHash:
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    authorizationExpiresAt:
      '2099-01-01T00:00:00.000Z',
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

function unsignedFromSigned(heartbeat) {
  const {
    signature,
    ...unsignedHeartbeat
  } = heartbeat;

  return unsignedHeartbeat;
}

test(
  'builds a valid signed heartbeat',
  () => {
    const heartbeat =
      buildSignedHeartbeat(validOptions());

    assert.equal(
      validateUnsignedHeartbeat(
        unsignedFromSigned(heartbeat)
      ),
      true
    );

    assert.equal(
      isCanonicalSignature(
        heartbeat.signature
      ),
      true
    );

    assert.equal(
      verifyHeartbeatSignature({
        payloadHash:
          heartbeat.payloadHash,
        signature:
          heartbeat.signature,
        expectedOperatorAddress:
          heartbeat.sessionAddress
      }).valid,
      true
    );
  }
);

test(
  'recovers the heartbeat session signer',
  () => {
    const heartbeat =
      buildSignedHeartbeat(validOptions());

    assert.equal(
      recoverHeartbeatSigner(
        heartbeat.payloadHash,
        heartbeat.signature
      ),
      OPERATOR_ADDRESS
    );
  }
);

test(
  'returns an immutable heartbeat',
  () => {
    const heartbeat =
      buildSignedHeartbeat(validOptions());

    assert.equal(
      Object.isFrozen(heartbeat),
      true
    );

    assert.throws(
      () => {
        heartbeat.signature = 'modified';
      },
      TypeError
    );
  }
);

test(
  'does not expose the private key or raw status',
  () => {
    const heartbeat =
      buildSignedHeartbeat(validOptions());

    assert.equal(
      Object.prototype.hasOwnProperty.call(
        heartbeat,
        'privateKey'
      ),
      false
    );

    assert.equal(
      Object.prototype.hasOwnProperty.call(
        heartbeat,
        'status'
      ),
      false
    );
  }
);

test(
  'signs deterministic heartbeat payloads deterministically',
  () => {
    const first =
      buildSignedHeartbeat(validOptions());

    const second =
      buildSignedHeartbeat(validOptions());

    assert.deepEqual(first, second);
  }
);

test(
  'rejects a private key that does not control the session address',
  () => {
    assert.throws(
      () =>
        buildSignedHeartbeat({
          ...validOptions(),
          sessionAddress:
            '0x1111111111111111111111111111111111111111'
        }),
      /signer mismatch/
    );
  }
);

test(
  'rejects malformed top-level options',
  () => {
    for (const value of [
      null,
      undefined,
      true,
      'heartbeat',
      [],
      42
    ]) {
      assert.throws(
        () => buildSignedHeartbeat(value),
        /Signed heartbeat options must be a plain object/
      );
    }
  }
);

test(
  'rejects malformed private keys',
  () => {
    assert.throws(
      () =>
        buildSignedHeartbeat({
          ...validOptions(),
          privateKey: 'invalid'
        }),
      /private key/
    );
  }
);
