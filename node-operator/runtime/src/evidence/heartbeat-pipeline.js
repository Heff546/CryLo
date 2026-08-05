'use strict';

const {
  collectStatusEvidence
} = require('./status-collector');

const {
  buildSignedHeartbeat
} = require('./signed-heartbeat-builder');

const DEFAULT_HEARTBEAT_TTL_MS = 60_000;

function requirePlainObject(value, name) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(
      `${name} must be a plain object`
    );
  }
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

function requireFunction(value, name) {
  if (typeof value !== 'function') {
    throw new TypeError(
      `${name} must be a function`
    );
  }

  return value;
}

function requirePositiveSafeInteger(value, name) {
  if (
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    throw new TypeError(
      `${name} must be a positive safe integer`
    );
  }

  return value;
}

function normalizeTimestamp(value) {
  const date =
    value instanceof Date
      ? new Date(value.getTime())
      : new Date(value);

  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(
      'Heartbeat clock must return a valid Date or timestamp'
    );
  }

  return date;
}

function createHeartbeatPipeline(options) {
  requirePlainObject(
    options,
    'Heartbeat pipeline options'
  );

  const operatorAddress =
    requireNonEmptyString(
      options.operatorAddress,
      'Heartbeat operatorAddress'
    );

  const sessionAddress =
    requireNonEmptyString(
      options.sessionAddress,
      'Heartbeat sessionAddress'
    );

  const delegationHash =
    requireNonEmptyString(
      options.delegationHash,
      'Heartbeat delegationHash'
    );

  const authorizationExpiresAt =
    requireNonEmptyString(
      options.authorizationExpiresAt,
      'Heartbeat authorizationExpiresAt'
    );

  const nodeId =
    requireNonEmptyString(
      options.nodeId,
      'Heartbeat nodeId'
    );

  const privateKey =
    requireNonEmptyString(
      options.privateKey,
      'Heartbeat privateKey'
    );

  requirePlainObject(
    options.sequenceManager,
    'Heartbeat sequenceManager'
  );

  requirePlainObject(
    options.nonceProvider,
    'Heartbeat nonceProvider'
  );

  const allocateNextSequence =
    requireFunction(
      options.sequenceManager
        .allocateNextSequence,
      'Heartbeat sequence allocator'
    );

  const generateNonce =
    requireFunction(
      options.nonceProvider.generateNonce,
      'Heartbeat nonce generator'
    );

  const now =
    options.now === undefined
      ? () => new Date()
      : requireFunction(
          options.now,
          'Heartbeat clock'
        );

  const ttlMs =
    options.ttlMs === undefined
      ? DEFAULT_HEARTBEAT_TTL_MS
      : requirePositiveSafeInteger(
          options.ttlMs,
          'Heartbeat ttlMs'
        );

  function createSignedHeartbeat(status) {
    /*
     * Validate and detach the runtime status before
     * consuming a persistent sequence number.
     */
    const statusEvidence =
      collectStatusEvidence(status);

    const issuedDate =
      normalizeTimestamp(now());

    const expiresTime =
      issuedDate.getTime() + ttlMs;

    if (!Number.isSafeInteger(expiresTime)) {
      throw new RangeError(
        'Heartbeat expiration timestamp is outside the supported range'
      );
    }

    const issuedAt =
      issuedDate.toISOString();

    const expiresAt =
      new Date(expiresTime).toISOString();

    /*
     * Nonce generation happens before sequence allocation.
     * Invalid entropy must not consume a sequence.
     */
    const nonce = generateNonce();

    /*
     * Once allocated, a sequence is never reused—even if
     * signing subsequently fails. Gaps are safer than replay.
     */
    const sequence =
      allocateNextSequence();

    return buildSignedHeartbeat({
      privateKey,
      protocolVersion: '2.0.0',
      chainId: statusEvidence.chainId,
      operatorAddress,
      sessionAddress,
      delegationHash,
      authorizationExpiresAt,
      nodeId,
      sequence,
      issuedAt,
      expiresAt,
      nonce,
      status: statusEvidence
    });
  }

  return Object.freeze({
    createSignedHeartbeat
  });
}

module.exports = Object.freeze({
  DEFAULT_HEARTBEAT_TTL_MS,
  createHeartbeatPipeline
});
