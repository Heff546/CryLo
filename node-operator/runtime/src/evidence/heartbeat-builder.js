'use strict';

const {
  heartbeatPayloadHash,
  statusHash
} = require('./hashing');

function requireObject(value, name) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    throw new TypeError(
      `${name} must be a plain object`
    );
  }
}

function requireString(value, name) {
  if (
    typeof value !== 'string' ||
    value.length === 0
  ) {
    throw new TypeError(
      `${name} must be a non-empty string`
    );
  }
}

function buildUnsignedHeartbeat(options) {
  requireObject(
    options,
    'Heartbeat options'
  );

  const {
    chainId,
    operatorAddress,
    nodeId,
    sequence,
    issuedAt,
    expiresAt,
    nonce,
    status,
    protocolVersion = '1.0.0'
  } = options;

  if (
    !Number.isSafeInteger(chainId) ||
    chainId <= 0
  ) {
    throw new TypeError(
      'chainId must be a positive safe integer'
    );
  }

  if (
    !Number.isSafeInteger(sequence) ||
    sequence < 0
  ) {
    throw new TypeError(
      'sequence must be a non-negative safe integer'
    );
  }

  requireString(
    protocolVersion,
    'protocolVersion'
  );

  requireString(
    operatorAddress,
    'operatorAddress'
  );

  requireString(
    nodeId,
    'nodeId'
  );

  requireString(
    issuedAt,
    'issuedAt'
  );

  requireString(
    expiresAt,
    'expiresAt'
  );

  requireString(
    nonce,
    'nonce'
  );

  requireObject(
    status,
    'status'
  );

  const payload = {
    protocolVersion,
    chainId,
    operatorAddress,
    nodeId,
    sequence,
    issuedAt,
    expiresAt,
    nonce,
    statusHash: statusHash(status)
  };

  return Object.freeze({
    ...payload,
    payloadHash:
      heartbeatPayloadHash(payload)
  });
}

module.exports = {
  buildUnsignedHeartbeat
};
