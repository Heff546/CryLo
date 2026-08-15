'use strict';

const {
  TypedDataEncoder,
  getAddress,
  isAddress,
  keccak256,
  toUtf8Bytes,
  verifyTypedData
} = require('ethers');

const CHAIN_ID = 5546;

const PURPOSE =
  'validator-reward-approval';

const EIP712_DOMAIN_NAME =
  'CryLoNexus Validator Reward Approval';

const EIP712_DOMAIN_VERSION =
  '2';

const DELEGATION_VERSION =
  2;

const DELEGATION_TYPES =
  Object.freeze({
    ValidatorRewardApprovalDelegation: [
      {
        name: 'version',
        type: 'uint256'
      },
      {
        name: 'purposeHash',
        type: 'bytes32'
      },
      {
        name: 'validatorAddress',
        type: 'address'
      },
      {
        name: 'validatorNodeIdHash',
        type: 'bytes32'
      },
      {
        name: 'sessionAddress',
        type: 'address'
      },
      {
        name: 'issuedAt',
        type: 'uint64'
      },
      {
        name: 'expiresAt',
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

function validatorRewardApprovalDelegationTypedData(
  delegation
) {
  requirePlainObject(
    delegation,
    'Validator reward approval delegation'
  );

  if (
    delegation.version !==
    DELEGATION_VERSION
  ) {
    throw new Error(
      `Unsupported Validator reward approval delegation version: ${delegation.version}`
    );
  }

  if (
    delegation.purpose !==
    PURPOSE
  ) {
    throw new Error(
      'Validator reward approval authorization purpose mismatch'
    );
  }

  if (
    delegation.chainId !==
    CHAIN_ID
  ) {
    throw new Error(
      `Unexpected Validator reward approval chain ID: ${delegation.chainId}`
    );
  }

  const validatorAddress =
    normalizeAddress(
      delegation.validatorAddress,
      'Validator delegation wallet address'
    );

  const validatorNodeId =
    requireNonEmptyString(
      delegation.nodeId,
      'Validator delegation node ID'
    );

  const sessionAddress =
    normalizeAddress(
      delegation.sessionAddress,
      'Validator delegation session address'
    );

  const finalizationContract =
    normalizeAddress(
      delegation.finalizationContract,
      'Validator reward finalization contract'
    );

  const issuedAt =
    canonicalTimeSeconds(
      delegation.issuedAt,
      'Validator delegation issuedAt'
    );

  const expiresAt =
    canonicalTimeSeconds(
      delegation.expiresAt,
      'Validator delegation expiresAt'
    );

  if (
    expiresAt <=
    issuedAt
  ) {
    throw new Error(
      'Validator reward approval delegation expiration must follow issuance'
    );
  }

  const domain =
    Object.freeze({
      name:
        EIP712_DOMAIN_NAME,

      version:
        EIP712_DOMAIN_VERSION,

      chainId:
        CHAIN_ID,

      verifyingContract:
        finalizationContract
    });

  const value =
    Object.freeze({
      version:
        DELEGATION_VERSION,

      purposeHash:
        hashText(
          PURPOSE,
          'Validator reward approval purpose'
        ),

      validatorAddress,

      validatorNodeIdHash:
        hashText(
          validatorNodeId,
          'Validator delegation node ID'
        ),

      sessionAddress,

      issuedAt,
      expiresAt
    });

  const digest =
    TypedDataEncoder.hash(
      domain,
      DELEGATION_TYPES,
      value
    );

  return Object.freeze({
    domain,
    types:
      DELEGATION_TYPES,
    value,
    digest,

    validatorAddress,
    validatorNodeId,
    validatorNodeIdHash:
      value.validatorNodeIdHash,
    sessionAddress,
    finalizationContract,
    issuedAt,
    expiresAt
  });
}

function verifyValidatorRewardApprovalDelegationSignature({
  delegation,
  signature
}) {
  const typed =
    validatorRewardApprovalDelegationTypedData(
      delegation
    );

  const recovered =
    getAddress(
      verifyTypedData(
        typed.domain,
        typed.types,
        typed.value,
        requireNonEmptyString(
          signature,
          'Validator reward approval delegation signature'
        )
      )
    );

  if (
    recovered !==
    typed.validatorAddress
  ) {
    throw new Error(
      'Validator reward approval delegation signature mismatch'
    );
  }

  return Object.freeze({
    ...typed,
    recoveredValidatorAddress:
      recovered
  });
}

module.exports = Object.freeze({
  CHAIN_ID,
  PURPOSE,
  DELEGATION_VERSION,
  EIP712_DOMAIN_NAME,
  EIP712_DOMAIN_VERSION,
  DELEGATION_TYPES,
  validatorRewardApprovalDelegationTypedData,
  verifyValidatorRewardApprovalDelegationSignature
});
