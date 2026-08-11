'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const {
  DELIVERY_PENDING,
  DELIVERY_DELIVERED,
  createValidatorRewardApprovalDeliveryState
} = require(
  '../src/evidence/validator-reward-approval-delivery-state'
);

const {
  createValidatorRewardApprovalDeliveryProcessor
} = require(
  '../src/evidence/validator-reward-approval-delivery-processor'
);

const {
  createValidatorRewardApprovalTransport,
  sendValidatorRewardApproval
} = require(
  '../src/transport/validator-reward-approval-transport'
);

async function makeTemp() {
  const directory =
    await fs.mkdtemp(
      path.join(
        os.tmpdir(),
        'crylo-validator-delivery-integration-'
      )
    );

  return {
    directory,

    statePath:
      path.join(
        directory,
        'delivery-state.json'
      )
  };
}

async function reserveUnusedPort() {
  const server =
    net.createServer();

  await new Promise(
    (resolve, reject) => {
      server.once(
        'error',
        reject
      );

      server.listen(
        0,
        '127.0.0.1',
        resolve
      );
    }
  );

  const address =
    server.address();

  if (
    !address ||
    typeof address !== 'object'
  ) {
    throw new Error(
      'Failed to allocate temporary test port'
    );
  }

  const port =
    address.port;

  await new Promise(
    (resolve, reject) => {
      server.close(
        error => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        }
      );
    }
  );

  return port;
}

function approvalEnvelope() {
  return {
    authorization: {
      version: 1,
      delegation: {
        purpose:
          'validator-reward-approval'
      }
    },

    approval: {
      approvalHash:
        '0x' + '11'.repeat(32),

      observedNodeId:
        'operator-node-001'
    }
  };
}

async function enqueue(
  state,
  port
) {
  const envelope =
    approvalEnvelope();

  return await state.enqueue({
    authorization:
      envelope.authorization,

    approval:
      envelope.approval,

    destinationHost:
      '127.0.0.1',

    destinationPort:
      port,

    createdAt:
      '2026-08-11T06:00:00.000Z'
  });
}

test(
  'real connection failure leaves durable approval pending',
  async () => {
    const temp =
      await makeTemp();

    try {
      const port =
        await reserveUnusedPort();

      const state =
        await createValidatorRewardApprovalDeliveryState({
          statePath:
            temp.statePath
        });

      const queued =
        await enqueue(
          state,
          port
        );

      const processor =
        createValidatorRewardApprovalDeliveryProcessor({
          deliveryState:
            state,

          sendApproval:
            sendValidatorRewardApproval
        });

      const result =
        await processor.processPending();

      assert.equal(
        result.deliveredCount,
        0
      );

      assert.equal(
        result.retryableErrorCount,
        1
      );

      const persisted =
        state.getDelivery(
          queued.record.deliveryId
        );

      assert.equal(
        persisted.status,
        DELIVERY_PENDING
      );

      assert.equal(
        persisted.attemptCount,
        1
      );
    } finally {
      await fs.rm(
        temp.directory,
        {
          recursive: true,
          force: true
        }
      );
    }
  }
);

test(
  'pending approval survives restart and delivers over real HTTP',
  async () => {
    const temp =
      await makeTemp();

    let transport =
      null;

    try {
      const port =
        await reserveUnusedPort();

      const firstState =
        await createValidatorRewardApprovalDeliveryState({
          statePath:
            temp.statePath
        });

      const queued =
        await enqueue(
          firstState,
          port
        );

      const failingProcessor =
        createValidatorRewardApprovalDeliveryProcessor({
          deliveryState:
            firstState,

          sendApproval:
            sendValidatorRewardApproval
        });

      const failed =
        await failingProcessor.processPending();

      assert.equal(
        failed.retryableErrorCount,
        1
      );

      /*
       * Simulate process restart by reopening the durable
       * state from disk before the peer becomes available.
       */
      const restartedState =
        await createValidatorRewardApprovalDeliveryState({
          statePath:
            temp.statePath
        });

      let received =
        null;

      transport =
        createValidatorRewardApprovalTransport({
          host:
            '127.0.0.1',

          port,

          async handleValidatorRewardApproval(
            envelope
          ) {
            received =
              envelope;

            return {
              accepted:
                true,

              quorumStatus:
                'PENDING'
            };
          }
        });

      await transport.start();

      const succeedingProcessor =
        createValidatorRewardApprovalDeliveryProcessor({
          deliveryState:
            restartedState,

          sendApproval:
            sendValidatorRewardApproval
        });

      const delivered =
        await succeedingProcessor.processPending();

      assert.equal(
        delivered.deliveredCount,
        1
      );

      assert.equal(
        delivered.retryableErrorCount,
        0
      );

      assert.deepEqual(
        received,
        approvalEnvelope()
      );

      const persisted =
        restartedState.getDelivery(
          queued.record.deliveryId
        );

      assert.equal(
        persisted.status,
        DELIVERY_DELIVERED
      );

      assert.equal(
        persisted.attemptCount,
        2
      );

      /*
       * Delivered records are no longer retried.
       */
      const again =
        await succeedingProcessor.processPending();

      assert.equal(
        again.pendingCount,
        0
      );

      assert.equal(
        persisted.approvalHash,
        approvalEnvelope()
          .approval
          .approvalHash
      );
    } finally {
      if (transport) {
        await transport.stop();
      }

      await fs.rm(
        temp.directory,
        {
          recursive: true,
          force: true
        }
      );
    }
  }
);

test(
  'real peer rejection remains durable and retryable',
  async () => {
    const temp =
      await makeTemp();

    let transport =
      null;

    try {
      const port =
        await reserveUnusedPort();

      const state =
        await createValidatorRewardApprovalDeliveryState({
          statePath:
            temp.statePath
        });

      const queued =
        await enqueue(
          state,
          port
        );

      transport =
        createValidatorRewardApprovalTransport({
          host:
            '127.0.0.1',

          port,

          async handleValidatorRewardApproval() {
            throw new Error(
              'Validator authority rejected'
            );
          }
        });

      await transport.start();

      const processor =
        createValidatorRewardApprovalDeliveryProcessor({
          deliveryState:
            state,

          sendApproval:
            sendValidatorRewardApproval
        });

      const result =
        await processor.processPending();

      assert.equal(
        result.deliveredCount,
        0
      );

      assert.equal(
        result.retryableErrorCount,
        1
      );

      const persisted =
        state.getDelivery(
          queued.record.deliveryId
        );

      assert.equal(
        persisted.status,
        DELIVERY_PENDING
      );

      assert.equal(
        persisted.attemptCount,
        1
      );
    } finally {
      if (transport) {
        await transport.stop();
      }

      await fs.rm(
        temp.directory,
        {
          recursive: true,
          force: true
        }
      );
    }
  }
);
