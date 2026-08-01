'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  Wallet
} = require('ethers');

const {
  createHeartbeatPipeline,
  DEFAULT_HEARTBEAT_TTL_MS
} = require('../src/evidence/heartbeat-pipeline');

const {
  verifyHeartbeatSignature
} = require('../src/evidence/detached-signing');

const TEST_OPERATOR_ADDRESS =
  '0x1111111111111111111111111111111111111111';

const TEST_DELEGATION_HASH =
  `0x${'b'.repeat(64)}`;

const TEST_AUTHORIZATION_EXPIRES_AT =
  '2099-01-01T00:00:00.000Z';

function validStatus() {
  return {
    schemaVersion: '1.0.0',
    protocolVersion: '1.0.0',
    serviceVersion: '1.0.0',
    network: 'CryLoNexusV2',
    chainId: 5546,
    nodeId: 'runtime-node',
    operatorAddress:
      '0x1111111111111111111111111111111111111111',
    startedAt:
      '2026-07-26T20:00:00.000Z',
    updatedAt:
      '2026-07-26T20:01:00.000Z',
    lastHeartbeatAt:
      '2026-07-26T20:01:00.000Z',
    connected: true,
    rpcHealthy: true,
    walletMatched: true,
    registered: true,
    tier: 'Validator',
    uptimeSeconds: 60,
    rewardEligible: false,
    verification: {
      connected: true,
      verified: false,
      verifiedAt: null,
      reasonCode:
        'UPTIME_VERIFICATION_PENDING'
    },
    metrics: {
      heartbeatCount: 1,
      successfulChecks: 2,
      failedChecks: 0,
      pendingRewardsBaseUnits: '0'
    },
    workers: [],
    warnings: [],
    errors: []
  };
}

function createSequenceStub(start = 0) {
  let next = start;

  return {
    allocateNextSequence() {
      const allocated = next;
      next += 1;
      return allocated;
    }
  };
}

function createNonceStub() {
  let value = 0;

  return {
    generateNonce() {
      const nonce =
        value
          .toString(16)
          .padStart(64, '0');

      value += 1;
      return nonce;
    }
  };
}

function createFixture(overrides = {}) {
  const wallet =
    Wallet.createRandom();

  const options = {
    operatorAddress:
      '0x1111111111111111111111111111111111111111',
    sessionAddress:
      wallet.address,
    delegationHash:
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    authorizationExpiresAt:
      '2099-01-01T00:00:00.000Z',
    nodeId: 'operator-node-001',
    privateKey: wallet.privateKey,
    sequenceManager:
      createSequenceStub(),
    nonceProvider:
      createNonceStub(),
    now: () =>
      new Date(
        '2026-07-26T20:00:00.000Z'
      ),
    ...overrides
  };

  return {
    wallet,
    pipeline:
      createHeartbeatPipeline(options)
  };
}

test(
  'creates a complete signed heartbeat',
  () => {
    const {
      wallet,
      pipeline
    } = createFixture();

    const heartbeat =
      pipeline.createSignedHeartbeat(
        validStatus()
      );

    assert.equal(
      heartbeat.chainId,
      5546
    );

    assert.equal(
      heartbeat.sessionAddress,
      wallet.address
    );

    assert.equal(
      heartbeat.nodeId,
      'operator-node-001'
    );

    assert.equal(
      heartbeat.sequence,
      0
    );

    assert.equal(
      heartbeat.issuedAt,
      '2026-07-26T20:00:00.000Z'
    );

    assert.equal(
      heartbeat.expiresAt,
      '2026-07-26T20:01:00.000Z'
    );

    assert.match(
      heartbeat.nonce,
      /^[0-9a-f]{64}$/
    );

    assert.match(
      heartbeat.payloadHash,
      /^0x[0-9a-f]{64}$/
    );

    assert.match(
      heartbeat.signature,
      /^0x[0-9a-f]{130}$/
    );
  }
);

test(
  'produces a verifiable signature',
  () => {
    const {
      wallet,
      pipeline
    } = createFixture();

    const heartbeat =
      pipeline.createSignedHeartbeat(
        validStatus()
      );

    const verification =
      verifyHeartbeatSignature({
        payloadHash:
          heartbeat.payloadHash,
        signature:
          heartbeat.signature,
        expectedOperatorAddress:
          wallet.address
      });

    assert.equal(
      verification.operatorAddress,
      wallet.address
    );
  }
);

test(
  'allocates monotonically increasing sequences',
  () => {
    const {
      pipeline
    } = createFixture({
      sequenceManager:
        createSequenceStub(41)
    });

    const first =
      pipeline.createSignedHeartbeat(
        validStatus()
      );

    const second =
      pipeline.createSignedHeartbeat(
        validStatus()
      );

    assert.equal(first.sequence, 41);
    assert.equal(second.sequence, 42);
  }
);

test(
  'generates a new nonce for every heartbeat',
  () => {
    const {
      pipeline
    } = createFixture();

    const first =
      pipeline.createSignedHeartbeat(
        validStatus()
      );

    const second =
      pipeline.createSignedHeartbeat(
        validStatus()
      );

    assert.notEqual(
      first.nonce,
      second.nonce
    );
  }
);

test(
  'uses the configured heartbeat TTL',
  () => {
    const {
      pipeline
    } = createFixture({
      ttlMs: 90_000
    });

    const heartbeat =
      pipeline.createSignedHeartbeat(
        validStatus()
      );

    assert.equal(
      heartbeat.expiresAt,
      '2026-07-26T20:01:30.000Z'
    );
  }
);

test(
  'uses a 60-second default TTL',
  () => {
    assert.equal(
      DEFAULT_HEARTBEAT_TTL_MS,
      60_000
    );

    const wallet =
      Wallet.createRandom();

    const pipeline =
      createHeartbeatPipeline({
        operatorAddress:
          '0x1111111111111111111111111111111111111111',
        sessionAddress:
          wallet.address,
        delegationHash:
          '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        authorizationExpiresAt:
          '2099-01-01T00:00:00.000Z',
        nodeId: 'operator-node-001',
        privateKey:
          wallet.privateKey,
        sequenceManager:
          createSequenceStub(),
        nonceProvider:
          createNonceStub(),
        now: () =>
          new Date(
            '2026-07-26T20:00:00.000Z'
          )
      });

    const heartbeat =
      pipeline.createSignedHeartbeat(
        validStatus()
      );

    assert.equal(
      heartbeat.expiresAt,
      '2026-07-26T20:01:00.000Z'
    );
  }
);

test(
  'returns immutable artifacts',
  () => {
    const {
      pipeline
    } = createFixture();

    const heartbeat =
      pipeline.createSignedHeartbeat(
        validStatus()
      );

    assert.equal(
      Object.isFrozen(heartbeat),
      true
    );
  }
);

test(
  'does not include raw runtime status',
  () => {
    const {
      pipeline
    } = createFixture();

    const heartbeat =
      pipeline.createSignedHeartbeat(
        validStatus()
      );

    assert.equal(
      Object.prototype.hasOwnProperty.call(
        heartbeat,
        'status'
      ),
      false
    );

    assert.equal(
      Object.prototype.hasOwnProperty.call(
        heartbeat,
        'workers'
      ),
      false
    );
  }
);

test(
  'invalid status does not consume sequence or nonce',
  () => {
    let sequences = 0;
    let nonces = 0;

    const {
      pipeline
    } = createFixture({
      sequenceManager: {
        allocateNextSequence() {
          sequences += 1;
          return sequences - 1;
        }
      },
      nonceProvider: {
        generateNonce() {
          nonces += 1;
          return crypto
            .randomBytes(32)
            .toString('hex');
        }
      }
    });

    assert.throws(
      () =>
        pipeline.createSignedHeartbeat({
          ...validStatus(),
          connected: 'yes'
        }),
      /connected must be a boolean/
    );

    assert.equal(sequences, 0);
    assert.equal(nonces, 0);
  }
);

test(
  'nonce failure does not consume sequence',
  () => {
    let sequences = 0;

    const {
      pipeline
    } = createFixture({
      sequenceManager: {
        allocateNextSequence() {
          sequences += 1;
          return sequences - 1;
        }
      },
      nonceProvider: {
        generateNonce() {
          throw new Error(
            'entropy unavailable'
          );
        }
      }
    });

    assert.throws(
      () =>
        pipeline.createSignedHeartbeat(
          validStatus()
        ),
      /entropy unavailable/
    );

    assert.equal(sequences, 0);
  }
);

test(
  'signing failure does not reuse an allocated sequence',
  () => {
    const wrongWallet =
      Wallet.createRandom();

    let nextSequence = 0;
    const allocatedSequences = [];

    const {
      pipeline
    } = createFixture({
      sessionAddress:
        wrongWallet.address,
      sequenceManager: {
        allocateNextSequence() {
          const sequence =
            nextSequence;

          nextSequence += 1;
          allocatedSequences.push(
            sequence
          );

          return sequence;
        }
      }
    });

    assert.throws(
      () =>
        pipeline.createSignedHeartbeat(
          validStatus()
        ),
      /signer mismatch/i
    );

    assert.throws(
      () =>
        pipeline.createSignedHeartbeat(
          validStatus()
        ),
      /signer mismatch/i
    );

    assert.deepEqual(
      allocatedSequences,
      [0, 1]
    );
  }
);

test(
  'rejects malformed pipeline options',
  () => {
    for (const value of [
      null,
      undefined,
      [],
      true,
      'options'
    ]) {
      assert.throws(
        () =>
          createHeartbeatPipeline(value),
        /plain object/
      );
    }
  }
);

test(
  'rejects invalid dependencies',
  () => {
    const wallet =
      Wallet.createRandom();

    assert.throws(
      () =>
        createHeartbeatPipeline({
          operatorAddress:
            TEST_OPERATOR_ADDRESS,
          sessionAddress:
            wallet.address,
          delegationHash:
            TEST_DELEGATION_HASH,
          authorizationExpiresAt:
            TEST_AUTHORIZATION_EXPIRES_AT,
          nodeId: 'node',
          privateKey:
            wallet.privateKey,
          sequenceManager: {},
          nonceProvider:
            createNonceStub()
        }),
      /sequence allocator/
    );

    assert.throws(
      () =>
        createHeartbeatPipeline({
          operatorAddress:
            TEST_OPERATOR_ADDRESS,
          sessionAddress:
            wallet.address,
          delegationHash:
            TEST_DELEGATION_HASH,
          authorizationExpiresAt:
            TEST_AUTHORIZATION_EXPIRES_AT,
          nodeId: 'node',
          privateKey:
            wallet.privateKey,
          sequenceManager:
            createSequenceStub(),
          nonceProvider: {}
        }),
      /nonce generator/
    );
  }
);

test(
  'rejects invalid clocks and TTL values',
  () => {
    const {
      pipeline
    } = createFixture({
      now: () => 'not-a-date'
    });

    assert.throws(
      () =>
        pipeline.createSignedHeartbeat(
          validStatus()
        ),
      /valid Date or timestamp/
    );

    const wallet =
      Wallet.createRandom();

    for (const ttlMs of [
      0,
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1
    ]) {
      assert.throws(
        () =>
          createHeartbeatPipeline({
            operatorAddress:
              TEST_OPERATOR_ADDRESS,
            sessionAddress:
              wallet.address,
            delegationHash:
              TEST_DELEGATION_HASH,
            authorizationExpiresAt:
              TEST_AUTHORIZATION_EXPIRES_AT,
            nodeId: 'node',
            privateKey:
              wallet.privateKey,
            sequenceManager:
              createSequenceStub(),
            nonceProvider:
              createNonceStub(),
            ttlMs
          }),
        /positive safe integer/
      );
    }
  }
);
