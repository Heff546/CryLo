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
  buildSignedValidatorRewardApproval
} = require(
  '../src/evidence/signed-validator-reward-approval'
);

const {
  REWARD_ELIGIBLE
} = require(
  '../src/evidence/validator-reward-eligibility-state'
);

const {
  QUORUM_PENDING,
  QUORUM_APPROVED,
  createValidatorRewardApprovalQuorumState
} = require(
  '../src/evidence/validator-reward-approval-quorum-state'
);

const {
  createValidatorRewardApprovalHandler
} = require(
  '../src/evidence/validator-reward-approval-handler'
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
        'crylo-validator-approval-handler-'
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
    version: 1,

    purpose:
      PURPOSE,

    chainId: 5546,

    validatorAddress:
      validator.address,

    nodeId:
      validatorNodeId,

    sessionAddress:
      session.address,

    issuedAt:
      '2026-08-11T04:00:00.000Z',

    expiresAt:
      '2026-08-12T04:00:00.000Z'
  };

  const delegationSignature =
    await validator.signMessage(
      JSON.stringify(
        delegation
      )
    );

  const authorization = {
    version: 1,
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

      issuedAt:
        '2026-08-11T05:21:00.000Z',

      privateKey:
        session.privateKey
    });

  return {
    validator,
    session,
    authorization,
    approval,
    rewardDecision
  };
}

function validatorNode(
  overrides = {}
) {
  return {
    registered:
      true,

    isNodeWallet:
      true,

    tier:
      '2',

    tierLabel:
      'Validator',

    stakeAtomic:
      '75000000000000',

    operatorStakeRequirementAtomic:
      '30000000000000',

    validatorStakeRequirementAtomic:
      '75000000000000',

    ...overrides
  };
}

function windowQuery(
  rewardDecision
) {
  return {
    observedOperatorAddress:
      rewardDecision
        .observedOperatorAddress,

    observedNodeId:
      rewardDecision
        .observedNodeId,

    windowStartedAt:
      rewardDecision
        .windowStartedAt,

    windowEndedAt:
      rewardDecision
        .windowEndedAt
  };
}

test(
  'valid current Validator approval reaches quorum state',
  async () => {
    const temp =
      await makeTempState();

    try {
      const quorumState =
        await createValidatorRewardApprovalQuorumState({
          minimumApprovals: 2,

          statePath:
            temp.statePath
        });

      const bundle =
        await approvalBundle();

      let reads =
        0;

      const handler =
        createValidatorRewardApprovalHandler({
          async readNode(
            address
          ) {
            reads += 1;

            assert.equal(
              address,
              bundle.validator.address
            );

            return validatorNode();
          },

          quorumState
        });

      const result =
        await handler.handleValidatorRewardApproval({
          authorization:
            bundle.authorization,

          approval:
            bundle.approval,

          nowMs:
            NOW
        });

      assert.equal(
        reads,
        1
      );

      assert.equal(
        result.accepted,
        true
      );

      assert.equal(
        result.approvingValidatorAddress,
        bundle.validator.address
      );

      assert.equal(
        result.quorumStatus,
        QUORUM_PENDING
      );

      const persisted =
        quorumState.getWindow(
          windowQuery(
            bundle.rewardDecision
          )
        );

      assert.ok(
        persisted
      );

      assert.equal(
        Object.keys(
          persisted.approvals
        ).length,
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
  'two independently authorized Validators reach quorum',
  async () => {
    const temp =
      await makeTempState();

    try {
      const quorumState =
        await createValidatorRewardApprovalQuorumState({
          minimumApprovals: 2,

          statePath:
            temp.statePath
        });

      const first =
        await approvalBundle({
          validatorNodeId:
            'validator-node-001'
        });

      const second =
        await approvalBundle({
          validatorNodeId:
            'validator-node-002'
        });

      const nodes =
        new Map([
          [
            first.validator.address,
            validatorNode()
          ],
          [
            second.validator.address,
            validatorNode()
          ]
        ]);

      const handler =
        createValidatorRewardApprovalHandler({
          async readNode(
            address
          ) {
            return nodes.get(
              address
            );
          },

          quorumState
        });

      const firstResult =
        await handler.handleValidatorRewardApproval({
          authorization:
            first.authorization,

          approval:
            first.approval,

          nowMs:
            NOW
        });

      assert.equal(
        firstResult.quorumStatus,
        QUORUM_PENDING
      );

      const secondResult =
        await handler.handleValidatorRewardApproval({
          authorization:
            second.authorization,

          approval:
            second.approval,

          nowMs:
            NOW
        });

      assert.equal(
        secondResult.quorumStatus,
        QUORUM_APPROVED
      );

      assert.match(
        secondResult.finalizationId,
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
  'Operator-tier signer cannot mutate Validator quorum',
  async () => {
    const temp =
      await makeTempState();

    try {
      const quorumState =
        await createValidatorRewardApprovalQuorumState({
          minimumApprovals: 2,

          statePath:
            temp.statePath
        });

      const bundle =
        await approvalBundle();

      const handler =
        createValidatorRewardApprovalHandler({
          async readNode() {
            return validatorNode({
              tier:
                '1',

              tierLabel:
                'Operator',

              stakeAtomic:
                '30000000000000'
            });
          },

          quorumState
        });

      await assert.rejects(
        handler.handleValidatorRewardApproval({
          authorization:
            bundle.authorization,

          approval:
            bundle.approval,

          nowMs:
            NOW
        }),
        error =>
          error.code ===
          'APPROVING_WALLET_NOT_VALIDATOR'
      );

      assert.equal(
        quorumState.getWindow(
          windowQuery(
            bundle.rewardDecision
          )
        ),
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
  'insufficiently staked Validator cannot mutate quorum',
  async () => {
    const temp =
      await makeTempState();

    try {
      const quorumState =
        await createValidatorRewardApprovalQuorumState({
          minimumApprovals: 2,

          statePath:
            temp.statePath
        });

      const bundle =
        await approvalBundle();

      const handler =
        createValidatorRewardApprovalHandler({
          async readNode() {
            return validatorNode({
              stakeAtomic:
                '74999999999999'
            });
          },

          quorumState
        });

      await assert.rejects(
        handler.handleValidatorRewardApproval({
          authorization:
            bundle.authorization,

          approval:
            bundle.approval,

          nowMs:
            NOW
        }),
        error =>
          error.code ===
          'APPROVING_VALIDATOR_STAKE_INSUFFICIENT'
      );

      assert.equal(
        quorumState.getWindow(
          windowQuery(
            bundle.rewardDecision
          )
        ),
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
  'NodeStaking RPC failure leaves quorum untouched',
  async () => {
    const temp =
      await makeTempState();

    try {
      const quorumState =
        await createValidatorRewardApprovalQuorumState({
          minimumApprovals: 2,

          statePath:
            temp.statePath
        });

      const bundle =
        await approvalBundle();

      const handler =
        createValidatorRewardApprovalHandler({
          async readNode() {
            throw new Error(
              'RPC unavailable'
            );
          },

          quorumState
        });

      await assert.rejects(
        handler.handleValidatorRewardApproval({
          authorization:
            bundle.authorization,

          approval:
            bundle.approval,

          nowMs:
            NOW
        }),
        /RPC unavailable/
      );

      assert.equal(
        quorumState.getWindow(
          windowQuery(
            bundle.rewardDecision
          )
        ),
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
  'tampered approval is rejected before NodeStaking read',
  async () => {
    const temp =
      await makeTempState();

    try {
      const quorumState =
        await createValidatorRewardApprovalQuorumState({
          minimumApprovals: 2,

          statePath:
            temp.statePath
        });

      const bundle =
        await approvalBundle();

      let reads =
        0;

      const handler =
        createValidatorRewardApprovalHandler({
          async readNode() {
            reads += 1;

            return validatorNode();
          },

          quorumState
        });

      await assert.rejects(
        handler.handleValidatorRewardApproval({
          authorization:
            bundle.authorization,

          approval: {
            ...bundle.approval,

            observedNodeId:
              'tampered-node'
          },

          nowMs:
            NOW
        }),
        /hash mismatch/
      );

      assert.equal(
        reads,
        0
      );

      assert.equal(
        quorumState.getWindow(
          windowQuery(
            bundle.rewardDecision
          )
        ),
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
  'rejects malformed handler dependencies',
  () => {
    assert.throws(
      () =>
        createValidatorRewardApprovalHandler(
          null
        ),
      /plain object/
    );

    assert.throws(
      () =>
        createValidatorRewardApprovalHandler({
          readNode:
            null,

          quorumState: {
            acceptApproval() {}
          }
        }),
      /must be a function/
    );

    assert.throws(
      () =>
        createValidatorRewardApprovalHandler({
          readNode() {},

          quorumState: {}
        }),
      /acceptApproval/
    );
  }
);
