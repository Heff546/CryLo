'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

const {
  computeAddress
} = require('ethers');

const {
  createLocalHeartbeatRuntime,
  defaultHeartbeatDirectory,
  defaultHeartbeatOutputPath,
  defaultSequenceStatePath
} = require(
  '../src/evidence/local-heartbeat-runtime'
);

const OPERATOR_ADDRESS =
  '0x1111111111111111111111111111111111111111';

const PRIVATE_KEY =
  `0x${'11'.repeat(32)}`;

const SESSION_ADDRESS =
  computeAddress(PRIVATE_KEY);

const TEST_AUTHORIZATION =
  Object.freeze({
    sessionAddress:
      SESSION_ADDRESS,
    expiresAt:
      '2099-01-01T00:00:00.000Z',
    delegation:
      Object.freeze({
        version: 1,
        purpose:
          'operator-heartbeat',
        chainId: 5546,
        operatorAddress:
          OPERATOR_ADDRESS,
        nodeId:
          'operator-node-001',
        sessionAddress:
          SESSION_ADDRESS,
        issuedAt:
          '2026-07-31T00:00:00.000Z',
        expiresAt:
          '2099-01-01T00:00:00.000Z'
      }),
    delegationSignature:
      'unit-test-delegation'
  });

function dependencies(overrides = {}) {
  const calls = {
    authorization: null,
    key: null,
    sequence: null,
    pipeline: null,
    writer: null
  };

  const heartbeat = Object.freeze({
    sequence: 0,
    signature:
      `0x${'22'.repeat(65)}`
  });

  const deps = {
    async loadAuthorization(options) {
      calls.authorization = options;

      return TEST_AUTHORIZATION;
    },

    async loadSigningKey(options) {
      calls.key = options;

      return Object.freeze({
        keyPath:
          '/secure/signing-key',
        privateKey: PRIVATE_KEY
      });
    },

    createSequenceManager(options) {
      calls.sequence = options;

      return Object.freeze({
        allocateNextSequence() {
          return 0;
        }
      });
    },

    createNonceProvider() {
      return Object.freeze({
        generateNonce() {
          return '00'.repeat(32);
        }
      });
    },

    createHeartbeatPipeline(options) {
      calls.pipeline = options;

      return Object.freeze({
        createSignedHeartbeat() {
          return heartbeat;
        }
      });
    },

    createLocalHeartbeatWriter(options) {
      calls.writer = options;

      return Object.freeze({
        async writeHeartbeat() {
          return heartbeat;
        }
      });
    },

    ...overrides
  };

  return {
    calls,
    deps,
    heartbeat
  };
}

test(
  'composes a local-only heartbeat runtime',
  async () => {
    const {
      calls,
      deps,
      heartbeat
    } = dependencies();

    const runtime =
      await createLocalHeartbeatRuntime({
        operatorAddress:
          OPERATOR_ADDRESS,
        nodeId:
          'operator-node-001',
        keyPath:
          '/secure/signing-key',
        outputPath:
          '/runtime/latest.json',
        sequenceStatePath:
          '/runtime/sequence.json',
        ...deps
      });

    assert.deepEqual(
      calls.authorization,
      {
        authorizationPath:
          undefined,
        expectedOperatorAddress:
          OPERATOR_ADDRESS,
        expectedNodeId:
          'operator-node-001'
      }
    );

    assert.deepEqual(
      calls.key,
      {
        keyPath:
          '/secure/signing-key',
        expectedSignerAddress:
          SESSION_ADDRESS
      }
    );

    assert.deepEqual(
      calls.sequence,
      {
        statePath:
          '/runtime/sequence.json'
      }
    );

    assert.equal(
      calls.pipeline.operatorAddress,
      OPERATOR_ADDRESS
    );

    assert.equal(
      calls.pipeline.nodeId,
      'operator-node-001'
    );

    assert.equal(
      calls.pipeline.privateKey,
      PRIVATE_KEY
    );

    assert.equal(
      calls.writer.outputPath,
      '/runtime/latest.json'
    );

    assert.equal(
      await runtime.writeHeartbeat({}),
      heartbeat
    );
  }
);

test(
  'does not expose the private key or internals',
  async () => {
    const {
      deps
    } = dependencies();

    const runtime =
      await createLocalHeartbeatRuntime({
        operatorAddress:
          OPERATOR_ADDRESS,
        nodeId:
          'operator-node-001',
        ...deps
      });

    assert.deepEqual(
      Object.keys(runtime).sort(),
      [
        'keyPath',
        'outputPath',
        'sequenceStatePath',
        'sessionAddress',
        'signObservation',
        'signUptimeReport',
        'writeHeartbeat'
      ]
    );

    assert.equal(
      runtime.sessionAddress,
      SESSION_ADDRESS
    );

    assert.equal(
      Object.values(runtime)
        .includes(PRIVATE_KEY),
      false
    );

    for (const field of [
      'privateKey',
      'pipeline',
      'signer',
      'nonceProvider',
      'sequenceManager',
      'submit',
      'send',
      'publish',
      'broadcast'
    ]) {
      assert.equal(
        Object.prototype
          .hasOwnProperty.call(
            runtime,
            field
          ),
        false
      );
    }
  }
);

test(
  'signs node observations without exposing the session private key',
  async () => {
    const {
      deps
    } = dependencies();

    const runtime =
      await createLocalHeartbeatRuntime({
        operatorAddress:
          OPERATOR_ADDRESS,
        nodeId:
          'operator-node-001',
        ...deps
      });

    const observation = {
      protocolVersion:
        '2.0.0',

      chainId:
        5546,

      observedOperatorAddress:
        '0x3333333333333333333333333333333333333333',

      observedNodeId:
        'observed-node-0001',

      observedSessionAddress:
        '0x4444444444444444444444444444444444444444',

      heartbeatSequence:
        10,

      heartbeatPayloadHash:
        `0x${'33'.repeat(32)}`,

      statusHash:
        `0x${'44'.repeat(32)}`,

      observedAt:
        '2026-08-09T23:00:30.000Z',

      claimedTier:
        'Operator',

      registration: {
        passed:
          true,

        registered:
          true,

        isNodeWallet:
          true,

        onChainTier:
          'Operator',

        stakeAtomic:
          '30000000000000',

        stakeRequirementAtomic:
          '30000000000000',

        configuredTierMatches:
          true,

        stakeRequirementMet:
          true,

        messageCode:
          'REGISTERED_OPERATOR'
      },

      result:
        'PASS',

      reasonCode:
        'REGISTERED_OPERATOR'
    };

    const signed =
      runtime.signObservation(
        observation
      );

    assert.equal(
      typeof signed,
      'object'
    );

    assert.equal(
      typeof signed.observationHash,
      'string'
    );

    assert.equal(
      typeof signed.signature,
      'string'
    );

    assert.equal(
      Object.values(runtime)
        .includes(PRIVATE_KEY),
      false
    );

    assert.equal(
      Object.prototype
        .hasOwnProperty.call(
          runtime,
          'privateKey'
        ),
      false
    );

    assert.equal(
      Object.prototype
        .hasOwnProperty.call(
          runtime,
          'sessionPrivateKey'
        ),
      false
    );
  }
);

test(
  'forwards an optional TTL',
  async () => {
    const {
      calls,
      deps
    } = dependencies();

    await createLocalHeartbeatRuntime({
      operatorAddress:
        OPERATOR_ADDRESS,
      nodeId:
        'operator-node-001',
      ttlMs: 120000,
      ...deps
    });

    assert.equal(
      calls.pipeline.ttlMs,
      120000
    );
  }
);

test(
  'does not inject an undefined TTL',
  async () => {
    const {
      calls,
      deps
    } = dependencies();

    await createLocalHeartbeatRuntime({
      operatorAddress:
        OPERATOR_ADDRESS,
      nodeId:
        'operator-node-001',
      ...deps
    });

    assert.equal(
      Object.prototype
        .hasOwnProperty.call(
          calls.pipeline,
          'ttlMs'
        ),
      false
    );
  }
);

test(
  'uses protected default artifact paths',
  async () => {
    const {
      deps
    } = dependencies();

    const runtime =
      await createLocalHeartbeatRuntime({
        operatorAddress:
          OPERATOR_ADDRESS,
        nodeId:
          'operator-node-001',
        ...deps
      });

    assert.equal(
      runtime.outputPath,
      defaultHeartbeatOutputPath()
    );

    assert.equal(
      runtime.sequenceStatePath,
      defaultSequenceStatePath()
    );
  }
);

test(
  'propagates signing-key loader failures',
  async () => {
    const {
      deps
    } = dependencies({
      async loadSigningKey() {
        throw new Error(
          'signing key unavailable'
        );
      }
    });

    await assert.rejects(
      createLocalHeartbeatRuntime({
        operatorAddress:
          OPERATOR_ADDRESS,
        nodeId:
          'operator-node-001',
        ...deps
      }),
      /signing key unavailable/
    );
  }
);

test(
  'rejects a malformed loaded key result',
  async () => {
    const {
      deps
    } = dependencies({
      async loadSigningKey() {
        return {
          keyPath:
            '/secure/signing-key'
        };
      }
    });

    await assert.rejects(
      createLocalHeartbeatRuntime({
        operatorAddress:
          OPERATOR_ADDRESS,
        nodeId:
          'operator-node-001',
        ...deps
      }),
      /private key/
    );
  }
);

test(
  'rejects malformed top-level options',
  async () => {
    for (const value of [
      null,
      undefined,
      [],
      true,
      'options'
    ]) {
      await assert.rejects(
        createLocalHeartbeatRuntime(
          value
        ),
        /plain object/
      );
    }
  }
);

test(
  'rejects missing identity fields',
  async () => {
    const {
      deps
    } = dependencies();

    await assert.rejects(
      createLocalHeartbeatRuntime({
        nodeId:
          'operator-node-001',
        ...deps
      }),
      /operatorAddress/
    );

    await assert.rejects(
      createLocalHeartbeatRuntime({
        operatorAddress:
          OPERATOR_ADDRESS,
        ...deps
      }),
      /nodeId/
    );
  }
);

test(
  'rejects invalid dependency factories',
  async () => {
    const base = {
      operatorAddress:
        OPERATOR_ADDRESS,
      nodeId:
        'operator-node-001'
    };

    for (const field of [
      'loadAuthorization',
      'loadSigningKey',
      'createSequenceManager',
      'createNonceProvider',
      'createHeartbeatPipeline',
      'createLocalHeartbeatWriter'
    ]) {
      await assert.rejects(
        createLocalHeartbeatRuntime({
          ...base,
          [field]: true
        }),
        /must be a function/
      );
    }
  }
);

test(
  'default paths remain inside operator configuration',
  () => {
    const expectedDirectory =
      path.join(
        os.homedir(),
        '.config',
        'crylo-wallet',
        'operator',
        'heartbeat'
      );

    assert.equal(
      defaultHeartbeatDirectory(),
      expectedDirectory
    );

    assert.equal(
      defaultHeartbeatOutputPath(),
      path.join(
        expectedDirectory,
        'latest-heartbeat.json'
      )
    );

    assert.equal(
      defaultSequenceStatePath(),
      path.join(
        expectedDirectory,
        'sequence.json'
      )
    );
  }
);

test(
  'signs Operator uptime reports without exposing the session private key',
  async () => {
    const {
      deps
    } = dependencies();

    const runtime =
      await createLocalHeartbeatRuntime({
        operatorAddress:
          OPERATOR_ADDRESS,
        nodeId:
          'operator-node-001',
        ...deps
      });

    const finalizedWindow = {
      schemaVersion:
        1,

      protocolVersion:
        '2.0.0',

      reportingOperatorAddress:
        OPERATOR_ADDRESS,

      reportingNodeId:
        'operator-node-001',

      reportingSessionAddress:
        SESSION_ADDRESS,

      observedOperatorAddress:
        '0x3333333333333333333333333333333333333333',

      observedNodeId:
        'observed-node-0001',

      windowStartedAt:
        '2026-08-09T23:00:00.000Z',

      windowEndedAt:
        '2026-08-09T23:20:00.000Z',

      expectedObservations:
        20,

      receivedObservations:
        18,

      passCount:
        18,

      failCount:
        0,

      missingCount:
        2,

      totalFailures:
        2,

      windowComplete:
        true,

      locallyQualified:
        true,

      slots:
        Array.from(
          { length: 18 },
          (_, index) => ({
            slotStartedAt:
              `2026-08-09T23:${String(index)
                .padStart(2, '0')}:00.000Z`,

            observedAt:
              `2026-08-09T23:${String(index)
                .padStart(2, '0')}:05.000Z`,

            observationHash:
              `0x${(index + 1)
                .toString(16)
                .padStart(64, '0')}`,

            heartbeatPayloadHash:
              `0x${(index + 101)
                .toString(16)
                .padStart(64, '0')}`,

            heartbeatSequence:
              index + 1,

            result:
              'PASS',

            reasonCode:
              'REGISTERED_OPERATOR'
          })
        )
    };

    const signed =
      runtime.signUptimeReport(
        finalizedWindow
      );

    assert.equal(
      typeof signed.reportHash,
      'string'
    );

    assert.equal(
      typeof signed.signature,
      'string'
    );

    assert.equal(
      signed.reportingOperatorAddress,
      OPERATOR_ADDRESS
    );

    assert.equal(
      signed.reportingSessionAddress,
      SESSION_ADDRESS
    );

    assert.equal(
      Object.values(runtime)
        .includes(PRIVATE_KEY),
      false
    );

    assert.equal(
      Object.prototype
        .hasOwnProperty.call(
          runtime,
          'privateKey'
        ),
      false
    );

    assert.equal(
      Object.prototype
        .hasOwnProperty.call(
          runtime,
          'sessionPrivateKey'
        ),
      false
    );
  }
);
