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
