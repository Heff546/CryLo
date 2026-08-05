'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  createLocalHeartbeatWriter
} = require(
  '../src/evidence/local-heartbeat-writer'
);

function exampleHeartbeat(
  sequence = 0
) {
  return Object.freeze({
    protocolVersion: '1.0.0',
    chainId: 5546,
    operatorAddress:
      '0x1111111111111111111111111111111111111111',
    nodeId: 'operator-node-001',
    sequence,
    issuedAt:
      '2026-07-26T20:00:00.000Z',
    expiresAt:
      '2026-07-26T20:01:00.000Z',
    nonce:
      '00'.repeat(32),
    statusHash:
      `0x${'11'.repeat(32)}`,
    payloadHash:
      `0x${'22'.repeat(32)}`,
    signature:
      `0x${'33'.repeat(65)}`
  });
}

async function temporaryDirectory() {
  return fs.mkdtemp(
    path.join(
      os.tmpdir(),
      'crylonexus-heartbeat-writer-'
    )
  );
}

test(
  'writes the generated heartbeat atomically',
  async t => {
    const directory =
      await temporaryDirectory();

    t.after(async () => {
      await fs.rm(
        directory,
        {
          recursive: true,
          force: true
        }
      );
    });

    const outputPath =
      path.join(
        directory,
        'latest-heartbeat.json'
      );

    const heartbeat =
      exampleHeartbeat(7);

    let receivedStatus = null;

    const writer =
      createLocalHeartbeatWriter({
        outputPath,
        pipeline: {
          createSignedHeartbeat(status) {
            receivedStatus = status;
            return heartbeat;
          }
        }
      });

    const status = {
      connected: true
    };

    const result =
      await writer.writeHeartbeat(
        status
      );

    const stored =
      JSON.parse(
        await fs.readFile(
          outputPath,
          'utf8'
        )
      );

    assert.equal(
      receivedStatus,
      status
    );

    assert.equal(
      result,
      heartbeat
    );

    assert.deepEqual(
      stored,
      heartbeat
    );
  }
);

test(
  'replaces the previous local artifact',
  async t => {
    const directory =
      await temporaryDirectory();

    t.after(async () => {
      await fs.rm(
        directory,
        {
          recursive: true,
          force: true
        }
      );
    });

    const outputPath =
      path.join(
        directory,
        'latest-heartbeat.json'
      );

    let sequence = 0;

    const writer =
      createLocalHeartbeatWriter({
        outputPath,
        pipeline: {
          createSignedHeartbeat() {
            const heartbeat =
              exampleHeartbeat(
                sequence
              );

            sequence += 1;
            return heartbeat;
          }
        }
      });

    await writer.writeHeartbeat({});
    await writer.writeHeartbeat({});

    const stored =
      JSON.parse(
        await fs.readFile(
          outputPath,
          'utf8'
        )
      );

    assert.equal(
      stored.sequence,
      1
    );
  }
);

test(
  'does not write when generation fails',
  async t => {
    const directory =
      await temporaryDirectory();

    t.after(async () => {
      await fs.rm(
        directory,
        {
          recursive: true,
          force: true
        }
      );
    });

    const outputPath =
      path.join(
        directory,
        'latest-heartbeat.json'
      );

    const writer =
      createLocalHeartbeatWriter({
        outputPath,
        pipeline: {
          createSignedHeartbeat() {
            throw new Error(
              'signing unavailable'
            );
          }
        }
      });

    await assert.rejects(
      writer.writeHeartbeat({}),
      /signing unavailable/
    );

    await assert.rejects(
      fs.access(outputPath),
      error =>
        error.code === 'ENOENT'
    );
  }
);

test(
  'propagates filesystem failures',
  async () => {
    const heartbeat =
      exampleHeartbeat();

    const writer =
      createLocalHeartbeatWriter({
        outputPath:
          '/tmp/latest-heartbeat.json',
        pipeline: {
          createSignedHeartbeat() {
            return heartbeat;
          }
        },
        async writeJson() {
          throw new Error(
            'filesystem unavailable'
          );
        }
      });

    await assert.rejects(
      writer.writeHeartbeat({}),
      /filesystem unavailable/
    );
  }
);

test(
  'prevents overlapping writes',
  async () => {
    let releaseWrite;

    const pendingWrite =
      new Promise(resolve => {
        releaseWrite = resolve;
      });

    const writer =
      createLocalHeartbeatWriter({
        outputPath:
          '/tmp/latest-heartbeat.json',
        pipeline: {
          createSignedHeartbeat() {
            return exampleHeartbeat();
          }
        },
        async writeJson() {
          await pendingWrite;
        }
      });

    const first =
      writer.writeHeartbeat({});

    await assert.rejects(
      writer.writeHeartbeat({}),
      /already in progress/
    );

    releaseWrite();
    await first;
  }
);

test(
  'allows another write after failure',
  async () => {
    let attempts = 0;

    const writer =
      createLocalHeartbeatWriter({
        outputPath:
          '/tmp/latest-heartbeat.json',
        pipeline: {
          createSignedHeartbeat() {
            return exampleHeartbeat();
          }
        },
        async writeJson() {
          attempts += 1;

          if (attempts === 1) {
            throw new Error(
              'first write failed'
            );
          }
        }
      });

    await assert.rejects(
      writer.writeHeartbeat({}),
      /first write failed/
    );

    await writer.writeHeartbeat({});

    assert.equal(attempts, 2);
  }
);

test(
  'exposes no networking methods',
  () => {
    const writer =
      createLocalHeartbeatWriter({
        outputPath:
          '/tmp/latest-heartbeat.json',
        pipeline: {
          createSignedHeartbeat() {
            return exampleHeartbeat();
          }
        },
        async writeJson() {}
      });

    assert.deepEqual(
      Object.keys(writer).sort(),
      [
        'outputPath',
        'writeHeartbeat'
      ]
    );

    for (const field of [
      'send',
      'submit',
      'publish',
      'broadcast',
      'connect',
      'listen',
      'startServer'
    ]) {
      assert.equal(
        Object.prototype
          .hasOwnProperty.call(
            writer,
            field
          ),
        false
      );
    }
  }
);

test(
  'rejects malformed writer options',
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
          createLocalHeartbeatWriter(
            value
          ),
        /plain object/
      );
    }
  }
);

test(
  'rejects invalid dependencies and paths',
  () => {
    assert.throws(
      () =>
        createLocalHeartbeatWriter({
          pipeline: {},
          outputPath:
            '/tmp/heartbeat.json'
        }),
      /pipeline generator/
    );

    assert.throws(
      () =>
        createLocalHeartbeatWriter({
          pipeline: {
            createSignedHeartbeat() {
              return exampleHeartbeat();
            }
          },
          outputPath: ''
        }),
      /non-empty string/
    );

    assert.throws(
      () =>
        createLocalHeartbeatWriter({
          pipeline: {
            createSignedHeartbeat() {
              return exampleHeartbeat();
            }
          },
          outputPath:
            '/tmp/heartbeat.json',
          writeJson: true
        }),
      /JSON writer/
    );
  }
);
