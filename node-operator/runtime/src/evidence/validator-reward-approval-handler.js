'use strict';

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
  evaluateValidatorRewardApprovalAuthority
} = require(
  './validator-reward-approval-authority'
);

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

function createValidatorRewardApprovalHandler(
  options
) {
  requirePlainObject(
    options,
    'Validator reward approval handler options'
  );

  const readNode =
    requireFunction(
      options.readNode,
      'Validator reward approval handler readNode'
    );

  const quorumState =
    requirePlainObject(
      options.quorumState,
      'Validator reward approval quorum state'
    );

  const acceptApproval =
    requireFunction(
      quorumState.acceptApproval,
      'Validator reward approval quorum acceptApproval'
    );

  async function handleValidatorRewardApproval({
    authorization,
    approval,
    nowMs = Date.now()
  }) {
    requirePlainObject(
      authorization,
      'Validator reward approval authorization'
    );

    requirePlainObject(
      approval,
      'Signed Validator reward approval'
    );

    /*
     * Verify the signed approval and its delegation before
     * any contract read. This establishes the approving
     * Validator wallet/node/session identity.
     */
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

    /*
     * Important:
     * Provider/RPC/contract failure escapes here.
     * Quorum state has not been mutated, so this approval
     * remains retryable.
     */
    const validatorNode =
      await readNode(
        verifiedAuthorization.validatorAddress
      );

    const authority =
      evaluateValidatorRewardApprovalAuthority(
        validatorNode
      );

    if (!authority.accepted) {
      const error =
        new Error(
          `Validator reward approval rejected: ` +
          authority.reasonCode
        );

      error.code =
        authority.reasonCode;

      throw error;
    }

    /*
     * Quorum state independently verifies the approval and
     * delegation again before durable mutation.
     */
    const accepted =
      await acceptApproval({
        authorization,
        approval,
        nowMs
      });

    return Object.freeze({
      accepted: true,

      approvingValidatorAddress:
        verifiedAuthorization
          .validatorAddress,

      approvingValidatorNodeId:
        verifiedAuthorization
          .validatorNodeId,

      authorityReasonCode:
        authority.reasonCode,

      quorumStatus:
        accepted.record
          .quorumStatus,

      finalizationId:
        accepted.record
          .finalizationId,

      record:
        accepted.record
    });
  }

  return Object.freeze({
    handleValidatorRewardApproval
  });
}

module.exports = Object.freeze({
  createValidatorRewardApprovalHandler
});
