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

async function makeTempState() {
  const directory =
    await fs.mkdtemp(
      path.join(
        os.tmpdir(),
        'crylo-validator-reward-eligibility-'
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

function verification(
  overrides = {}
) {
  return {
    authorizationId:
      '0x' + '11'.repeat(32),

    verificationId:
      '0x' + '22'.repeat(32),

    observedOperatorAddress:
      '0x1111111111111111111111111111111111111111',

    observedNodeId:
      'observed-node-001',

    windowStartedAt:
      '2026-08-10T20:00:00.000Z',

    windowEndedAt:
      '2026-08-10T20:20:00.000Z',

    outcome:
      CONTRACT_VERIFIED,

    reasonCode:
      'VERIFIED',

    ...overrides
  };
}

test(
  'records CONTRACT_VERIFIED as REWARD_ELIGIBLE',
  async () => {
    const temp =
      await makeTempState();

    try {
      const state =
        await createValidatorRewardEligibilityState({
          statePath:
            temp.statePath
        });

      const record =
        await state.recordVerification(
          verification()
        );

      assert.equal(
        record.rewardEligibility,
        REWARD_ELIGIBLE
      );

      assert.equal(
        record.contractOutcome,
        CONTRACT_VERIFIED
      );

      assert.match(
        record.decisionId,
        /^0x[0-9a-fA-F]{64}$/
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
  'records CONTRACT_REJECTED as REWARD_INELIGIBLE',
  async () => {
    const temp =
      await makeTempState();

    try {
      const state =
        await createValidatorRewardEligibilityState({
          statePath:
            temp.statePath
        });

      const record =
        await state.recordVerification(
          verification({
            outcome:
              CONTRACT_REJECTED,

            reasonCode:
              'INSUFFICIENT_STAKE'
          })
        );

      assert.equal(
        record.rewardEligibility,
        REWARD_INELIGIBLE
      );

      assert.equal(
        record.contractOutcome,
        CONTRACT_REJECTED
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
  'rejects unknown contract verification outcome',
  async () => {
    const temp =
      await makeTempState();

    try {
      const state =
        await createValidatorRewardEligibilityState({
          statePath:
            temp.statePath
        });

      await assert.rejects(
        state.recordVerification(
          verification({
            outcome:
              'PENDING'
          })
        ),
        /Unknown Validator contract verification outcome/
      );

      assert.equal(
        state.listDecisions().length,
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
  'rejects duplicate decision for authorization',
  async () => {
    const temp =
      await makeTempState();

    try {
      const state =
        await createValidatorRewardEligibilityState({
          statePath:
            temp.statePath
        });

      await state.recordVerification(
        verification()
      );

      await assert.rejects(
        state.recordVerification(
          verification()
        ),
        /already exists/
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
  'persists eligibility decision across restart',
  async () => {
    const temp =
      await makeTempState();

    try {
      const first =
        await createValidatorRewardEligibilityState({
          statePath:
            temp.statePath
        });

      const created =
        await first.recordVerification(
          verification()
        );

      const second =
        await createValidatorRewardEligibilityState({
          statePath:
            temp.statePath
        });

      const loaded =
        second.getDecision(
          created.authorizationId
        );

      assert.deepEqual(
        loaded,
        created
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
  'keeps separate authorizations independent',
  async () => {
    const temp =
      await makeTempState();

    try {
      const state =
        await createValidatorRewardEligibilityState({
          statePath:
            temp.statePath
        });

      await state.recordVerification(
        verification({
          authorizationId:
            '0x' + '33'.repeat(32),

          verificationId:
            '0x' + '44'.repeat(32)
        })
      );

      await state.recordVerification(
        verification({
          authorizationId:
            '0x' + '55'.repeat(32),

          verificationId:
            '0x' + '66'.repeat(32)
        })
      );

      assert.equal(
        state.listDecisions().length,
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
  'rejects tampered persisted reward eligibility',
  async () => {
    const temp =
      await makeTempState();

    try {
      const state =
        await createValidatorRewardEligibilityState({
          statePath:
            temp.statePath
        });

      await state.recordVerification(
        verification()
      );

      const parsed =
        JSON.parse(
          await fs.readFile(
            temp.statePath,
            'utf8'
          )
        );

      const key =
        Object.keys(
          parsed.records
        )[0];

      parsed.records[
        key
      ].rewardEligibility =
        REWARD_INELIGIBLE;

      await fs.writeFile(
        temp.statePath,
        JSON.stringify(
          parsed,
          null,
          2
        )
      );

      await assert.rejects(
        createValidatorRewardEligibilityState({
          statePath:
            temp.statePath
        }),
        /result mismatch/
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
  'rejects tampered persisted decision ID',
  async () => {
    const temp =
      await makeTempState();

    try {
      const state =
        await createValidatorRewardEligibilityState({
          statePath:
            temp.statePath
        });

      await state.recordVerification(
        verification()
      );

      const parsed =
        JSON.parse(
          await fs.readFile(
            temp.statePath,
            'utf8'
          )
        );

      const key =
        Object.keys(
          parsed.records
        )[0];

      parsed.records[
        key
      ].decisionId =
        '0x' + 'ff'.repeat(32);

      await fs.writeFile(
        temp.statePath,
        JSON.stringify(
          parsed,
          null,
          2
        )
      );

      await assert.rejects(
        createValidatorRewardEligibilityState({
          statePath:
            temp.statePath
        }),
        /decision ID mismatch/
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
  'eligibility decision ID commits the observed node identity',
  async () => {
    const firstTemp =
      await makeTempState();

    const secondTemp =
      await makeTempState();

    try {
      const firstState =
        await createValidatorRewardEligibilityState({
          statePath:
            firstTemp.statePath
        });

      const secondState =
        await createValidatorRewardEligibilityState({
          statePath:
            secondTemp.statePath
        });

      const first =
        await firstState.recordVerification(
          verification()
        );

      const second =
        await secondState.recordVerification(
          verification({
            observedNodeId:
              'observed-node-002'
          })
        );

      assert.notEqual(
        first.decisionId,
        second.decisionId
      );

      assert.equal(
        first.observedNodeId,
        'observed-node-001'
      );

      assert.equal(
        second.observedNodeId,
        'observed-node-002'
      );
    } finally {
      await fs.rm(
        firstTemp.directory,
        {
          recursive: true,
          force: true
        }
      );

      await fs.rm(
        secondTemp.directory,
        {
          recursive: true,
          force: true
        }
      );
    }
  }
);

test(
  'rejects non-canonical eligibility window timestamps',
  async () => {
    const temp =
      await makeTempState();

    try {
      const state =
        await createValidatorRewardEligibilityState({
          statePath:
            temp.statePath
        });

      await assert.rejects(
        state.recordVerification(
          verification({
            windowEndedAt:
              '2026-08-10 20:20:00'
          })
        ),
        /canonical UTC timestamp/
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
