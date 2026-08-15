'use strict';

const test =
  require('node:test');

const assert =
  require('node:assert/strict');

const {
  Wallet,
  keccak256,
  toUtf8Bytes
} = require('ethers');

const {
  PURPOSE
} = require(
  '../src/evidence/validator-reward-approval-authorization'
);

const {
  REWARD_ELIGIBLE
} = require(
  '../src/evidence/validator-reward-eligibility-state'
);

const {
  validatorRewardApprovalDelegationTypedData
} = require(
  '../src/evidence/validator-reward-approval-eip712'
);

const {
  buildSignedValidatorRewardApproval
} = require(
  '../src/evidence/signed-validator-reward-approval'
);

const {
  validatorRewardApprovalEnvelopeToFinalizerVote
} = require(
  '../src/evidence/validator-reward-approval-finalizer-envelope'
);

const FINALIZER =
  '0xF100000000000000000000000000000000000001';

test(
  'converts Pi1 EIP-712 approval envelope into deployed finalizer structs',
  async () => {
    const validator =
      Wallet.createRandom();

    const session =
      Wallet.createRandom();

    const delegation = {
      version: 2,

      purpose:
        PURPOSE,

      chainId:
        5546,

      validatorAddress:
        validator.address,

      nodeId:
        'validator-node-001',

      sessionAddress:
        session.address,

      finalizationContract:
        FINALIZER,

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

    const decision = {
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
        REWARD_ELIGIBLE
    };

    const approval =
      buildSignedValidatorRewardApproval({
        decision,

        approvingValidatorAddress:
          validator.address,

        approvingValidatorNodeId:
          'validator-node-001',

        approvingSessionAddress:
          session.address,

        finalizationContract:
          FINALIZER,

        issuedAt:
          '2026-08-11T05:20:00.000Z',

        privateKey:
          session.privateKey
      });

    const vote =
      validatorRewardApprovalEnvelopeToFinalizerVote({
        authorization,
        approval,

        nowMs:
          Date.parse(
            '2026-08-11T06:00:00.000Z'
          )
      });

    assert.equal(
      vote.delegation.validatorAddress,
      validator.address
    );

    assert.equal(
      vote.delegation.validatorNodeIdHash,
      keccak256(
        toUtf8Bytes(
          'validator-node-001'
        )
      )
    );

    assert.equal(
      vote.approval.observedNodeIdHash,
      keccak256(
        toUtf8Bytes(
          'operator-node-001'
        )
      )
    );

    assert.equal(
      vote.approval.contractOutcomeHash,
      keccak256(
        toUtf8Bytes(
          'CONTRACT_VERIFIED'
        )
      )
    );

    assert.equal(
      vote.approval.contractReasonCodeHash,
      keccak256(
        toUtf8Bytes(
          'VERIFIED'
        )
      )
    );

    assert.equal(
      vote.approval.rewardEligible,
      true
    );

    assert.equal(
      vote.approvalSignature,
      approval.signature
    );

    assert.equal(
      vote.delegationSignature,
      delegationSignature
    );

    assert.equal(
      vote.finalizationContract,
      FINALIZER
    );
  }
);

test(
  'rejects expired Validator delegation before contract submission',
  async () => {
    const validator =
      Wallet.createRandom();

    const session =
      Wallet.createRandom();

    const delegation = {
      version: 2,
      purpose: PURPOSE,
      chainId: 5546,
      validatorAddress:
        validator.address,
      nodeId:
        'validator-node-001',
      sessionAddress:
        session.address,
      finalizationContract:
        FINALIZER,
      issuedAt:
        '2026-08-11T04:00:00.000Z',
      expiresAt:
        '2026-08-11T05:00:00.000Z'
    };

    const typed =
      validatorRewardApprovalDelegationTypedData(
        delegation
      );

    const authorization = {
      version: 2,
      delegation,

      delegationSignature:
        await validator.signTypedData(
          typed.domain,
          typed.types,
          typed.value
        )
    };

    const approval =
      buildSignedValidatorRewardApproval({
        decision: {
          observedOperatorAddress:
            '0x1111111111111111111111111111111111111111',
          observedNodeId:
            'operator-node-001',
          windowStartedAt:
            '2026-08-11T04:20:00.000Z',
          windowEndedAt:
            '2026-08-11T04:40:00.000Z',
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
            REWARD_ELIGIBLE
        },

        approvingValidatorAddress:
          validator.address,

        approvingValidatorNodeId:
          'validator-node-001',

        approvingSessionAddress:
          session.address,

        finalizationContract:
          FINALIZER,

        issuedAt:
          '2026-08-11T04:40:00.000Z',

        privateKey:
          session.privateKey
      });

    assert.throws(
      () =>
        validatorRewardApprovalEnvelopeToFinalizerVote({
          authorization,
          approval,

          nowMs:
            Date.parse(
              '2026-08-11T06:00:00.000Z'
            )
        }),
      /expired/
    );
  }
);
