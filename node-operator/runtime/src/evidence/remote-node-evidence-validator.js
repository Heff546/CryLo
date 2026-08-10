'use strict';

const {
  getAddress,
  isAddress,
  verifyMessage
} = require('ethers');

const {
  canonicalHash
} = require('./hashing');

const {
  validateUnsignedHeartbeat,
  CRYLONEXUS_CHAIN_ID
} = require('./heartbeat-validator');

const {
  verifyHeartbeatSignature
} = require('./detached-signing');

const DEFAULT_MAX_CLOCK_SKEW_MS = 15_000;

function requirePlainObject(value, name) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${name} must be a plain object`);
  }

  return value;
}

function normalizeAddress(value, name) {
  if (
    typeof value !== 'string' ||
    !isAddress(value)
  ) {
    throw new TypeError(`${name} must be a valid EVM address`);
  }

  return getAddress(value);
}

function requireNonEmptyString(value, name) {
  if (
    typeof value !== 'string' ||
    value.trim() === ''
  ) {
    throw new TypeError(`${name} must be a non-empty string`);
  }

  return value;
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

function normalizeNow(value) {
  const date =
    value instanceof Date
      ? new Date(value.getTime())
      : new Date(value);

  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(
      'Remote evidence clock must return a valid Date or timestamp'
    );
  }

  return date;
}

function validateRemoteAuthorization({
  authorization,
  heartbeat,
  expectedChainId = CRYLONEXUS_CHAIN_ID
}) {
  requirePlainObject(
    authorization,
    'Remote node authorization'
  );

  requirePlainObject(
    authorization.delegation,
    'Remote node delegation'
  );

  const delegation = authorization.delegation;

  if (authorization.version !== 1) {
    throw new Error(
      `Unsupported remote authorization version: ${authorization.version}`
    );
  }

  if (delegation.version !== 1) {
    throw new Error(
      `Unsupported remote delegation version: ${delegation.version}`
    );
  }

  if (delegation.purpose !== 'operator-heartbeat') {
    throw new Error(
      'Remote delegation purpose is not operator-heartbeat'
    );
  }

  if (delegation.chainId !== expectedChainId) {
    throw new Error(
      `Unexpected remote delegation chain ID: ${delegation.chainId}`
    );
  }

  const operatorAddress =
    normalizeAddress(
      delegation.operatorAddress,
      'Remote delegation operator address'
    );

  const heartbeatOperator =
    normalizeAddress(
      heartbeat.operatorAddress,
      'Remote heartbeat operator address'
    );

  if (operatorAddress !== heartbeatOperator) {
    throw new Error(
      'Remote delegation operator does not match heartbeat operator'
    );
  }

  const nodeId =
    requireNonEmptyString(
      delegation.nodeId,
      'Remote delegation node ID'
    );

  if (nodeId !== heartbeat.nodeId) {
    throw new Error(
      'Remote delegation node ID does not match heartbeat node ID'
    );
  }

  const sessionAddress =
    normalizeAddress(
      delegation.sessionAddress,
      'Remote delegation session address'
    );

  const heartbeatSession =
    normalizeAddress(
      heartbeat.sessionAddress,
      'Remote heartbeat session address'
    );

  if (sessionAddress !== heartbeatSession) {
    throw new Error(
      'Remote delegation session does not match heartbeat session'
    );
  }

  const issuedAt =
    requireCanonicalTime(
      delegation.issuedAt,
      'Remote delegation issuedAt'
    );

  const expiresAt =
    requireCanonicalTime(
      delegation.expiresAt,
      'Remote delegation expiresAt'
    );

  if (expiresAt <= issuedAt) {
    throw new Error(
      'Remote delegation expiration must be later than issuance'
    );
  }

  if (delegation.expiresAt !== heartbeat.authorizationExpiresAt) {
    throw new Error(
      'Remote delegation expiration does not match heartbeat authorization expiration'
    );
  }

  const delegationSignature =
    requireNonEmptyString(
      authorization.delegationSignature,
      'Remote delegation signature'
    );

  const delegationMessage = JSON.stringify(delegation);

  const recoveredOperator =
    getAddress(
      verifyMessage(
        delegationMessage,
        delegationSignature
      )
    );

  if (recoveredOperator !== operatorAddress) {
    throw new Error(
      `Remote delegation signature mismatch: expected ` +
      `${operatorAddress}, recovered ${recoveredOperator}`
    );
  }

  const delegationHash =
    canonicalHash(delegation);

  if (delegationHash !== heartbeat.delegationHash) {
    throw new Error(
      'Remote delegation hash does not match heartbeat delegationHash'
    );
  }

  return Object.freeze({
    operatorAddress,
    sessionAddress,
    nodeId,
    issuedAt: delegation.issuedAt,
    expiresAt: delegation.expiresAt,
    delegationHash
  });
}

function validateRemoteNodeEvidence(options) {
  requirePlainObject(
    options,
    'Remote node evidence options'
  );

  const heartbeat =
    requirePlainObject(
      options.heartbeat,
      'Remote heartbeat'
    );

  const authorization =
    requirePlainObject(
      options.authorization,
      'Remote authorization'
    );

  const localOperatorAddress =
    normalizeAddress(
      options.localOperatorAddress,
      'Local operator address'
    );

  const localNodeId =
    requireNonEmptyString(
      options.localNodeId,
      'Local node ID'
    );

  const expectedChainId =
    options.expectedChainId === undefined
      ? CRYLONEXUS_CHAIN_ID
      : options.expectedChainId;

  const maxClockSkewMs =
    options.maxClockSkewMs === undefined
      ? DEFAULT_MAX_CLOCK_SKEW_MS
      : options.maxClockSkewMs;

  if (
    !Number.isSafeInteger(maxClockSkewMs) ||
    maxClockSkewMs < 0
  ) {
    throw new TypeError(
      'maxClockSkewMs must be a non-negative safe integer'
    );
  }

  const {
    signature,
    ...unsignedHeartbeat
  } = heartbeat;

  requireNonEmptyString(
    signature,
    'Remote heartbeat signature'
  );

  validateUnsignedHeartbeat(
    unsignedHeartbeat,
    { expectedChainId }
  );

  const remoteOperatorAddress =
    normalizeAddress(
      heartbeat.operatorAddress,
      'Remote heartbeat operator address'
    );

  if (remoteOperatorAddress === localOperatorAddress) {
    throw new Error(
      'Node worker must not observe its own operator identity'
    );
  }

  if (heartbeat.nodeId === localNodeId) {
    throw new Error(
      'Node worker must not observe its own node identity'
    );
  }

  const authorizationResult =
    validateRemoteAuthorization({
      authorization,
      heartbeat,
      expectedChainId
    });

  const signatureResult =
    verifyHeartbeatSignature({
      payloadHash: heartbeat.payloadHash,
      signature: heartbeat.signature,
      expectedOperatorAddress:
        authorizationResult.sessionAddress
    });

  const now =
    normalizeNow(
      options.now === undefined
        ? new Date()
        : (
            typeof options.now === 'function'
              ? options.now()
              : options.now
          )
    );

  const nowMs = now.getTime();

  const issuedAt =
    requireCanonicalTime(
      heartbeat.issuedAt,
      'Remote heartbeat issuedAt'
    );

  const expiresAt =
    requireCanonicalTime(
      heartbeat.expiresAt,
      'Remote heartbeat expiresAt'
    );

  if (issuedAt > nowMs + maxClockSkewMs) {
    throw new Error(
      'Remote heartbeat was issued too far in the future'
    );
  }

  if (expiresAt < nowMs - maxClockSkewMs) {
    throw new Error(
      'Remote heartbeat has expired'
    );
  }

  return Object.freeze({
    valid: true,
    operatorAddress:
      authorizationResult.operatorAddress,
    sessionAddress:
      authorizationResult.sessionAddress,
    nodeId:
      authorizationResult.nodeId,
    payloadHash:
      heartbeat.payloadHash,
    sequence:
      heartbeat.sequence,
    nonce:
      heartbeat.nonce,
    issuedAt:
      heartbeat.issuedAt,
    expiresAt:
      heartbeat.expiresAt,
    signatureSigner:
      signatureResult.operatorAddress
  });
}

module.exports = Object.freeze({
  DEFAULT_MAX_CLOCK_SKEW_MS,
  validateRemoteAuthorization,
  validateRemoteNodeEvidence
});
