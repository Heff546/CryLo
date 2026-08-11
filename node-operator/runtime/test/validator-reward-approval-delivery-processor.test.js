'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

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

async function makeState() {
  const directory =
    await fs.mkdtemp(
      path.join(
        os.tmpdir(),
        'crylo-validator-delivery-processor-'
      )
    );

  const state =
    await createValidatorRewardApprovalDeliveryState({
      statePath:
        path.join(
          directory,
          'state.json'
        )
    });

  return {
    directory,
    state
  };
}

function approval(
  byte
) {
  return {
    approvalHash:
      '0x' + byte.repeat(64),

    value:
      `approval-${byte}`
  };
}

async function enqueue(
  state,
  {
    byte,
    host
  }
) {
  return await state.enqueue({
    authorization: {
      version: 1
    },

    approval:
      approval(byte),

    destinationHost:
      host,

    destinationPort:
      9443,

    createdAt:
      '2026-08-11T06:00:00.000Z'
  });
}

test(
  'successful send marks delivery delivered',
  async () => {
    const temp =
      await makeState();

    try {
      const queued =
        await enqueue(
          temp.state,
          {
            byte: '1',
            host: 'validator-a'
          }
        );

      let sends = 0;

      const processor =
        createValidatorRewardApprovalDeliveryProcessor({
          deliveryState:
            temp.state,

          async sendApproval() {
            sends += 1;

            return {
              accepted: true
            };
          }
        });

      const result =
        await processor.processPending();

      assert.equal(
        sends,
        1
      );

      assert.equal(
        result.deliveredCount,
        1
      );

      const record =
        temp.state.getDelivery(
          queued.record.deliveryId
        );

      assert.equal(
        record.status,
        DELIVERY_DELIVERED
      );

      assert.equal(
        record.attemptCount,
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
  'failed send remains pending and retryable',
  async () => {
    const temp =
      await makeState();

    try {
      const queued =
        await enqueue(
          temp.state,
          {
            byte: '2',
            host: 'validator-a'
          }
        );

      const processor =
        createValidatorRewardApprovalDeliveryProcessor({
          deliveryState:
            temp.state,

          async sendApproval() {
            throw new Error(
              'connection refused'
            );
          }
        });

      const result =
        await processor.processPending();

      assert.equal(
        result.retryableErrorCount,
        1
      );

      const record =
        temp.state.getDelivery(
          queued.record.deliveryId
        );

      assert.equal(
        record.status,
        DELIVERY_PENDING
      );

      assert.equal(
        record.attemptCount,
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
  'one failed destination does not block another',
  async () => {
    const temp =
      await makeState();

    try {
      const first =
        await enqueue(
          temp.state,
          {
            byte: '3',
            host: 'validator-a'
          }
        );

      const second =
        await enqueue(
          temp.state,
          {
            byte: '4',
            host: 'validator-b'
          }
        );

      const processor =
        createValidatorRewardApprovalDeliveryProcessor({
          deliveryState:
            temp.state,

          async sendApproval(
            options
          ) {
            if (
              options.host ===
              'validator-a'
            ) {
              throw new Error(
                'validator-a offline'
              );
            }

            return {
              accepted: true
            };
          }
        });

      const result =
        await processor.processPending();

      assert.equal(
        result.attemptedCount,
        2
      );

      assert.equal(
        result.deliveredCount,
        1
      );

      assert.equal(
        result.retryableErrorCount,
        1
      );

      assert.equal(
        temp.state.getDelivery(
          first.record.deliveryId
        ).status,
        DELIVERY_PENDING
      );

      assert.equal(
        temp.state.getDelivery(
          second.record.deliveryId
        ).status,
        DELIVERY_DELIVERED
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
  'retry after restart delivers pending approval once',
  async () => {
    const temp =
      await makeState();

    try {
      const queued =
        await enqueue(
          temp.state,
          {
            byte: '5',
            host: 'validator-a'
          }
        );

      const failing =
        createValidatorRewardApprovalDeliveryProcessor({
          deliveryState:
            temp.state,

          async sendApproval() {
            throw new Error(
              'offline'
            );
          }
        });

      await failing.processPending();

      const statePath =
        temp.state.statePath;

      const restarted =
        await createValidatorRewardApprovalDeliveryState({
          statePath
        });

      let sends = 0;

      const succeeding =
        createValidatorRewardApprovalDeliveryProcessor({
          deliveryState:
            restarted,

          async sendApproval() {
            sends += 1;

            return {
              accepted: true
            };
          }
        });

      await succeeding.processPending();

      assert.equal(
        sends,
        1
      );

      const record =
        restarted.getDelivery(
          queued.record.deliveryId
        );

      assert.equal(
        record.status,
        DELIVERY_DELIVERED
      );

      assert.equal(
        record.attemptCount,
        2
      );

      const again =
        await succeeding.processPending();

      assert.equal(
        again.pendingCount,
        0
      );

      assert.equal(
        sends,
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
  'rejects malformed processor dependencies',
  () => {
    assert.throws(
      () =>
        createValidatorRewardApprovalDeliveryProcessor(
          null
        ),
      /plain object/
    );

    assert.throws(
      () =>
        createValidatorRewardApprovalDeliveryProcessor({
          deliveryState: {},
          sendApproval() {}
        }),
      /listPending/
    );

    assert.throws(
      () =>
        createValidatorRewardApprovalDeliveryProcessor({
          deliveryState: {
            listPending() {},
            recordAttempt() {},
            markDelivered() {}
          },

          sendApproval:
            null
        }),
      /must be a function/
    );
  }
);
