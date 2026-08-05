'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PROTOCOL_VERSION = '1.0.0';
const INITIAL_NEXT_SEQUENCE = 0;
const STATE_FIELDS = Object.freeze([
  'nextSequence',
  'protocolVersion'
]);

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

function assertStatePath(statePath) {
  if (typeof statePath !== 'string' || statePath.trim() === '') {
    throw new TypeError('Sequence state path must be a non-empty string');
  }

  return path.resolve(statePath);
}

function validateSequenceState(state) {
  if (!isPlainObject(state)) {
    throw new TypeError('Sequence state must be a plain object');
  }

  const fields = Object.keys(state).sort();

  if (
    fields.length !== STATE_FIELDS.length ||
    fields.some((field, index) => field !== STATE_FIELDS[index])
  ) {
    throw new TypeError(
      'Sequence state must contain exactly protocolVersion and nextSequence'
    );
  }

  if (state.protocolVersion !== PROTOCOL_VERSION) {
    throw new RangeError(
      `Unsupported sequence state protocol version: ${state.protocolVersion}`
    );
  }

  if (
    !Number.isSafeInteger(state.nextSequence) ||
    state.nextSequence < 0
  ) {
    throw new RangeError(
      'Sequence state nextSequence must be a non-negative safe integer'
    );
  }

  return Object.freeze({
    protocolVersion: state.protocolVersion,
    nextSequence: state.nextSequence
  });
}

function initialSequenceState() {
  return Object.freeze({
    protocolVersion: PROTOCOL_VERSION,
    nextSequence: INITIAL_NEXT_SEQUENCE
  });
}

function readSequenceState(statePath) {
  const resolvedPath = assertStatePath(statePath);

  let serialized;

  try {
    serialized = fs.readFileSync(resolvedPath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return initialSequenceState();
    }

    throw error;
  }

  let parsed;

  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new Error(
      `Sequence state contains malformed JSON: ${resolvedPath}`,
      { cause: error }
    );
  }

  return validateSequenceState(parsed);
}

function fsyncDirectory(directoryPath) {
  let descriptor;

  try {
    descriptor = fs.openSync(directoryPath, 'r');
    fs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) {
      fs.closeSync(descriptor);
    }
  }
}

function writeSequenceStateAtomic(statePath, state) {
  const resolvedPath = assertStatePath(statePath);
  const normalizedState = validateSequenceState(state);
  const directoryPath = path.dirname(resolvedPath);
  const filename = path.basename(resolvedPath);

  fs.mkdirSync(directoryPath, {
    recursive: true,
    mode: 0o700
  });

  const temporaryPath = path.join(
    directoryPath,
    `.${filename}.${process.pid}.${Date.now()}.${Math.random()
      .toString(16)
      .slice(2)}.tmp`
  );

  const serialized = `${JSON.stringify(normalizedState, null, 2)}\n`;
  let descriptor;

  try {
    descriptor = fs.openSync(
      temporaryPath,
      fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        fs.constants.O_WRONLY,
      0o600
    );

    fs.writeFileSync(descriptor, serialized, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;

    fs.renameSync(temporaryPath, resolvedPath);
    fsyncDirectory(directoryPath);
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // Preserve the original error.
      }
    }

    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch {
      // Preserve the original error.
    }

    throw error;
  }

  return normalizedState;
}

function acquireSequenceLock(statePath) {
  const lockPath = `${statePath}.lock`;

  try {
    fs.mkdirSync(lockPath, {
      recursive: false,
      mode: 0o700
    });
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      throw new Error(
        `Sequence state is locked by another allocator: ${statePath}`
      );
    }

    throw error;
  }

  return lockPath;
}

function releaseSequenceLock(lockPath) {
  fs.rmdirSync(lockPath);
}

function createSequenceManager(options) {
  if (!isPlainObject(options)) {
    throw new TypeError('Sequence manager options must be a plain object');
  }

  const statePath = assertStatePath(options.statePath);

  function peekNextSequence() {
    return readSequenceState(statePath).nextSequence;
  }

  function allocateNextSequence() {
    fs.mkdirSync(path.dirname(statePath), {
      recursive: true,
      mode: 0o700
    });

    const lockPath = acquireSequenceLock(statePath);

    try {
      const currentState = readSequenceState(statePath);

      if (currentState.nextSequence >= Number.MAX_SAFE_INTEGER) {
        throw new RangeError('Sequence allocation is exhausted');
      }

      const allocatedSequence = currentState.nextSequence;

      writeSequenceStateAtomic(statePath, {
        protocolVersion: PROTOCOL_VERSION,
        nextSequence: allocatedSequence + 1
      });

      return allocatedSequence;
    } finally {
      releaseSequenceLock(lockPath);
    }
  }

  return Object.freeze({
    statePath,
    peekNextSequence,
    allocateNextSequence
  });
}

module.exports = Object.freeze({
  INITIAL_NEXT_SEQUENCE,
  PROTOCOL_VERSION,
  createSequenceManager,
  initialSequenceState,
  readSequenceState,
  validateSequenceState,
  writeSequenceStateAtomic
});
