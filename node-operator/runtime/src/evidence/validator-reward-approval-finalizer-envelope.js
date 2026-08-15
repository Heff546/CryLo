'use strict';

const {
  keccak256,
  toUtf8Bytes
} = require('ethers');

const {
  verifySignedValidatorRewardApproval
} = require(
  './signed-validator-reward-approval'
);

const {
  REWARD_ELIGIBLE,
  REWARD_INELIGIBLE
} = require(
  './validator-reward-eligibility-state'
);

const {
  verifyValidatorRewardApprovalAuthorization
} = require(
  './validator-reward-approval-authorization'
);

function requirePlainObject(
  value,
  name
) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !==
      Object.prototype
  ) {
    throw new TypeError(
      `${name} must be a plain object`
    );
  }

  return value;
}

function hashText(
  value,
  name
) {
  if (
    typeof value !== 'string' ||
    value.length === 0
  ) {
    throw new TypeError(
      `${name} must be a non-empty string`
    );
  }

  return keccak256(
    toUtf8Bytes(value)
  );
}

function timestampSeconds(
  value,
  name
) {
  if (
    typeof value !== 'string' ||
    value.length === 0
  ) {
    throw new TypeError(
      `${name} must be a canonical timestamp`
    );
  }

  const milliseconds =
    Date.parse(value);

  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !==
      value ||
    milliseconds % 1000 !== 0
  ) {
    throw new TypeError(
      `${name} must be a canonical whole-second timestamp`
    );
  }

  return BigInt(
    milliseconds / 1000
  );
}

function validatorRewardApprovalEnvelopeToFinalizerVote({
  authorization,
  approval,
  nowMs = Date.now()
}) {
  requirePlainObject(
    authorization,
    'Validator reward approval authorization'
  );

  requirePlainObject(
    approval,
    'Signed Validator reward approval'
  );

  const verifiedApproval =
    verifySignedValidatorRewardApproval(
      approval
    );

  const verifiedAuthorization =
    verifyValidatorRewardApprovalAuthorization({
      authorization,

      expectedValidatorAddress:
        verifiedApproval
          .approvingValidatorAddress,

      expectedValidatorNodeId:
        verifiedApproval
          .approvingValidatorNodeId,

      expectedSessionAddress:
        verifiedApproval
          .approvingSessionAddress,

      expectedFinalizationContract:
        verifiedApproval
          .finalizationContract,

      nowMs
    });

  const delegation =
    verifiedAuthorization.delegation;

  return Object.freeze({
    delegation: Object.freeze({
      validatorAddress:
        verifiedAuthorization
          .validatorAddress,

      validatorNodeIdHash:
        hashText(
          verifiedAuthorization
            .validatorNodeId,
          'Validator node ID'
        ),

      sessionAddress:
        verifiedAuthorization
          .sessionAddress,

      issuedAt:
        timestampSeconds(
          delegation.issuedAt,
          'Validator delegation issuedAt'
        ),

      expiresAt:
        timestampSeconds(
          delegation.expiresAt,
          'Validator delegation expiresAt'
        )
    }),

    delegationSignature:
      verifiedAuthorization
        .delegationSignature,

    approval: Object.freeze({
      approvingValidatorAddress:
        verifiedApproval
          .approvingValidatorAddress,

      approvingValidatorNodeIdHash:
        hashText(
          verifiedApproval
            .approvingValidatorNodeId,
          'Approving Validator node ID'
        ),

      approvingSessionAddress:
        verifiedApproval
          .approvingSessionAddress,

      observedOperatorAddress:
        verifiedApproval
          .observedOperatorAddress,

      observedNodeIdHash:
        hashText(
          verifiedApproval
            .observedNodeId,
          'Observed node ID'
        ),

      windowStartedAt:
        timestampSeconds(
          verifiedApproval
            .windowStartedAt,
          'Reward windowStartedAt'
        ),

      windowEndedAt:
        timestampSeconds(
          verifiedApproval
            .windowEndedAt,
          'Reward windowEndedAt'
        ),

      authorizationId:
        verifiedApproval
          .authorizationId,

      verificationId:
        verifiedApproval
          .verificationId,

      decisionId:
        verifiedApproval
          .decisionId,

      contractOutcomeHash:
        hashText(
          verifiedApproval
            .contractOutcome,
          'Contract outcome'
        ),

      contractReasonCodeHash:
        hashText(
          verifiedApproval
            .contractReasonCode,
          'Contract reason code'
        ),

      rewardEligible:
        verifiedApproval
          .rewardEligibility ===
          REWARD_ELIGIBLE
          ? true
          : verifiedApproval
              .rewardEligibility ===
              REWARD_INELIGIBLE
            ? false
            : (() => {
                throw new Error(
                  'Validator reward approval eligibility is invalid'
                );
              })(),

      issuedAt:
        timestampSeconds(
          verifiedApproval
            .issuedAt,
          'Validator approval issuedAt'
        )
    }),

    approvalSignature:
      approval.signature,

    approvalHash:
      approval.approvalHash,

    finalizationContract:
      verifiedApproval
        .finalizationContract
  });
}

module.exports = Object.freeze({
  hashText,
  timestampSeconds,
  validatorRewardApprovalEnvelopeToFinalizerVote
});
