'use strict';

const {
  verifySignedOperatorUptimeReport
} = require(
  './signed-operator-uptime-report'
);

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

function requireFunction(value, name) {
  if (typeof value !== 'function') {
    throw new TypeError(
      `${name} must be a function`
    );
  }

  return value;
}

function evaluateReportingOperator(
  node
) {
  requirePlainObject(
    node,
    'Reporting Operator NodeStaking status'
  );

  if (node.registered !== true) {
    return Object.freeze({
      accepted: false,
      reasonCode:
        'REPORTER_NOT_REGISTERED'
    });
  }

  if (node.isNodeWallet !== true) {
    return Object.freeze({
      accepted: false,
      reasonCode:
        'REPORTER_NOT_NODE_WALLET'
    });
  }

  if (node.tierLabel !== 'Operator') {
    return Object.freeze({
      accepted: false,
      reasonCode:
        'REPORTER_NOT_OPERATOR'
    });
  }

  let stake;
  let requirement;

  try {
    stake =
      BigInt(
        node.stakeAtomic
      );

    requirement =
      BigInt(
        node.operatorStakeRequirementAtomic
      );
  } catch (error) {
    throw new TypeError(
      'Reporting Operator stake values are invalid',
      { cause: error }
    );
  }

  if (stake < requirement) {
    return Object.freeze({
      accepted: false,
      reasonCode:
        'REPORTER_STAKE_INSUFFICIENT'
    });
  }

  return Object.freeze({
    accepted: true,
    reasonCode:
      'REPORTER_OPERATOR_VALID'
  });
}

function createValidatorUptimeReportHandler(
  options
) {
  requirePlainObject(
    options,
    'Validator uptime report handler options'
  );

  const readNode =
    requireFunction(
      options.readNode,
      'Validator reporting-node reader'
    );

  const replayState =
    requirePlainObject(
      options.replayState,
      'Validator report replay state'
    );

  const acceptReport =
    requireFunction(
      replayState.acceptReport,
      'Validator report replay acceptReport'
    );

  const onAcceptedReport =
    options.onAcceptedReport === undefined
      ? null
      : requireFunction(
          options.onAcceptedReport,
          'Validator accepted-report callback'
        );

  async function handleValidatorUptimeReport(
    signedReport
  ) {
    requirePlainObject(
      signedReport,
      'Signed Operator uptime report'
    );

    /*
     * Verify the report first, but do not commit replay
     * state yet. Registration authorization is checked
     * independently against current NodeStaking state.
     */
    const verified =
      verifySignedOperatorUptimeReport(
        signedReport
      );

    const reporterNode =
      await readNode(
        verified.reportingOperatorAddress
      );

    const reporterEvaluation =
      evaluateReportingOperator(
        reporterNode
      );

    if (!reporterEvaluation.accepted) {
      const error =
        new Error(
          `Validator rejected Operator uptime report: ` +
          reporterEvaluation.reasonCode
        );

      error.code =
        reporterEvaluation.reasonCode;

      throw error;
    }

    /*
     * Replay state performs its own signature verification.
     * This duplication is intentional: no caller can bypass
     * replay-state cryptographic validation.
     */
    const accepted =
      await acceptReport(
        signedReport
      );

    if (onAcceptedReport) {
      await onAcceptedReport({
        signedReport,
        verified,
        reporterNode,
        accepted
      });
    }

    return Object.freeze({
      accepted: true,
      reportHash:
        accepted.reportHash,
      reportingOperatorAddress:
        accepted.reportingOperatorAddress,
      reportingNodeId:
        accepted.reportingNodeId,
      observedOperatorAddress:
        accepted.observedOperatorAddress,
      observedNodeId:
        accepted.observedNodeId,
      windowStartedAt:
        accepted.windowStartedAt,
      windowEndedAt:
        accepted.windowEndedAt,
      locallyQualified:
        accepted.locallyQualified,
      reasonCode:
        reporterEvaluation.reasonCode
    });
  }

  return Object.freeze({
    handleValidatorUptimeReport
  });
}

module.exports = Object.freeze({
  evaluateReportingOperator,
  createValidatorUptimeReportHandler
});
