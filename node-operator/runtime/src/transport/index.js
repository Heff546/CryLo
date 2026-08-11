'use strict';

const httpJsonServer =
  require('./http-json-server');

const operatorEvidenceHandler =
  require('./operator-evidence-handler');

const transportRuntime =
  require('./transport-runtime');

const validatorReportTransport =
  require('./validator-report-transport');

const validatorRewardApprovalTransport =
  require('./validator-reward-approval-transport');

module.exports = Object.freeze({
  ...httpJsonServer,
  ...operatorEvidenceHandler,
  ...transportRuntime,
  ...validatorReportTransport,
  ...validatorRewardApprovalTransport
});
