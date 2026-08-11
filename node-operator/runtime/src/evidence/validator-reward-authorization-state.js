'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { getAddress } = require('ethers');

const {
  writeJsonAtomic
} = require('../atomic-file');

const {
  canonicalHash
} = require('./hashing');

const {
  CONSENSUS_PENDING,
  CONSENSUS_QUALIFIED,
  CONSENSUS_UNQUALIFIED
} = require('./validator-consensus-state');

const STATE_VERSION = 1;

const AUTHORIZATION_AWAITING_CONTRACT_VERIFICATION =
  'AWAITING_CONTRACT_VERIFICATION';

const AUTHORIZATION_DENIED_BY_CONSENSUS =
  'DENIED_BY_CONSENSUS';

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

  return value;
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

function requireNonNegativeInteger(
  value,
  name
) {
  if (
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new TypeError(
      `${name} must be a non-negative safe integer`
    );
  }

  return value;
}

function requirePositiveInteger(
  value,
  name
) {
  if (
    !Number.isSafeInteger(value) ||
    value < 1
  ) {
    throw new TypeError(
      `${name} must be a positive safe integer`
    );
  }

  return value;
}

function normalizeAddress(
  value,
  name
) {
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

function requireCanonicalTime(
  value,
  name
) {
  requireNonEmptyString(
    value,
    name
  );

  const parsed =
    Date.parse(value);

  if (
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString() !==
      value
  ) {
    throw new TypeError(
      `${name} must be a canonical UTC timestamp`
    );
  }

  return value;
}

function defaultValidatorRewardAuthorizationPath() {
  return path.join(
    os.homedir(),
    '.config',
    'crylo-wallet',
    'operator',
    'verification',
    'validator-reward-authorization-state.json'
  );
}

function authorizationWindowKey(
  value
) {
  return [
    value.observedOperatorAddress
      .toLowerCase(),
    value.observedNodeId,
    value.windowStartedAt,
    value.windowEndedAt
  ].join('::');
}

function authorizationStatusForConsensus(
  consensus
) {
  if (consensus === CONSENSUS_QUALIFIED) {
    return AUTHORIZATION_AWAITING_CONTRACT_VERIFICATION;
  }

  if (consensus === CONSENSUS_UNQUALIFIED) {
    return AUTHORIZATION_DENIED_BY_CONSENSUS;
  }

  if (consensus === CONSENSUS_PENDING) {
    throw new Error(
      'Pending Validator consensus cannot enter reward authorization'
    );
  }

  throw new Error(
    'Unknown Validator consensus result'
  );
}

function normalizeFinalizedConsensus(
  consensusWindow
) {
  requirePlainObject(
    consensusWindow,
    'Finalized Validator consensus window'
  );

  if (consensusWindow.finalized !== true) {
    throw new Error(
      'Reward authorization requires finalized Validator consensus'
    );
  }

  const observedOperatorAddress =
    normalizeAddress(
      consensusWindow.observedOperatorAddress,
      'Reward authorization observed Operator address'
    );

  const observedNodeId =
    requireNonEmptyString(
      consensusWindow.observedNodeId,
      'Reward authorization observed node ID'
    );

  const windowStartedAt =
    requireCanonicalTime(
      consensusWindow.windowStartedAt,
      'Reward authorization windowStartedAt'
    );

  const windowEndedAt =
    requireCanonicalTime(
      consensusWindow.windowEndedAt,
      'Reward authorization windowEndedAt'
    );

  if (
    Date.parse(windowEndedAt) <=
    Date.parse(windowStartedAt)
  ) {
    throw new Error(
      'Reward authorization window end must follow its start'
    );
  }

  const minimumReports =
    requirePositiveInteger(
      consensusWindow.minimumReports,
      'Reward authorization minimumReports'
    );

  const reportCount =
    requireNonNegativeInteger(
      consensusWindow.reportCount,
      'Reward authorization reportCount'
    );

  const qualifiedCount =
    requireNonNegativeInteger(
      consensusWindow.qualifiedCount,
      'Reward authorization qualifiedCount'
    );

  const unqualifiedCount =
    requireNonNegativeInteger(
      consensusWindow.unqualifiedCount,
      'Reward authorization unqualifiedCount'
    );

  if (
    qualifiedCount +
      unqualifiedCount !==
    reportCount
  ) {
    throw new Error(
      'Reward authorization consensus counts are inconsistent'
    );
  }

  const consensus =
    consensusWindow.consensus;

  const authorizationStatus =
    authorizationStatusForConsensus(
      consensus
    );

  return Object.freeze({
    observedOperatorAddress,
    observedNodeId,
    windowStartedAt,
    windowEndedAt,
    minimumReports,
    reportCount,
    qualifiedCount,
    unqualifiedCount,
    consensus,
    authorizationStatus
  });
}

function authorizationIdForRecord(
  record
) {
  return canonicalHash({
    observedOperatorAddress:
      record.observedOperatorAddress,
    observedNodeId:
      record.observedNodeId,
    windowStartedAt:
      record.windowStartedAt,
    windowEndedAt:
      record.windowEndedAt,
    minimumReports:
      record.minimumReports,
    reportCount:
      record.reportCount,
    qualifiedCount:
      record.qualifiedCount,
    unqualifiedCount:
      record.unqualifiedCount,
    consensus:
      record.consensus,
    authorizationStatus:
      record.authorizationStatus
  });
}

function validateStoredAuthorizationRecord({
  windowKey,
  record
}) {
  requireNonEmptyString(
    windowKey,
    'Stored reward authorization window key'
  );

  requirePlainObject(
    record,
    'Stored reward authorization record'
  );

  const observedOperatorAddress =
    normalizeAddress(
      record.observedOperatorAddress,
      'Stored reward authorization observed Operator address'
    );

  const observedNodeId =
    requireNonEmptyString(
      record.observedNodeId,
      'Stored reward authorization observed node ID'
    );

  const windowStartedAt =
    requireCanonicalTime(
      record.windowStartedAt,
      'Stored reward authorization windowStartedAt'
    );

  const windowEndedAt =
    requireCanonicalTime(
      record.windowEndedAt,
      'Stored reward authorization windowEndedAt'
    );

  if (
    Date.parse(windowEndedAt) <=
    Date.parse(windowStartedAt)
  ) {
    throw new Error(
      'Stored reward authorization window end must follow its start'
    );
  }

  const minimumReports =
    requirePositiveInteger(
      record.minimumReports,
      'Stored reward authorization minimumReports'
    );

  const reportCount =
    requireNonNegativeInteger(
      record.reportCount,
      'Stored reward authorization reportCount'
    );

  const qualifiedCount =
    requireNonNegativeInteger(
      record.qualifiedCount,
      'Stored reward authorization qualifiedCount'
    );

  const unqualifiedCount =
    requireNonNegativeInteger(
      record.unqualifiedCount,
      'Stored reward authorization unqualifiedCount'
    );

  if (
    qualifiedCount +
      unqualifiedCount !==
    reportCount
  ) {
    throw new Error(
      'Stored reward authorization consensus counts are inconsistent'
    );
  }

  const consensus =
    record.consensus;

  if (
    consensus !== CONSENSUS_QUALIFIED &&
    consensus !== CONSENSUS_UNQUALIFIED
  ) {
    throw new Error(
      'Stored reward authorization consensus must be finalized'
    );
  }

  if (
    consensus === CONSENSUS_QUALIFIED &&
    qualifiedCount < minimumReports
  ) {
    throw new Error(
      'Stored qualified authorization lacks sufficient qualified reports'
    );
  }

  if (
    consensus === CONSENSUS_UNQUALIFIED &&
    unqualifiedCount < minimumReports
  ) {
    throw new Error(
      'Stored unqualified authorization lacks sufficient unqualified reports'
    );
  }

  const authorizationStatus =
    authorizationStatusForConsensus(
      consensus
    );

  if (
    record.authorizationStatus !==
      authorizationStatus
  ) {
    throw new Error(
      'Stored reward authorization status is inconsistent'
    );
  }

  const normalized = {
    observedOperatorAddress,
    observedNodeId,
    windowStartedAt,
    windowEndedAt,
    minimumReports,
    reportCount,
    qualifiedCount,
    unqualifiedCount,
    consensus,
    authorizationStatus
  };

  const expectedWindowKey =
    authorizationWindowKey(
      normalized
    );

  if (expectedWindowKey !== windowKey) {
    throw new Error(
      'Stored reward authorization window key does not match record contents'
    );
  }

  const authorizationId =
    requireNonEmptyString(
      record.authorizationId,
      'Stored reward authorization ID'
    );

  const expectedAuthorizationId =
    authorizationIdForRecord(
      normalized
    );

  if (
    authorizationId !==
      expectedAuthorizationId
  ) {
    throw new Error(
      'Stored reward authorization ID is inconsistent'
    );
  }

  return {
    authorizationId,
    ...normalized
  };
}

async function readState(
  statePath
) {
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
      !parsed.records ||
      typeof parsed.records !==
        'object' ||
      Array.isArray(parsed.records)
    ) {
      throw new Error(
        'Validator reward authorization state is invalid'
      );
    }

    const records = {};

    for (const [
      windowKey,
      record
    ] of Object.entries(
      parsed.records
    )) {
      records[windowKey] =
        validateStoredAuthorizationRecord({
          windowKey,
          record
        });
    }

    return {
      version:
        STATE_VERSION,
      records
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        version:
          STATE_VERSION,
        records: {}
      };
    }

    throw error;
  }
}

async function createValidatorRewardAuthorizationState(
  options = {}
) {
  requirePlainObject(
    options,
    'Validator reward authorization state options'
  );

  const statePath =
    path.resolve(
      options.statePath === undefined
        ? defaultValidatorRewardAuthorizationPath()
        : requireNonEmptyString(
            options.statePath,
            'Validator reward authorization state path'
          )
    );

  let state =
    await readState(
      statePath
    );

  async function persist() {
    await writeJsonAtomic(
      statePath,
      state
    );
  }

  async function recordConsensus(
    consensusWindow
  ) {
    const normalized =
      normalizeFinalizedConsensus(
        consensusWindow
      );

    const windowKey =
      authorizationWindowKey(
        normalized
      );

    if (state.records[windowKey]) {
      throw new Error(
        'Validator reward authorization window already recorded'
      );
    }

    const authorizationId =
      authorizationIdForRecord(
        normalized
      );

    const record =
      Object.freeze({
        authorizationId,
        ...normalized
      });

    state = {
      version:
        STATE_VERSION,

      records: {
        ...state.records,
        [windowKey]:
          record
      }
    };

    await persist();

    return record;
  }

  function getRecord(
    query
  ) {
    requirePlainObject(
      query,
      'Validator reward authorization query'
    );

    const normalized = {
      observedOperatorAddress:
        normalizeAddress(
          query.observedOperatorAddress,
          'Reward authorization observed Operator address'
        ),

      observedNodeId:
        requireNonEmptyString(
          query.observedNodeId,
          'Reward authorization observed node ID'
        ),

      windowStartedAt:
        requireCanonicalTime(
          query.windowStartedAt,
          'Reward authorization windowStartedAt'
        ),

      windowEndedAt:
        requireCanonicalTime(
          query.windowEndedAt,
          'Reward authorization windowEndedAt'
        )
    };

    const windowKey =
      authorizationWindowKey(
        normalized
      );

    const record =
      state.records[
        windowKey
      ];

    return record
      ? Object.freeze({
          windowKey,
          ...record
        })
      : null;
  }

  function getRecords() {
    return Object.entries(
      state.records
    ).map(
      ([windowKey, record]) =>
        Object.freeze({
          windowKey,
          ...record
        })
    );
  }

  return Object.freeze({
    statePath,
    recordConsensus,
    getRecord,
    getRecords
  });
}

module.exports = Object.freeze({
  STATE_VERSION,
  AUTHORIZATION_AWAITING_CONTRACT_VERIFICATION,
  AUTHORIZATION_DENIED_BY_CONSENSUS,
  authorizationWindowKey,
  authorizationStatusForConsensus,
  authorizationIdForRecord,
  validateStoredAuthorizationRecord,
  normalizeFinalizedConsensus,
  createValidatorRewardAuthorizationState,
  defaultValidatorRewardAuthorizationPath
});
