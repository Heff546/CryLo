'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  getAddress,
  isAddress,
  verifyMessage
} = require('ethers');

const AUTHORIZATION_VERSION = 1;
const DELEGATION_VERSION = 1;
const CHAIN_ID = 5546;

const PURPOSE =
  'validator-reward-approval';

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

  return parsed;
}

function defaultValidatorRewardApprovalAuthorizationPath() {
  return path.join(
    os.homedir(),
    '.config',
    'crylo-wallet',
    'operator',
    'validator-reward-approval-authorization.json'
  );
}

function verifyValidatorRewardApprovalAuthorization({
  authorization,
  expectedValidatorAddress,
  expectedValidatorNodeId,
  expectedSessionAddress,
  nowMs = Date.now()
}) {
  requirePlainObject(
    authorization,
    'Validator reward approval authorization'
  );

  requirePlainObject(
    authorization.delegation,
    'Validator reward approval delegation'
  );

  if (
    !Number.isSafeInteger(nowMs) ||
    nowMs < 0
  ) {
    throw new TypeError(
      'Validator reward approval authorization nowMs must be a non-negative safe integer'
    );
  }

  if (
    authorization.version !==
    AUTHORIZATION_VERSION
  ) {
    throw new Error(
      `Unsupported Validator reward approval authorization version: ${authorization.version}`
    );
  }

  const delegation =
    authorization.delegation;

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

  if (
    expectedValidatorAddress !== undefined &&
    validatorAddress !==
      normalizeAddress(
        expectedValidatorAddress,
        'Expected Validator address'
      )
  ) {
    throw new Error(
      'Validator reward approval authorization wallet mismatch'
    );
  }

  if (
    expectedValidatorNodeId !== undefined &&
    validatorNodeId !==
      requireNonEmptyString(
        expectedValidatorNodeId,
        'Expected Validator node ID'
      )
  ) {
    throw new Error(
      'Validator reward approval authorization node ID mismatch'
    );
  }

  if (
    expectedSessionAddress !== undefined &&
    sessionAddress !==
      normalizeAddress(
        expectedSessionAddress,
        'Expected Validator session address'
      )
  ) {
    throw new Error(
      'Validator reward approval authorization session mismatch'
    );
  }

  const issuedAtMs =
    requireCanonicalTime(
      delegation.issuedAt,
      'Validator delegation issuedAt'
    );

  const expiresAtMs =
    requireCanonicalTime(
      delegation.expiresAt,
      'Validator delegation expiresAt'
    );

  if (
    expiresAtMs <=
    issuedAtMs
  ) {
    throw new Error(
      'Validator reward approval delegation expiration must follow issuance'
    );
  }

  if (
    expiresAtMs <=
    nowMs
  ) {
    throw new Error(
      'Validator reward approval authorization has expired'
    );
  }

  const delegationSignature =
    requireNonEmptyString(
      authorization.delegationSignature,
      'Validator reward approval delegation signature'
    );

  const delegationMessage =
    JSON.stringify(
      delegation
    );

  const recoveredValidatorAddress =
    getAddress(
      verifyMessage(
        delegationMessage,
        delegationSignature
      )
    );

  if (
    recoveredValidatorAddress !==
    validatorAddress
  ) {
    throw new Error(
      'Validator reward approval delegation signature mismatch'
    );
  }

  if (
    Object.prototype.hasOwnProperty.call(
      authorization,
      'sessionPrivateKey'
    )
  ) {
    throw new Error(
      'Validator reward approval authorization must not contain a session private key'
    );
  }

  return Object.freeze({
    authorization,
    delegation,
    delegationMessage,
    delegationSignature,

    validatorAddress,
    validatorNodeId,
    sessionAddress,

    issuedAt:
      delegation.issuedAt,

    expiresAt:
      delegation.expiresAt
  });
}

async function loadValidatorRewardApprovalAuthorization(
  options
) {
  requirePlainObject(
    options,
    'Validator reward approval authorization loader options'
  );

  const authorizationPath =
    path.resolve(
      options.authorizationPath === undefined
        ? (
            process.env
              .CRYLONEXUS_VALIDATOR_REWARD_APPROVAL_AUTHORIZATION_FILE ||
            defaultValidatorRewardApprovalAuthorizationPath()
          )
        : requireNonEmptyString(
            options.authorizationPath,
            'Validator reward approval authorization path'
          )
    );

  let serialized;

  try {
    serialized =
      await fs.readFile(
        authorizationPath,
        'utf8'
      );
  } catch (error) {
    if (
      error?.code ===
      'ENOENT'
    ) {
      throw new Error(
        `Validator reward approval authorization file does not exist: ${authorizationPath}`,
        {
          cause:
            error
        }
      );
    }

    throw error;
  }

  let authorization;

  try {
    authorization =
      JSON.parse(
        serialized
      );
  } catch (error) {
    throw new Error(
      'Validator reward approval authorization file is not valid JSON',
      {
        cause:
          error
      }
    );
  }

  const verified =
    verifyValidatorRewardApprovalAuthorization({
      authorization,

      expectedValidatorAddress:
        options.expectedValidatorAddress,

      expectedValidatorNodeId:
        options.expectedValidatorNodeId,

      expectedSessionAddress:
        options.expectedSessionAddress,

      ...(options.nowMs === undefined
        ? {}
        : {
            nowMs:
              options.nowMs
          })
    });

  return Object.freeze({
    authorizationPath,
    ...verified
  });
}

module.exports = Object.freeze({
  AUTHORIZATION_VERSION,
  DELEGATION_VERSION,
  CHAIN_ID,
  PURPOSE,
  defaultValidatorRewardApprovalAuthorizationPath,
  verifyValidatorRewardApprovalAuthorization,
  loadValidatorRewardApprovalAuthorization
});
