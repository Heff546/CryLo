'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  Wallet
} = require('ethers');

const {
  PURPOSE
} = require(
  '../src/evidence/validator-reward-approval-authorization'
);

const {
  validatorRewardApprovalDelegationTypedData
} = require(
  '../src/evidence/validator-reward-approval-eip712'
);

const FINALIZATION_CONTRACT =
  '0xF100000000000000000000000000000000000001';

const {
  buildSignedValidatorRewardApproval
} = require(
  '../src/evidence/signed-validator-reward-approval'
);

const {
  REWARD_ELIGIBLE,
  REWARD_INELIGIBLE
} = require(
  '../src/evidence/validator-reward-eligibility-state'
);

const {
  QUORUM_PENDING,
  QUORUM_APPROVED,
  QUORUM_REJECTED,
  createValidatorRewardApprovalQuorumState
} = require(
  '../src/evidence/validator-reward-approval-quorum-state'
);

const NOW =
  Date.parse(
    '2026-08-11T06:00:00.000Z'
  );

async function makeTempState() {
  const directory =
    await fs.mkdtemp(
      path.join(
        os.tmpdir(),
        'crylo-validator-approval-quorum-'
      )
    );

  return {
    directory,

    statePath:
      path.join(
        directory,
        'quorum.json'
      )
  };
}

function decision(
  overrides = {}
) {
  return {
    observedOperatorAddress:
      '0x1111111111111111111111111111111111111111',

    observedNodeId:
      'operator-node-001',

    windowStartedAt:
      '2026-08-11T05:00:00.000Z',

    windowEndedAt:
      '2026-08-11T05:20:00.000Z',

    authorizationId:
      '0x' + '11'.repeat(32),

    verificationId:
      '0x' + '22'.repeat(32),

    decisionId:
      '0x' + '33'.repeat(32),

    contractOutcome:
      'CONTRACT_VERIFIED',

    contractReasonCode:
      'VERIFIED',

    rewardEligibility:
      REWARD_ELIGIBLE,

    ...overrides
  };
}

async function approvalBundle({
  validator =
    Wallet.createRandom(),

  session =
    Wallet.createRandom(),

  validatorNodeId =
    'validator-node-001',

  rewardDecision =
    decision()
} = {}) {
  const delegation = {
    version: 2,
    purpose:
      PURPOSE,
    chainId: 5546,

    validatorAddress:
      validator.address,

    nodeId:
      validatorNodeId,

    sessionAddress:
      session.address,

    finalizationContract:
      FINALIZATION_CONTRACT,

    issuedAt:
      '2026-08-11T04:00:00.000Z',

    expiresAt:
      '2026-08-12T04:00:00.000Z'
  };

  const typedDelegation =
    validatorRewardApprovalDelegationTypedData(
      delegation
    );

  const delegationSignature =
    await validator.signTypedData(
      typedDelegation.domain,
      typedDelegation.types,
      typedDelegation.value
    );

  const authorization = {
    version: 2,
    delegation,
    delegationSignature
  };

  const approval =
    buildSignedValidatorRewardApproval({
      decision:
        rewardDecision,

      approvingValidatorAddress:
        validator.address,

      approvingValidatorNodeId:
        validatorNodeId,

      approvingSessionAddress:
        session.address,

      finalizationContract:
        FINALIZATION_CONTRACT,

      issuedAt:
        '2026-08-11T05:21:00.000Z',

      privateKey:
        session.privateKey
    });

  return {
    validator,
    session,
    authorization,
    approval
  };
}

async function submit(
  state,
  bundle
) {
  return await state.acceptApproval({
    authorization:
      bundle.authorization,

    approval:
      bundle.approval,

    nowMs:
      NOW
  });
}

test(
  'remains pending below Validator approval quorum',
  async () => {
    const temp =
      await makeTempState();

    try {
      const state =
        await createValidatorRewardApprovalQuorumState({
          minimumApprovals: 3,
          statePath:
            temp.statePath
        });

      const first =
        await submit(
          state,
          await approvalBundle()
        );

      assert.equal(
        first.record.quorumStatus,
        QUORUM_PENDING
      );

      assert.equal(
        Object.keys(
          first.record.approvals
        ).length,
        1
      );

      assert.equal(
        first.record.finalizationId,
        null
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
  'three independent Validators finalize eligible reward approval',
  async () => {
    const temp =
      await makeTempState();

    try {
      const state =
        await createValidatorRewardApprovalQuorumState({
          minimumApprovals: 3,
          statePath:
            temp.statePath
        });

      await submit(
        state,
        await approvalBundle({
          validatorNodeId:
            'validator-node-001'
        })
      );

      await submit(
        state,
        await approvalBundle({
          validatorNodeId:
            'validator-node-002'
        })
      );

      const third =
        await submit(
          state,
          await approvalBundle({
            validatorNodeId:
              'validator-node-003'
          })
        );

      assert.equal(
        third.record.quorumStatus,
        QUORUM_APPROVED
      );

      assert.equal(
        Object.keys(
          third.record.approvals
        ).length,
        3
      );

      assert.match(
        third.record.finalizationId,
        /^0x[0-9a-f]{64}$/
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
  'three independent Validators finalize ineligible decision as rejected',
  async () => {
    const temp =
      await makeTempState();

    try {
      const state =
        await createValidatorRewardApprovalQuorumState({
          minimumApprovals: 3,
          statePath:
            temp.statePath
        });

      const rejectedDecision =
        decision({
          rewardEligibility:
            REWARD_INELIGIBLE,

          contractOutcome:
            'CONTRACT_REJECTED',

          contractReasonCode:
            'INSUFFICIENT_STAKE'
        });

      await submit(
        state,
        await approvalBundle({
          rewardDecision:
            rejectedDecision
        })
      );

      await submit(
        state,
        await approvalBundle({
          rewardDecision:
            rejectedDecision
        })
      );

      const third =
        await submit(
          state,
          await approvalBundle({
            rewardDecision:
              rejectedDecision
          })
        );

      assert.equal(
        third.record.quorumStatus,
        QUORUM_REJECTED
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
  'same Validator wallet cannot approve twice',
  async () => {
    const temp =
      await makeTempState();

    try {
      const state =
        await createValidatorRewardApprovalQuorumState({
          minimumApprovals: 3,
          statePath:
            temp.statePath
        });

      const validator =
        Wallet.createRandom();

      await submit(
        state,
        await approvalBundle({
          validator,
          validatorNodeId:
            'validator-node-a'
        })
      );

      await assert.rejects(
        submit(
          state,
          await approvalBundle({
            validator,
            session:
              Wallet.createRandom(),
            validatorNodeId:
              'validator-node-b'
          })
        ),
        /already approved/
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
  'rejects conflicting decision for same target window',
  async () => {
    const temp =
      await makeTempState();

    try {
      const state =
        await createValidatorRewardApprovalQuorumState({
          minimumApprovals: 3,
          statePath:
            temp.statePath
        });

      await submit(
        state,
        await approvalBundle()
      );

      await assert.rejects(
        submit(
          state,
          await approvalBundle({
            rewardDecision:
              decision({
                decisionId:
                  '0x' + '44'.repeat(32)
              })
          })
        ),
        /Conflicting Validator reward approval decision/
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
  'keeps separate reward windows independent',
  async () => {
    const temp =
      await makeTempState();

    try {
      const state =
        await createValidatorRewardApprovalQuorumState({
          minimumApprovals: 2,
          statePath:
            temp.statePath
        });

      await submit(
        state,
        await approvalBundle()
      );

      await submit(
        state,
        await approvalBundle({
          rewardDecision:
            decision({
              windowStartedAt:
                '2026-08-11T05:20:00.000Z',

              windowEndedAt:
                '2026-08-11T05:40:00.000Z',

              authorizationId:
                '0x' + '44'.repeat(32),

              verificationId:
                '0x' + '55'.repeat(32),

              decisionId:
                '0x' + '66'.repeat(32)
            })
        })
      );

      assert.equal(
        state.listFinalized().length,
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
  'persists quorum across restart',
  async () => {
    const temp =
      await makeTempState();

    try {
      const options = {
        minimumApprovals: 2,
        statePath:
          temp.statePath
      };

      const first =
        await createValidatorRewardApprovalQuorumState(
          options
        );

      await submit(
        first,
        await approvalBundle()
      );

      const restarted =
        await createValidatorRewardApprovalQuorumState(
          options
        );

      const result =
        await submit(
          restarted,
          await approvalBundle()
        );

      assert.equal(
        result.record.quorumStatus,
        QUORUM_APPROVED
      );

      assert.equal(
        restarted
          .listFinalized()
          .length,
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
  'rejects malformed quorum options',
  async () => {
    await assert.rejects(
      createValidatorRewardApprovalQuorumState(
        null
      ),
      /plain object/
    );

    await assert.rejects(
      createValidatorRewardApprovalQuorumState({
        minimumApprovals: 0
      }),
      /positive safe integer/
    );
  }
);
