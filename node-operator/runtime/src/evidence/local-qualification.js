'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  writeJsonAtomic
} = require('../atomic-file');

const EXPECTED_HEARTBEATS = 20;
const LOCAL_THRESHOLD = 18;
const MAX_LOCAL_FAILURES = 2;
const OBSERVATION_INTERVAL_MS = 60_000;
const WINDOW_DURATION_MS =
  EXPECTED_HEARTBEATS *
  OBSERVATION_INTERVAL_MS;

function defaultLocalQualificationPath() {
  return path.join(
    os.homedir(),
    '.config',
    'crylo-wallet',
    'operator',
    'verification',
    'local-window.json'
  );
}

function canonicalTime(ms) {
  return new Date(ms).toISOString();
}

function requirePlainObject(value, name) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
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

  return value.trim();
}

function slotStartMs(timestampMs) {
  return (
    Math.floor(
      timestampMs /
      OBSERVATION_INTERVAL_MS
    ) * OBSERVATION_INTERVAL_MS
  );
}

function createWindow({
  operatorAddress,
  nodeId,
  timestampMs
}) {
  const startedMs = slotStartMs(timestampMs);
  const endedMs =
    startedMs + WINDOW_DURATION_MS;

  return {
    schemaVersion: 1,
    protocolVersion: 1,
    operatorAddress,
    nodeId,
    windowStartedAt:
      canonicalTime(startedMs),
    windowEndedAt:
      canonicalTime(endedMs),
    expectedHeartbeats:
      EXPECTED_HEARTBEATS,
    receivedHeartbeats: 0,
    successfulObservations: 0,
    failedObservations: 0,
    missingHeartbeats: 0,
    localThreshold: LOCAL_THRESHOLD,
    maximumLocalFailures:
      MAX_LOCAL_FAILURES,
    thresholdMet: false,
    windowComplete: false,
    locallyQualified: false,
    retryPending: false,
    consensusQualified: false,
    rewardAuthorized: false,
    reasonCode:
      'COLLECTING_LOCAL_EVIDENCE',
    lastAcceptedAt: null,
    lastAcceptedSequence: null,
    updatedAt: canonicalTime(timestampMs),
    slots: []
  };
}

function summarizeWindow(state, nowMs) {
  const endedMs =
    Date.parse(state.windowEndedAt);

  const windowComplete =
    Number.isFinite(endedMs) &&
    nowMs >= endedMs;

  const explicitFailures =
    state.slots.reduce(
      (total, slot) =>
        total + (slot.successful ? 0 : 1),
      0
    );

  const successes =
    state.slots.length -
    explicitFailures;

  const missing = windowComplete
    ? Math.max(
        0,
        EXPECTED_HEARTBEATS -
        state.slots.length
      )
    : 0;

  const failures =
    explicitFailures + missing;

  const thresholdMet =
    successes >= LOCAL_THRESHOLD &&
    explicitFailures <=
      MAX_LOCAL_FAILURES;

  const locallyQualified =
    windowComplete &&
    successes >= LOCAL_THRESHOLD &&
    failures <= MAX_LOCAL_FAILURES;

  let reasonCode =
    'COLLECTING_LOCAL_EVIDENCE';

  if (locallyQualified) {
    reasonCode = 'LOCAL_EVIDENCE_ONLY';
  } else if (windowComplete) {
    reasonCode = missing > 0
      ? 'INSUFFICIENT_HEARTBEATS'
      : 'SUCCESS_RATE_TOO_LOW';
  } else if (thresholdMet) {
    reasonCode = 'LOCAL_THRESHOLD_MET';
  }

  return {
    ...state,
    receivedHeartbeats:
      state.slots.length,
    successfulObservations: successes,
    failedObservations: failures,
    missingHeartbeats: missing,
    thresholdMet,
    windowComplete,
    locallyQualified,
    consensusQualified: false,
    rewardAuthorized: false,
    reasonCode,
    updatedAt: canonicalTime(nowMs)
  };
}

async function readExistingState(
  statePath,
  operatorAddress,
  nodeId
) {
  let serialized;

  try {
    serialized = await fs.readFile(
      statePath,
      'utf8'
    );
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }

    throw error;
  }

  let parsed;

  try {
    parsed = JSON.parse(serialized);
  } catch {
    return null;
  }

  if (
    !parsed ||
    parsed.operatorAddress !==
      operatorAddress ||
    parsed.nodeId !== nodeId ||
    !Array.isArray(parsed.slots)
  ) {
    return null;
  }

  return parsed;
}

async function createLocalQualificationTracker(
  options
) {
  requirePlainObject(
    options,
    'Local qualification options'
  );

  const operatorAddress =
    requireNonEmptyString(
      options.operatorAddress,
      'Local qualification operatorAddress'
    );

  const nodeId = requireNonEmptyString(
    options.nodeId,
    'Local qualification nodeId'
  );

  const statePath = path.resolve(
    options.statePath === undefined
      ? defaultLocalQualificationPath()
      : requireNonEmptyString(
          options.statePath,
          'Local qualification statePath'
        )
  );

  let state = await readExistingState(
    statePath,
    operatorAddress,
    nodeId
  );

  async function persist(nextState) {
    state = nextState;
    await writeJsonAtomic(
      statePath,
      state
    );
    return state;
  }

  async function recordObservation({
    issuedAt,
    sequence,
    successful
  }) {
    const issuedMs = Date.parse(issuedAt);

    if (!Number.isFinite(issuedMs)) {
      throw new TypeError(
        'Local qualification issuedAt must be a valid timestamp'
      );
    }

    if (
      !Number.isSafeInteger(sequence) ||
      sequence < 0
    ) {
      throw new TypeError(
        'Local qualification sequence must be a non-negative safe integer'
      );
    }

    if (typeof successful !== 'boolean') {
      throw new TypeError(
        'Local qualification successful must be boolean'
      );
    }

    if (!state) {
      state = createWindow({
        operatorAddress,
        nodeId,
        timestampMs: issuedMs
      });
    }

    state = summarizeWindow(
      state,
      issuedMs
    );

    if (state.locallyQualified) {
      return persist({
        ...state,
        updatedAt: canonicalTime(issuedMs)
      });
    }

    if (state.windowComplete) {
      if (state.retryPending === true) {
        state = createWindow({
          operatorAddress,
          nodeId,
          timestampMs: issuedMs
        });
      } else {
        return persist({
          ...state,
          retryPending: true,
          updatedAt: canonicalTime(issuedMs)
        });
      }
    }

    const currentSlotMs =
      slotStartMs(issuedMs);

    const startedMs =
      Date.parse(state.windowStartedAt);
    const endedMs =
      Date.parse(state.windowEndedAt);

    if (
      currentSlotMs < startedMs ||
      currentSlotMs >= endedMs
    ) {
      return persist(
        summarizeWindow(state, issuedMs)
      );
    }

    const currentSlot =
      canonicalTime(currentSlotMs);

    if (
      state.slots.some(
        slot =>
          slot.slotStartedAt ===
          currentSlot
      )
    ) {
      return persist(
        summarizeWindow(state, issuedMs)
      );
    }

    const slots = [
      ...state.slots,
      {
        slotStartedAt: currentSlot,
        sequence,
        issuedAt,
        successful
      }
    ];

    return persist(
      summarizeWindow(
        {
          ...state,
          slots,
          lastAcceptedAt: issuedAt,
          lastAcceptedSequence:
            sequence
        },
        issuedMs
      )
    );
  }

  async function getState() {
    if (!state) return null;

    return persist(
      summarizeWindow(
        state,
        Date.now()
      )
    );
  }

  return Object.freeze({
    statePath,
    recordObservation,
    getState
  });
}

module.exports = Object.freeze({
  EXPECTED_HEARTBEATS,
  LOCAL_THRESHOLD,
  MAX_LOCAL_FAILURES,
  OBSERVATION_INTERVAL_MS,
  WINDOW_DURATION_MS,
  createLocalQualificationTracker,
  defaultLocalQualificationPath
});
