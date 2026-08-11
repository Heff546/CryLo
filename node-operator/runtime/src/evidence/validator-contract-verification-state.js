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
} = require('./validator-contract-verification');

const STATE_VERSION = 1;

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

function defaultStatePath() {
  return path.join(
    os.homedir(),
    '.config',
    'crylo-wallet',
    'operator',
    'validator-verification',
    'validator-contract-verification-state.json'
  );
}

function buildVerificationId(
  record
) {
  return canonicalHash({
    schemaVersion:
      1,
    authorizationId:
      record.authorizationId,
    observedOperatorAddress:
      record.observedOperatorAddress,
    observedNodeId:
      record.observedNodeId,
    windowStartedAt:
      record.windowStartedAt,
    windowEndedAt:
      record.windowEndedAt,
    outcome:
      record.outcome,
    reasonCode:
      record.reasonCode,
    nodeTier:
      record.nodeTier,
    stakeAtomic:
      record.stakeAtomic,
    stakeRequirementAtomic:
      record.stakeRequirementAtomic
  });
}

function normalizeVerificationRecord(
  record
) {
  requirePlainObject(
    record,
    'Validator contract verification record'
  );

  const authorizationId =
    requireNonEmptyString(
      record.authorizationId,
      'Authorization ID'
    );

  const observedOperatorAddress =
    getAddress(
      requireNonEmptyString(
        record.observedOperatorAddress,
        'Observed Operator address'
      )
    );

  const observedNodeId =
    requireNonEmptyString(
      record.observedNodeId,
      'Observed node ID'
    );

  const windowStartedAt =
    requireCanonicalTime(
      record.windowStartedAt,
      'Window start'
    );

  const windowEndedAt =
    requireCanonicalTime(
      record.windowEndedAt,
      'Window end'
    );

  if (
    Date.parse(windowEndedAt) <=
    Date.parse(windowStartedAt)
  ) {
    throw new Error(
      'Validator contract verification window end must follow its start'
    );
  }

  if (
    record.outcome !== CONTRACT_VERIFIED &&
    record.outcome !== CONTRACT_REJECTED
  ) {
    throw new Error(
      'Validator contract verification outcome is invalid'
    );
  }

  const normalized =
    {
      schemaVersion:
        1,

      authorizationId,

      observedOperatorAddress,

      observedNodeId,

      windowStartedAt,

      windowEndedAt,

      outcome:
        record.outcome,

      reasonCode:
        requireNonEmptyString(
          record.reasonCode,
          'Contract verification reason code'
        ),

      nodeTier:
        String(
          record.nodeTier
        ),

      nodeTierLabel:
        record.nodeTierLabel === undefined ||
        record.nodeTierLabel === null
          ? null
          : String(
              record.nodeTierLabel
            ),

      stakeAtomic:
        String(
          record.stakeAtomic
        ),

      stakeRequirementAtomic:
        record.stakeRequirementAtomic === null
          ? null
          : String(
              record.stakeRequirementAtomic
            ),

      registered:
        record.registered === true,

      nodeWallet:
        record.nodeWallet === true,

      stakeRequirementMet:
        record.stakeRequirementMet === true
    };

  return Object.freeze({
    ...normalized,

    verificationId:
      buildVerificationId(
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
      'Validator contract verification state'
    );

    if (
      parsed.stateVersion !==
      STATE_VERSION
    ) {
      throw new Error(
        'Unsupported Validator contract verification state version'
      );
    }

    requirePlainObject(
      parsed.records,
      'Validator contract verification records'
    );

    const records = {};

    for (
      const [
        authorizationId,
        persisted
      ] of Object.entries(
        parsed.records
      )
    ) {
      const normalized =
        normalizeVerificationRecord(
          persisted
        );

      if (
        authorizationId !==
        normalized.authorizationId
      ) {
        throw new Error(
          'Persisted Validator contract verification authorization key mismatch'
        );
      }

      if (
        persisted.verificationId !==
        normalized.verificationId
      ) {
        throw new Error(
          'Persisted Validator contract verification ID mismatch'
        );
      }

      records[
        authorizationId
      ] = normalized;
    }

    return records;
  } catch (error) {
    if (
      error &&
      error.code === 'ENOENT'
    ) {
      return {};
    }

    throw error;
  }
}

async function createValidatorContractVerificationState(
  options = {}
) {
  requirePlainObject(
    options,
    'Validator contract verification state options'
  );

  const statePath =
    options.statePath === undefined
      ? defaultStatePath()
      : requireNonEmptyString(
          options.statePath,
          'Validator contract verification state path'
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
    authorization,
    verification
  ) {
    requirePlainObject(
      authorization,
      'Validator reward authorization'
    );

    requirePlainObject(
      verification,
      'Validator contract verification result'
    );

    const authorizationId =
      requireNonEmptyString(
        authorization.authorizationId,
        'Authorization ID'
      );

    if (
      records[
        authorizationId
      ] !== undefined
    ) {
      throw new Error(
        'Validator contract verification already exists for authorization'
      );
    }

    const record =
      normalizeVerificationRecord({
        authorizationId,

        observedOperatorAddress:
          authorization.observedOperatorAddress,

        observedNodeId:
          authorization.observedNodeId,

        windowStartedAt:
          authorization.windowStartedAt,

        windowEndedAt:
          authorization.windowEndedAt,

        outcome:
          verification.outcome,

        reasonCode:
          verification.reasonCode,

        nodeTier:
          verification.nodeTier,

        nodeTierLabel:
          verification.nodeTierLabel,

        stakeAtomic:
          verification.stakeAtomic,

        stakeRequirementAtomic:
          verification
            .stakeRequirementAtomic,

        registered:
          verification.registered,

        nodeWallet:
          verification.nodeWallet,

        stakeRequirementMet:
          verification
            .stakeRequirementMet
      });

    records = {
      ...records,
      [authorizationId]:
        record
    };

    await persist();

    return record;
  }

  function getVerification(
    authorizationId
  ) {
    requireNonEmptyString(
      authorizationId,
      'Authorization ID'
    );

    return (
      records[
        authorizationId
      ] || null
    );
  }

  function listVerifications() {
    return Object.freeze(
      Object.values(
        records
      )
    );
  }

  return Object.freeze({
    statePath,
    recordVerification,
    getVerification,
    listVerifications
  });
}

module.exports = Object.freeze({
  STATE_VERSION,
  createValidatorContractVerificationState
});
