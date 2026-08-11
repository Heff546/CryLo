'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { Wallet } = require('ethers');

const {
  REWARD_ELIGIBLE,
  REWARD_INELIGIBLE
} = require(
  '../src/evidence/validator-reward-eligibility-state'
);

const {
  buildSignedValidatorRewardApproval,
  verifySignedValidatorRewardApproval
} = require(
  '../src/evidence/signed-validator-reward-approval'
);

function decision(
  overrides = {}
) {
  return {
    observedOperatorAddress:
      Wallet.createRandom().address,

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

function buildApproval(
  overrides = {}
) {
  const session =
    overrides.session ||
    Wallet.createRandom();

  const validator =
    overrides.validator ||
    Wallet.createRandom();

  const approval =
    buildSignedValidatorRewardApproval({
      decision:
        overrides.decision ||
        decision(),

      approvingValidatorAddress:
        validator.address,

      approvingValidatorNodeId:
        'validator-node-001',

      approvingSessionAddress:
        session.address,

      issuedAt:
        '2026-08-11T05:21:00.000Z',

      privateKey:
        session.privateKey
    });

  return {
    approval,
    session,
    validator
  };
}

test(
  'builds and verifies signed reward eligibility approval',
  () => {
    const {
      approval
    } =
      buildApproval();

    const verified =
      verifySignedValidatorRewardApproval(
        approval
      );

    assert.equal(
      verified.valid,
      true
    );

    assert.equal(
      verified.rewardEligibility,
      REWARD_ELIGIBLE
    );

    assert.equal(
      verified.observedNodeId,
      'operator-node-001'
    );
  }
);

test(
  'preserves REWARD_INELIGIBLE approval',
  () => {
    const {
      approval
    } =
      buildApproval({
        decision:
          decision({
            rewardEligibility:
              REWARD_INELIGIBLE,

            contractOutcome:
              'CONTRACT_REJECTED',

            contractReasonCode:
              'INSUFFICIENT_STAKE'
          })
      });

    const verified =
      verifySignedValidatorRewardApproval(
        approval
      );

    assert.equal(
      verified.rewardEligibility,
      REWARD_INELIGIBLE
    );
  }
);

test(
  'approval hash commits target node identity',
  () => {
    const session =
      Wallet.createRandom();

    const validator =
      Wallet.createRandom();

    const first =
      buildApproval({
        session,
        validator,
        decision:
          decision({
            observedNodeId:
              'operator-node-001'
          })
      }).approval;

    const second =
      buildApproval({
        session,
        validator,
        decision:
          decision({
            observedNodeId:
              'operator-node-002'
          })
      }).approval;

    assert.notEqual(
      first.approvalHash,
      second.approvalHash
    );
  }
);

test(
  'approval hash commits Validator identity',
  () => {
    const session =
      Wallet.createRandom();

    const first =
      buildApproval({
        session,
        validator:
          Wallet.createRandom()
      }).approval;

    const second =
      buildApproval({
        session,
        validator:
          Wallet.createRandom()
      }).approval;

    assert.notEqual(
      first.approvalHash,
      second.approvalHash
    );
  }
);

test(
  'rejects tampered target node ID',
  () => {
    const {
      approval
    } =
      buildApproval();

    assert.throws(
      () =>
        verifySignedValidatorRewardApproval({
          ...approval,
          observedNodeId:
            'tampered-node'
        }),
      /hash mismatch/
    );
  }
);

test(
  'rejects tampered eligibility decision',
  () => {
    const {
      approval
    } =
      buildApproval();

    assert.throws(
      () =>
        verifySignedValidatorRewardApproval({
          ...approval,
          rewardEligibility:
            REWARD_INELIGIBLE
        }),
      /hash mismatch/
    );
  }
);

test(
  'rejects wrong approving session key',
  () => {
    const session =
      Wallet.createRandom();

    const wrong =
      Wallet.createRandom();

    assert.throws(
      () =>
        buildSignedValidatorRewardApproval({
          decision:
            decision(),

          approvingValidatorAddress:
            Wallet.createRandom()
              .address,

          approvingValidatorNodeId:
            'validator-node-001',

          approvingSessionAddress:
            session.address,

          issuedAt:
            '2026-08-11T05:21:00.000Z',

          privateKey:
            wrong.privateKey
        }),
      /signer does not match/
    );
  }
);

test(
  'rejects non-canonical approval timestamp',
  () => {
    const session =
      Wallet.createRandom();

    assert.throws(
      () =>
        buildSignedValidatorRewardApproval({
          decision:
            decision(),

          approvingValidatorAddress:
            Wallet.createRandom()
              .address,

          approvingValidatorNodeId:
            'validator-node-001',

          approvingSessionAddress:
            session.address,

          issuedAt:
            '2026-08-11 05:21:00',

          privateKey:
            session.privateKey
        }),
      /canonical UTC timestamp/
    );
  }
);
