'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

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

function dependencies(overrides = {}) {
  const calls = {
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
      calls.key,
      {
        keyPath:
          '/secure/signing-key',
        expectedOperatorAddress:
          OPERATOR_ADDRESS
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
        'writeHeartbeat'
      ]
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
