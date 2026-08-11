'use strict';

const {
  canonicalJson,
  canonicalJsonBytes
} = require('./canonical-json');

const {
  canonicalHash,
  heartbeatPayloadHash,
  isCanonicalHash,
  statusHash
} = require('./hashing');

const {
  buildUnsignedHeartbeat
} = require('./heartbeat-builder');

const {
  CRYLONEXUS_CHAIN_ID,
  REQUIRED_FIELDS,
  SUPPORTED_PROTOCOL_VERSION,
  unsignedPayloadFromHeartbeat,
  validateUnsignedHeartbeat
} = require('./heartbeat-validator');

module.exports = {
  buildUnsignedHeartbeat,
  canonicalHash,
  canonicalJson,
  canonicalJsonBytes,
  CRYLONEXUS_CHAIN_ID,
  heartbeatPayloadHash,
  isCanonicalHash,
  REQUIRED_FIELDS,
  statusHash,
  SUPPORTED_PROTOCOL_VERSION,
  unsignedPayloadFromHeartbeat,
  validateUnsignedHeartbeat
};

const sequenceManager = require('./sequence-manager');

module.exports = Object.freeze({
  ...module.exports,
  ...sequenceManager
});

const nonceProvider = require('./nonce-provider');

module.exports = Object.freeze({
  ...module.exports,
  ...nonceProvider
});

const detachedSigning = require('./detached-signing');

module.exports = Object.freeze({
  ...module.exports,
  ...detachedSigning
});

const signedHeartbeatBuilder =
  require('./signed-heartbeat-builder');

module.exports = Object.freeze({
  ...module.exports,
  ...signedHeartbeatBuilder
});

const statusCollector =
  require('./status-collector');

module.exports = Object.freeze({
  ...module.exports,
  ...statusCollector
});

const heartbeatPipeline =
  require('./heartbeat-pipeline');

module.exports = Object.freeze({
  ...module.exports,
  ...heartbeatPipeline
});

const localHeartbeatWriter =
  require('./local-heartbeat-writer');

module.exports = Object.freeze({
  ...module.exports,
  ...localHeartbeatWriter
});

const signingKeyLoader =
  require('./signing-key-loader');

module.exports = Object.freeze({
  ...module.exports,
  ...signingKeyLoader
});

const localHeartbeatRuntime =
  require('./local-heartbeat-runtime');

module.exports = Object.freeze({
  ...module.exports,
  ...localHeartbeatRuntime
});


const authorizationLoader =
  require('./authorization-loader');

module.exports = Object.freeze({
  ...module.exports,
  ...authorizationLoader
});


const remoteNodeEvidenceValidator =
  require('./remote-node-evidence-validator');

module.exports = Object.freeze({
  ...module.exports,
  ...remoteNodeEvidenceValidator
});

const observationReplayState =
  require('./observation-replay-state');

module.exports = Object.freeze({
  ...module.exports,
  ...observationReplayState
});

const nodeObservationWorker =
  require('./node-observation-worker');

module.exports = Object.freeze({
  ...module.exports,
  ...nodeObservationWorker
});

const signedNodeObservation =
  require('./signed-node-observation');

module.exports = Object.freeze({
  ...module.exports,
  ...signedNodeObservation
});


const operatorPeerTracker =
  require('./operator-peer-tracker');

module.exports = Object.freeze({
  ...module.exports,
  ...operatorPeerTracker
});

const signedOperatorUptimeReport =
  require('./signed-operator-uptime-report');

module.exports = Object.freeze({
  ...module.exports,
  ...signedOperatorUptimeReport
});

const validatorReportReplayState =
  require('./validator-report-replay-state');

module.exports = Object.freeze({
  ...module.exports,
  ...validatorReportReplayState
});

const validatorUptimeReportHandler =
  require('./validator-uptime-report-handler');

module.exports = Object.freeze({
  ...module.exports,
  ...validatorUptimeReportHandler
});

const validatorIntakeLifecycle =
  require('./validator-intake-lifecycle');

module.exports = Object.freeze({
  ...module.exports,
  ...validatorIntakeLifecycle
});

const validatorConsensusState =
  require('./validator-consensus-state');

module.exports = Object.freeze({
  ...module.exports,
  ...validatorConsensusState
});

const validatorConsensusPolicy =
  require('./validator-consensus-policy');

module.exports = Object.freeze({
  ...module.exports,
  ...validatorConsensusPolicy
});

const validatorRewardAuthorizationState =
  require('./validator-reward-authorization-state');

module.exports = Object.freeze({
  ...module.exports,
  ...validatorRewardAuthorizationState
});

const validatorRewardAuthorizationReconciler =
  require('./validator-reward-authorization-reconciler');

module.exports = Object.freeze({
  ...module.exports,
  ...validatorRewardAuthorizationReconciler
});
