
const fs = require('node:fs/promises');
const path = require('node:path');

const {
  getAddress,
  isAddress,
  verifyMessage
} = require('ethers');

const {
  defaultOperatorDirectory
} = require('../config');

function defaultAuthorizationPath() {
  return path.join(
    defaultOperatorDirectory(),
    'authorization.json'
  );
}

function requirePlainObject(value, name) {
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

function requireNonEmptyString(value, name) {
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

function normalizeAddress(value, name) {
  requireNonEmptyString(value, name);

  if (!isAddress(value)) {
    throw new TypeError(
      `${name} must be a valid EVM address`
    );
  }

  return getAddress(value);
}

function requireCanonicalTime(value, name) {
  requireNonEmptyString(value, name);

  const parsed = Date.parse(value);

  if (
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString() !== value
  ) {
    throw new TypeError(
      `${name} must be a canonical UTC timestamp`
    );
  }

  return parsed;
}

async function loadAuthorization(options) {
  requirePlainObject(
    options,
    'Authorization loader options'
  );

  const expectedOperatorAddress =
    normalizeAddress(
      options.expectedOperatorAddress,
      'Expected operator address'
    );

  const expectedNodeId =
    requireNonEmptyString(
      options.expectedNodeId,
      'Expected node ID'
    );

  const authorizationPath =
    path.resolve(
      options.authorizationPath === undefined
        ? (
            process.env
              .CRYLONEXUS_OPERATOR_AUTHORIZATION_FILE ||
            defaultAuthorizationPath()
          )
        : requireNonEmptyString(
            options.authorizationPath,
            'Authorization path'
          )
    );

  let serialized;

  try {
    serialized = await fs.readFile(
      authorizationPath,
      'utf8'
    );
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(
        `Operator authorization file does not exist: ${authorizationPath}`,
        { cause: error }
      );
    }

    throw error;
  }

  let authorization;

  try {
    authorization =
      JSON.parse(serialized);
  } catch (error) {
    throw new Error(
      'Operator authorization file is not valid JSON',
      { cause: error }
    );
  }

  requirePlainObject(
    authorization,
    'Operator authorization'
  );

  requirePlainObject(
    authorization.delegation,
    'Operator delegation'
  );

  const delegation =
    authorization.delegation;

  if (authorization.version !== 1) {
    throw new Error(
      `Unsupported authorization version: ${authorization.version}`
    );
  }

  if (delegation.version !== 1) {
    throw new Error(
      `Unsupported delegation version: ${delegation.version}`
    );
  }

  if (
    delegation.purpose !==
    'operator-heartbeat'
  ) {
    throw new Error(
      'Authorization purpose is not operator-heartbeat'
    );
  }

  if (delegation.chainId !== 5546) {
    throw new Error(
      `Unexpected authorization chain ID: ${delegation.chainId}`
    );
  }

  const operatorAddress =
    normalizeAddress(
      delegation.operatorAddress,
      'Delegation operator address'
    );

  if (
    operatorAddress !==
    expectedOperatorAddress
  ) {
    throw new Error(
      `Authorization operator mismatch: expected ` +
      `${expectedOperatorAddress}, received ${operatorAddress}`
    );
  }

  if (delegation.nodeId !== expectedNodeId) {
    throw new Error(
      `Authorization node ID mismatch: expected ` +
      `${expectedNodeId}, received ${delegation.nodeId}`
    );
  }

  const sessionAddress =
    normalizeAddress(
      delegation.sessionAddress,
      'Delegation session address'
    );

  const issuedAt =
    requireCanonicalTime(
      delegation.issuedAt,
      'Delegation issuedAt'
    );

  const expiresAt =
    requireCanonicalTime(
      delegation.expiresAt,
      'Delegation expiresAt'
    );

  if (expiresAt <= issuedAt) {
    throw new Error(
      'Delegation expiration must be later than issuance'
    );
  }

  if (expiresAt <= Date.now()) {
    throw new Error(
      'Operator authorization has expired'
    );
  }

  const delegationSignature =
    requireNonEmptyString(
      authorization.delegationSignature,
      'Delegation signature'
    );

  const delegationMessage =
    JSON.stringify(delegation);

  const recoveredOperatorAddress =
    getAddress(
      verifyMessage(
        delegationMessage,
        delegationSignature
      )
    );

  if (
    recoveredOperatorAddress !==
    operatorAddress
  ) {
    throw new Error(
      `Delegation signature mismatch: expected ` +
      `${operatorAddress}, recovered ${recoveredOperatorAddress}`
    );
  }

  if (
    Object.prototype.hasOwnProperty.call(
      authorization,
      'sessionPrivateKey'
    )
  ) {
    throw new Error(
      'Authorization file must not contain a session private key'
    );
  }

  return Object.freeze({
    authorizationPath,
    authorization,
    delegation,
    delegationMessage,
    delegationSignature,
    operatorAddress,
    sessionAddress,
    issuedAt:
      delegation.issuedAt,
    expiresAt:
      delegation.expiresAt
  });
}

module.exports = Object.freeze({
  defaultAuthorizationPath,
  loadAuthorization
});
