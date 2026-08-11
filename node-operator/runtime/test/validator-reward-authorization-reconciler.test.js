'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { Wallet } = require('ethers');

const {
  createValidatorConsensusState
} = require(
  '../src/evidence/validator-consensus-state'
);

const {
  createValidatorRewardAuthorizationState,
  AUTHORIZATION_AWAITING_CONTRACT_VERIFICATION
} = require(
  '../src/evidence/validator-reward-authorization-state'
);

const {
  createValidatorRewardAuthorizationReconciler
} = require(
  '../src/evidence/validator-reward-authorization-reconciler'
);

async function makeTempState() {
  const directory =
    await fs.mkdtemp(
      path.join(
        os.tmpdir(),
        'crylonexus-validator-auth-reconcile-'
      )
    );

  return {
    directory,

    consensusPath:
      path.join(
        directory,
        'consensus.json'
      ),

    authorizationPath:
      path.join(
        directory,
        'authorization.json'
      )
  };
}

function report({
  reporter,
  target,
  index
}) {
  return {
    reportHash:
      `0x${index
        .toString(16)
        .padStart(64, '0')}`,

    reportingOperatorAddress:
      reporter.address,

    reportingNodeId:
      `reporter-node-${index}`,

    observedOperatorAddress:
      target.address,

    observedNodeId:
      'target-node-0001',

    windowStartedAt:
      '2026-08-10T20:00:00.000Z',

    windowEndedAt:
      '2026-08-10T20:20:00.000Z',

    locallyQualified:
      true
  };
}

async function makeStates(
  temp
) {
  const consensusState =
    await createValidatorConsensusState({
      minimumReports:
        3,
      statePath:
        temp.consensusPath
    });

  const authorizationState =
    await createValidatorRewardAuthorizationState({
      statePath:
        temp.authorizationPath
    });

  return {
    consensusState,
    authorizationState,

    reconciler:
      createValidatorRewardAuthorizationReconciler({
        consensusState,
        authorizationState
      })
  };
}

test(
  'pending consensus creates nothing during reconciliation',
  async () => {
    const temp =
      await makeTempState();

    try {
      const states =
        await makeStates(
          temp
        );

      await states.consensusState
        .acceptReport(
          report({
            reporter:
              Wallet.createRandom(),
            target:
              Wallet.createRandom(),
            index:
              1
          })
        );

      const result =
        await states.reconciler
          .reconcile();

      assert.equal(
        result.finalizedCount,
        0
      );

      assert.equal(
        states.authorizationState
          .getRecords().length,
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
  'recovers authorization missing after finalized consensus',
  async () => {
    const temp =
      await makeTempState();

    try {
      const target =
        Wallet.createRandom();

      const states =
        await makeStates(
          temp
        );

      for (
        let index = 1;
        index <= 3;
        index += 1
      ) {
        await states.consensusState
          .acceptReport(
            report({
              reporter:
                Wallet.createRandom(),
              target,
              index
            })
          );
      }

      assert.equal(
        states.authorizationState
          .getRecords().length,
        0
      );

      const result =
        await states.reconciler
          .reconcile();

      assert.equal(
        result.finalizedCount,
        1
      );

      assert.equal(
        result.createdCount,
        1
      );

      const records =
        states.authorizationState
          .getRecords();

      assert.equal(
        records.length,
        1
      );

      assert.equal(
        records[0]
          .authorizationStatus,
        AUTHORIZATION_AWAITING_CONTRACT_VERIFICATION
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
  'reconciliation is idempotent',
  async () => {
    const temp =
      await makeTempState();

    try {
      const target =
        Wallet.createRandom();

      const states =
        await makeStates(
          temp
        );

      for (
        let index = 1;
        index <= 3;
        index += 1
      ) {
        await states.consensusState
          .acceptReport(
            report({
              reporter:
                Wallet.createRandom(),
              target,
              index
            })
          );
      }

      await states.reconciler
        .reconcile();

      const second =
        await states.reconciler
          .reconcile();

      assert.equal(
        second.createdCount,
        0
      );

      assert.equal(
        second.existingCount,
        1
      );

      assert.equal(
        states.authorizationState
          .getRecords().length,
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
  'ensureAuthorization creates once and then returns existing record',
  async () => {
    const temp =
      await makeTempState();

    try {
      const target =
        Wallet.createRandom();

      const states =
        await makeStates(
          temp
        );

      let finalized = null;

      for (
        let index = 1;
        index <= 3;
        index += 1
      ) {
        finalized =
          await states.consensusState
            .acceptReport(
              report({
                reporter:
                  Wallet.createRandom(),
                target,
                index
              })
            );
      }

      const first =
        await states.reconciler
          .ensureAuthorization(
            finalized
          );

      const second =
        await states.reconciler
          .ensureAuthorization(
            finalized
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
        first.record.authorizationId,
        second.record.authorizationId
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
