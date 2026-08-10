'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createOperatorEvidenceHandler
} = require(
  '../src/transport/operator-evidence-handler'
);

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

function makeObservation(
  overrides = {}
) {
  return {
    observedOperatorAddress:
      '0x1111111111111111111111111111111111111111',

    observedNodeId:
      'observed-node-0001',

    result:
      'PASS',

    reasonCode:
      'REGISTERED_OPERATOR',

    ...overrides
  };
}

test(
  'forwards exact evidence envelope to observation worker',
  async () => {
    const envelope =
      makeEnvelope();

    let received = null;

    const handler =
      createOperatorEvidenceHandler({
        observationWorker: {
          async observe(value) {
            received = value;

            return makeObservation();
          }
        }
      });

    const result =
      await handler
        .handleOperatorEvidence(
          envelope
        );

    assert.deepEqual(
      received,
      {
        heartbeat:
          envelope.heartbeat,
        authorization:
          envelope.authorization,
        status:
          envelope.status
      }
    );

    assert.equal(
      result.accepted,
      true
    );

    assert.equal(
      result.result,
      'PASS'
    );
  }
);

test(
  'accepts valid FAIL observation result',
  async () => {
    const handler =
      createOperatorEvidenceHandler({
        observationWorker: {
          async observe() {
            return makeObservation({
              result:
                'FAIL',

              reasonCode:
                'REGISTRATION_MISMATCH'
            });
          }
        }
      });

    const result =
      await handler
        .handleOperatorEvidence(
          makeEnvelope()
        );

    assert.equal(
      result.accepted,
      true
    );

    assert.equal(
      result.result,
      'FAIL'
    );

    assert.equal(
      result.reasonCode,
      'REGISTRATION_MISMATCH'
    );
  }
);

test(
  'invokes observation callback after worker acceptance',
  async () => {
    const observation =
      makeObservation();

    let callbackValue = null;

    const handler =
      createOperatorEvidenceHandler({
        observationWorker: {
          async observe() {
            return observation;
          }
        },

        async onObservation(value) {
          callbackValue = value;
        }
      });

    await handler
      .handleOperatorEvidence(
        makeEnvelope()
      );

    assert.equal(
      callbackValue,
      observation
    );
  }
);

test(
  'rejects missing evidence field',
  async () => {
    const envelope =
      makeEnvelope();

    delete envelope.status;

    const handler =
      createOperatorEvidenceHandler({
        observationWorker: {
          async observe() {
            throw new Error(
              'worker must not run'
            );
          }
        }
      });

    await assert.rejects(
      handler.handleOperatorEvidence(
        envelope
      ),
      /Missing Operator evidence field: status/
    );
  }
);

test(
  'rejects unexpected evidence field',
  async () => {
    const envelope = {
      ...makeEnvelope(),
      privateKey:
        'must-not-be-accepted'
    };

    const handler =
      createOperatorEvidenceHandler({
        observationWorker: {
          async observe() {
            throw new Error(
              'worker must not run'
            );
          }
        }
      });

    await assert.rejects(
      handler.handleOperatorEvidence(
        envelope
      ),
      /Unexpected Operator evidence field: privateKey/
    );
  }
);

test(
  'rejects non-object heartbeat',
  async () => {
    const envelope =
      makeEnvelope();

    envelope.heartbeat = [];

    const handler =
      createOperatorEvidenceHandler({
        observationWorker: {
          async observe() {
            throw new Error(
              'worker must not run'
            );
          }
        }
      });

    await assert.rejects(
      handler.handleOperatorEvidence(
        envelope
      ),
      /Operator evidence heartbeat must be a plain object/
    );
  }
);

test(
  'propagates observation worker rejection',
  async () => {
    const handler =
      createOperatorEvidenceHandler({
        observationWorker: {
          async observe() {
            throw new Error(
              'Observed heartbeat sequence replay detected'
            );
          }
        }
      });

    await assert.rejects(
      handler.handleOperatorEvidence(
        makeEnvelope()
      ),
      /sequence replay detected/
    );
  }
);
