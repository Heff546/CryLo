'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { Wallet } = require('ethers');

const {
  buildSignedOperatorUptimeReport
} = require(
  '../src/evidence/signed-operator-uptime-report'
);

const {
  createValidatorReportReplayState
} = require(
  '../src/evidence/validator-report-replay-state'
);

async function makeTempState() {
  const directory =
    await fs.mkdtemp(
      path.join(
        os.tmpdir(),
        'crylonexus-validator-report-replay-'
      )
    );

  return {
    directory,
    statePath:
      path.join(
        directory,
        'validator-report-replay-state.json'
      )
  };
}

function makeSignedReport({
  reporter,
  reporterSession,
  target,
  targetNodeId =
    'observed-node-0001',
  windowStartedAt =
    '2026-08-10T20:00:00.000Z',
  sequenceBase = 1
}) {
  const startMs =
    Date.parse(windowStartedAt);

  const windowEndedAt =
    new Date(
      startMs + 20 * 60_000
    ).toISOString();

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
            `0x${(
              sequenceBase +
              index
            )
              .toString(16)
              .padStart(64, '0')}`,

          heartbeatPayloadHash:
            `0x${(
              sequenceBase +
              index +
              1000
            )
              .toString(16)
              .padStart(64, '0')}`,

          heartbeatSequence:
            sequenceBase +
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

      reportingNodeId:
        'reporting-operator-node-0001',

      reportingSessionAddress:
        reporterSession.address,

      observedOperatorAddress:
        target.address,

      observedNodeId:
        targetNodeId,

      windowStartedAt,
      windowEndedAt,

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

test(
  'accepts a new signed Operator report',
  async () => {
    const temp =
      await makeTempState();

    try {
      const reporter =
        Wallet.createRandom();

      const reporterSession =
        Wallet.createRandom();

      const target =
        Wallet.createRandom();

      const replay =
        await createValidatorReportReplayState({
          statePath:
            temp.statePath
        });

      const report =
        makeSignedReport({
          reporter,
          reporterSession,
          target
        });

      const accepted =
        await replay.acceptReport(
          report
        );

      assert.equal(
        accepted.reportHash,
        report.reportHash
      );

      assert.equal(
        accepted.reportingOperatorAddress,
        reporter.address
      );

      assert.equal(
        accepted.observedOperatorAddress,
        target.address
      );

      assert.equal(
        accepted.locallyQualified,
        true
      );

      assert.equal(
        replay.hasReportHash(
          report.reportHash
        ),
        true
      );

      assert.equal(
        replay.getAcceptedReports().length,
        1
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
  'rejects replay of the same report hash',
  async () => {
    const temp =
      await makeTempState();

    try {
      const reporter =
        Wallet.createRandom();

      const reporterSession =
        Wallet.createRandom();

      const target =
        Wallet.createRandom();

      const replay =
        await createValidatorReportReplayState({
          statePath:
            temp.statePath
        });

      const report =
        makeSignedReport({
          reporter,
          reporterSession,
          target
        });

      await replay.acceptReport(
        report
      );

      await assert.rejects(
        replay.acceptReport(
          report
        ),
        /report replay detected/
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
  'rejects a conflicting report for the same reporter target and window',
  async () => {
    const temp =
      await makeTempState();

    try {
      const reporter =
        Wallet.createRandom();

      const reporterSession =
        Wallet.createRandom();

      const target =
        Wallet.createRandom();

      const replay =
        await createValidatorReportReplayState({
          statePath:
            temp.statePath
        });

      const first =
        makeSignedReport({
          reporter,
          reporterSession,
          target,
          sequenceBase: 1
        });

      const conflicting =
        makeSignedReport({
          reporter,
          reporterSession,
          target,
          sequenceBase: 100
        });

      assert.notEqual(
        first.reportHash,
        conflicting.reportHash
      );

      await replay.acceptReport(
        first
      );

      await assert.rejects(
        replay.acceptReport(
          conflicting
        ),
        /window already accepted/
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
  'allows the same reporter and target in a later window',
  async () => {
    const temp =
      await makeTempState();

    try {
      const reporter =
        Wallet.createRandom();

      const reporterSession =
        Wallet.createRandom();

      const target =
        Wallet.createRandom();

      const replay =
        await createValidatorReportReplayState({
          statePath:
            temp.statePath
        });

      const first =
        makeSignedReport({
          reporter,
          reporterSession,
          target,
          windowStartedAt:
            '2026-08-10T20:00:00.000Z',
          sequenceBase: 1
        });

      const second =
        makeSignedReport({
          reporter,
          reporterSession,
          target,
          windowStartedAt:
            '2026-08-10T20:20:00.000Z',
          sequenceBase: 100
        });

      await replay.acceptReport(
        first
      );

      await replay.acceptReport(
        second
      );

      assert.equal(
        replay.getAcceptedReports().length,
        2
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
  'allows different reporters for the same target and window',
  async () => {
    const temp =
      await makeTempState();

    try {
      const reporterA =
        Wallet.createRandom();

      const reporterASession =
        Wallet.createRandom();

      const reporterB =
        Wallet.createRandom();

      const reporterBSession =
        Wallet.createRandom();

      const target =
        Wallet.createRandom();

      const replay =
        await createValidatorReportReplayState({
          statePath:
            temp.statePath
        });

      await replay.acceptReport(
        makeSignedReport({
          reporter:
            reporterA,
          reporterSession:
            reporterASession,
          target,
          sequenceBase:
            1
        })
      );

      await replay.acceptReport(
        makeSignedReport({
          reporter:
            reporterB,
          reporterSession:
            reporterBSession,
          target,
          sequenceBase:
            100
        })
      );

      assert.equal(
        replay.getAcceptedReports().length,
        2
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
  'persists accepted reports across restart',
  async () => {
    const temp =
      await makeTempState();

    try {
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

      const first =
        await createValidatorReportReplayState({
          statePath:
            temp.statePath
        });

      await first.acceptReport(
        report
      );

      const restarted =
        await createValidatorReportReplayState({
          statePath:
            temp.statePath
        });

      assert.equal(
        restarted.hasReportHash(
          report.reportHash
        ),
        true
      );

      assert.equal(
        restarted.getAcceptedReports().length,
        1
      );

      await assert.rejects(
        restarted.acceptReport(
          report
        ),
        /report replay detected/
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
  'rejects tampered signed reports before persistence',
  async () => {
    const temp =
      await makeTempState();

    try {
      const reporter =
        Wallet.createRandom();

      const reporterSession =
        Wallet.createRandom();

      const target =
        Wallet.createRandom();

      const replay =
        await createValidatorReportReplayState({
          statePath:
            temp.statePath
        });

      const report =
        makeSignedReport({
          reporter,
          reporterSession,
          target
        });

      const tampered = {
        ...report,
        locallyQualified:
          false
      };

      await assert.rejects(
        replay.acceptReport(
          tampered
        )
      );

      assert.equal(
        replay.getAcceptedReports().length,
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
