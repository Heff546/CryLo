'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { getAddress } = require('ethers');

const {
  writeJsonAtomic
} = require('../atomic-file');

const {
  verifySignedOperatorUptimeReport
} = require('./signed-operator-uptime-report');

const STATE_VERSION = 1;

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

function normalizeAddress(value, name) {
  try {
    return getAddress(
      requireNonEmptyString(
        value,
        name
      )
    );
  } catch (error) {
    throw new TypeError(
      `${name} must be a valid EVM address`,
      { cause: error }
    );
  }
}

function defaultValidatorReportReplayPath() {
  return path.join(
    os.homedir(),
    '.config',
    'crylo-wallet',
    'operator',
    'verification',
    'validator-report-replay-state.json'
  );
}

function reportWindowKey(verified) {
  return [
    verified.reportingOperatorAddress
      .toLowerCase(),
    verified.reportingNodeId,
    verified.observedOperatorAddress
      .toLowerCase(),
    verified.observedNodeId,
    verified.windowStartedAt,
    verified.windowEndedAt
  ].join('::');
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
      !parsed.reportHashes ||
      typeof parsed.reportHashes !==
        'object' ||
      Array.isArray(parsed.reportHashes) ||
      !parsed.windows ||
      typeof parsed.windows !==
        'object' ||
      Array.isArray(parsed.windows)
    ) {
      throw new Error(
        'Validator report replay state is invalid'
      );
    }

    return parsed;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        version: STATE_VERSION,
        reportHashes: {},
        windows: {}
      };
    }

    throw error;
  }
}

async function createValidatorReportReplayState(
  options = {}
) {
  requirePlainObject(
    options,
    'Validator report replay options'
  );

  const statePath =
    path.resolve(
      options.statePath === undefined
        ? defaultValidatorReportReplayPath()
        : requireNonEmptyString(
            options.statePath,
            'Validator report replay state path'
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

  async function acceptReport(
    signedReport
  ) {
    requirePlainObject(
      signedReport,
      'Signed Operator uptime report'
    );

    /*
     * Cryptographic and structural verification happens
     * before replay state is inspected or modified.
     */
    const verified =
      verifySignedOperatorUptimeReport(
        signedReport
      );

    const reportHash =
      requireNonEmptyString(
        verified.reportHash,
        'Verified Operator report hash'
      );

    if (state.reportHashes[reportHash]) {
      throw new Error(
        'Operator uptime report replay detected'
      );
    }

    const windowKey =
      reportWindowKey(verified);

    if (state.windows[windowKey]) {
      throw new Error(
        'Operator uptime report window already accepted'
      );
    }

    const accepted = Object.freeze({
      reportHash,
      reportingOperatorAddress:
        normalizeAddress(
          verified.reportingOperatorAddress,
          'Reporting Operator address'
        ),
      reportingNodeId:
        verified.reportingNodeId,
      reportingSessionAddress:
        normalizeAddress(
          verified.reportingSessionAddress,
          'Reporting session address'
        ),
      observedOperatorAddress:
        normalizeAddress(
          verified.observedOperatorAddress,
          'Observed Operator address'
        ),
      observedNodeId:
        verified.observedNodeId,
      windowStartedAt:
        verified.windowStartedAt,
      windowEndedAt:
        verified.windowEndedAt,
      locallyQualified:
        verified.locallyQualified
    });

    state = {
      version: STATE_VERSION,

      reportHashes: {
        ...state.reportHashes,
        [reportHash]: {
          windowKey
        }
      },

      windows: {
        ...state.windows,
        [windowKey]: accepted
      }
    };

    await persist();

    return accepted;
  }

  function hasReportHash(reportHash) {
    return Boolean(
      state.reportHashes[
        requireNonEmptyString(
          reportHash,
          'Operator report hash'
        )
      ]
    );
  }

  function getAcceptedReports() {
    return Object.values(
      state.windows
    );
  }

  return Object.freeze({
    statePath,
    acceptReport,
    hasReportHash,
    getAcceptedReports
  });
}

module.exports = Object.freeze({
  STATE_VERSION,
  createValidatorReportReplayState,
  defaultValidatorReportReplayPath
});
