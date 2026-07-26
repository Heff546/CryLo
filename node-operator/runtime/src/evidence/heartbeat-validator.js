'use strict';

const {
  isAddress
} = require('ethers');

const {
  heartbeatPayloadHash,
  isCanonicalHash
} = require('./hashing');

const SUPPORTED_PROTOCOL_VERSION = '1.0.0';
const CRYLONEXUS_CHAIN_ID = 5546;

const REQUIRED_FIELDS = Object.freeze([
  'protocolVersion',
  'chainId',
  'operatorAddress',
  'nodeId',
  'sequence',
  'issuedAt',
  'expiresAt',
  'nonce',
  'statusHash',
  'payloadHash'
]);

const REQUIRED_FIELD_SET = new Set(
  REQUIRED_FIELDS
);

const NONCE_PATTERN = /^[0-9a-f]{64}$/;
const UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function requirePlainObject(value, name) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !==
      Object.prototype
  ) {
    throw new TypeError(
      `${name} must be a plain object`
    );
  }
}

function requireExactFields(heartbeat) {
  for (const field of REQUIRED_FIELDS) {
    if (
      !Object.prototype.hasOwnProperty.call(
        heartbeat,
        field
      )
    ) {
      throw new TypeError(
        `Heartbeat is missing required field: ${field}`
      );
    }
  }

  for (const field of Object.keys(heartbeat)) {
    if (!REQUIRED_FIELD_SET.has(field)) {
      throw new TypeError(
        `Heartbeat contains unsupported field: ${field}`
      );
    }
  }
}

function requireCanonicalTimestamp(
  value,
  name
) {
  if (
    typeof value !== 'string' ||
    !UTC_TIMESTAMP_PATTERN.test(value)
  ) {
    throw new TypeError(
      `${name} must be a canonical UTC timestamp`
    );
  }

  const timestamp = Date.parse(value);

  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString() !== value
  ) {
    throw new TypeError(
      `${name} must be a valid canonical UTC timestamp`
    );
  }

  return timestamp;
}

function unsignedPayloadFromHeartbeat(
  heartbeat
) {
  return {
    protocolVersion:
      heartbeat.protocolVersion,
    chainId: heartbeat.chainId,
    operatorAddress:
      heartbeat.operatorAddress,
    nodeId: heartbeat.nodeId,
    sequence: heartbeat.sequence,
    issuedAt: heartbeat.issuedAt,
    expiresAt: heartbeat.expiresAt,
    nonce: heartbeat.nonce,
    statusHash: heartbeat.statusHash
  };
}

function validateUnsignedHeartbeat(
  heartbeat,
  options = {}
) {
  requirePlainObject(
    heartbeat,
    'Heartbeat'
  );

  requirePlainObject(
    options,
    'Validation options'
  );

  requireExactFields(heartbeat);

  const {
    expectedChainId =
      CRYLONEXUS_CHAIN_ID
  } = options;

  if (
    !Number.isSafeInteger(expectedChainId) ||
    expectedChainId <= 0
  ) {
    throw new TypeError(
      'expectedChainId must be a positive safe integer'
    );
  }

  if (
    heartbeat.protocolVersion !==
    SUPPORTED_PROTOCOL_VERSION
  ) {
    throw new TypeError(
      `Unsupported protocolVersion: ${heartbeat.protocolVersion}`
    );
  }

  if (
    !Number.isSafeInteger(
      heartbeat.chainId
    ) ||
    heartbeat.chainId <= 0
  ) {
    throw new TypeError(
      'chainId must be a positive safe integer'
    );
  }

  if (
    heartbeat.chainId !==
    expectedChainId
  ) {
    throw new TypeError(
      `Unexpected chainId: ${heartbeat.chainId}`
    );
  }

  if (
    typeof heartbeat.operatorAddress !==
      'string' ||
    !isAddress(heartbeat.operatorAddress)
  ) {
    throw new TypeError(
      'operatorAddress must be a valid EVM address'
    );
  }

  if (
    typeof heartbeat.nodeId !==
      'string' ||
    heartbeat.nodeId.length === 0
  ) {
    throw new TypeError(
      'nodeId must be a non-empty string'
    );
  }

  if (
    !Number.isSafeInteger(
      heartbeat.sequence
    ) ||
    heartbeat.sequence < 0
  ) {
    throw new TypeError(
      'sequence must be a non-negative safe integer'
    );
  }

  const issuedAt = requireCanonicalTimestamp(
    heartbeat.issuedAt,
    'issuedAt'
  );

  const expiresAt = requireCanonicalTimestamp(
    heartbeat.expiresAt,
    'expiresAt'
  );

  if (expiresAt <= issuedAt) {
    throw new TypeError(
      'expiresAt must be later than issuedAt'
    );
  }

  if (
    typeof heartbeat.nonce !== 'string' ||
    !NONCE_PATTERN.test(
      heartbeat.nonce
    )
  ) {
    throw new TypeError(
      'nonce must be 32 bytes of lowercase hexadecimal'
    );
  }

  if (
    !isCanonicalHash(
      heartbeat.statusHash
    )
  ) {
    throw new TypeError(
      'statusHash must be a canonical hash'
    );
  }

  if (
    !isCanonicalHash(
      heartbeat.payloadHash
    )
  ) {
    throw new TypeError(
      'payloadHash must be a canonical hash'
    );
  }

  const expectedPayloadHash =
    heartbeatPayloadHash(
      unsignedPayloadFromHeartbeat(
        heartbeat
      )
    );

  if (
    heartbeat.payloadHash !==
    expectedPayloadHash
  ) {
    throw new TypeError(
      'payloadHash does not match heartbeat payload'
    );
  }

  return true;
}

module.exports = {
  CRYLONEXUS_CHAIN_ID,
  REQUIRED_FIELDS,
  SUPPORTED_PROTOCOL_VERSION,
  unsignedPayloadFromHeartbeat,
  validateUnsignedHeartbeat
};
