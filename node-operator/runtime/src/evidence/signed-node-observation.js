'use strict';

const {
  getAddress,
  computeAddress
} = require('ethers');

const {
  canonicalHash,
  isCanonicalHash
} = require('./hashing');

const {
  assertPrivateKey,
  signHeartbeatPayload,
  verifyHeartbeatSignature
} = require('./detached-signing');

const OBSERVATION_SCHEMA_VERSION = 2;
const OBSERVATION_PROTOCOL_VERSION = '2.0.0';
const CRYLONEXUS_CHAIN_ID = 5546;

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

  return value;
}

function requireString(value, name) {
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

function requireBoolean(value, name) {
  if (typeof value !== 'boolean') {
    throw new TypeError(
      `${name} must be a boolean`
    );
  }

  return value;
}

function requireSequence(value) {
  if (
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new TypeError(
      'Heartbeat sequence must be a non-negative safe integer'
    );
  }

  return value;
}

function normalizeAddress(value, name) {
  requireString(value, name);

  try {
    return getAddress(value);
  } catch (error) {
    throw new TypeError(
      `${name} must be a valid EVM address`,
      { cause: error }
    );
  }
}

function requireCanonicalTime(value, name) {
  requireString(value, name);

  const parsed = Date.parse(value);

  if (
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString() !== value
  ) {
    throw new TypeError(
      `${name} must be a canonical UTC timestamp`
    );
  }

  return value;
}

function requireTier(value, name) {
  if (
    value !== 'Operator' &&
    value !== 'Validator'
  ) {
    throw new TypeError(
      `${name} must be Operator or Validator`
    );
  }

  return value;
}

function unsignedObservationFromResult({
  observation,
  observingOperatorAddress,
  observingNodeId,
  observingSessionAddress
}) {
  requirePlainObject(
    observation,
    'Node observation result'
  );

  if (
    observation.result !== 'PASS' &&
    observation.result !== 'FAIL'
  ) {
    throw new Error(
      'Node observation result must be PASS or FAIL'
    );
  }

  if (
    !isCanonicalHash(
      observation.heartbeatPayloadHash
    )
  ) {
    throw new TypeError(
      'Observed heartbeat payload hash must be canonical'
    );
  }

  if (
    !isCanonicalHash(
      observation.statusHash
    )
  ) {
    throw new TypeError(
      'Observed status hash must be canonical'
    );
  }

  const registration =
    requirePlainObject(
      observation.registration,
      'Node observation registration'
    );

  return Object.freeze({
    schemaVersion:
      OBSERVATION_SCHEMA_VERSION,

    protocolVersion:
      OBSERVATION_PROTOCOL_VERSION,

    network:
      'CryLoNexus Mainnet',

    chainId:
      CRYLONEXUS_CHAIN_ID,

    observingOperatorAddress:
      normalizeAddress(
        observingOperatorAddress,
        'Observing operator address'
      ),

    observingNodeId:
      requireString(
        observingNodeId,
        'Observing node ID'
      ),

    observingSessionAddress:
      normalizeAddress(
        observingSessionAddress,
        'Observing session address'
      ),

    observedOperatorAddress:
      normalizeAddress(
        observation.observedOperatorAddress,
        'Observed operator address'
      ),

    observedNodeId:
      requireString(
        observation.observedNodeId,
        'Observed node ID'
      ),

    observedSessionAddress:
      normalizeAddress(
        observation.observedSessionAddress,
        'Observed session address'
      ),

    heartbeatSequence:
      requireSequence(
        observation.heartbeatSequence
      ),

    heartbeatPayloadHash:
      observation.heartbeatPayloadHash,

    statusHash:
      observation.statusHash,

    observedAt:
      requireCanonicalTime(
        observation.observedAt,
        'Observation timestamp'
      ),

    claimedTier:
      requireTier(
        observation.claimedTier,
        'Claimed node tier'
      ),

    registration: Object.freeze({
      passed:
        requireBoolean(
          registration.passed,
          'Registration passed'
        ),

      registered:
        requireBoolean(
          registration.registered,
          'Registration registered'
        ),

      isNodeWallet:
        requireBoolean(
          registration.isNodeWallet,
          'Registration isNodeWallet'
        ),

      onChainTier:
        requireString(
          registration.onChainTier,
          'Registration onChainTier'
        ),

      stakeAtomic:
        requireString(
          String(registration.stakeAtomic),
          'Registration stakeAtomic'
        ),

      stakeRequirementAtomic:
        requireString(
          String(
            registration.stakeRequirementAtomic
          ),
          'Registration stakeRequirementAtomic'
        ),

      configuredTierMatches:
        requireBoolean(
          registration.configuredTierMatches,
          'Registration configuredTierMatches'
        ),

      stakeRequirementMet:
        requireBoolean(
          registration.stakeRequirementMet,
          'Registration stakeRequirementMet'
        ),

      messageCode:
        requireString(
          registration.messageCode,
          'Registration messageCode'
        )
    }),

    result:
      observation.result,

    reasonCode:
      requireString(
        observation.reasonCode,
        'Observation reasonCode'
      )
  });
}

function buildSignedNodeObservation({
  observation,
  observingOperatorAddress,
  observingNodeId,
  observingSessionPrivateKey
}) {
  const privateKey =
    assertPrivateKey(
      observingSessionPrivateKey
    );

  const observingSessionAddress =
    getAddress(
      computeAddress(privateKey)
    );

  const unsigned =
    unsignedObservationFromResult({
      observation,
      observingOperatorAddress,
      observingNodeId,
      observingSessionAddress
    });

  if (
    unsigned.observingOperatorAddress ===
    unsigned.observedOperatorAddress
  ) {
    throw new Error(
      'Node must not sign an observation of its own operator identity'
    );
  }

  if (
    unsigned.observingNodeId ===
    unsigned.observedNodeId
  ) {
    throw new Error(
      'Node must not sign an observation of its own node identity'
    );
  }

  const observationHash =
    canonicalHash(unsigned);

  const signingResult =
    signHeartbeatPayload(
      observationHash,
      privateKey
    );

  verifyHeartbeatSignature({
    payloadHash:
      observationHash,
    signature:
      signingResult.signature,
    expectedOperatorAddress:
      observingSessionAddress
  });

  return Object.freeze({
    ...unsigned,
    observationHash,
    signature:
      signingResult.signature
  });
}

function verifySignedNodeObservation(
  signedObservation
) {
  requirePlainObject(
    signedObservation,
    'Signed node observation'
  );

  const {
    observationHash,
    signature,
    ...unsigned
  } = signedObservation;

  if (!isCanonicalHash(observationHash)) {
    throw new TypeError(
      'Observation hash must be canonical'
    );
  }

  requireString(
    signature,
    'Observation signature'
  );

  const expectedHash =
    canonicalHash(unsigned);

  if (expectedHash !== observationHash) {
    throw new Error(
      'Observation hash does not match observation payload'
    );
  }

  const observingSessionAddress =
    normalizeAddress(
      unsigned.observingSessionAddress,
      'Observing session address'
    );

  verifyHeartbeatSignature({
    payloadHash:
      observationHash,
    signature,
    expectedOperatorAddress:
      observingSessionAddress
  });

  if (
    normalizeAddress(
      unsigned.observingOperatorAddress,
      'Observing operator address'
    ) ===
    normalizeAddress(
      unsigned.observedOperatorAddress,
      'Observed operator address'
    )
  ) {
    throw new Error(
      'Signed observation contains self-observation by operator identity'
    );
  }

  if (
    unsigned.observingNodeId ===
    unsigned.observedNodeId
  ) {
    throw new Error(
      'Signed observation contains self-observation by node identity'
    );
  }

  return Object.freeze({
    valid: true,
    observationHash,
    observingOperatorAddress:
      unsigned.observingOperatorAddress,
    observingNodeId:
      unsigned.observingNodeId,
    observingSessionAddress,
    observedOperatorAddress:
      unsigned.observedOperatorAddress,
    observedNodeId:
      unsigned.observedNodeId,
    result:
      unsigned.result,
    reasonCode:
      unsigned.reasonCode
  });
}

module.exports = Object.freeze({
  CRYLONEXUS_CHAIN_ID,
  OBSERVATION_PROTOCOL_VERSION,
  OBSERVATION_SCHEMA_VERSION,
  buildSignedNodeObservation,
  unsignedObservationFromResult,
  verifySignedNodeObservation
});
