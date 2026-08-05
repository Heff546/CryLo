'use strict';

const {
  NETWORK,
  CHAIN_ID,
  SCHEMA_VERSION,
  PROTOCOL_VERSION
} = require('./constants');

function createWorker(name) {
  return {
    name,
    healthy: false,
    lastRunAt: null,
    successes: 0,
    errors: 0,
    messageCode: 'NOT_RUN'
  };
}

function createInitialStatus({
  serviceVersion,
  operatorAddress,
  nodeId,
  startedAt
}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    serviceVersion,
    network: NETWORK,
    chainId: CHAIN_ID,
    nodeId,
    operatorAddress,
    startedAt,
    updatedAt: startedAt,
    lastHeartbeatAt: null,
    connected: false,
    rpcHealthy: false,
    walletMatched: false,
    registered: false,
    tier: null,
    uptimeSeconds: 0,
    rewardEligible: false,
    verification: {
      connected: false,
      verified: false,
      verifiedAt: null,
      reasonCode: 'NOT_VERIFIED'
    },
    metrics: {
      heartbeatCount: 0,
      successfulChecks: 0,
      failedChecks: 0,
      pendingRewardsBaseUnits: '0'
    },
    workers: [
      createWorker('configuration'),
      createWorker('rpc-health'),
      createWorker('registration'),
      createWorker('reward-eligibility'),
      createWorker('status-writer')
    ],
    warnings: [],
    errors: []
  };
}

function findWorker(status, name) {
  const worker =
    status.workers.find(
      candidate => candidate.name === name
    );

  if (!worker) {
    throw new Error(
      `Unknown worker: ${name}`
    );
  }

  return worker;
}

function markWorkerSuccess(
  status,
  name,
  timestamp,
  messageCode = null
) {
  const worker = findWorker(status, name);

  worker.healthy = true;
  worker.lastRunAt = timestamp;
  worker.successes += 1;
  worker.messageCode = messageCode;
}

function markWorkerFailure(
  status,
  name,
  timestamp,
  messageCode
) {
  const worker = findWorker(status, name);

  worker.healthy = false;
  worker.lastRunAt = timestamp;
  worker.errors += 1;
  worker.messageCode = messageCode;
}

function statusMessage(
  code,
  message,
  firstSeenAt
) {
  return {
    code,
    message,
    firstSeenAt
  };
}

module.exports = {
  createInitialStatus,
  markWorkerSuccess,
  markWorkerFailure,
  statusMessage
};
