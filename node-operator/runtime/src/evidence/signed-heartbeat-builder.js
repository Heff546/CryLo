'use strict';

const {
  buildUnsignedHeartbeat
} = require('./heartbeat-builder');

const {
  validateUnsignedHeartbeat
} = require('./heartbeat-validator');

const {
  signHeartbeatPayload,
  verifyHeartbeatSignature
} = require('./detached-signing');

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

function buildSignedHeartbeat(options) {
  requirePlainObject(
    options,
    'Signed heartbeat options'
  );

  const {
    privateKey,
    ...heartbeatOptions
  } = options;

  const unsignedHeartbeat =
    buildUnsignedHeartbeat(heartbeatOptions);

  validateUnsignedHeartbeat(
    unsignedHeartbeat,
    {
      expectedChainId:
        unsignedHeartbeat.chainId
    }
  );

  const signingResult =
    signHeartbeatPayload(
      unsignedHeartbeat.payloadHash,
      privateKey
    );

  if (
    signingResult.payloadHash !==
    unsignedHeartbeat.payloadHash
  ) {
    throw new Error(
      'Heartbeat signer returned a mismatched payloadHash'
    );
  }

  verifyHeartbeatSignature({
    payloadHash:
      unsignedHeartbeat.payloadHash,
    signature:
      signingResult.signature,
    expectedOperatorAddress:
      unsignedHeartbeat.operatorAddress
  });

  return Object.freeze({
    ...unsignedHeartbeat,
    operatorAddress:
      signingResult.operatorAddress,
    signature:
      signingResult.signature
  });
}

module.exports = Object.freeze({
  buildSignedHeartbeat
});
