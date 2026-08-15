'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  getAddress,
  isAddress
} = require('ethers');

const {
  CHAIN_ID,
  PURPOSE,
  DELEGATION_VERSION,
  validatorRewardApprovalDelegationTypedData,
  verifyValidatorRewardApprovalDelegationSignature
} = require(
  './validator-reward-approval-eip712'
);

const AUTHORIZATION_VERSION = 2;

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
  expectedFinalizationContract,
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

  const typed =
    validatorRewardApprovalDelegationTypedData(
      delegation
    );

  if (
    expectedValidatorAddress !== undefined &&
    typed.validatorAddress !==
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
    typed.validatorNodeId !==
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
    typed.sessionAddress !==
      normalizeAddress(
        expectedSessionAddress,
        'Expected Validator session address'
      )
  ) {
    throw new Error(
      'Validator reward approval authorization session mismatch'
    );
  }

  if (
    expectedFinalizationContract !== undefined &&
    typed.finalizationContract !==
      normalizeAddress(
        expectedFinalizationContract,
        'Expected Validator reward finalization contract'
      )
  ) {
    throw new Error(
      'Validator reward approval authorization finalization contract mismatch'
    );
  }

  if (
    typed.expiresAt * 1000 <=
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

  const signatureResult =
    verifyValidatorRewardApprovalDelegationSignature({
      delegation,
      signature:
        delegationSignature
    });

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

    delegationDigest:
      typed.digest,

    delegationSignature,

    validatorAddress:
      typed.validatorAddress,

    validatorNodeId:
      typed.validatorNodeId,

    validatorNodeIdHash:
      typed.validatorNodeIdHash,

    sessionAddress:
      typed.sessionAddress,

    finalizationContract:
      typed.finalizationContract,

    issuedAt:
      delegation.issuedAt,

    expiresAt:
      delegation.expiresAt,

    signatureSigner:
      signatureResult
        .recoveredValidatorAddress
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

      expectedFinalizationContract:
        options.expectedFinalizationContract,

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
