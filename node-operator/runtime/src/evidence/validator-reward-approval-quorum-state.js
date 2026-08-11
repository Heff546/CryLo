'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  getAddress
} = require('ethers');

const {
  writeJsonAtomic
} = require('../atomic-file');

const {
  canonicalHash
} = require('./hashing');

const {
  verifySignedValidatorRewardApproval
} = require(
  './signed-validator-reward-approval'
);

const {
  verifyValidatorRewardApprovalAuthorization
} = require(
  './validator-reward-approval-authorization'
);

const {
  REWARD_ELIGIBLE,
  REWARD_INELIGIBLE
} = require(
  './validator-reward-eligibility-state'
);

const STATE_VERSION = 1;

const QUORUM_PENDING =
  'PENDING';

const QUORUM_APPROVED =
  'APPROVED';

const QUORUM_REJECTED =
  'REJECTED';

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

function requirePositiveInteger(
  value,
  name
) {
  if (
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    throw new TypeError(
      `${name} must be a positive safe integer`
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
      {
        cause:
          error
      }
    );
  }
}

function defaultStatePath() {
  return path.join(
    os.homedir(),
    '.config',
    'crylo-wallet',
    'operator',
    'verification',
    'validator-reward-approval-quorum-state.json'
  );
}

function windowKey(
  value
) {
  return [
    value.observedOperatorAddress
      .toLowerCase(),

    value.observedNodeId,

    value.windowStartedAt,

    value.windowEndedAt
  ].join('|');
}

function lineageFromApproval(
  approval
) {
  return Object.freeze({
    observedOperatorAddress:
      normalizeAddress(
        approval.observedOperatorAddress,
        'Approved observed Operator address'
      ),

    observedNodeId:
      requireNonEmptyString(
        approval.observedNodeId,
        'Approved observed node ID'
      ),

    windowStartedAt:
      requireNonEmptyString(
        approval.windowStartedAt,
        'Approved window start'
      ),

    windowEndedAt:
      requireNonEmptyString(
        approval.windowEndedAt,
        'Approved window end'
      ),

    authorizationId:
      requireNonEmptyString(
        approval.authorizationId,
        'Approved authorization ID'
      ),

    verificationId:
      requireNonEmptyString(
        approval.verificationId,
        'Approved verification ID'
      ),

    decisionId:
      requireNonEmptyString(
        approval.decisionId,
        'Approved decision ID'
      ),

    contractOutcome:
      requireNonEmptyString(
        approval.contractOutcome,
        'Approved contract outcome'
      ),

    contractReasonCode:
      requireNonEmptyString(
        approval.contractReasonCode,
        'Approved contract reason code'
      ),

    rewardEligibility:
      approval.rewardEligibility
  });
}

function sameLineage(
  first,
  second
) {
  return (
    first.observedOperatorAddress ===
      second.observedOperatorAddress &&
    first.observedNodeId ===
      second.observedNodeId &&
    first.windowStartedAt ===
      second.windowStartedAt &&
    first.windowEndedAt ===
      second.windowEndedAt &&
    first.authorizationId ===
      second.authorizationId &&
    first.verificationId ===
      second.verificationId &&
    first.decisionId ===
      second.decisionId &&
    first.contractOutcome ===
      second.contractOutcome &&
    first.contractReasonCode ===
      second.contractReasonCode &&
    first.rewardEligibility ===
      second.rewardEligibility
  );
}

function determineQuorum(
  record,
  minimumApprovals
) {
  const approvalCount =
    Object.keys(
      record.approvals
    ).length;

  if (
    approvalCount <
    minimumApprovals
  ) {
    return QUORUM_PENDING;
  }

  if (
    record.rewardEligibility ===
    REWARD_ELIGIBLE
  ) {
    return QUORUM_APPROVED;
  }

  if (
    record.rewardEligibility ===
    REWARD_INELIGIBLE
  ) {
    return QUORUM_REJECTED;
  }

  throw new Error(
    'Validator reward approval quorum contains invalid eligibility'
  );
}

function finalizationIdFor(
  record,
  minimumApprovals
) {
  return canonicalHash({
    protocol:
      'validator-reward-approval-quorum',

    minimumApprovals,

    observedOperatorAddress:
      record.observedOperatorAddress,

    observedNodeId:
      record.observedNodeId,

    windowStartedAt:
      record.windowStartedAt,

    windowEndedAt:
      record.windowEndedAt,

    authorizationId:
      record.authorizationId,

    verificationId:
      record.verificationId,

    decisionId:
      record.decisionId,

    contractOutcome:
      record.contractOutcome,

    contractReasonCode:
      record.contractReasonCode,

    rewardEligibility:
      record.rewardEligibility
  });
}

function cloneRecord(
  record
) {
  return structuredClone(
    record
  );
}

async function readState(
  statePath,
  minimumApprovals
) {
  let serialized;

  try {
    serialized =
      await fs.readFile(
        statePath,
        'utf8'
      );
  } catch (error) {
    if (
      error?.code ===
      'ENOENT'
    ) {
      return {
        version:
          STATE_VERSION,

        minimumApprovals,

        windows: {}
      };
    }

    throw error;
  }

  let state;

  try {
    state =
      JSON.parse(
        serialized
      );
  } catch (error) {
    throw new Error(
      'Validator reward approval quorum state is not valid JSON',
      {
        cause:
          error
      }
    );
  }

  requirePlainObject(
    state,
    'Validator reward approval quorum state'
  );

  if (
    state.version !==
    STATE_VERSION
  ) {
    throw new Error(
      `Unsupported Validator reward approval quorum state version: ${state.version}`
    );
  }

  if (
    state.minimumApprovals !==
    minimumApprovals
  ) {
    throw new Error(
      'Persisted Validator reward approval quorum policy mismatch'
    );
  }

  requirePlainObject(
    state.windows,
    'Validator reward approval quorum windows'
  );

  for (
    const [
      persistedKey,
      persisted
    ] of Object.entries(
      state.windows
    )
  ) {
    requirePlainObject(
      persisted,
      'Persisted Validator reward approval quorum window'
    );

    const lineage =
      lineageFromApproval(
        persisted
      );

    if (
      windowKey(lineage) !==
      persistedKey
    ) {
      throw new Error(
        'Persisted Validator reward approval quorum window key mismatch'
      );
    }

    requirePlainObject(
      persisted.approvals,
      'Persisted Validator reward approvals'
    );

    for (
      const [
        validatorKey,
        approval
      ] of Object.entries(
        persisted.approvals
      )
    ) {
      requirePlainObject(
        approval,
        'Persisted Validator reward approval vote'
      );

      const validatorAddress =
        normalizeAddress(
          approval.approvingValidatorAddress,
          'Persisted approving Validator address'
        );

      if (
        validatorKey !==
        validatorAddress.toLowerCase()
      ) {
        throw new Error(
          'Persisted Validator reward approval voter key mismatch'
        );
      }

      requireNonEmptyString(
        approval.approvingValidatorNodeId,
        'Persisted approving Validator node ID'
      );

      normalizeAddress(
        approval.approvingSessionAddress,
        'Persisted approving Validator session address'
      );

      requireNonEmptyString(
        approval.approvalHash,
        'Persisted Validator reward approval hash'
      );
    }

    const expectedStatus =
      determineQuorum(
        persisted,
        minimumApprovals
      );

    if (
      persisted.quorumStatus !==
      expectedStatus
    ) {
      throw new Error(
        'Persisted Validator reward approval quorum status mismatch'
      );
    }

    const expectedFinalizationId =
      expectedStatus ===
      QUORUM_PENDING
        ? null
        : finalizationIdFor(
            persisted,
            minimumApprovals
          );

    if (
      persisted.finalizationId !==
      expectedFinalizationId
    ) {
      throw new Error(
        'Persisted Validator reward approval finalization ID mismatch'
      );
    }
  }

  return state;
}

async function createValidatorRewardApprovalQuorumState(
  options
) {
  requirePlainObject(
    options,
    'Validator reward approval quorum options'
  );

  const minimumApprovals =
    requirePositiveInteger(
      options.minimumApprovals,
      'Validator reward approval minimumApprovals'
    );

  const statePath =
    path.resolve(
      options.statePath === undefined
        ? defaultStatePath()
        : requireNonEmptyString(
            options.statePath,
            'Validator reward approval quorum state path'
          )
    );

  let state =
    await readState(
      statePath,
      minimumApprovals
    );

  let writing =
    Promise.resolve();

  async function persist() {
    await fs.mkdir(
      path.dirname(
        statePath
      ),
      {
        recursive: true,
        mode: 0o700
      }
    );

    await writeJsonAtomic(
      statePath,
      state
    );
  }

  async function acceptApproval({
    authorization,
    approval,
    nowMs = Date.now()
  }) {
    const work =
      writing.then(
        async () => {
          const verifiedApproval =
            verifySignedValidatorRewardApproval(
              approval
            );

          const verifiedAuthorization =
            verifyValidatorRewardApprovalAuthorization({
              authorization,

              expectedValidatorAddress:
                verifiedApproval
                  .approvingValidatorAddress,

              expectedValidatorNodeId:
                verifiedApproval
                  .approvingValidatorNodeId,

              expectedSessionAddress:
                verifiedApproval
                  .approvingSessionAddress,

              nowMs
            });

          const lineage =
            lineageFromApproval(
              verifiedApproval
            );

          const key =
            windowKey(
              lineage
            );

          const existing =
            state.windows[key];

          if (
            existing &&
            !sameLineage(
              existing,
              lineage
            )
          ) {
            throw new Error(
              'Conflicting Validator reward approval decision for target window'
            );
          }

          const validatorAddress =
            verifiedAuthorization
              .validatorAddress;

          const validatorKey =
            validatorAddress
              .toLowerCase();

          const record =
            existing
              ? cloneRecord(existing)
              : {
                  ...lineage,

                  approvals: {},

                  quorumStatus:
                    QUORUM_PENDING,

                  finalizationId:
                    null
                };

          if (
            Object.prototype.hasOwnProperty.call(
              record.approvals,
              validatorKey
            )
          ) {
            throw new Error(
              'Validator wallet already approved this reward decision'
            );
          }

          record.approvals[
            validatorKey
          ] = {
            approvingValidatorAddress:
              validatorAddress,

            approvingValidatorNodeId:
              verifiedAuthorization
                .validatorNodeId,

            approvingSessionAddress:
              verifiedAuthorization
                .sessionAddress,

            approvalHash:
              verifiedApproval
                .approvalHash,

            issuedAt:
              verifiedApproval
                .issuedAt
          };

          record.quorumStatus =
            determineQuorum(
              record,
              minimumApprovals
            );

          record.finalizationId =
            record.quorumStatus ===
              QUORUM_PENDING
              ? null
              : finalizationIdFor(
                  record,
                  minimumApprovals
                );

          state.windows[key] =
            record;

          await persist();

          return Object.freeze({
            changed:
              true,

            record:
              cloneRecord(
                record
              )
          });
        }
      );

    writing =
      work.catch(
        () => {}
      );

    return await work;
  }

  function getWindow({
    observedOperatorAddress,
    observedNodeId,
    windowStartedAt,
    windowEndedAt
  }) {
    const key =
      windowKey({
        observedOperatorAddress:
          normalizeAddress(
            observedOperatorAddress,
            'Observed Operator address'
          ),

        observedNodeId:
          requireNonEmptyString(
            observedNodeId,
            'Observed node ID'
          ),

        windowStartedAt:
          requireNonEmptyString(
            windowStartedAt,
            'Window start'
          ),

        windowEndedAt:
          requireNonEmptyString(
            windowEndedAt,
            'Window end'
          )
      });

    const record =
      state.windows[key];

    return record
      ? Object.freeze(
          cloneRecord(record)
        )
      : null;
  }

  function listFinalized() {
    return Object.freeze(
      Object.values(
        state.windows
      )
        .filter(
          record =>
            record.quorumStatus !==
            QUORUM_PENDING
        )
        .map(
          record =>
            Object.freeze(
              cloneRecord(record)
            )
        )
    );
  }

  return Object.freeze({
    statePath,
    minimumApprovals,
    acceptApproval,
    getWindow,
    listFinalized
  });
}

module.exports = Object.freeze({
  STATE_VERSION,
  QUORUM_PENDING,
  QUORUM_APPROVED,
  QUORUM_REJECTED,
  determineQuorum,
  createValidatorRewardApprovalQuorumState
});
