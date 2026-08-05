'use strict';

const {
  keccak256
} = require('ethers');

const {
  canonicalJsonBytes
} = require('./canonical-json');

const HASH_PATTERN = /^0x[0-9a-f]{64}$/;

function canonicalHash(value) {
  return keccak256(
    canonicalJsonBytes(value)
  );
}

function statusHash(status) {
  if (
    !status ||
    typeof status !== 'object' ||
    Array.isArray(status)
  ) {
    throw new TypeError(
      'Status evidence must be a plain object'
    );
  }

  return canonicalHash(status);
}

function heartbeatPayloadHash(payload) {
  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload)
  ) {
    throw new TypeError(
      'Heartbeat payload must be a plain object'
    );
  }

  if (
    Object.prototype.hasOwnProperty.call(
      payload,
      'payloadHash'
    )
  ) {
    throw new TypeError(
      'Heartbeat payload must not include payloadHash while being hashed'
    );
  }

  if (
    Object.prototype.hasOwnProperty.call(
      payload,
      'signature'
    )
  ) {
    throw new TypeError(
      'Heartbeat payload must not include signature while being hashed'
    );
  }

  return canonicalHash(payload);
}

function isCanonicalHash(value) {
  return (
    typeof value === 'string' &&
    HASH_PATTERN.test(value)
  );
}

module.exports = {
  canonicalHash,
  heartbeatPayloadHash,
  isCanonicalHash,
  statusHash
};
