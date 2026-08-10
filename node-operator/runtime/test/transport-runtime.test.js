'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  createOperatorTransportRuntime
} = require(
  '../src/transport/transport-runtime'
);

async function postJson(
  port,
  body
) {
  return await new Promise(
    (resolve, reject) => {
      const payload =
        Buffer.from(
          JSON.stringify(body),
          'utf8'
        );

      const request =
        http.request(
          {
            host:
              '127.0.0.1',
            port,
            method:
              'POST',
            path:
              '/v1/operator/evidence',
            headers: {
              'content-type':
                'application/json',
              'content-length':
                String(
                  payload.length
                )
            }
          },
          response => {
            const chunks = [];

            response.on(
              'data',
              chunk => {
                chunks.push(chunk);
              }
            );

            response.on(
              'end',
              () => {
                resolve({
                  statusCode:
                    response.statusCode,
                  body:
                    JSON.parse(
                      Buffer.concat(
                        chunks
                      ).toString(
                        'utf8'
                      )
                    )
                });
              }
            );
          }
        );

      request.on(
        'error',
        reject
      );

      request.end(
        payload
      );
    }
  );
}

function makeEnvelope() {
  return {
    heartbeat: {
      payloadHash:
        `0x${'11'.repeat(32)}`
    },

    authorization: {
      version: 1
    },

    status: {
      tier: 'Operator'
    }
  };
}

function makeObservation() {
  return {
    observedOperatorAddress:
      '0x1111111111111111111111111111111111111111',

    observedNodeId:
      'observed-node-0001',

    result:
      'PASS',

    reasonCode:
      'REGISTERED_OPERATOR'
  };
}

test(
  'starts transport on loopback and accepts evidence',
  async () => {
    let received = null;

    const runtime =
      await createOperatorTransportRuntime({
        observationWorker: {
          async observe(value) {
            received = value;

            return makeObservation();
          }
        }
      });

    try {
      const listening =
        await runtime.start();

      assert.equal(
        listening.host,
        '127.0.0.1'
      );

      assert.equal(
        listening.route,
        '/v1/operator/evidence'
      );

      assert.equal(
        listening.port > 0,
        true
      );

      const envelope =
        makeEnvelope();

      const response =
        await postJson(
          listening.port,
          envelope
        );

      assert.equal(
        response.statusCode,
        200
      );

      assert.equal(
        response.body.ok,
        true
      );

      assert.deepEqual(
        received.heartbeat,
        envelope.heartbeat
      );

      assert.deepEqual(
        received.authorization,
        envelope.authorization
      );

      assert.deepEqual(
        received.status,
        envelope.status
      );
    } finally {
      await runtime.stop();
    }
  }
);

test(
  'reports lifecycle status',
  async () => {
    const runtime =
      await createOperatorTransportRuntime({
        observationWorker: {
          async observe() {
            return makeObservation();
          }
        }
      });

    assert.equal(
      runtime.status().started,
      false
    );

    const listening =
      await runtime.start();

    assert.equal(
      runtime.status().started,
      true
    );

    assert.equal(
      runtime.status().port,
      listening.port
    );

    await runtime.stop();

    assert.equal(
      runtime.status().started,
      false
    );

    assert.equal(
      runtime.status().port,
      null
    );
  }
);

test(
  'rejects duplicate start',
  async () => {
    const runtime =
      await createOperatorTransportRuntime({
        observationWorker: {
          async observe() {
            return makeObservation();
          }
        }
      });

    try {
      await runtime.start();

      await assert.rejects(
        runtime.start(),
        /already started/
      );
    } finally {
      await runtime.stop();
    }
  }
);

test(
  'stop is safe before start and after stop',
  async () => {
    const runtime =
      await createOperatorTransportRuntime({
        observationWorker: {
          async observe() {
            return makeObservation();
          }
        }
      });

    await runtime.stop();

    await runtime.start();

    await runtime.stop();

    await runtime.stop();

    assert.equal(
      runtime.status().started,
      false
    );
  }
);

test(
  'propagates evidence rejection through opaque HTTP response',
  async () => {
    const runtime =
      await createOperatorTransportRuntime({
        observationWorker: {
          async observe() {
            throw new Error(
              'Observed heartbeat nonce replay detected'
            );
          }
        }
      });

    try {
      const listening =
        await runtime.start();

      const response =
        await postJson(
          listening.port,
          makeEnvelope()
        );

      assert.equal(
        response.statusCode,
        422
      );

      assert.equal(
        response.body.error,
        'EVIDENCE_REJECTED'
      );

      assert.equal(
        JSON.stringify(
          response.body
        ).includes(
          'nonce replay'
        ),
        false
      );
    } finally {
      await runtime.stop();
    }
  }
);
