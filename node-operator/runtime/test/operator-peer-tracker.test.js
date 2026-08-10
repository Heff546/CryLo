'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { Wallet } = require('ethers');

const {
  buildSignedNodeObservation
} = require(
  '../src/evidence/signed-node-observation'
);

const {
  buildSignedOperatorUptimeReport
} = require(
  '../src/evidence/signed-operator-uptime-report'
);

const {
  createOperatorPeerTracker
} = require(
  '../src/evidence/operator-peer-tracker'
);

async function makeTempState() {
  const directory =
    await fs.mkdtemp(
      path.join(
        os.tmpdir(),
        'crylonexus-peer-tracker-'
      )
    );

  return {
    directory,
    statePath:
      path.join(
        directory,
        'peer-windows.json'
      )
  };
}

function makeObservation({
  reporter,
  reporterSession,
  reporterNodeId,
  target,
  targetSession,
  targetNodeId,
  observedAt,
  sequence,
  result = 'PASS',
  tier = 'Operator'
}) {
  const passed =
    result === 'PASS';

  return buildSignedNodeObservation({
    observingOperatorAddress:
      reporter.address,

    observingNodeId:
      reporterNodeId,

    observingSessionPrivateKey:
      reporterSession.privateKey,

    observation: {
      protocolVersion:
        '2.0.0',

      chainId:
        5546,

      observedOperatorAddress:
        target.address,

      observedNodeId:
        targetNodeId,

      observedSessionAddress:
        targetSession.address,

      heartbeatSequence:
        sequence,

      heartbeatPayloadHash:
        `0x${sequence
          .toString(16)
          .padStart(64, '0')}`,

      statusHash:
        `0x${(sequence + 1000)
          .toString(16)
          .padStart(64, '0')}`,

      observedAt,

      claimedTier:
        tier,

      registration: {
        passed,
        registered: true,
        isNodeWallet: true,
        onChainTier:
          tier,
        stakeAtomic:
          tier === 'Validator'
            ? '75000000000000'
            : '30000000000000',
        stakeRequirementAtomic:
          tier === 'Validator'
            ? '75000000000000'
            : '30000000000000',
        configuredTierMatches:
          passed,
        stakeRequirementMet:
          passed,
        messageCode:
          passed
            ? `REGISTERED_${tier.toUpperCase()}`
            : 'REGISTRATION_MISMATCH'
      },

      result,

      reasonCode:
        passed
          ? `REGISTERED_${tier.toUpperCase()}`
          : 'REGISTRATION_MISMATCH'
    }
  });
}

test(
  'tracks multiple peers independently',
  async () => {
    const temp =
      await makeTempState();

    try {
      const reporter =
        Wallet.createRandom();

      const reporterSession =
        Wallet.createRandom();

      const operatorPeer =
        Wallet.createRandom();

      const operatorPeerSession =
        Wallet.createRandom();

      const validatorPeer =
        Wallet.createRandom();

      const validatorPeerSession =
        Wallet.createRandom();

      const tracker =
        await createOperatorPeerTracker({
          reportingOperatorAddress:
            reporter.address,

          reportingNodeId:
            'reporting-operator-node-0001',

          reportingSessionAddress:
            reporterSession.address,

          statePath:
            temp.statePath
        });

      await tracker.recordObservation(
        makeObservation({
          reporter,
          reporterSession,
          reporterNodeId:
            'reporting-operator-node-0001',
          target:
            operatorPeer,
          targetSession:
            operatorPeerSession,
          targetNodeId:
            'operator-peer-node-0001',
          observedAt:
            '2026-08-09T23:00:05.000Z',
          sequence: 1,
          tier:
            'Operator'
        })
      );

      await tracker.recordObservation(
        makeObservation({
          reporter,
          reporterSession,
          reporterNodeId:
            'reporting-operator-node-0001',
          target:
            validatorPeer,
          targetSession:
            validatorPeerSession,
          targetNodeId:
            'validator-peer-node-0001',
          observedAt:
            '2026-08-09T23:00:10.000Z',
          sequence: 2,
          tier:
            'Validator'
        })
      );

      const operatorState =
        await tracker.getPeerState(
          operatorPeer.address,
          'operator-peer-node-0001',
          new Date(
            '2026-08-09T23:00:30.000Z'
          )
        );

      const validatorState =
        await tracker.getPeerState(
          validatorPeer.address,
          'validator-peer-node-0001',
          new Date(
            '2026-08-09T23:00:30.000Z'
          )
        );

      assert.equal(
        operatorState.receivedObservations,
        1
      );

      assert.equal(
        validatorState.receivedObservations,
        1
      );

      assert.equal(
        operatorState.observedNodeId,
        'operator-peer-node-0001'
      );

      assert.equal(
        validatorState.observedNodeId,
        'validator-peer-node-0001'
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
  'keeps separate slots for separate peers',
  async () => {
    const temp =
      await makeTempState();

    try {
      const reporter =
        Wallet.createRandom();

      const reporterSession =
        Wallet.createRandom();

      const peerA =
        Wallet.createRandom();

      const peerASession =
        Wallet.createRandom();

      const peerB =
        Wallet.createRandom();

      const peerBSession =
        Wallet.createRandom();

      const tracker =
        await createOperatorPeerTracker({
          reportingOperatorAddress:
            reporter.address,

          reportingNodeId:
            'reporting-operator-node-0001',

          reportingSessionAddress:
            reporterSession.address,

          statePath:
            temp.statePath
        });

      await tracker.recordObservation(
        makeObservation({
          reporter,
          reporterSession,
          reporterNodeId:
            'reporting-operator-node-0001',
          target:
            peerA,
          targetSession:
            peerASession,
          targetNodeId:
            'peer-a-node-0001',
          observedAt:
            '2026-08-09T23:00:05.000Z',
          sequence: 10
        })
      );

      await tracker.recordObservation(
        makeObservation({
          reporter,
          reporterSession,
          reporterNodeId:
            'reporting-operator-node-0001',
          target:
            peerB,
          targetSession:
            peerBSession,
          targetNodeId:
            'peer-b-node-0001',
          observedAt:
            '2026-08-09T23:00:06.000Z',
          sequence: 11
        })
      );

      const states =
        await tracker.getAllPeerStates(
          new Date(
            '2026-08-09T23:00:30.000Z'
          )
        );

      assert.equal(
        states.length,
        2
      );

      assert.equal(
        states.every(
          state =>
            state.receivedObservations === 1
        ),
        true
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
  'persists multiple peer windows across restart',
  async () => {
    const temp =
      await makeTempState();

    try {
      const reporter =
        Wallet.createRandom();

      const reporterSession =
        Wallet.createRandom();

      const peerA =
        Wallet.createRandom();

      const peerASession =
        Wallet.createRandom();

      const peerB =
        Wallet.createRandom();

      const peerBSession =
        Wallet.createRandom();

      const options = {
        reportingOperatorAddress:
          reporter.address,

        reportingNodeId:
          'reporting-operator-node-0001',

        reportingSessionAddress:
          reporterSession.address,

        statePath:
          temp.statePath
      };

      const first =
        await createOperatorPeerTracker(
          options
        );

      await first.recordObservation(
        makeObservation({
          reporter,
          reporterSession,
          reporterNodeId:
            options.reportingNodeId,
          target:
            peerA,
          targetSession:
            peerASession,
          targetNodeId:
            'peer-a-node-0001',
          observedAt:
            '2026-08-09T23:00:05.000Z',
          sequence: 20
        })
      );

      await first.recordObservation(
        makeObservation({
          reporter,
          reporterSession,
          reporterNodeId:
            options.reportingNodeId,
          target:
            peerB,
          targetSession:
            peerBSession,
          targetNodeId:
            'peer-b-node-0001',
          observedAt:
            '2026-08-09T23:01:05.000Z',
          sequence: 21
        })
      );

      const restarted =
        await createOperatorPeerTracker(
          options
        );

      const states =
        await restarted.getAllPeerStates(
          new Date(
            '2026-08-09T23:02:00.000Z'
          )
        );

      assert.equal(
        states.length,
        2
      );

      assert.equal(
        states.reduce(
          (sum, state) =>
            sum +
            state.receivedObservations,
          0
        ),
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
  'completed peer window is preserved until explicit finalization',
  async () => {
    const temp =
      await makeTempState();

    try {
      const reporter =
        Wallet.createRandom();

      const reporterSession =
        Wallet.createRandom();

      const peer =
        Wallet.createRandom();

      const peerSession =
        Wallet.createRandom();

      const tracker =
        await createOperatorPeerTracker({
          reportingOperatorAddress:
            reporter.address,

          reportingNodeId:
            'reporting-operator-node-0001',

          reportingSessionAddress:
            reporterSession.address,

          statePath:
            temp.statePath
        });

      for (
        let index = 0;
        index < 20;
        index += 1
      ) {
        const minute =
          String(index).padStart(2, '0');

        await tracker.recordObservation(
          makeObservation({
            reporter,
            reporterSession,
            reporterNodeId:
              'reporting-operator-node-0001',
            target:
              peer,
            targetSession:
              peerSession,
            targetNodeId:
              'completed-peer-node-0001',
            observedAt:
              `2026-08-09T23:${minute}:05.000Z`,
            sequence:
              100 + index
          })
        );
      }

      const completed =
        await tracker.getPeerState(
          peer.address,
          'completed-peer-node-0001',
          new Date(
            '2026-08-09T23:20:00.000Z'
          )
        );

      assert.equal(
        completed.windowComplete,
        true
      );

      assert.equal(
        completed.receivedObservations,
        20
      );

      assert.equal(
        completed.passCount,
        20
      );

      assert.equal(
        completed.locallyQualified,
        true
      );

      await assert.rejects(
        tracker.recordObservation(
          makeObservation({
            reporter,
            reporterSession,
            reporterNodeId:
              'reporting-operator-node-0001',
            target:
              peer,
            targetSession:
              peerSession,
            targetNodeId:
              'completed-peer-node-0001',
            observedAt:
              '2026-08-09T23:20:05.000Z',
            sequence:
              120
          })
        ),
        /must be finalized before rollover/
      );

      const preserved =
        await tracker.getPeerState(
          peer.address,
          'completed-peer-node-0001',
          new Date(
            '2026-08-09T23:20:10.000Z'
          )
        );

      assert.equal(
        preserved.receivedObservations,
        20
      );

      assert.equal(
        preserved.passCount,
        20
      );

      assert.equal(
        preserved.slots.length,
        20
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
  'finalizes a completed peer window and removes it from active peers',
  async () => {
    const temp =
      await makeTempState();

    try {
      const reporter =
        Wallet.createRandom();

      const reporterSession =
        Wallet.createRandom();

      const peer =
        Wallet.createRandom();

      const peerSession =
        Wallet.createRandom();

      const tracker =
        await createOperatorPeerTracker({
          reportingOperatorAddress:
            reporter.address,
          reportingNodeId:
            'reporting-operator-node-0001',
          reportingSessionAddress:
            reporterSession.address,
          signUptimeReport:
            finalizedWindow =>
              buildSignedOperatorUptimeReport({
                finalizedWindow,
                privateKey:
                  reporterSession.privateKey
              }),
          statePath:
            temp.statePath
        });

      for (
        let index = 0;
        index < 20;
        index += 1
      ) {
        const minute =
          String(index).padStart(2, '0');

        await tracker.recordObservation(
          makeObservation({
            reporter,
            reporterSession,
            reporterNodeId:
              'reporting-operator-node-0001',
            target:
              peer,
            targetSession:
              peerSession,
            targetNodeId:
              'finalized-peer-node-0001',
            observedAt:
              `2026-08-09T23:${minute}:05.000Z`,
            sequence:
              200 + index
          })
        );
      }

      const finalized =
        await tracker.finalizePeerWindow(
          peer.address,
          'finalized-peer-node-0001',
          new Date(
            '2026-08-09T23:20:00.000Z'
          )
        );

      assert.equal(
        typeof finalized.reportHash,
        'string'
      );

      assert.equal(
        typeof finalized.signature,
        'string'
      );

      assert.equal(
        finalized.receivedObservations,
        20
      );

      assert.equal(
        finalized.passCount,
        20
      );

      assert.equal(
        finalized.locallyQualified,
        true
      );

      assert.equal(
        finalized.reportingOperatorAddress,
        reporter.address
      );

      assert.equal(
        finalized.reportingNodeId,
        'reporting-operator-node-0001'
      );

      const active =
        await tracker.getPeerState(
          peer.address,
          'finalized-peer-node-0001',
          new Date(
            '2026-08-09T23:20:00.000Z'
          )
        );

      assert.equal(
        active,
        null
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
  'opens a fresh window after completed peer window is finalized',
  async () => {
    const temp =
      await makeTempState();

    try {
      const reporter =
        Wallet.createRandom();

      const reporterSession =
        Wallet.createRandom();

      const peer =
        Wallet.createRandom();

      const peerSession =
        Wallet.createRandom();

      const tracker =
        await createOperatorPeerTracker({
          reportingOperatorAddress:
            reporter.address,
          reportingNodeId:
            'reporting-operator-node-0001',
          reportingSessionAddress:
            reporterSession.address,
          signUptimeReport:
            finalizedWindow =>
              buildSignedOperatorUptimeReport({
                finalizedWindow,
                privateKey:
                  reporterSession.privateKey
              }),
          statePath:
            temp.statePath
        });

      for (
        let index = 0;
        index < 20;
        index += 1
      ) {
        const minute =
          String(index).padStart(2, '0');

        await tracker.recordObservation(
          makeObservation({
            reporter,
            reporterSession,
            reporterNodeId:
              'reporting-operator-node-0001',
            target:
              peer,
            targetSession:
              peerSession,
            targetNodeId:
              'rollover-peer-node-0001',
            observedAt:
              `2026-08-09T23:${minute}:05.000Z`,
            sequence:
              300 + index
          })
        );
      }

      await tracker.finalizePeerWindow(
        peer.address,
        'rollover-peer-node-0001',
        new Date(
          '2026-08-09T23:20:00.000Z'
        )
      );

      await tracker.recordObservation(
        makeObservation({
          reporter,
          reporterSession,
          reporterNodeId:
            'reporting-operator-node-0001',
          target:
            peer,
          targetSession:
            peerSession,
          targetNodeId:
            'rollover-peer-node-0001',
          observedAt:
            '2026-08-09T23:20:05.000Z',
          sequence:
            320
        })
      );

      const next =
        await tracker.getPeerState(
          peer.address,
          'rollover-peer-node-0001',
          new Date(
            '2026-08-09T23:20:30.000Z'
          )
        );

      assert.equal(
        next.receivedObservations,
        1
      );

      assert.equal(
        next.windowStartedAt,
        '2026-08-09T23:20:00.000Z'
      );

      assert.equal(
        next.windowComplete,
        false
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
  'preserves completed peer window when report signing cannot occur',
  async () => {
    const temp =
      await makeTempState();

    try {
      const reporter =
        Wallet.createRandom();

      const reporterSession =
        Wallet.createRandom();

      const peer =
        Wallet.createRandom();

      const peerSession =
        Wallet.createRandom();

      const tracker =
        await createOperatorPeerTracker({
          reportingOperatorAddress:
            reporter.address,
          reportingNodeId:
            'reporting-operator-node-0001',
          reportingSessionAddress:
            reporterSession.address,
          statePath:
            temp.statePath
        });

      for (
        let index = 0;
        index < 20;
        index += 1
      ) {
        const minute =
          String(index).padStart(2, '0');

        await tracker.recordObservation(
          makeObservation({
            reporter,
            reporterSession,
            reporterNodeId:
              'reporting-operator-node-0001',
            target:
              peer,
            targetSession:
              peerSession,
            targetNodeId:
              'signing-failure-peer-node-0001',
            observedAt:
              `2026-08-09T23:${minute}:05.000Z`,
            sequence:
              400 + index
          })
        );
      }

      await assert.rejects(
        tracker.finalizePeerWindow(
          peer.address,
          'signing-failure-peer-node-0001',
          new Date(
            '2026-08-09T23:20:00.000Z'
          )
        ),
        /uptime report signer is required/
      );

      const preserved =
        await tracker.getPeerState(
          peer.address,
          'signing-failure-peer-node-0001',
          new Date(
            '2026-08-09T23:20:10.000Z'
          )
        );

      assert.equal(
        preserved.windowComplete,
        true
      );

      assert.equal(
        preserved.receivedObservations,
        20
      );

      assert.equal(
        preserved.passCount,
        20
      );

      assert.equal(
        preserved.slots.length,
        20
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
