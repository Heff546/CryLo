'use strict';

const os = require('node:os');
const path = require('node:path');

const {
  createHeartbeatPipeline
} = require('./heartbeat-pipeline');

const {
  createLocalHeartbeatWriter
} = require('./local-heartbeat-writer');

const {
  createNonceProvider
} = require('./nonce-provider');

const {
  createSequenceManager
} = require('./sequence-manager');

const {
  loadSigningKey
} = require('./signing-key-loader');

function requirePlainObject(
  value,
  name
) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !==
      Object.prototype
  ) {
    throw new TypeError(
      `${name} must be a plain object`
    );
  }
}

function requireNonEmptyString(
  value,
  name
) {
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

function requireFunction(
  value,
  name
) {
  if (typeof value !== 'function') {
    throw new TypeError(
      `${name} must be a function`
    );
  }

  return value;
}

function defaultHeartbeatDirectory() {
  return path.join(
    os.homedir(),
    '.config',
    'crylo-wallet',
    'operator',
    'heartbeat'
  );
}

function defaultHeartbeatOutputPath() {
  return path.join(
    defaultHeartbeatDirectory(),
    'latest-heartbeat.json'
  );
}

function defaultSequenceStatePath() {
  return path.join(
    defaultHeartbeatDirectory(),
    'sequence.json'
  );
}

async function createLocalHeartbeatRuntime(
  options
) {
  requirePlainObject(
    options,
    'Local heartbeat runtime options'
  );

  const operatorAddress =
    requireNonEmptyString(
      options.operatorAddress,
      'Local heartbeat operatorAddress'
    );

  const nodeId =
    requireNonEmptyString(
      options.nodeId,
      'Local heartbeat nodeId'
    );

  const outputPath =
    path.resolve(
      options.outputPath === undefined
        ? defaultHeartbeatOutputPath()
        : requireNonEmptyString(
            options.outputPath,
            'Local heartbeat outputPath'
          )
    );

  const sequenceStatePath =
    path.resolve(
      options.sequenceStatePath ===
        undefined
        ? defaultSequenceStatePath()
        : requireNonEmptyString(
            options.sequenceStatePath,
            'Local heartbeat sequenceStatePath'
          )
    );

  const loadKey =
    options.loadSigningKey === undefined
      ? loadSigningKey
      : requireFunction(
          options.loadSigningKey,
          'Local heartbeat signing-key loader'
        );

  const makeSequenceManager =
    options.createSequenceManager ===
      undefined
      ? createSequenceManager
      : requireFunction(
          options.createSequenceManager,
          'Local heartbeat sequence-manager factory'
        );

  const makeNonceProvider =
    options.createNonceProvider ===
      undefined
      ? createNonceProvider
      : requireFunction(
          options.createNonceProvider,
          'Local heartbeat nonce-provider factory'
        );

  const makePipeline =
    options.createHeartbeatPipeline ===
      undefined
      ? createHeartbeatPipeline
      : requireFunction(
          options.createHeartbeatPipeline,
          'Local heartbeat pipeline factory'
        );

  const makeWriter =
    options.createLocalHeartbeatWriter ===
      undefined
      ? createLocalHeartbeatWriter
      : requireFunction(
          options.createLocalHeartbeatWriter,
          'Local heartbeat writer factory'
        );

  const signingKey =
    await loadKey({
      keyPath: options.keyPath,
      expectedOperatorAddress:
        operatorAddress
    });

  requirePlainObject(
    signingKey,
    'Loaded signing key'
  );

  const privateKey =
    requireNonEmptyString(
      signingKey.privateKey,
      'Loaded signing private key'
    );

  const sequenceManager =
    makeSequenceManager({
      statePath:
        sequenceStatePath
    });

  const nonceProvider =
    makeNonceProvider();

  const pipeline =
    makePipeline({
      operatorAddress,
      nodeId,
      privateKey,
      sequenceManager,
      nonceProvider,
      ...(options.ttlMs === undefined
        ? {}
        : {
            ttlMs: options.ttlMs
          })
    });

  const writer =
    makeWriter({
      outputPath,
      pipeline
    });

  const writeHeartbeat =
    requireFunction(
      writer.writeHeartbeat,
      'Local heartbeat writer'
    );

  return Object.freeze({
    keyPath:
      signingKey.keyPath,
    outputPath,
    sequenceStatePath,
    writeHeartbeat
  });
}

module.exports = Object.freeze({
  createLocalHeartbeatRuntime,
  defaultHeartbeatDirectory,
  defaultHeartbeatOutputPath,
  defaultSequenceStatePath
});
