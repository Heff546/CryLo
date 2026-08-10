'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { Wallet } = require('ethers');

const {
  buildSignedOperatorUptimeReport
} = require(
  '../src/evidence/signed-operator-uptime-report'
);

const {
  createValidatorUptimeReportHandler
} = require(
  '../src/evidence/validator-uptime-report-handler'
);

function makeSignedReport({
  reporter,
  reporterSession,
  target
}) {
  const startMs =
    Date.parse(
      '2026-08-10T20:00:00.000Z'
    );

  const slots =
    Array.from(
      { length: 18 },
      (_, index) => {
        const slotMs =
          startMs +
          index * 60_000;

        return {
          slotStartedAt:
            new Date(
              slotMs
            ).toISOString(),

          observedAt:
            new Date(
              slotMs + 5_000
            ).toISOString(),

          observationHash:
            `0x${(index + 1)
              .toString(16)
              .padStart(64, '0')}`,

          heartbeatPayloadHash:
            `0x${(index + 1001)
              .toString(16)
              .padStart(64, '0')}`,

          heartbeatSequence:
            index + 1,

          result:
            'PASS',

          reasonCode:
            'REGISTERED_OPERATOR'
        };
      }
    );

  return buildSignedOperatorUptimeReport({
    finalizedWindow: {
      schemaVersion:
        1,

      protocolVersion:
        '2.0.0',

      reportingOperatorAddress:
        reporter.address,

      reportingNodeId:
        'reporting-operator-node-0001',

      reportingSessionAddress:
        reporterSession.address,

      observedOperatorAddress:
        target.address,

      observedNodeId:
        'observed-node-0001',

      windowStartedAt:
        '2026-08-10T20:00:00.000Z',

      windowEndedAt:
        '2026-08-10T20:20:00.000Z',

      expectedObservations:
        20,

      receivedObservations:
        18,

      passCount:
        18,

      failCount:
        0,

      missingCount:
        2,

      totalFailures:
        2,

      windowComplete:
        true,

      locallyQualified:
        true,

      slots
    },

    privateKey:
      reporterSession.privateKey
  });
}

function validReporterNode(
  reporter
) {
  return {
    address:
      reporter.address,

    registered:
      true,

    isNodeWallet:
      true,

    tier:
      '1',

    tierLabel:
      'Operator',

    stakeAtomic:
      '30000000000000',

    operatorStakeRequirementAtomic:
      '30000000000000',

    validatorStakeRequirementAtomic:
      '75000000000000'
  };
}

test(
  'accepts report from valid registered Operator',
  async () => {
    const reporter =
      Wallet.createRandom();

    const reporterSession =
      Wallet.createRandom();

    const target =
      Wallet.createRandom();

    const report =
      makeSignedReport({
        reporter,
        reporterSession,
        target
      });

    let acceptedInput = null;

    const handler =
      createValidatorUptimeReportHandler({
        async readNode(address) {
          assert.equal(
            address,
            reporter.address
          );

          return validReporterNode(
            reporter
          );
        },

        replayState: {
          async acceptReport(value) {
            acceptedInput = value;

            return {
              reportHash:
                value.reportHash,

              reportingOperatorAddress:
                value.reportingOperatorAddress,

              reportingNodeId:
                value.reportingNodeId,

              observedOperatorAddress:
                value.observedOperatorAddress,

              observedNodeId:
                value.observedNodeId,

              windowStartedAt:
                value.windowStartedAt,

              windowEndedAt:
                value.windowEndedAt,

              locallyQualified:
                value.locallyQualified
            };
          }
        }
      });

    const result =
      await handler
        .handleValidatorUptimeReport(
          report
        );

    assert.equal(
      acceptedInput,
      report
    );

    assert.equal(
      result.accepted,
      true
    );

    assert.equal(
      result.reasonCode,
      'REPORTER_OPERATOR_VALID'
    );

    assert.equal(
      result.reportHash,
      report.reportHash
    );
  }
);

test(
  'rejects unregistered reporter before replay commit',
  async () => {
    const reporter =
      Wallet.createRandom();

    const reporterSession =
      Wallet.createRandom();

    const target =
      Wallet.createRandom();

    let committed = false;

    const handler =
      createValidatorUptimeReportHandler({
        async readNode() {
          return {
            ...validReporterNode(
              reporter
            ),
            registered:
              false
          };
        },

        replayState: {
          async acceptReport() {
            committed = true;
          }
        }
      });

    await assert.rejects(
      handler.handleValidatorUptimeReport(
        makeSignedReport({
          reporter,
          reporterSession,
          target
        })
      ),
      /REPORTER_NOT_REGISTERED/
    );

    assert.equal(
      committed,
      false
    );
  }
);

test(
  'rejects Validator-tier reporter',
  async () => {
    const reporter =
      Wallet.createRandom();

    const reporterSession =
      Wallet.createRandom();

    const target =
      Wallet.createRandom();

    const handler =
      createValidatorUptimeReportHandler({
        async readNode() {
          return {
            ...validReporterNode(
              reporter
            ),
            tier:
              '2',
            tierLabel:
              'Validator',
            stakeAtomic:
              '75000000000000'
          };
        },

        replayState: {
          async acceptReport() {
            throw new Error(
              'must not commit'
            );
          }
        }
      });

    await assert.rejects(
      handler.handleValidatorUptimeReport(
        makeSignedReport({
          reporter,
          reporterSession,
          target
        })
      ),
      /REPORTER_NOT_OPERATOR/
    );
  }
);

test(
  'rejects reporter that is not a node wallet',
  async () => {
    const reporter =
      Wallet.createRandom();

    const reporterSession =
      Wallet.createRandom();

    const target =
      Wallet.createRandom();

    const handler =
      createValidatorUptimeReportHandler({
        async readNode() {
          return {
            ...validReporterNode(
              reporter
            ),
            isNodeWallet:
              false
          };
        },

        replayState: {
          async acceptReport() {
            throw new Error(
              'must not commit'
            );
          }
        }
      });

    await assert.rejects(
      handler.handleValidatorUptimeReport(
        makeSignedReport({
          reporter,
          reporterSession,
          target
        })
      ),
      /REPORTER_NOT_NODE_WALLET/
    );
  }
);

test(
  'rejects reporter below Operator stake requirement',
  async () => {
    const reporter =
      Wallet.createRandom();

    const reporterSession =
      Wallet.createRandom();

    const target =
      Wallet.createRandom();

    const handler =
      createValidatorUptimeReportHandler({
        async readNode() {
          return {
            ...validReporterNode(
              reporter
            ),
            stakeAtomic:
              '29999999999999'
          };
        },

        replayState: {
          async acceptReport() {
            throw new Error(
              'must not commit'
            );
          }
        }
      });

    await assert.rejects(
      handler.handleValidatorUptimeReport(
        makeSignedReport({
          reporter,
          reporterSession,
          target
        })
      ),
      /REPORTER_STAKE_INSUFFICIENT/
    );
  }
);

test(
  'rejects tampered report before NodeStaking read',
  async () => {
    const reporter =
      Wallet.createRandom();

    const reporterSession =
      Wallet.createRandom();

    const target =
      Wallet.createRandom();

    let readCalled = false;

    const report =
      makeSignedReport({
        reporter,
        reporterSession,
        target
      });

    const handler =
      createValidatorUptimeReportHandler({
        async readNode() {
          readCalled = true;

          return validReporterNode(
            reporter
          );
        },

        replayState: {
          async acceptReport() {
            throw new Error(
              'must not commit'
            );
          }
        }
      });

    await assert.rejects(
      handler.handleValidatorUptimeReport({
        ...report,
        locallyQualified:
          false
      })
    );

    assert.equal(
      readCalled,
      false
    );
  }
);

test(
  'propagates replay-state rejection',
  async () => {
    const reporter =
      Wallet.createRandom();

    const reporterSession =
      Wallet.createRandom();

    const target =
      Wallet.createRandom();

    const handler =
      createValidatorUptimeReportHandler({
        async readNode() {
          return validReporterNode(
            reporter
          );
        },

        replayState: {
          async acceptReport() {
            throw new Error(
              'Operator uptime report replay detected'
            );
          }
        }
      });

    await assert.rejects(
      handler.handleValidatorUptimeReport(
        makeSignedReport({
          reporter,
          reporterSession,
          target
        })
      ),
      /report replay detected/
    );
  }
);

test(
  'invokes accepted-report callback after replay commit',
  async () => {
    const reporter =
      Wallet.createRandom();

    const reporterSession =
      Wallet.createRandom();

    const target =
      Wallet.createRandom();

    const report =
      makeSignedReport({
        reporter,
        reporterSession,
        target
      });

    let callbackValue = null;

    const handler =
      createValidatorUptimeReportHandler({
        async readNode() {
          return validReporterNode(
            reporter
          );
        },

        replayState: {
          async acceptReport(value) {
            return {
              reportHash:
                value.reportHash,
              reportingOperatorAddress:
                value.reportingOperatorAddress,
              reportingNodeId:
                value.reportingNodeId,
              observedOperatorAddress:
                value.observedOperatorAddress,
              observedNodeId:
                value.observedNodeId,
              windowStartedAt:
                value.windowStartedAt,
              windowEndedAt:
                value.windowEndedAt,
              locallyQualified:
                value.locallyQualified
            };
          }
        },

        async onAcceptedReport(value) {
          callbackValue = value;
        }
      });

    await handler
      .handleValidatorUptimeReport(
        report
      );

    assert.equal(
      callbackValue.signedReport,
      report
    );

    assert.equal(
      callbackValue.reporterNode
        .tierLabel,
      'Operator'
    );

    assert.equal(
      callbackValue.accepted
        .reportHash,
      report.reportHash
    );
  }
);
