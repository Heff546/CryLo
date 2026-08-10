'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  Wallet
} = require('ethers');

const {
  buildSignedOperatorUptimeReport,
  verifySignedOperatorUptimeReport
} = require(
  '../src/evidence/signed-operator-uptime-report'
);

function makeSlots({
  passes = 20,
  fails = 0
} = {}) {
  const slots = [];

  for (
    let index = 0;
    index < passes + fails;
    index += 1
  ) {
    const passing =
      index < passes;

    const minute =
      String(index).padStart(2, '0');

    slots.push({
      slotStartedAt:
        `2026-08-09T23:${minute}:00.000Z`,

      observedAt:
        `2026-08-09T23:${minute}:05.000Z`,

      observationHash:
        `0x${(index + 1)
          .toString(16)
          .padStart(64, '0')}`,

      heartbeatPayloadHash:
        `0x${(index + 100)
          .toString(16)
          .padStart(64, '0')}`,

      heartbeatSequence:
        1000 + index,

      result:
        passing
          ? 'PASS'
          : 'FAIL',

      reasonCode:
        passing
          ? 'REGISTERED_OPERATOR'
          : 'REGISTRATION_MISMATCH'
    });
  }

  return slots;
}

function makeFinalizedWindow({
  reportingOperator,
  reportingSession,
  observedOperator,
  passes = 20,
  fails = 0,
  missing = 0,
  locallyQualified
}) {
  const received =
    passes + fails;

  const totalFailures =
    fails + missing;

  const qualified =
    locallyQualified === undefined
      ? (
          passes >= 18 &&
          totalFailures <= 2
        )
      : locallyQualified;

  return {
    schemaVersion: 1,
    protocolVersion:
      '2.0.0',

    reportingOperatorAddress:
      reportingOperator.address,

    reportingNodeId:
      'reporting-operator-node-0001',

    reportingSessionAddress:
      reportingSession.address,

    observedOperatorAddress:
      observedOperator.address,

    observedNodeId:
      'observed-node-0001',

    windowStartedAt:
      '2026-08-09T23:00:00.000Z',

    windowEndedAt:
      '2026-08-09T23:20:00.000Z',

    expectedObservations:
      20,

    receivedObservations:
      received,

    passCount:
      passes,

    failCount:
      fails,

    missingCount:
      missing,

    totalFailures,

    windowComplete:
      true,

    locallyQualified:
      qualified,

    slots:
      makeSlots({
        passes,
        fails
      })
  };
}

test(
  'builds and verifies a qualified signed Operator uptime report',
  () => {
    const reportingOperator =
      Wallet.createRandom();

    const reportingSession =
      Wallet.createRandom();

    const observedOperator =
      Wallet.createRandom();

    const finalizedWindow =
      makeFinalizedWindow({
        reportingOperator,
        reportingSession,
        observedOperator
      });

    const signed =
      buildSignedOperatorUptimeReport({
        finalizedWindow,
        privateKey:
          reportingSession.privateKey
      });

    const verified =
      verifySignedOperatorUptimeReport(
        signed
      );

    assert.equal(
      verified.valid,
      true
    );

    assert.equal(
      verified.reportingOperatorAddress,
      reportingOperator.address
    );

    assert.equal(
      verified.reportingSessionAddress,
      reportingSession.address
    );

    assert.equal(
      verified.observedOperatorAddress,
      observedOperator.address
    );

    assert.equal(
      verified.locallyQualified,
      true
    );
  }
);

test(
  'produces deterministic report hash and signature',
  () => {
    const reportingOperator =
      Wallet.createRandom();

    const reportingSession =
      Wallet.createRandom();

    const observedOperator =
      Wallet.createRandom();

    const finalizedWindow =
      makeFinalizedWindow({
        reportingOperator,
        reportingSession,
        observedOperator
      });

    const first =
      buildSignedOperatorUptimeReport({
        finalizedWindow,
        privateKey:
          reportingSession.privateKey
      });

    const second =
      buildSignedOperatorUptimeReport({
        finalizedWindow,
        privateKey:
          reportingSession.privateKey
      });

    assert.equal(
      first.reportHash,
      second.reportHash
    );

    assert.equal(
      first.signature,
      second.signature
    );
  }
);

test(
  'accepts 18 PASS and 2 missing as qualified',
  () => {
    const reportingOperator =
      Wallet.createRandom();

    const reportingSession =
      Wallet.createRandom();

    const observedOperator =
      Wallet.createRandom();

    const signed =
      buildSignedOperatorUptimeReport({
        finalizedWindow:
          makeFinalizedWindow({
            reportingOperator,
            reportingSession,
            observedOperator,
            passes: 18,
            fails: 0,
            missing: 2
          }),

        privateKey:
          reportingSession.privateKey
      });

    assert.equal(
      signed.locallyQualified,
      true
    );

    assert.equal(
      signed.totalFailures,
      2
    );
  }
);

test(
  'accepts 17 PASS and 3 missing as unqualified',
  () => {
    const reportingOperator =
      Wallet.createRandom();

    const reportingSession =
      Wallet.createRandom();

    const observedOperator =
      Wallet.createRandom();

    const signed =
      buildSignedOperatorUptimeReport({
        finalizedWindow:
          makeFinalizedWindow({
            reportingOperator,
            reportingSession,
            observedOperator,
            passes: 17,
            fails: 0,
            missing: 3
          }),

        privateKey:
          reportingSession.privateKey
      });

    assert.equal(
      signed.locallyQualified,
      false
    );

    assert.equal(
      signed.totalFailures,
      3
    );
  }
);

test(
  'rejects signing with the wrong session key',
  () => {
    const reportingOperator =
      Wallet.createRandom();

    const reportingSession =
      Wallet.createRandom();

    const wrongSession =
      Wallet.createRandom();

    const observedOperator =
      Wallet.createRandom();

    assert.throws(
      () =>
        buildSignedOperatorUptimeReport({
          finalizedWindow:
            makeFinalizedWindow({
              reportingOperator,
              reportingSession,
              observedOperator
            }),

          privateKey:
            wrongSession.privateKey
        }),
      /signer mismatch/
    );
  }
);

test(
  'rejects tampered aggregate count',
  () => {
    const reportingOperator =
      Wallet.createRandom();

    const reportingSession =
      Wallet.createRandom();

    const observedOperator =
      Wallet.createRandom();

    const signed =
      buildSignedOperatorUptimeReport({
        finalizedWindow:
          makeFinalizedWindow({
            reportingOperator,
            reportingSession,
            observedOperator
          }),

        privateKey:
          reportingSession.privateKey
      });

    const tampered = {
      ...signed,
      passCount: 19
    };

    assert.throws(
      () =>
        verifySignedOperatorUptimeReport(
          tampered
        ),
      /PASS\/FAIL counts do not match/
    );
  }
);

test(
  'rejects tampered observation commitment',
  () => {
    const reportingOperator =
      Wallet.createRandom();

    const reportingSession =
      Wallet.createRandom();

    const observedOperator =
      Wallet.createRandom();

    const signed =
      buildSignedOperatorUptimeReport({
        finalizedWindow:
          makeFinalizedWindow({
            reportingOperator,
            reportingSession,
            observedOperator
          }),

        privateKey:
          reportingSession.privateKey
      });

    const observations =
      signed.observations.map(
        item => ({ ...item })
      );

    observations[0].observationHash =
      `0x${'aa'.repeat(32)}`;

    const tampered = {
      ...signed,
      observations
    };

    assert.throws(
      () =>
        verifySignedOperatorUptimeReport(
          tampered
        ),
      /report hash mismatch/
    );
  }
);

test(
  'rejects false qualification claim',
  () => {
    const reportingOperator =
      Wallet.createRandom();

    const reportingSession =
      Wallet.createRandom();

    const observedOperator =
      Wallet.createRandom();

    assert.throws(
      () =>
        buildSignedOperatorUptimeReport({
          finalizedWindow:
            makeFinalizedWindow({
              reportingOperator,
              reportingSession,
              observedOperator,
              passes: 17,
              fails: 0,
              missing: 3,
              locallyQualified:
                true
            }),

          privateKey:
            reportingSession.privateKey
        }),
      /qualification does not match/
    );
  }
);

test(
  'rejects a report window that is not exactly 20 minutes',
  () => {
    const reportingOperator =
      Wallet.createRandom();

    const reportingSession =
      Wallet.createRandom();

    const observedOperator =
      Wallet.createRandom();

    const finalizedWindow =
      makeFinalizedWindow({
        reportingOperator,
        reportingSession,
        observedOperator
      });

    finalizedWindow.windowEndedAt =
      '2026-08-09T23:19:00.000Z';

    assert.throws(
      () =>
        buildSignedOperatorUptimeReport({
          finalizedWindow,
          privateKey:
            reportingSession.privateKey
        }),
      /must be exactly 20 minutes/
    );
  }
);

test(
  'rejects a slot outside the report window',
  () => {
    const reportingOperator =
      Wallet.createRandom();

    const reportingSession =
      Wallet.createRandom();

    const observedOperator =
      Wallet.createRandom();

    const finalizedWindow =
      makeFinalizedWindow({
        reportingOperator,
        reportingSession,
        observedOperator
      });

    finalizedWindow.slots[0] = {
      ...finalizedWindow.slots[0],
      slotStartedAt:
        '2026-08-09T22:59:00.000Z',
      observedAt:
        '2026-08-09T22:59:05.000Z'
    };

    assert.throws(
      () =>
        buildSignedOperatorUptimeReport({
          finalizedWindow,
          privateKey:
            reportingSession.privateKey
        }),
      /outside the report window/
    );
  }
);

test(
  'rejects a slot not aligned to the 60-second grid',
  () => {
    const reportingOperator =
      Wallet.createRandom();

    const reportingSession =
      Wallet.createRandom();

    const observedOperator =
      Wallet.createRandom();

    const finalizedWindow =
      makeFinalizedWindow({
        reportingOperator,
        reportingSession,
        observedOperator
      });

    finalizedWindow.slots[0] = {
      ...finalizedWindow.slots[0],
      slotStartedAt:
        '2026-08-09T23:00:30.000Z',
      observedAt:
        '2026-08-09T23:00:35.000Z'
    };

    assert.throws(
      () =>
        buildSignedOperatorUptimeReport({
          finalizedWindow,
          privateKey:
            reportingSession.privateKey
        }),
      /not aligned to the 60-second grid/
    );
  }
);

test(
  'rejects observation time outside its slot',
  () => {
    const reportingOperator =
      Wallet.createRandom();

    const reportingSession =
      Wallet.createRandom();

    const observedOperator =
      Wallet.createRandom();

    const finalizedWindow =
      makeFinalizedWindow({
        reportingOperator,
        reportingSession,
        observedOperator
      });

    finalizedWindow.slots[0] = {
      ...finalizedWindow.slots[0],
      observedAt:
        '2026-08-09T23:01:00.000Z'
    };

    assert.throws(
      () =>
        buildSignedOperatorUptimeReport({
          finalizedWindow,
          privateKey:
            reportingSession.privateKey
        }),
      /outside its observation slot/
    );
  }
);

test(
  'rejects duplicate observation slots',
  () => {
    const reportingOperator =
      Wallet.createRandom();

    const reportingSession =
      Wallet.createRandom();

    const observedOperator =
      Wallet.createRandom();

    const finalizedWindow =
      makeFinalizedWindow({
        reportingOperator,
        reportingSession,
        observedOperator
      });

    finalizedWindow.slots[1] = {
      ...finalizedWindow.slots[1],
      slotStartedAt:
        finalizedWindow.slots[0]
          .slotStartedAt,
      observedAt:
        '2026-08-09T23:00:10.000Z'
    };

    assert.throws(
      () =>
        buildSignedOperatorUptimeReport({
          finalizedWindow,
          privateKey:
            reportingSession.privateKey
        }),
      /duplicate observation slot/
    );
  }
);

test(
  'rejects observation slots that are not strictly ordered',
  () => {
    const reportingOperator =
      Wallet.createRandom();

    const reportingSession =
      Wallet.createRandom();

    const observedOperator =
      Wallet.createRandom();

    const finalizedWindow =
      makeFinalizedWindow({
        reportingOperator,
        reportingSession,
        observedOperator
      });

    const first =
      finalizedWindow.slots[0];

    finalizedWindow.slots[0] =
      finalizedWindow.slots[1];

    finalizedWindow.slots[1] =
      first;

    assert.throws(
      () =>
        buildSignedOperatorUptimeReport({
          finalizedWindow,
          privateKey:
            reportingSession.privateKey
        }),
      /must be strictly ordered/
    );
  }
);

test(
  'rejects more observations than the window allows',
  () => {
    const reportingOperator =
      Wallet.createRandom();

    const reportingSession =
      Wallet.createRandom();

    const observedOperator =
      Wallet.createRandom();

    const finalizedWindow =
      makeFinalizedWindow({
        reportingOperator,
        reportingSession,
        observedOperator
      });

    finalizedWindow.slots.push({
      slotStartedAt:
        '2026-08-09T23:19:00.000Z',
      observedAt:
        '2026-08-09T23:19:10.000Z',
      observationHash:
        `0x${'ab'.repeat(32)}`,
      heartbeatPayloadHash:
        `0x${'cd'.repeat(32)}`,
      heartbeatSequence:
        9999,
      result:
        'PASS',
      reasonCode:
        'REGISTERED_OPERATOR'
    });

    finalizedWindow.receivedObservations =
      21;

    finalizedWindow.passCount =
      21;

    finalizedWindow.missingCount =
      0;

    assert.throws(
      () =>
        buildSignedOperatorUptimeReport({
          finalizedWindow,
          privateKey:
            reportingSession.privateKey
        }),
      /more observations than the window allows/
    );
  }
);
