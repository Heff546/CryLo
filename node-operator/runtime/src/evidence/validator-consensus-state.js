'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { getAddress } = require('ethers');

const {
  writeJsonAtomic
} = require('../atomic-file');

const STATE_VERSION = 1;

const CONSENSUS_PENDING =
  'PENDING';

const CONSENSUS_QUALIFIED =
  'QUALIFIED';

const CONSENSUS_UNQUALIFIED =
  'UNQUALIFIED';

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

function defaultValidatorConsensusPath() {
  return path.join(
    os.homedir(),
    '.config',
    'crylo-wallet',
    'operator',
    'verification',
    'validator-consensus-state.json'
  );
}

function consensusWindowKey(
  report
) {
  return [
    report.observedOperatorAddress
      .toLowerCase(),
    report.observedNodeId,
    report.windowStartedAt,
    report.windowEndedAt
  ].join('::');
}

function determineConsensus({
  qualifiedCount,
  unqualifiedCount,
  minimumReports
}) {
  if (
    qualifiedCount >= minimumReports
  ) {
    return CONSENSUS_QUALIFIED;
  }

  if (
    unqualifiedCount >= minimumReports
  ) {
    return CONSENSUS_UNQUALIFIED;
  }

  return CONSENSUS_PENDING;
}

function validateStoredWindow({
  windowKey,
  window,
  minimumReports
}) {
  requireNonEmptyString(
    windowKey,
    'Stored Validator consensus window key'
  );

  requirePlainObject(
    window,
    'Stored Validator consensus window'
  );

  const observedOperatorAddress =
    normalizeAddress(
      window.observedOperatorAddress,
      'Stored consensus observed Operator address'
    );

  const observedNodeId =
    requireNonEmptyString(
      window.observedNodeId,
      'Stored consensus observed node ID'
    );

  const windowStartedAt =
    requireCanonicalTime(
      window.windowStartedAt,
      'Stored consensus windowStartedAt'
    );

  const windowEndedAt =
    requireCanonicalTime(
      window.windowEndedAt,
      'Stored consensus windowEndedAt'
    );

  if (
    Date.parse(windowEndedAt) <=
    Date.parse(windowStartedAt)
  ) {
    throw new Error(
      'Stored consensus window end must follow its start'
    );
  }

  if (
    window.minimumReports !==
      minimumReports
  ) {
    throw new Error(
      'Stored Validator consensus minimumReports does not match runtime policy'
    );
  }

  requirePlainObject(
    window.reporters,
    'Stored Validator consensus reporters'
  );

  const normalizedForKey = {
    observedOperatorAddress,
    observedNodeId,
    windowStartedAt,
    windowEndedAt
  };

  const expectedWindowKey =
    consensusWindowKey(
      normalizedForKey
    );

  if (expectedWindowKey !== windowKey) {
    throw new Error(
      'Stored Validator consensus window key does not match window contents'
    );
  }

  const reporterEntries =
    Object.entries(
      window.reporters
    );

  let qualifiedCount = 0;
  let unqualifiedCount = 0;

  const normalizedReporters = {};

  for (const [
    reporterKey,
    reporter
  ] of reporterEntries) {
    requirePlainObject(
      reporter,
      'Stored Validator consensus reporter'
    );

    const reportingOperatorAddress =
      normalizeAddress(
        reporter.reportingOperatorAddress,
        'Stored consensus reporting Operator address'
      );

    const expectedReporterKey =
      reportingOperatorAddress
        .toLowerCase();

    if (reporterKey !== expectedReporterKey) {
      throw new Error(
        'Stored Validator consensus reporter key does not match reporting address'
      );
    }

    const reportingNodeId =
      requireNonEmptyString(
        reporter.reportingNodeId,
        'Stored consensus reporting node ID'
      );

    const reportHash =
      requireNonEmptyString(
        reporter.reportHash,
        'Stored consensus report hash'
      );

    if (
      typeof reporter.locallyQualified !==
      'boolean'
    ) {
      throw new TypeError(
        'Stored consensus locallyQualified must be boolean'
      );
    }

    if (reporter.locallyQualified) {
      qualifiedCount += 1;
    } else {
      unqualifiedCount += 1;
    }

    normalizedReporters[
      expectedReporterKey
    ] = {
      reportHash,
      reportingOperatorAddress,
      reportingNodeId,
      locallyQualified:
        reporter.locallyQualified
    };
  }

  const reportCount =
    reporterEntries.length;

  if (
    window.reportCount !==
      reportCount
  ) {
    throw new Error(
      'Stored Validator consensus reportCount is inconsistent'
    );
  }

  if (
    window.qualifiedCount !==
      qualifiedCount
  ) {
    throw new Error(
      'Stored Validator consensus qualifiedCount is inconsistent'
    );
  }

  if (
    window.unqualifiedCount !==
      unqualifiedCount
  ) {
    throw new Error(
      'Stored Validator consensus unqualifiedCount is inconsistent'
    );
  }

  if (
    qualifiedCount +
      unqualifiedCount !==
    reportCount
  ) {
    throw new Error(
      'Stored Validator consensus vote counts are inconsistent'
    );
  }

  const expectedConsensus =
    determineConsensus({
      qualifiedCount,
      unqualifiedCount,
      minimumReports
    });

  if (
    window.consensus !==
      expectedConsensus
  ) {
    throw new Error(
      'Stored Validator consensus result is inconsistent'
    );
  }

  const expectedFinalized =
    expectedConsensus !==
      CONSENSUS_PENDING;

  if (
    window.finalized !==
      expectedFinalized
  ) {
    throw new Error(
      'Stored Validator consensus finalized flag is inconsistent'
    );
  }

  return {
    observedOperatorAddress,
    observedNodeId,
    windowStartedAt,
    windowEndedAt,
    minimumReports,
    reportCount,
    qualifiedCount,
    unqualifiedCount,
    consensus:
      expectedConsensus,
    finalized:
      expectedFinalized,
    reporters:
      normalizedReporters
  };
}

async function readState(
  statePath,
  minimumReports
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
      parsed.minimumReports !==
        minimumReports ||
      !parsed.windows ||
      typeof parsed.windows !==
        'object' ||
      Array.isArray(parsed.windows)
    ) {
      throw new Error(
        'Validator consensus state is invalid'
      );
    }

    const windows = {};

    for (const [
      windowKey,
      window
    ] of Object.entries(
      parsed.windows
    )) {
      windows[windowKey] =
        validateStoredWindow({
          windowKey,
          window,
          minimumReports
        });
    }

    return {
      version:
        STATE_VERSION,
      minimumReports,
      windows
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        version:
          STATE_VERSION,
        minimumReports,
        windows: {}
      };
    }

    throw error;
  }
}

async function createValidatorConsensusState(
  options
) {
  requirePlainObject(
    options,
    'Validator consensus state options'
  );

  const minimumReports =
    requirePositiveInteger(
      options.minimumReports,
      'Validator consensus minimumReports'
    );

  const statePath =
    path.resolve(
      options.statePath === undefined
        ? defaultValidatorConsensusPath()
        : requireNonEmptyString(
            options.statePath,
            'Validator consensus state path'
          )
    );

  let state =
    await readState(
      statePath,
      minimumReports
    );

  async function persist() {
    await writeJsonAtomic(
      statePath,
      state
    );
  }

  function getWindowByKey(
    windowKey
  ) {
    const value =
      state.windows[windowKey];

    return value || null;
  }

  async function acceptReport(
    acceptedReport
  ) {
    requirePlainObject(
      acceptedReport,
      'Accepted Validator report'
    );

    const reportingOperatorAddress =
      normalizeAddress(
        acceptedReport
          .reportingOperatorAddress,
        'Consensus reporting Operator address'
      );

    const observedOperatorAddress =
      normalizeAddress(
        acceptedReport
          .observedOperatorAddress,
        'Consensus observed Operator address'
      );

    const reportingNodeId =
      requireNonEmptyString(
        acceptedReport.reportingNodeId,
        'Consensus reporting node ID'
      );

    const observedNodeId =
      requireNonEmptyString(
        acceptedReport.observedNodeId,
        'Consensus observed node ID'
      );

    const reportHash =
      requireNonEmptyString(
        acceptedReport.reportHash,
        'Consensus report hash'
      );

    const windowStartedAt =
      requireCanonicalTime(
        acceptedReport.windowStartedAt,
        'Consensus windowStartedAt'
      );

    const windowEndedAt =
      requireCanonicalTime(
        acceptedReport.windowEndedAt,
        'Consensus windowEndedAt'
      );

    if (
      Date.parse(windowEndedAt) <=
      Date.parse(windowStartedAt)
    ) {
      throw new Error(
        'Consensus window end must follow its start'
      );
    }

    if (
      typeof acceptedReport
        .locallyQualified !==
      'boolean'
    ) {
      throw new TypeError(
        'Consensus locallyQualified must be boolean'
      );
    }

    const normalized = {
      reportHash,
      reportingOperatorAddress,
      reportingNodeId,
      observedOperatorAddress,
      observedNodeId,
      windowStartedAt,
      windowEndedAt,
      locallyQualified:
        acceptedReport.locallyQualified
    };

    const windowKey =
      consensusWindowKey(
        normalized
      );

    const existing =
      getWindowByKey(
        windowKey
      );

    if (
      existing &&
      existing.consensus !==
        CONSENSUS_PENDING
    ) {
      throw new Error(
        'Validator consensus window is already finalized'
      );
    }

    const reporters =
      existing
        ? {
            ...existing.reporters
          }
        : {};

    const reporterKey =
      reportingOperatorAddress
        .toLowerCase();

    if (reporters[reporterKey]) {
      throw new Error(
        'Validator consensus reporter already submitted for this window'
      );
    }

    reporters[reporterKey] = {
      reportHash,
      reportingOperatorAddress,
      reportingNodeId,
      locallyQualified:
        acceptedReport.locallyQualified
    };

    const votes =
      Object.values(
        reporters
      );

    const qualifiedCount =
      votes.filter(
        report =>
          report.locallyQualified ===
            true
      ).length;

    const unqualifiedCount =
      votes.length -
      qualifiedCount;

    const consensus =
      determineConsensus({
        qualifiedCount,
        unqualifiedCount,
        minimumReports
      });

    const windowState = {
      observedOperatorAddress,
      observedNodeId,
      windowStartedAt,
      windowEndedAt,
      minimumReports,
      reportCount:
        votes.length,
      qualifiedCount,
      unqualifiedCount,
      consensus,
      finalized:
        consensus !== CONSENSUS_PENDING,
      reporters
    };

    state = {
      version: STATE_VERSION,
      minimumReports,
      windows: {
        ...state.windows,
        [windowKey]:
          windowState
      }
    };

    await persist();

    return Object.freeze({
      windowKey,
      ...windowState
    });
  }

  function getWindow(
    query
  ) {
    requirePlainObject(
      query,
      'Validator consensus window query'
    );

    const normalized = {
      observedOperatorAddress:
        normalizeAddress(
          query.observedOperatorAddress,
          'Consensus observed Operator address'
        ),

      observedNodeId:
        requireNonEmptyString(
          query.observedNodeId,
          'Consensus observed node ID'
        ),

      windowStartedAt:
        requireCanonicalTime(
          query.windowStartedAt,
          'Consensus windowStartedAt'
        ),

      windowEndedAt:
        requireCanonicalTime(
          query.windowEndedAt,
          'Consensus windowEndedAt'
        )
    };

    const windowKey =
      consensusWindowKey(
        normalized
      );

    const value =
      getWindowByKey(
        windowKey
      );

    return value
      ? Object.freeze({
          windowKey,
          ...value
        })
      : null;
  }

  function getWindows() {
    return Object.entries(
      state.windows
    ).map(
      ([windowKey, value]) =>
        Object.freeze({
          windowKey,
          ...value
        })
    );
  }

  return Object.freeze({
    statePath,
    minimumReports,
    acceptReport,
    getWindow,
    getWindows
  });
}

module.exports = Object.freeze({
  STATE_VERSION,
  CONSENSUS_PENDING,
  CONSENSUS_QUALIFIED,
  CONSENSUS_UNQUALIFIED,
  determineConsensus,
  consensusWindowKey,
  validateStoredWindow,
  createValidatorConsensusState,
  defaultValidatorConsensusPath
});
