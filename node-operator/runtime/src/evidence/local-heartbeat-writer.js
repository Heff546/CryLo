'use strict';

const path = require('node:path');

const {
  writeJsonAtomic
} = require('../atomic-file');

function requirePlainObject(value, name) {
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

function requireFunction(value, name) {
  if (typeof value !== 'function') {
    throw new TypeError(
      `${name} must be a function`
    );
  }

  return value;
}

function requirePath(value, name) {
  if (
    typeof value !== 'string' ||
    value.trim() === ''
  ) {
    throw new TypeError(
      `${name} must be a non-empty string`
    );
  }

  return path.resolve(value);
}

function createLocalHeartbeatWriter(options) {
  requirePlainObject(
    options,
    'Local heartbeat writer options'
  );

  requirePlainObject(
    options.pipeline,
    'Local heartbeat pipeline'
  );

  const createSignedHeartbeat =
    requireFunction(
      options.pipeline
        .createSignedHeartbeat,
      'Local heartbeat pipeline generator'
    );

  const outputPath =
    requirePath(
      options.outputPath,
      'Local heartbeat outputPath'
    );

  const writeJson =
    options.writeJson === undefined
      ? writeJsonAtomic
      : requireFunction(
          options.writeJson,
          'Local heartbeat JSON writer'
        );

  let writing = false;

  async function writeHeartbeat(status) {
    if (writing) {
      throw new Error(
        'Local heartbeat write is already in progress'
      );
    }

    writing = true;

    try {
      /*
       * Generate the complete signed artifact before
       * attempting any filesystem mutation.
       */
      const heartbeat =
        createSignedHeartbeat(status);

      await writeJson(
        outputPath,
        heartbeat
      );

      return heartbeat;
    } finally {
      writing = false;
    }
  }

  return Object.freeze({
    outputPath,
    writeHeartbeat
  });
}

module.exports = Object.freeze({
  createLocalHeartbeatWriter
});
