'use strict';

const {
  SigningKey,
  computeAddress,
  getAddress
} = require('ethers');

const {
  isCanonicalHash
} = require('./hashing');

const {
  assertPrivateKey
} = require('./detached-signing');

const {
  REWARD_ELIGIBLE,
  REWARD_INELIGIBLE
} = require(
  './validator-reward-eligibility-state'
);

const {
  APPROVAL_VERSION,
  validatorRewardApprovalTypedData,
  verifyValidatorRewardApprovalSignature
} = require(
  './validator-reward-approval-signature-eip712'
);

const APPROVAL_SCHEMA_VERSION = 2;

const APPROVAL_PROTOCOL_VERSION =
  '3.0.0';

const CRYLONEXUS_CHAIN_ID = 5546;

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

function requireNonEmptyString(
  value,
  name
) {
  if (
    typeof value !== 'string' ||
    value.trim() === ''
  ) {
    throw new TypeError(
      `${name} must be a non-empty string`
    );
  }

  return value;
}

function normalizeAddress(
  value,
  name
) {
  try {
    return getAddress(
      requireNonEmptyString(
        value,
        name
      )
    );
  } catch (error) {
    throw new TypeError(
      `${name} must be a valid EVM address`,
      {
        cause:
          error
      }
    );
  }
}

function requireCanonicalTime(
  value,
  name
) {
  requireNonEmptyString(
    value,
    name
  );

  const parsed =
    Date.parse(value);

  if (
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString() !==
      value
  ) {
    throw new TypeError(
      `${name} must be a canonical UTC timestamp`
    );
  }

  if (
    parsed % 1000 !==
    0
  ) {
    throw new TypeError(
      `${name} must have whole-second precision`
    );
  }

  return value;
}

function requireCanonicalHash(
  value,
  name
) {
  if (!isCanonicalHash(value)) {
    throw new TypeError(
      `${name} must be a canonical hash`
    );
  }

  return value;
}

function buildUnsignedValidatorRewardApproval({
  decision,
  approvingValidatorAddress,
  approvingValidatorNodeId,
  approvingSessionAddress,
  finalizationContract,
  issuedAt
}) {
  requirePlainObject(
    decision,
    'Validator reward eligibility decision'
  );

  const validatorAddress =
    normalizeAddress(
      approvingValidatorAddress,
      'Approving Validator address'
    );

  const validatorNodeId =
    requireNonEmptyString(
      approvingValidatorNodeId,
      'Approving Validator node ID'
    );

  const sessionAddress =
    normalizeAddress(
      approvingSessionAddress,
      'Approving Validator session address'
    );

  const normalizedFinalizationContract =
    normalizeAddress(
      finalizationContract,
      'Validator reward finalization contract'
    );

  const observedOperatorAddress =
    normalizeAddress(
      decision.observedOperatorAddress,
      'Published observed Operator address'
    );

  const observedNodeId =
    requireNonEmptyString(
      decision.observedNodeId,
      'Published observed node ID'
    );

  const windowStartedAt =
    requireCanonicalTime(
      decision.windowStartedAt,
      'Published windowStartedAt'
    );

  const windowEndedAt =
    requireCanonicalTime(
      decision.windowEndedAt,
      'Published windowEndedAt'
    );

  if (
    Date.parse(windowEndedAt) <=
    Date.parse(windowStartedAt)
  ) {
    throw new Error(
      'Published eligibility window end must follow its start'
    );
  }

  const rewardEligibility =
    decision.rewardEligibility;

  if (
    rewardEligibility !==
      REWARD_ELIGIBLE &&
    rewardEligibility !==
      REWARD_INELIGIBLE
  ) {
    throw new Error(
      'Published reward eligibility decision is invalid'
    );
  }

  return Object.freeze({
    schemaVersion:
      APPROVAL_SCHEMA_VERSION,

    approvalVersion:
      APPROVAL_VERSION,

    protocolVersion:
      APPROVAL_PROTOCOL_VERSION,

    chainId:
      CRYLONEXUS_CHAIN_ID,

    purpose:
      'validator-reward-approval',

    finalizationContract:
      normalizedFinalizationContract,

    approvingValidatorAddress:
      validatorAddress,

    approvingValidatorNodeId:
      validatorNodeId,

    approvingSessionAddress:
      sessionAddress,

    observedOperatorAddress,

    observedNodeId,

    windowStartedAt,
    windowEndedAt,

    authorizationId:
      requireCanonicalHash(
        decision.authorizationId,
        'Published authorization ID'
      ),

    verificationId:
      requireCanonicalHash(
        decision.verificationId,
        'Published verification ID'
      ),

    decisionId:
      requireCanonicalHash(
        decision.decisionId,
        'Published decision ID'
      ),

    contractOutcome:
      requireNonEmptyString(
        decision.contractOutcome,
        'Published contract outcome'
      ),

    contractReasonCode:
      requireNonEmptyString(
        decision.contractReasonCode,
        'Published contract reason code'
      ),

    rewardEligibility,

    issuedAt:
      requireCanonicalTime(
        issuedAt,
        'Validator reward approval issuedAt'
      )
  });
}

function buildSignedValidatorRewardApproval({
  decision,
  approvingValidatorAddress,
  approvingValidatorNodeId,
  approvingSessionAddress,
  finalizationContract,
  issuedAt,
  privateKey
}) {
  assertPrivateKey(
    privateKey,
    'Validator reward approval private key'
  );

  const unsigned =
    buildUnsignedValidatorRewardApproval({
      decision,
      approvingValidatorAddress,
      approvingValidatorNodeId,
      approvingSessionAddress,
      finalizationContract,
      issuedAt
    });

  const signerAddress =
    getAddress(
      computeAddress(
        privateKey
      )
    );

  if (
    signerAddress !==
    unsigned.approvingSessionAddress
  ) {
    throw new Error(
      'Validator reward approval signer does not match approving session address'
    );
  }

  const typed =
    validatorRewardApprovalTypedData(
      unsigned,
      unsigned.finalizationContract
    );

  const signingKey =
    new SigningKey(
      privateKey
    );

  const signature =
    signingKey
      .sign(
        typed.digest
      )
      .serialized;

  return Object.freeze({
    ...unsigned,

    approvalHash:
      typed.digest,

    signature
  });
}

function verifySignedValidatorRewardApproval(
  approval
) {
  requirePlainObject(
    approval,
    'Signed Validator reward approval'
  );

  const {
    approvalHash,
    signature,
    ...unsignedInput
  } = approval;

  requireCanonicalHash(
    approvalHash,
    'Validator reward approval hash'
  );

  requireNonEmptyString(
    signature,
    'Validator reward approval signature'
  );

  const unsigned =
    buildUnsignedValidatorRewardApproval({
      decision: {
        observedOperatorAddress:
          unsignedInput.observedOperatorAddress,

        observedNodeId:
          unsignedInput.observedNodeId,

        windowStartedAt:
          unsignedInput.windowStartedAt,

        windowEndedAt:
          unsignedInput.windowEndedAt,

        authorizationId:
          unsignedInput.authorizationId,

        verificationId:
          unsignedInput.verificationId,

        decisionId:
          unsignedInput.decisionId,

        contractOutcome:
          unsignedInput.contractOutcome,

        contractReasonCode:
          unsignedInput.contractReasonCode,

        rewardEligibility:
          unsignedInput.rewardEligibility
      },

      approvingValidatorAddress:
        unsignedInput
          .approvingValidatorAddress,

      approvingValidatorNodeId:
        unsignedInput
          .approvingValidatorNodeId,

      approvingSessionAddress:
        unsignedInput
          .approvingSessionAddress,

      finalizationContract:
        unsignedInput
          .finalizationContract,

      issuedAt:
        unsignedInput.issuedAt
    });

  const typed =
    validatorRewardApprovalTypedData(
      unsigned,
      unsigned.finalizationContract
    );

  if (
    typed.digest !==
    approvalHash
  ) {
    throw new Error(
      'Validator reward approval hash mismatch'
    );
  }

  const signatureResult =
    verifyValidatorRewardApprovalSignature({
      approval:
        unsigned,

      finalizationContract:
        unsigned.finalizationContract,

      signature
    });

  return Object.freeze({
    valid:
      true,

    approvalHash,

    signatureSigner:
      signatureResult
        .recoveredSessionAddress,

    finalizationContract:
      unsigned.finalizationContract,

    ...unsigned
  });
}

module.exports = Object.freeze({
  APPROVAL_SCHEMA_VERSION,
  APPROVAL_PROTOCOL_VERSION,
  CRYLONEXUS_CHAIN_ID,
  buildUnsignedValidatorRewardApproval,
  buildSignedValidatorRewardApproval,
  verifySignedValidatorRewardApproval
});
