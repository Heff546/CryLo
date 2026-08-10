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

const {
  EXPECTED_HEARTBEATS,
  LOCAL_THRESHOLD,
  MAX_LOCAL_FAILURES
} = require('./local-qualification');

const REPORT_SCHEMA_VERSION = 1;
const REPORT_PROTOCOL_VERSION = '2.0.0';
const CRYLONEXUS_CHAIN_ID = 5546;

const OBSERVATION_INTERVAL_MS = 60_000;
const WINDOW_DURATION_MS = 20 * 60_000;

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

function requireSafeInteger(value, name) {
  if (
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new TypeError(
      `${name} must be a non-negative safe integer`
    );
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

function normalizeAddress(value, name) {
  try {
    return getAddress(
      requireNonEmptyString(
        value,
        name
      )
    );
  } catch (error) {
    throw new TypeError(
      `${name} must be a valid EVM address`,
      { cause: error }
    );
  }
}

function normalizeObservation(slot) {
  requirePlainObject(
    slot,
    'Operator report observation'
  );

  requireCanonicalTime(
    slot.slotStartedAt,
    'Operator report observation slotStartedAt'
  );

  requireCanonicalTime(
    slot.observedAt,
    'Operator report observation observedAt'
  );

  if (
    !isCanonicalHash(
      slot.observationHash
    )
  ) {
    throw new TypeError(
      'Operator report observationHash must be a canonical hash'
    );
  }

  if (
    !isCanonicalHash(
      slot.heartbeatPayloadHash
    )
  ) {
    throw new TypeError(
      'Operator report heartbeatPayloadHash must be a canonical hash'
    );
  }

  requireSafeInteger(
    slot.heartbeatSequence,
    'Operator report heartbeatSequence'
  );

  if (
    slot.result !== 'PASS' &&
    slot.result !== 'FAIL'
  ) {
    throw new TypeError(
      'Operator report observation result must be PASS or FAIL'
    );
  }

  requireNonEmptyString(
    slot.reasonCode,
    'Operator report observation reasonCode'
  );

  return Object.freeze({
    slotStartedAt:
      slot.slotStartedAt,
    observedAt:
      slot.observedAt,
    observationHash:
      slot.observationHash,
    heartbeatPayloadHash:
      slot.heartbeatPayloadHash,
    heartbeatSequence:
      slot.heartbeatSequence,
    result:
      slot.result,
    reasonCode:
      slot.reasonCode
  });
}

function buildUnsignedOperatorUptimeReport(
  finalizedWindow
) {
  requirePlainObject(
    finalizedWindow,
    'Finalized Operator uptime window'
  );

  if (
    finalizedWindow.windowComplete !== true
  ) {
    throw new Error(
      'Operator uptime report requires a completed window'
    );
  }

  const reportingOperatorAddress =
    normalizeAddress(
      finalizedWindow.reportingOperatorAddress,
      'Reporting operator address'
    );

  const reportingNodeId =
    requireNonEmptyString(
      finalizedWindow.reportingNodeId,
      'Reporting node ID'
    );

  const reportingSessionAddress =
    normalizeAddress(
      finalizedWindow.reportingSessionAddress,
      'Reporting session address'
    );

  const observedOperatorAddress =
    normalizeAddress(
      finalizedWindow.observedOperatorAddress,
      'Observed operator address'
    );

  const observedNodeId =
    requireNonEmptyString(
      finalizedWindow.observedNodeId,
      'Observed node ID'
    );

  if (
    reportingOperatorAddress ===
    observedOperatorAddress
  ) {
    throw new Error(
      'Operator must not report uptime for itself'
    );
  }

  if (
    reportingNodeId ===
    observedNodeId
  ) {
    throw new Error(
      'Operator node must not report uptime for itself'
    );
  }

  const windowStartedAt =
    requireCanonicalTime(
      finalizedWindow.windowStartedAt,
      'Operator report windowStartedAt'
    );

  const windowEndedAt =
    requireCanonicalTime(
      finalizedWindow.windowEndedAt,
      'Operator report windowEndedAt'
    );

  if (windowEndedAt <= windowStartedAt) {
    throw new Error(
      'Operator report window end must follow its start'
    );
  }

  if (
    windowEndedAt - windowStartedAt !==
    WINDOW_DURATION_MS
  ) {
    throw new Error(
      'Operator report window must be exactly 20 minutes'
    );
  }

  const expectedObservations =
    requireSafeInteger(
      finalizedWindow.expectedObservations,
      'Operator report expectedObservations'
    );

  const receivedObservations =
    requireSafeInteger(
      finalizedWindow.receivedObservations,
      'Operator report receivedObservations'
    );

  const passCount =
    requireSafeInteger(
      finalizedWindow.passCount,
      'Operator report passCount'
    );

  const failCount =
    requireSafeInteger(
      finalizedWindow.failCount,
      'Operator report failCount'
    );

  const missingCount =
    requireSafeInteger(
      finalizedWindow.missingCount,
      'Operator report missingCount'
    );

  const totalFailures =
    requireSafeInteger(
      finalizedWindow.totalFailures,
      'Operator report totalFailures'
    );

  if (
    !Array.isArray(
      finalizedWindow.slots
    )
  ) {
    throw new TypeError(
      'Finalized Operator uptime window slots must be an array'
    );
  }

  const observations =
    finalizedWindow.slots.map(
      normalizeObservation
    );

  if (
    observations.length >
    EXPECTED_HEARTBEATS
  ) {
    throw new Error(
      'Operator report contains more observations than the window allows'
    );
  }

  const occupiedSlots =
    new Set();

  let previousSlotMs = null;

  for (
    const observation of observations
  ) {
    const slotMs =
      Date.parse(
        observation.slotStartedAt
      );

    const observedAtMs =
      Date.parse(
        observation.observedAt
      );

    if (
      slotMs < windowStartedAt ||
      slotMs >= windowEndedAt
    ) {
      throw new Error(
        'Operator report observation slot is outside the report window'
      );
    }

    if (
      (slotMs - windowStartedAt) %
        OBSERVATION_INTERVAL_MS !==
      0
    ) {
      throw new Error(
        'Operator report observation slot is not aligned to the 60-second grid'
      );
    }

    if (
      observedAtMs < slotMs ||
      observedAtMs >=
        slotMs + OBSERVATION_INTERVAL_MS
    ) {
      throw new Error(
        'Operator report observation time is outside its observation slot'
      );
    }

    if (
      occupiedSlots.has(
        observation.slotStartedAt
      )
    ) {
      throw new Error(
        'Operator report contains a duplicate observation slot'
      );
    }

    if (
      previousSlotMs !== null &&
      slotMs <= previousSlotMs
    ) {
      throw new Error(
        'Operator report observation slots must be strictly ordered'
      );
    }

    occupiedSlots.add(
      observation.slotStartedAt
    );

    previousSlotMs =
      slotMs;
  }

  if (
    observations.length !==
    receivedObservations
  ) {
    throw new Error(
      'Operator report observation count does not match receivedObservations'
    );
  }

  const calculatedPassCount =
    observations.filter(
      observation =>
        observation.result === 'PASS'
    ).length;

  const calculatedFailCount =
    observations.length -
    calculatedPassCount;

  if (
    calculatedPassCount !== passCount ||
    calculatedFailCount !== failCount
  ) {
    throw new Error(
      'Operator report PASS/FAIL counts do not match observation evidence'
    );
  }

  if (
    passCount + failCount !==
    receivedObservations
  ) {
    throw new Error(
      'Operator report received count is inconsistent'
    );
  }

  if (
    receivedObservations + missingCount !==
    expectedObservations
  ) {
    throw new Error(
      'Operator report missing count is inconsistent'
    );
  }

  if (
    failCount + missingCount !==
    totalFailures
  ) {
    throw new Error(
      'Operator report total failure count is inconsistent'
    );
  }

  if (
    expectedObservations !==
    EXPECTED_HEARTBEATS
  ) {
    throw new Error(
      'Operator report expected observation count does not match current policy'
    );
  }

  const calculatedQualification =
    passCount >= LOCAL_THRESHOLD &&
    totalFailures <= MAX_LOCAL_FAILURES;

  if (
    typeof finalizedWindow.locallyQualified !==
    'boolean'
  ) {
    throw new TypeError(
      'Operator report locallyQualified must be boolean'
    );
  }

  if (
    finalizedWindow.locallyQualified !==
    calculatedQualification
  ) {
    throw new Error(
      'Operator report qualification does not match observation evidence'
    );
  }

  return Object.freeze({
    schemaVersion:
      REPORT_SCHEMA_VERSION,

    protocolVersion:
      REPORT_PROTOCOL_VERSION,

    chainId:
      CRYLONEXUS_CHAIN_ID,

    reportingOperatorAddress,
    reportingNodeId,
    reportingSessionAddress,

    observedOperatorAddress,
    observedNodeId,

    windowStartedAt:
      finalizedWindow.windowStartedAt,

    windowEndedAt:
      finalizedWindow.windowEndedAt,

    expectedObservations,
    receivedObservations,
    passCount,
    failCount,
    missingCount,
    totalFailures,

    locallyQualified:
      finalizedWindow.locallyQualified,

    observations:
      Object.freeze(
        observations
      )
  });
}

function buildSignedOperatorUptimeReport({
  finalizedWindow,
  privateKey
}) {
  assertPrivateKey(
    privateKey,
    'Operator uptime report private key'
  );

  const unsignedReport =
    buildUnsignedOperatorUptimeReport(
      finalizedWindow
    );

  const signerAddress =
    getAddress(
      computeAddress(privateKey)
    );

  if (
    signerAddress !==
    unsignedReport.reportingSessionAddress
  ) {
    throw new Error(
      `Operator uptime report signer mismatch: expected ` +
      `${unsignedReport.reportingSessionAddress}, received ${signerAddress}`
    );
  }

  const reportHash =
    canonicalHash(
      unsignedReport
    );

  const signingResult =
    signHeartbeatPayload(
      reportHash,
      privateKey
    );

  return Object.freeze({
    ...unsignedReport,
    reportHash,
    signature:
      signingResult.signature
  });
}

function verifySignedOperatorUptimeReport(
  signedReport
) {
  requirePlainObject(
    signedReport,
    'Signed Operator uptime report'
  );

  const {
    reportHash,
    signature,
    ...unsignedInput
  } = signedReport;

  if (!isCanonicalHash(reportHash)) {
    throw new TypeError(
      'Operator uptime reportHash must be a canonical hash'
    );
  }

  requireNonEmptyString(
    signature,
    'Operator uptime report signature'
  );

  const unsignedReport =
    buildUnsignedOperatorUptimeReport({
      ...unsignedInput,
      windowComplete: true,
      slots:
        unsignedInput.observations
    });

  const expectedHash =
    canonicalHash(
      unsignedReport
    );

  if (expectedHash !== reportHash) {
    throw new Error(
      'Operator uptime report hash mismatch'
    );
  }

  const signatureResult =
    verifyHeartbeatSignature({
      payloadHash:
        reportHash,
      signature,
      expectedOperatorAddress:
        unsignedReport
          .reportingSessionAddress
    });

  return Object.freeze({
    valid: true,
    reportHash,
    reportingOperatorAddress:
      unsignedReport
        .reportingOperatorAddress,
    reportingNodeId:
      unsignedReport
        .reportingNodeId,
    reportingSessionAddress:
      unsignedReport
        .reportingSessionAddress,
    observedOperatorAddress:
      unsignedReport
        .observedOperatorAddress,
    observedNodeId:
      unsignedReport
        .observedNodeId,
    windowStartedAt:
      unsignedReport.windowStartedAt,
    windowEndedAt:
      unsignedReport.windowEndedAt,
    locallyQualified:
      unsignedReport.locallyQualified,
    signatureSigner:
      signatureResult.operatorAddress
  });
}

module.exports = Object.freeze({
  REPORT_SCHEMA_VERSION,
  REPORT_PROTOCOL_VERSION,
  CRYLONEXUS_CHAIN_ID,
  buildUnsignedOperatorUptimeReport,
  buildSignedOperatorUptimeReport,
  verifySignedOperatorUptimeReport
});
