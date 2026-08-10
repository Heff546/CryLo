'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const {
  writeJsonAtomic
} = require('../atomic-file');

const STATE_VERSION = 1;
const MAX_NONCE_HISTORY = 256;

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

function requireSequence(value) {
  if (
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new TypeError(
      'Observed heartbeat sequence must be a non-negative safe integer'
    );
  }

  return value;
}

function normalizePeerState(peer) {
  requirePlainObject(
    peer,
    'Observation replay peer state'
  );

  const nonceHistory =
    Array.isArray(peer.nonceHistory)
      ? peer.nonceHistory
      : (
          typeof peer.lastNonce === 'string'
            ? [peer.lastNonce]
            : []
        );

  return {
    ...peer,
    nonceHistory:
      nonceHistory.slice(
        -MAX_NONCE_HISTORY
      )
  };
}

function validateState(state) {
  requirePlainObject(
    state,
    'Observation replay state'
  );

  if (state.version !== STATE_VERSION) {
    throw new Error(
      `Unsupported observation replay state version: ${state.version}`
    );
  }

  if (
    !state.nodes ||
    typeof state.nodes !== 'object' ||
    Array.isArray(state.nodes)
  ) {
    throw new TypeError(
      'Observation replay state nodes must be an object'
    );
  }

  const nodes = {};

  for (const [key, peer] of Object.entries(state.nodes)) {
    nodes[key] =
      normalizePeerState(peer);
  }

  return {
    version: STATE_VERSION,
    nodes
  };
}

function emptyState() {
  return {
    version: STATE_VERSION,
    nodes: {}
  };
}

async function readState(statePath) {
  let serialized;

  try {
    serialized = await fs.readFile(
      statePath,
      'utf8'
    );
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return emptyState();
    }

    throw error;
  }

  let parsed;

  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new Error(
      `Observation replay state contains malformed JSON: ${statePath}`,
      { cause: error }
    );
  }

  return validateState(parsed);
}

function peerKey(
  operatorAddress,
  nodeId
) {
  return (
    `${operatorAddress.toLowerCase()}::${nodeId}`
  );
}

async function createObservationReplayState(
  options
) {
  requirePlainObject(
    options,
    'Observation replay state options'
  );

  const statePath =
    path.resolve(
      requireNonEmptyString(
        options.statePath,
        'Observation replay state path'
      )
    );

  let state =
    await readState(statePath);

  async function acceptHeartbeat({
    operatorAddress,
    nodeId,
    sequence,
    nonce,
    payloadHash,
    observedAt
  }) {
    requireNonEmptyString(
      operatorAddress,
      'Observed operator address'
    );

    requireNonEmptyString(
      nodeId,
      'Observed node ID'
    );

    requireSequence(sequence);

    requireNonEmptyString(
      nonce,
      'Observed heartbeat nonce'
    );

    requireNonEmptyString(
      payloadHash,
      'Observed heartbeat payloadHash'
    );

    requireNonEmptyString(
      observedAt,
      'Observed heartbeat timestamp'
    );

    const key =
      peerKey(
        operatorAddress,
        nodeId
      );

    const previous =
      state.nodes[key] || null;

    if (previous) {
      if (sequence < previous.lastSequence) {
        throw new Error(
          'Observed heartbeat sequence rollback detected'
        );
      }

      if (sequence === previous.lastSequence) {
        throw new Error(
          'Observed heartbeat sequence replay detected'
        );
      }

      if (
        previous.nonceHistory.includes(
          nonce
        )
      ) {
        throw new Error(
          'Observed heartbeat nonce replay detected'
        );
      }

      if (payloadHash === previous.lastPayloadHash) {
        throw new Error(
          'Observed heartbeat payload replay detected'
        );
      }
    }

    const nonceHistory = [
      ...(
        previous
          ? previous.nonceHistory
          : []
      ),
      nonce
    ].slice(-MAX_NONCE_HISTORY);

    const nextPeerState = {
      operatorAddress,
      nodeId,
      lastSequence: sequence,
      lastNonce: nonce,
      nonceHistory,
      lastPayloadHash: payloadHash,
      lastObservedAt: observedAt
    };

    state = {
      version: STATE_VERSION,
      nodes: {
        ...state.nodes,
        [key]: nextPeerState
      }
    };

    await writeJsonAtomic(
      statePath,
      state
    );

    return Object.freeze({
      ...nextPeerState,
      nonceHistory:
        Object.freeze([
          ...nextPeerState.nonceHistory
        ])
    });
  }

  async function getPeerState(
    operatorAddress,
    nodeId
  ) {
    requireNonEmptyString(
      operatorAddress,
      'Observed operator address'
    );

    requireNonEmptyString(
      nodeId,
      'Observed node ID'
    );

    const entry =
      state.nodes[
        peerKey(
          operatorAddress,
          nodeId
        )
      ];

    if (!entry) {
      return null;
    }

    return Object.freeze({
      ...entry,
      nonceHistory:
        Object.freeze([
          ...entry.nonceHistory
        ])
    });
  }

  return Object.freeze({
    statePath,
    acceptHeartbeat,
    getPeerState
  });
}

module.exports = Object.freeze({
  MAX_NONCE_HISTORY,
  STATE_VERSION,
  createObservationReplayState
});
