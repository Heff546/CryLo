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

function approval(
  hash =
    '0x' + '11'.repeat(32)
) {
  return {
    approvalHash:
      hash,

    value:
      'signed-approval'
  };
}

function authorization() {
  return {
    version: 1,
    value: 'delegation'
  };
}

async function makeTemp() {
  const directory =
    await fs.mkdtemp(
      path.join(
        os.tmpdir(),
        'crylo-validator-delivery-'
      )
    );

  return {
    directory,

    statePath:
      path.join(
        directory,
        'state.json'
      )
  };
}

test(
  'persists approval before delivery attempt',
  async () => {
    const temp =
      await makeTemp();

    try {
      const state =
        await createValidatorRewardApprovalDeliveryState({
          statePath:
            temp.statePath
        });

      const result =
        await state.enqueue({
          authorization:
            authorization(),

          approval:
            approval(),

          destinationHost:
            'validator.example',

          destinationPort:
            9443,

          createdAt:
            '2026-08-11T06:00:00.000Z'
        });

      assert.equal(
        result.changed,
        true
      );

      assert.equal(
        result.record.status,
        DELIVERY_PENDING
      );

      assert.equal(
        result.record.attemptCount,
        0
      );

      const raw =
        JSON.parse(
          await fs.readFile(
            temp.statePath,
            'utf8'
          )
        );

      assert.ok(
        raw.deliveries[
          result.record.deliveryId
        ]
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
  'duplicate destination enqueue is idempotent',
  async () => {
    const temp =
      await makeTemp();

    try {
      const state =
        await createValidatorRewardApprovalDeliveryState({
          statePath:
            temp.statePath
        });

      const input = {
        authorization:
          authorization(),

        approval:
          approval(),

        destinationHost:
          'validator.example',

        destinationPort:
          9443,

        createdAt:
          '2026-08-11T06:00:00.000Z'
      };

      const first =
        await state.enqueue(
          input
        );

      const second =
        await state.enqueue(
          input
        );

      assert.equal(
        first.changed,
        true
      );

      assert.equal(
        second.changed,
        false
      );

      assert.equal(
        second.record.deliveryId,
        first.record.deliveryId
      );

      assert.equal(
        state.listDeliveries().length,
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
  'same approval keeps destinations independent',
  async () => {
    const temp =
      await makeTemp();

    try {
      const state =
        await createValidatorRewardApprovalDeliveryState({
          statePath:
            temp.statePath
        });

      const first =
        await state.enqueue({
          authorization:
            authorization(),

          approval:
            approval(),

          destinationHost:
            'validator-a.example',

          destinationPort:
            9443,

          createdAt:
            '2026-08-11T06:00:00.000Z'
        });

      const second =
        await state.enqueue({
          authorization:
            authorization(),

          approval:
            approval(),

          destinationHost:
            'validator-b.example',

          destinationPort:
            9443,

          createdAt:
            '2026-08-11T06:00:00.000Z'
        });

      assert.notEqual(
        first.record.deliveryId,
        second.record.deliveryId
      );

      assert.equal(
        state.listPending().length,
        2
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
  'records attempts and successful delivery',
  async () => {
    const temp =
      await makeTemp();

    try {
      const state =
        await createValidatorRewardApprovalDeliveryState({
          statePath:
            temp.statePath
        });

      const queued =
        await state.enqueue({
          authorization:
            authorization(),

          approval:
            approval(),

          destinationHost:
            'validator.example',

          destinationPort:
            9443,

          createdAt:
            '2026-08-11T06:00:00.000Z'
        });

      const attempted =
        await state.recordAttempt(
          queued.record.deliveryId,
          '2026-08-11T06:01:00.000Z'
        );

      assert.equal(
        attempted.attemptCount,
        1
      );

      assert.equal(
        attempted.status,
        DELIVERY_PENDING
      );

      const delivered =
        await state.markDelivered(
          queued.record.deliveryId,
          '2026-08-11T06:02:00.000Z'
        );

      assert.equal(
        delivered.status,
        DELIVERY_DELIVERED
      );

      assert.equal(
        delivered.deliveredAt,
        '2026-08-11T06:02:00.000Z'
      );

      assert.equal(
        state.listPending().length,
        0
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
  'pending delivery survives restart',
  async () => {
    const temp =
      await makeTemp();

    try {
      const firstState =
        await createValidatorRewardApprovalDeliveryState({
          statePath:
            temp.statePath
        });

      const queued =
        await firstState.enqueue({
          authorization:
            authorization(),

          approval:
            approval(),

          destinationHost:
            'validator.example',

          destinationPort:
            9443,

          createdAt:
            '2026-08-11T06:00:00.000Z'
        });

      await firstState.recordAttempt(
        queued.record.deliveryId,
        '2026-08-11T06:01:00.000Z'
      );

      const restarted =
        await createValidatorRewardApprovalDeliveryState({
          statePath:
            temp.statePath
        });

      const pending =
        restarted.listPending();

      assert.equal(
        pending.length,
        1
      );

      assert.equal(
        pending[0].attemptCount,
        1
      );

      assert.equal(
        pending[0].deliveryId,
        queued.record.deliveryId
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
  'delivered state survives restart',
  async () => {
    const temp =
      await makeTemp();

    try {
      const firstState =
        await createValidatorRewardApprovalDeliveryState({
          statePath:
            temp.statePath
        });

      const queued =
        await firstState.enqueue({
          authorization:
            authorization(),

          approval:
            approval(),

          destinationHost:
            'validator.example',

          destinationPort:
            9443,

          createdAt:
            '2026-08-11T06:00:00.000Z'
        });

      await firstState.recordAttempt(
        queued.record.deliveryId,
        '2026-08-11T06:01:00.000Z'
      );

      await firstState.markDelivered(
        queued.record.deliveryId,
        '2026-08-11T06:02:00.000Z'
      );

      const restarted =
        await createValidatorRewardApprovalDeliveryState({
          statePath:
            temp.statePath
        });

      const record =
        restarted.getDelivery(
          queued.record.deliveryId
        );

      assert.equal(
        record.status,
        DELIVERY_DELIVERED
      );

      assert.equal(
        restarted.listPending().length,
        0
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
  'rejects persisted tampered delivery ID',
  async () => {
    const temp =
      await makeTemp();

    try {
      const state =
        await createValidatorRewardApprovalDeliveryState({
          statePath:
            temp.statePath
        });

      const queued =
        await state.enqueue({
          authorization:
            authorization(),

          approval:
            approval(),

          destinationHost:
            'validator.example',

          destinationPort:
            9443,

          createdAt:
            '2026-08-11T06:00:00.000Z'
        });

      const raw =
        JSON.parse(
          await fs.readFile(
            temp.statePath,
            'utf8'
          )
        );

      raw.deliveries[
        queued.record.deliveryId
      ].deliveryId =
        '0x' + 'ff'.repeat(32);

      await fs.writeFile(
        temp.statePath,
        JSON.stringify(
          raw,
          null,
          2
        ) + '\n'
      );

      await assert.rejects(
        createValidatorRewardApprovalDeliveryState({
          statePath:
            temp.statePath
        }),
        /delivery ID mismatch/
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
  'does not persist a private key field',
  async () => {
    const temp =
      await makeTemp();

    try {
      const state =
        await createValidatorRewardApprovalDeliveryState({
          statePath:
            temp.statePath
        });

      const queued =
        await state.enqueue({
          authorization:
            authorization(),

          approval:
            approval(),

          destinationHost:
            'validator.example',

          destinationPort:
            9443,

          createdAt:
            '2026-08-11T06:00:00.000Z'
        });

      const serialized =
        JSON.stringify(
          queued.record
        );

      assert.equal(
        serialized.includes(
          'privateKey'
        ),
        false
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
