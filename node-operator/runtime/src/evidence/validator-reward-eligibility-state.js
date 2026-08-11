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
  CONTRACT_VERIFIED,
  CONTRACT_REJECTED
} = require(
  './validator-contract-verification'
);

const STATE_VERSION = 1;

const REWARD_ELIGIBLE =
  'REWARD_ELIGIBLE';

const REWARD_INELIGIBLE =
  'REWARD_INELIGIBLE';

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

function defaultRewardEligibilityStatePath() {
  return path.join(
    os.homedir(),
    '.config',
    'crylo-wallet',
    'operator',
    'validator-verification',
    'validator-reward-eligibility-state.json'
  );
}

function eligibilityForVerification(
  outcome
) {
  if (outcome === CONTRACT_VERIFIED) {
    return REWARD_ELIGIBLE;
  }

  if (outcome === CONTRACT_REJECTED) {
    return REWARD_INELIGIBLE;
  }

  throw new Error(
    'Unknown Validator contract verification outcome'
  );
}

function eligibilityDecisionId(
  record
) {
  return canonicalHash({
    schemaVersion:
      1,

    authorizationId:
      record.authorizationId,

    verificationId:
      record.verificationId,

    observedOperatorAddress:
      record.observedOperatorAddress,

    observedNodeId:
      record.observedNodeId,

    windowStartedAt:
      record.windowStartedAt,

    windowEndedAt:
      record.windowEndedAt,

    contractOutcome:
      record.contractOutcome,

    contractReasonCode:
      record.contractReasonCode,

    rewardEligibility:
      record.rewardEligibility
  });
}

function normalizeEligibilityRecord(
  verification
) {
  requirePlainObject(
    verification,
    'Validator contract verification record'
  );

  const authorizationId =
    requireNonEmptyString(
      verification.authorizationId,
      'Reward eligibility authorization ID'
    );

  const verificationId =
    requireNonEmptyString(
      verification.verificationId,
      'Reward eligibility verification ID'
    );

  const observedOperatorAddress =
    getAddress(
      requireNonEmptyString(
        verification.observedOperatorAddress,
        'Reward eligibility observed Operator address'
      )
    );

  const observedNodeId =
    requireNonEmptyString(
      verification.observedNodeId,
      'Reward eligibility observed node ID'
    );

  const windowStartedAt =
    requireCanonicalTime(
      verification.windowStartedAt,
      'Reward eligibility windowStartedAt'
    );

  const windowEndedAt =
    requireCanonicalTime(
      verification.windowEndedAt,
      'Reward eligibility windowEndedAt'
    );

  if (
    Date.parse(windowEndedAt) <=
    Date.parse(windowStartedAt)
  ) {
    throw new Error(
      'Reward eligibility window end must follow its start'
    );
  }

  const contractOutcome =
    verification.outcome;

  const rewardEligibility =
    eligibilityForVerification(
      contractOutcome
    );

  const normalized = {
    schemaVersion:
      1,

    authorizationId,

    verificationId,

    observedOperatorAddress,

    observedNodeId,

    windowStartedAt,

    windowEndedAt,

    contractOutcome,

    contractReasonCode:
      requireNonEmptyString(
        verification.reasonCode,
        'Reward eligibility contract reason code'
      ),

    rewardEligibility
  };

  return Object.freeze({
    ...normalized,

    decisionId:
      eligibilityDecisionId(
        normalized
      )
  });
}

async function readState(
  statePath
) {
  try {
    const raw =
      await fs.readFile(
        statePath,
        'utf8'
      );

    const parsed =
      JSON.parse(raw);

    requirePlainObject(
      parsed,
      'Validator reward eligibility state'
    );

    if (
      parsed.stateVersion !==
      STATE_VERSION
    ) {
      throw new Error(
        'Unsupported Validator reward eligibility state version'
      );
    }

    requirePlainObject(
      parsed.records,
      'Validator reward eligibility records'
    );

    const records = {};

    for (const [
      authorizationId,
      persisted
    ] of Object.entries(
      parsed.records
    )) {
      const normalized =
        normalizeEligibilityRecord({
          authorizationId:
            persisted.authorizationId,

          verificationId:
            persisted.verificationId,

          observedOperatorAddress:
            persisted.observedOperatorAddress,

          observedNodeId:
            persisted.observedNodeId,

          windowStartedAt:
            persisted.windowStartedAt,

          windowEndedAt:
            persisted.windowEndedAt,

          outcome:
            persisted.contractOutcome,

          reasonCode:
            persisted.contractReasonCode
        });

      if (
        authorizationId !==
        normalized.authorizationId
      ) {
        throw new Error(
          'Persisted reward eligibility authorization key mismatch'
        );
      }

      if (
        persisted.rewardEligibility !==
        normalized.rewardEligibility
      ) {
        throw new Error(
          'Persisted reward eligibility result mismatch'
        );
      }

      if (
        persisted.decisionId !==
        normalized.decisionId
      ) {
        throw new Error(
          'Persisted reward eligibility decision ID mismatch'
        );
      }

      records[
        authorizationId
      ] = normalized;
    }

    return records;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {};
    }

    throw error;
  }
}

async function createValidatorRewardEligibilityState(
  options = {}
) {
  requirePlainObject(
    options,
    'Validator reward eligibility state options'
  );

  const statePath =
    options.statePath === undefined
      ? defaultRewardEligibilityStatePath()
      : requireNonEmptyString(
          options.statePath,
          'Validator reward eligibility state path'
        );

  let records =
    await readState(
      statePath
    );

  async function persist() {
    await writeJsonAtomic(
      statePath,
      {
        stateVersion:
          STATE_VERSION,
        records
      }
    );
  }

  async function recordVerification(
    verification
  ) {
    const record =
      normalizeEligibilityRecord(
        verification
      );

    if (
      records[
        record.authorizationId
      ] !== undefined
    ) {
      throw new Error(
        'Validator reward eligibility decision already exists for authorization'
      );
    }

    records = {
      ...records,

      [record.authorizationId]:
        record
    };

    await persist();

    return record;
  }

  function getDecision(
    authorizationId
  ) {
    requireNonEmptyString(
      authorizationId,
      'Reward eligibility authorization ID'
    );

    return (
      records[
        authorizationId
      ] || null
    );
  }

  function listDecisions() {
    return Object.freeze(
      Object.values(
        records
      )
    );
  }

  return Object.freeze({
    statePath,
    recordVerification,
    getDecision,
    listDecisions
  });
}

module.exports = Object.freeze({
  STATE_VERSION,
  REWARD_ELIGIBLE,
  REWARD_INELIGIBLE,
  eligibilityForVerification,
  eligibilityDecisionId,
  createValidatorRewardEligibilityState,
  defaultRewardEligibilityStatePath
});
