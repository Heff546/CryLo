'use strict';

const {
  TypedDataEncoder,
  getAddress,
  isAddress,
  keccak256,
  toUtf8Bytes,
  verifyTypedData
} = require('ethers');

const {
  REWARD_ELIGIBLE,
  REWARD_INELIGIBLE
} = require(
  './validator-reward-eligibility-state'
);

const CHAIN_ID = 5546;

const PURPOSE =
  'validator-reward-approval';

const EIP712_DOMAIN_NAME =
  'CryLoNexus Validator Reward Approval';

const EIP712_DOMAIN_VERSION =
  '2';

const APPROVAL_VERSION = 2;

const APPROVAL_TYPES =
  Object.freeze({
    ValidatorRewardApproval: [
      {
        name: 'version',
        type: 'uint256'
      },
      {
        name: 'purposeHash',
        type: 'bytes32'
      },
      {
        name: 'approvingValidatorAddress',
        type: 'address'
      },
      {
        name: 'approvingValidatorNodeIdHash',
        type: 'bytes32'
      },
      {
        name: 'approvingSessionAddress',
        type: 'address'
      },
      {
        name: 'observedOperatorAddress',
        type: 'address'
      },
      {
        name: 'observedNodeIdHash',
        type: 'bytes32'
      },
      {
        name: 'windowStartedAt',
        type: 'uint64'
      },
      {
        name: 'windowEndedAt',
        type: 'uint64'
      },
      {
        name: 'authorizationId',
        type: 'bytes32'
      },
      {
        name: 'verificationId',
        type: 'bytes32'
      },
      {
        name: 'decisionId',
        type: 'bytes32'
      },
      {
        name: 'contractOutcomeHash',
        type: 'bytes32'
      },
      {
        name: 'contractReasonCodeHash',
        type: 'bytes32'
      },
      {
        name: 'rewardEligible',
        type: 'bool'
      },
      {
        name: 'issuedAt',
        type: 'uint64'
      }
    ]
  });

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
  requireNonEmptyString(
    value,
    name
  );

  if (!isAddress(value)) {
    throw new TypeError(
      `${name} must be a valid EVM address`
    );
  }

  return getAddress(value);
}

function canonicalTimeSeconds(
  value,
  name
) {
  requireNonEmptyString(
    value,
    name
  );

  const milliseconds =
    Date.parse(value);

  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !==
      value
  ) {
    throw new TypeError(
      `${name} must be a canonical UTC timestamp`
    );
  }

  if (
    milliseconds % 1000 !== 0
  ) {
    throw new TypeError(
      `${name} must have whole-second precision`
    );
  }

  const seconds =
    milliseconds / 1000;

  if (
    !Number.isSafeInteger(seconds) ||
    seconds < 0
  ) {
    throw new TypeError(
      `${name} is outside the supported timestamp range`
    );
  }

  return seconds;
}

function requireCanonicalHash(
  value,
  name
) {
  if (
    typeof value !== 'string' ||
    !/^0x[0-9a-fA-F]{64}$/.test(value)
  ) {
    throw new TypeError(
      `${name} must be a bytes32 hash`
    );
  }

  return value;
}

function hashText(
  value,
  name
) {
  return keccak256(
    toUtf8Bytes(
      requireNonEmptyString(
        value,
        name
      )
    )
  );
}

function rewardEligibilityBoolean(
  value
) {
  if (value === REWARD_ELIGIBLE) {
    return true;
  }

  if (value === REWARD_INELIGIBLE) {
    return false;
  }

  throw new Error(
    'Validator reward approval eligibility is invalid'
  );
}

function validatorRewardApprovalTypedData(
  approval,
  finalizationContract
) {
  requirePlainObject(
    approval,
    'Validator reward approval'
  );

  const verifyingContract =
    normalizeAddress(
      finalizationContract,
      'Validator reward finalization contract'
    );

  const windowStartedAt =
    canonicalTimeSeconds(
      approval.windowStartedAt,
      'Validator reward approval windowStartedAt'
    );

  const windowEndedAt =
    canonicalTimeSeconds(
      approval.windowEndedAt,
      'Validator reward approval windowEndedAt'
    );

  if (
    windowEndedAt <=
    windowStartedAt
  ) {
    throw new Error(
      'Validator reward approval window end must follow its start'
    );
  }

  const issuedAt =
    canonicalTimeSeconds(
      approval.issuedAt,
      'Validator reward approval issuedAt'
    );

  const domain =
    Object.freeze({
      name:
        EIP712_DOMAIN_NAME,

      version:
        EIP712_DOMAIN_VERSION,

      chainId:
        CHAIN_ID,

      verifyingContract
    });

  const value =
    Object.freeze({
      version:
        APPROVAL_VERSION,

      purposeHash:
        hashText(
          PURPOSE,
          'Validator reward approval purpose'
        ),

      approvingValidatorAddress:
        normalizeAddress(
          approval.approvingValidatorAddress,
          'Approving Validator address'
        ),

      approvingValidatorNodeIdHash:
        hashText(
          approval.approvingValidatorNodeId,
          'Approving Validator node ID'
        ),

      approvingSessionAddress:
        normalizeAddress(
          approval.approvingSessionAddress,
          'Approving Validator session address'
        ),

      observedOperatorAddress:
        normalizeAddress(
          approval.observedOperatorAddress,
          'Observed Operator address'
        ),

      observedNodeIdHash:
        hashText(
          approval.observedNodeId,
          'Observed node ID'
        ),

      windowStartedAt,
      windowEndedAt,

      authorizationId:
        requireCanonicalHash(
          approval.authorizationId,
          'Validator reward approval authorization ID'
        ),

      verificationId:
        requireCanonicalHash(
          approval.verificationId,
          'Validator reward approval verification ID'
        ),

      decisionId:
        requireCanonicalHash(
          approval.decisionId,
          'Validator reward approval decision ID'
        ),

      contractOutcomeHash:
        hashText(
          approval.contractOutcome,
          'Validator reward approval contract outcome'
        ),

      contractReasonCodeHash:
        hashText(
          approval.contractReasonCode,
          'Validator reward approval contract reason code'
        ),

      rewardEligible:
        rewardEligibilityBoolean(
          approval.rewardEligibility
        ),

      issuedAt
    });

  const digest =
    TypedDataEncoder.hash(
      domain,
      APPROVAL_TYPES,
      value
    );

  return Object.freeze({
    domain,
    types:
      APPROVAL_TYPES,
    value,
    digest,
    finalizationContract:
      verifyingContract
  });
}

function verifyValidatorRewardApprovalSignature({
  approval,
  finalizationContract,
  signature
}) {
  const typed =
    validatorRewardApprovalTypedData(
      approval,
      finalizationContract
    );

  const recovered =
    getAddress(
      verifyTypedData(
        typed.domain,
        typed.types,
        typed.value,
        requireNonEmptyString(
          signature,
          'Validator reward approval signature'
        )
      )
    );

  if (
    recovered !==
    typed.value.approvingSessionAddress
  ) {
    throw new Error(
      'Validator reward approval signature mismatch'
    );
  }

  return Object.freeze({
    ...typed,
    recoveredSessionAddress:
      recovered
  });
}

module.exports = Object.freeze({
  CHAIN_ID,
  PURPOSE,
  EIP712_DOMAIN_NAME,
  EIP712_DOMAIN_VERSION,
  APPROVAL_VERSION,
  APPROVAL_TYPES,
  validatorRewardApprovalTypedData,
  verifyValidatorRewardApprovalSignature
});
