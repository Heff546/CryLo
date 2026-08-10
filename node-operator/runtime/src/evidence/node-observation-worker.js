'use strict';

const {
  getAddress
} = require('ethers');

const {
  statusHash
} = require('./hashing');

const {
  validateRemoteNodeEvidence
} = require(
  './remote-node-evidence-validator'
);

const {
  evaluateRegistration
} = require(
  '../contracts/verification'
);

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

function requireFunction(value, name) {
  if (typeof value !== 'function') {
    throw new TypeError(
      `${name} must be a function`
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

function tierFromStatus(status) {
  requirePlainObject(
    status,
    'Remote status evidence'
  );

  if (
    status.tier !== 'Operator' &&
    status.tier !== 'Validator'
  ) {
    throw new Error(
      'Remote status does not declare a registered node tier'
    );
  }

  return status.tier;
}

function createNodeObservationWorker(options) {
  requirePlainObject(
    options,
    'Node observation worker options'
  );

  const localOperatorAddress =
    getAddress(
      requireNonEmptyString(
        options.localOperatorAddress,
        'Local operator address'
      )
    );

  const localNodeId =
    requireNonEmptyString(
      options.localNodeId,
      'Local node ID'
    );

  const replayState =
    requirePlainObject(
      options.replayState,
      'Observation replay state'
    );

  requireFunction(
    replayState.acceptHeartbeat,
    'Observation replay acceptHeartbeat'
  );

  const readRemoteNodeStatus =
    requireFunction(
      options.readRemoteNodeStatus,
      'Remote node status reader'
    );

  const clock =
    options.clock === undefined
      ? () => new Date()
      : requireFunction(
          options.clock,
          'Observation worker clock'
        );

  async function observe({
    heartbeat,
    authorization,
    status
  }) {
    requirePlainObject(
      heartbeat,
      'Remote heartbeat'
    );

    requirePlainObject(
      authorization,
      'Remote authorization'
    );

    requirePlainObject(
      status,
      'Remote status evidence'
    );

    /*
     * The heartbeat signs statusHash, not the raw status
     * object. Bind the supplied status evidence to the
     * exact status commitment carried by the heartbeat.
     */
    const suppliedStatusHash =
      statusHash(status);

    if (
      suppliedStatusHash !==
      heartbeat.statusHash
    ) {
      throw new Error(
        'Remote status evidence does not match heartbeat statusHash'
      );
    }

    const remoteEvidence =
      validateRemoteNodeEvidence({
        heartbeat,
        authorization,
        localOperatorAddress,
        localNodeId,
        now: clock
      });

    const observedAtDate =
      clock();

    if (
      !(observedAtDate instanceof Date) ||
      !Number.isFinite(
        observedAtDate.getTime()
      )
    ) {
      throw new TypeError(
        'Observation worker clock must return a valid Date'
      );
    }

    const observedAt =
      observedAtDate.toISOString();

    /*
     * Replay state is committed only after cryptographic
     * validation and status-hash validation have passed.
     */
    await replayState.acceptHeartbeat({
      operatorAddress:
        remoteEvidence.operatorAddress,
      nodeId:
        remoteEvidence.nodeId,
      sequence:
        remoteEvidence.sequence,
      nonce:
        remoteEvidence.nonce,
      payloadHash:
        remoteEvidence.payloadHash,
      observedAt
    });

    /*
     * The remote status claims its tier, but that claim
     * is never trusted by itself. Verify it independently
     * against NodeStaking.
     */
    const claimedTier =
      tierFromStatus(status);

    const node =
      await readRemoteNodeStatus(
        remoteEvidence.operatorAddress
      );

    const registration =
      evaluateRegistration(
        node,
        claimedTier
      );

    const passed =
      registration.verified === true;

    return Object.freeze({
      protocolVersion: '2.0.0',
      chainId:
        heartbeat.chainId,

      observedOperatorAddress:
        remoteEvidence.operatorAddress,

      observedNodeId:
        remoteEvidence.nodeId,

      observedSessionAddress:
        remoteEvidence.sessionAddress,

      heartbeatSequence:
        remoteEvidence.sequence,

      heartbeatPayloadHash:
        remoteEvidence.payloadHash,

      statusHash:
        heartbeat.statusHash,

      observedAt,

      claimedTier,

      registration: Object.freeze({
        passed,

        registered:
          node.registered === true,

        isNodeWallet:
          node.isNodeWallet === true,

        onChainTier:
          node.tierLabel,

        stakeAtomic:
          node.stakeAtomic,

        stakeRequirementAtomic:
          registration.stakeRequirementAtomic,

        configuredTierMatches:
          registration.configuredTierMatches,

        stakeRequirementMet:
          registration.stakeRequirementMet,

        messageCode:
          registration.messageCode
      }),

      result:
        passed
          ? 'PASS'
          : 'FAIL',

      reasonCode:
        registration.messageCode
    });
  }

  return Object.freeze({
    observe
  });
}

module.exports = Object.freeze({
  createNodeObservationWorker,
  tierFromStatus
});
