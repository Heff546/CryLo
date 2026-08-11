'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { Wallet } = require('ethers');

const {
  buildSignedOperatorUptimeReport,
  createValidatorReportReplayState,
  createValidatorUptimeReportHandler,
  createValidatorConsensusState,
  CONSENSUS_PENDING,
  CONSENSUS_QUALIFIED,
  CONSENSUS_UNQUALIFIED
} = require(
  '../src/evidence'
);

async function makeTempState() {
  const directory =
    await fs.mkdtemp(
      path.join(
        os.tmpdir(),
        'crylonexus-validator-consensus-intake-'
      )
    );

  return {
    directory,

    replayPath:
      path.join(
        directory,
        'replay.json'
      ),

    consensusPath:
      path.join(
        directory,
        'consensus.json'
      )
  };
}

function reporterNode(
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

function makeSignedReport({
  reporter,
  reporterSession,
  target,
  reportingNodeId,
  locallyQualified,
  reportIndex
}) {
  const startMs =
    Date.parse(
      '2026-08-10T20:00:00.000Z'
    );

  const passes =
    locallyQualified
      ? 18
      : 17;

  const missing =
    locallyQualified
      ? 2
      : 3;

  const slots =
    Array.from(
      { length: passes },
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
            `0x${(
              reportIndex * 100 +
              index +
              1
            )
              .toString(16)
              .padStart(64, '0')}`,

          heartbeatPayloadHash:
            `0x${(
              reportIndex * 1000 +
              index +
              1
            )
              .toString(16)
              .padStart(64, '0')}`,

          heartbeatSequence:
            reportIndex * 100 +
            index,

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

      reportingNodeId,

      reportingSessionAddress:
        reporterSession.address,

      observedOperatorAddress:
        target.address,

      observedNodeId:
        'target-node-0001',

      windowStartedAt:
        '2026-08-10T20:00:00.000Z',

      windowEndedAt:
        '2026-08-10T20:20:00.000Z',

      expectedObservations:
        20,

      receivedObservations:
        passes,

      passCount:
        passes,

      failCount:
        0,

      missingCount:
        missing,

      totalFailures:
        missing,

      windowComplete:
        true,

      locallyQualified,

      slots
    },

    privateKey:
      reporterSession.privateKey
  });
}

async function createIntake({
  temp,
  minimumReports = 3
}) {
  const replayState =
    await createValidatorReportReplayState({
      statePath:
        temp.replayPath
    });

  const consensusState =
    await createValidatorConsensusState({
      minimumReports,
      statePath:
        temp.consensusPath
    });

  const reporters =
    new Map();

  const handler =
    createValidatorUptimeReportHandler({
      async readNode(
        walletAddress
      ) {
        const node =
          reporters.get(
            walletAddress.toLowerCase()
          );

        if (!node) {
          throw new Error(
            'Unknown reporting Operator'
          );
        }

        return node;
      },

      replayState,

      async onAcceptedReport({
        accepted
      }) {
        await consensusState
          .acceptReport(
            accepted
          );
      }
    });

  return {
    handler,
    consensusState,

    authorizeReporter(
      reporter
    ) {
      reporters.set(
        reporter.address
          .toLowerCase(),
        reporterNode(
          reporter
        )
      );
    }
  };
}

test(
  'accepted Operator reports feed Validator consensus',
  async () => {
    const temp =
      await makeTempState();

    try {
      const target =
        Wallet.createRandom();

      const reporter =
        Wallet.createRandom();

      const reporterSession =
        Wallet.createRandom();

      const intake =
        await createIntake({
          temp
        });

      intake.authorizeReporter(
        reporter
      );

      await intake.handler
        .handleValidatorUptimeReport(
          makeSignedReport({
            reporter,
            reporterSession,
            target,
            reportingNodeId:
              'reporting-node-1',
            locallyQualified:
              true,
            reportIndex:
              1
          })
        );

      const windows =
        intake.consensusState
          .getWindows();

      assert.equal(
        windows.length,
        1
      );

      assert.equal(
        windows[0].reportCount,
        1
      );

      assert.equal(
        windows[0].consensus,
        CONSENSUS_PENDING
      );
    } finally {
      await fs.rm(
        temp.directory,
        {
          recursive: true,
          force: true
        }
      );
    }
  }
);

test(
  'three independent qualified reports finalize QUALIFIED',
  async () => {
    const temp =
      await makeTempState();

    try {
      const target =
        Wallet.createRandom();

      const intake =
        await createIntake({
          temp
        });

      for (
        let index = 0;
        index < 3;
        index += 1
      ) {
        const reporter =
          Wallet.createRandom();

        const reporterSession =
          Wallet.createRandom();

        intake.authorizeReporter(
          reporter
        );

        await intake.handler
          .handleValidatorUptimeReport(
            makeSignedReport({
              reporter,
              reporterSession,
              target,
              reportingNodeId:
                `reporting-node-${index + 1}`,
              locallyQualified:
                true,
              reportIndex:
                index + 1
            })
          );
      }

      const window =
        intake.consensusState
          .getWindows()[0];

      assert.equal(
        window.consensus,
        CONSENSUS_QUALIFIED
      );

      assert.equal(
        window.finalized,
        true
      );

      assert.equal(
        window.qualifiedCount,
        3
      );
    } finally {
      await fs.rm(
        temp.directory,
        {
          recursive: true,
          force: true
        }
      );
    }
  }
);

test(
  'three independent unqualified reports finalize UNQUALIFIED',
  async () => {
    const temp =
      await makeTempState();

    try {
      const target =
        Wallet.createRandom();

      const intake =
        await createIntake({
          temp
        });

      for (
        let index = 0;
        index < 3;
        index += 1
      ) {
        const reporter =
          Wallet.createRandom();

        const reporterSession =
          Wallet.createRandom();

        intake.authorizeReporter(
          reporter
        );

        await intake.handler
          .handleValidatorUptimeReport(
            makeSignedReport({
              reporter,
              reporterSession,
              target,
              reportingNodeId:
                `reporting-node-${index + 1}`,
              locallyQualified:
                false,
              reportIndex:
                index + 1
            })
          );
      }

      const window =
        intake.consensusState
          .getWindows()[0];

      assert.equal(
        window.consensus,
        CONSENSUS_UNQUALIFIED
      );

      assert.equal(
        window.finalized,
        true
      );

      assert.equal(
        window.unqualifiedCount,
        3
      );
    } finally {
      await fs.rm(
        temp.directory,
        {
          recursive: true,
          force: true
        }
      );
    }
  }
);

test(
  'rejected report never reaches consensus',
  async () => {
    const temp =
      await makeTempState();

    try {
      const target =
        Wallet.createRandom();

      const reporter =
        Wallet.createRandom();

      const reporterSession =
        Wallet.createRandom();

      const intake =
        await createIntake({
          temp
        });

      await assert.rejects(
        intake.handler
          .handleValidatorUptimeReport(
            makeSignedReport({
              reporter,
              reporterSession,
              target,
              reportingNodeId:
                'reporting-node-1',
              locallyQualified:
                true,
              reportIndex:
                1
            })
          )
      );

      assert.equal(
        intake.consensusState
          .getWindows().length,
        0
      );
    } finally {
      await fs.rm(
        temp.directory,
        {
          recursive: true,
          force: true
        }
      );
    }
  }
);
