'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { getAddress } = require('ethers');

const {
  writeJsonAtomic
} = require('../atomic-file');

const {
  verifySignedNodeObservation
} = require('./signed-node-observation');

const {
  buildSignedOperatorUptimeReport,
  verifySignedOperatorUptimeReport
} = require('./signed-operator-uptime-report');

const {
  EXPECTED_HEARTBEATS,
  LOCAL_THRESHOLD,
  MAX_LOCAL_FAILURES,
  OBSERVATION_INTERVAL_MS,
  WINDOW_DURATION_MS
} = require('./local-qualification');

const STATE_VERSION = 2;

function requireObject(value, name) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    throw new TypeError(`${name} must be an object`);
  }

  return value;
}

function requireString(value, name) {
  if (
    typeof value !== 'string' ||
    value.trim() === ''
  ) {
    throw new TypeError(`${name} must be a non-empty string`);
  }

  return value;
}

function normalizeAddress(value, name) {
  try {
    return getAddress(requireString(value, name));
  } catch (error) {
    throw new TypeError(
      `${name} must be a valid EVM address`,
      { cause: error }
    );
  }
}

function canonicalTime(ms) {
  return new Date(ms).toISOString();
}

function slotStartMs(ms) {
  return (
    Math.floor(ms / OBSERVATION_INTERVAL_MS) *
    OBSERVATION_INTERVAL_MS
  );
}

function peerKey(operatorAddress, nodeId) {
  return `${operatorAddress.toLowerCase()}::${nodeId}`;
}

function defaultOperatorPeerTrackerPath() {
  return path.join(
    os.homedir(),
    '.config',
    'crylo-wallet',
    'operator',
    'verification',
    'operator-peer-windows.json'
  );
}

function createPeerWindow({
  observedOperatorAddress,
  observedNodeId,
  observedAtMs
}) {
  const startedMs = slotStartMs(observedAtMs);

  return {
    observedOperatorAddress,
    observedNodeId,
    windowStartedAt:
      canonicalTime(startedMs),
    windowEndedAt:
      canonicalTime(
        startedMs + WINDOW_DURATION_MS
      ),
    slots: []
  };
}

function summarizePeerWindow(window, nowMs) {
  const endedMs =
    Date.parse(window.windowEndedAt);

  const complete =
    Number.isFinite(endedMs) &&
    nowMs >= endedMs;

  let passCount = 0;
  let failCount = 0;

  for (const slot of window.slots) {
    if (slot.result === 'PASS') {
      passCount += 1;
    } else {
      failCount += 1;
    }
  }

  const missingCount =
    complete
      ? Math.max(
          0,
          EXPECTED_HEARTBEATS -
          window.slots.length
        )
      : 0;

  const totalFailures =
    failCount + missingCount;

  const qualified =
    complete &&
    passCount >= LOCAL_THRESHOLD &&
    totalFailures <= MAX_LOCAL_FAILURES;

  return {
    ...window,
    expectedObservations:
      EXPECTED_HEARTBEATS,
    receivedObservations:
      window.slots.length,
    passCount,
    failCount,
    missingCount,
    totalFailures,
    windowComplete:
      complete,
    locallyQualified:
      qualified
  };
}

async function readState(statePath) {
  try {
    const serialized =
      await fs.readFile(
        statePath,
        'utf8'
      );

    const parsed =
      JSON.parse(serialized);

    if (
      !parsed ||
      parsed.version !== STATE_VERSION ||
      !parsed.peers ||
      typeof parsed.peers !== 'object' ||
      Array.isArray(parsed.peers) ||
      !Array.isArray(parsed.finalized)
    ) {
      throw new Error(
        'Operator peer tracker state is invalid'
      );
    }

    return parsed;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        version: STATE_VERSION,
        peers: {},
        finalized: []
      };
    }

    throw error;
  }
}

async function createOperatorPeerTracker(options) {
  requireObject(
    options,
    'Operator peer tracker options'
  );

  const reportingOperatorAddress =
    normalizeAddress(
      options.reportingOperatorAddress,
      'Reporting operator address'
    );

  const reportingNodeId =
    requireString(
      options.reportingNodeId,
      'Reporting node ID'
    );

  const reportingSessionAddress =
    normalizeAddress(
      options.reportingSessionAddress,
      'Reporting session address'
    );

  const reportingSessionPrivateKey =
    options.reportingSessionPrivateKey ===
      undefined
      ? null
      : requireString(
          options.reportingSessionPrivateKey,
          'Reporting session private key'
        );

  const statePath =
    path.resolve(
      options.statePath === undefined
        ? defaultOperatorPeerTrackerPath()
        : requireString(
            options.statePath,
            'Operator peer tracker state path'
          )
    );

  let state =
    await readState(statePath);

  async function persist() {
    await writeJsonAtomic(
      statePath,
      state
    );
  }

  async function recordObservation(
    signedObservation
  ) {
    requireObject(
      signedObservation,
      'Signed node observation'
    );

    const verified =
      verifySignedNodeObservation(
        signedObservation
      );

    if (
      getAddress(
        verified.observingOperatorAddress
      ) !== reportingOperatorAddress
    ) {
      throw new Error(
        'Observation belongs to another reporting Operator'
      );
    }

    if (
      verified.observingNodeId !==
      reportingNodeId
    ) {
      throw new Error(
        'Observation belongs to another reporting node'
      );
    }

    if (
      getAddress(
        verified.observingSessionAddress
      ) !== reportingSessionAddress
    ) {
      throw new Error(
        'Observation belongs to another reporting session'
      );
    }

    const observedAtMs =
      Date.parse(
        signedObservation.observedAt
      );

    if (!Number.isFinite(observedAtMs)) {
      throw new Error(
        'Observation timestamp is invalid'
      );
    }

    const targetOperator =
      getAddress(
        verified.observedOperatorAddress
      );

    const targetNode =
      verified.observedNodeId;

    const key =
      peerKey(
        targetOperator,
        targetNode
      );

    let window =
      state.peers[key];

    if (!window) {
      window =
        createPeerWindow({
          observedOperatorAddress:
            targetOperator,
          observedNodeId:
            targetNode,
          observedAtMs
        });
    }

    window =
      summarizePeerWindow(
        window,
        observedAtMs
      );

    if (window.windowComplete) {
      throw new Error(
        'Peer observation window is complete and must be finalized before rollover'
      );
    }

    const slotMs =
      slotStartMs(observedAtMs);

    const windowStartMs =
      Date.parse(
        window.windowStartedAt
      );

    const windowEndMs =
      Date.parse(
        window.windowEndedAt
      );

    if (
      slotMs < windowStartMs ||
      slotMs >= windowEndMs
    ) {
      throw new Error(
        'Observation falls outside active peer window'
      );
    }

    const slotStartedAt =
      canonicalTime(slotMs);

    if (
      window.slots.some(
        slot =>
          slot.slotStartedAt ===
          slotStartedAt
      )
    ) {
      throw new Error(
        'Peer window already contains an observation for this slot'
      );
    }

    window.slots.push({
      slotStartedAt,
      observedAt:
        signedObservation.observedAt,
      observationHash:
        signedObservation.observationHash,
      heartbeatPayloadHash:
        signedObservation
          .heartbeatPayloadHash,
      heartbeatSequence:
        signedObservation
          .heartbeatSequence,
      result:
        verified.result,
      reasonCode:
        verified.reasonCode
    });

    window.slots.sort(
      (left, right) =>
        left.slotStartedAt.localeCompare(
          right.slotStartedAt
        )
    );

    state = {
      version: STATE_VERSION,
      peers: {
        ...state.peers,
        [key]:
          summarizePeerWindow(
            window,
            observedAtMs
          )
      },
      finalized:
        state.finalized
    };

    await persist();

    return state.peers[key];
  }

  async function finalizePeerWindow(
    observedOperatorAddress,
    observedNodeId,
    now = new Date()
  ) {
    const targetOperator =
      normalizeAddress(
        observedOperatorAddress,
        'Observed operator address'
      );

    const targetNode =
      requireString(
        observedNodeId,
        'Observed node ID'
      );

    const key =
      peerKey(
        targetOperator,
        targetNode
      );

    const window =
      state.peers[key];

    if (!window) {
      throw new Error(
        'Peer observation window does not exist'
      );
    }

    const nowMs =
      now instanceof Date
        ? now.getTime()
        : Date.parse(now);

    if (!Number.isFinite(nowMs)) {
      throw new TypeError(
        'Peer tracker clock is invalid'
      );
    }

    const completed =
      summarizePeerWindow(
        window,
        nowMs
      );

    if (!completed.windowComplete) {
      throw new Error(
        'Peer observation window is not complete'
      );
    }

    const existing =
      state.finalized.find(
        item =>
          item.observedOperatorAddress ===
            completed.observedOperatorAddress &&
          item.observedNodeId ===
            completed.observedNodeId &&
          item.windowStartedAt ===
            completed.windowStartedAt &&
          item.windowEndedAt ===
            completed.windowEndedAt
      );

    if (existing) {
      return existing;
    }

    if (!reportingSessionPrivateKey) {
      throw new Error(
        'Reporting session private key is required to finalize a peer window'
      );
    }

    const unsignedFinalized = {
      schemaVersion: 1,
      protocolVersion: '2.0.0',
      reportingOperatorAddress,
      reportingNodeId,
      reportingSessionAddress,
      ...completed
    };

    const finalized =
      buildSignedOperatorUptimeReport({
        finalizedWindow:
          unsignedFinalized,
        privateKey:
          reportingSessionPrivateKey
      });

    verifySignedOperatorUptimeReport(
      finalized
    );

    const nextPeers = {
      ...state.peers
    };

    delete nextPeers[key];

    state = {
      version: STATE_VERSION,
      peers: nextPeers,
      finalized: [
        ...state.finalized,
        finalized
      ]
    };

    await persist();

    return finalized;
  }

  async function getPeerState(
    observedOperatorAddress,
    observedNodeId,
    now = new Date()
  ) {
    const key =
      peerKey(
        normalizeAddress(
          observedOperatorAddress,
          'Observed operator address'
        ),
        requireString(
          observedNodeId,
          'Observed node ID'
        )
      );

    const window =
      state.peers[key];

    if (!window) {
      return null;
    }

    const nowMs =
      now instanceof Date
        ? now.getTime()
        : Date.parse(now);

    if (!Number.isFinite(nowMs)) {
      throw new TypeError(
        'Peer tracker clock is invalid'
      );
    }

    return summarizePeerWindow(
      window,
      nowMs
    );
  }

  async function getAllPeerStates(
    now = new Date()
  ) {
    const result = [];

    for (
      const window
      of Object.values(state.peers)
    ) {
      result.push(
        summarizePeerWindow(
          window,
          now instanceof Date
            ? now.getTime()
            : Date.parse(now)
        )
      );
    }

    return result;
  }

  return Object.freeze({
    statePath,
    recordObservation,
    finalizePeerWindow,
    getPeerState,
    getAllPeerStates
  });
}

module.exports = Object.freeze({
  STATE_VERSION,
  createOperatorPeerTracker,
  defaultOperatorPeerTrackerPath
});
