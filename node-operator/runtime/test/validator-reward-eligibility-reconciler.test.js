'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  CONTRACT_VERIFIED,
  CONTRACT_REJECTED
} = require(
  '../src/evidence/validator-contract-verification'
);

const {
  REWARD_ELIGIBLE,
  REWARD_INELIGIBLE,
  createValidatorRewardEligibilityState
} = require(
  '../src/evidence/validator-reward-eligibility-state'
);

const {
  createValidatorRewardEligibilityReconciler
} = require(
  '../src/evidence/validator-reward-eligibility-reconciler'
);

async function makeTempState() {
  const directory =
    await fs.mkdtemp(
      path.join(
        os.tmpdir(),
        'crylo-validator-reward-eligibility-reconcile-'
      )
    );

  return {
    directory,
    statePath:
      path.join(
        directory,
        'eligibility.json'
      )
  };
}

function verification({
  authorizationId,
  verificationId,
  outcome =
    CONTRACT_VERIFIED,
  reasonCode =
    'VERIFIED'
}) {
  return {
    authorizationId,
    verificationId,
    outcome,
    reasonCode
  };
}

function verificationState(
  records
) {
  return {
    listVerifications() {
      return records;
    }
  };
}

test(
  'creates reward eligibility from verified contract record',
  async () => {
    const temp =
      await makeTempState();

    try {
      const eligibilityState =
        await createValidatorRewardEligibilityState({
          statePath:
            temp.statePath
        });

      const record =
        verification({
          authorizationId:
            '0x' + '11'.repeat(32),
          verificationId:
            '0x' + '22'.repeat(32)
        });

      const reconciler =
        createValidatorRewardEligibilityReconciler({
          verificationState:
            verificationState([
              record
            ]),
          eligibilityState
        });

      const result =
        await reconciler.reconcile();

      assert.equal(
        result.createdCount,
        1
      );

      assert.equal(
        eligibilityState
          .getDecision(
            record.authorizationId
          )
          .rewardEligibility,
        REWARD_ELIGIBLE
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
  'creates reward ineligibility from rejected contract record',
  async () => {
    const temp =
      await makeTempState();

    try {
      const eligibilityState =
        await createValidatorRewardEligibilityState({
          statePath:
            temp.statePath
        });

      const record =
        verification({
          authorizationId:
            '0x' + '33'.repeat(32),
          verificationId:
            '0x' + '44'.repeat(32),
          outcome:
            CONTRACT_REJECTED,
          reasonCode:
            'INSUFFICIENT_STAKE'
        });

      const reconciler =
        createValidatorRewardEligibilityReconciler({
          verificationState:
            verificationState([
              record
            ]),
          eligibilityState
        });

      await reconciler.reconcile();

      assert.equal(
        eligibilityState
          .getDecision(
            record.authorizationId
          )
          .rewardEligibility,
        REWARD_INELIGIBLE
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
      const eligibilityState =
        await createValidatorRewardEligibilityState({
          statePath:
            temp.statePath
        });

      const record =
        verification({
          authorizationId:
            '0x' + '55'.repeat(32),
          verificationId:
            '0x' + '66'.repeat(32)
        });

      const reconciler =
        createValidatorRewardEligibilityReconciler({
          verificationState:
            verificationState([
              record
            ]),
          eligibilityState
        });

      const first =
        await reconciler.reconcile();

      const second =
        await reconciler.reconcile();

      assert.equal(
        first.createdCount,
        1
      );

      assert.equal(
        second.createdCount,
        0
      );

      assert.equal(
        second.existingCount,
        1
      );

      assert.equal(
        eligibilityState
          .listDecisions().length,
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
  'ensureDecision returns existing persisted decision',
  async () => {
    const temp =
      await makeTempState();

    try {
      const eligibilityState =
        await createValidatorRewardEligibilityState({
          statePath:
            temp.statePath
        });

      const record =
        verification({
          authorizationId:
            '0x' + '77'.repeat(32),
          verificationId:
            '0x' + '88'.repeat(32)
        });

      const reconciler =
        createValidatorRewardEligibilityReconciler({
          verificationState:
            verificationState([
              record
            ]),
          eligibilityState
        });

      const first =
        await reconciler
          .ensureDecision(
            record
          );

      const second =
        await reconciler
          .ensureDecision(
            record
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
        first.record.decisionId,
        second.record.decisionId
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
  'reconciles multiple verification records independently',
  async () => {
    const temp =
      await makeTempState();

    try {
      const eligibilityState =
        await createValidatorRewardEligibilityState({
          statePath:
            temp.statePath
        });

      const records = [
        verification({
          authorizationId:
            '0x' + '91'.repeat(32),
          verificationId:
            '0x' + '92'.repeat(32)
        }),

        verification({
          authorizationId:
            '0x' + '93'.repeat(32),
          verificationId:
            '0x' + '94'.repeat(32),
          outcome:
            CONTRACT_REJECTED,
          reasonCode:
            'NOT_REGISTERED'
        })
      ];

      const reconciler =
        createValidatorRewardEligibilityReconciler({
          verificationState:
            verificationState(
              records
            ),
          eligibilityState
        });

      const result =
        await reconciler.reconcile();

      assert.equal(
        result.verificationCount,
        2
      );

      assert.equal(
        result.createdCount,
        2
      );

      assert.equal(
        eligibilityState
          .listDecisions().length,
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
  'rejects malformed reconciler dependencies',
  async () => {
    assert.throws(
      () =>
        createValidatorRewardEligibilityReconciler(
          null
        ),
      /must be a plain object/
    );

    assert.throws(
      () =>
        createValidatorRewardEligibilityReconciler({
          verificationState: {
            listVerifications:
              'invalid'
          },

          eligibilityState: {
            getDecision() {},
            recordVerification() {}
          }
        }),
      /must be a function/
    );
  }
);
