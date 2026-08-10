'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  Wallet
} = require('ethers');

const {
  canonicalHash
} = require('../src/evidence/hashing');

const {
  buildSignedHeartbeat
} = require(
  '../src/evidence/signed-heartbeat-builder'
);

const {
  createNodeObservationWorker
} = require(
  '../src/evidence/node-observation-worker'
);

const CHAIN_ID = 5546;

const LOCAL_NODE_ID =
  'local-observer-node-0001';

const REMOTE_NODE_ID =
  'remote-observed-node-0001';

const OBSERVED_AT =
  '2026-08-09T23:00:30.000Z';

function makeStatus(
  tier = 'Operator'
) {
  return {
    chainId: CHAIN_ID,
    connected: true,
    rpcHealthy: true,
    walletMatched: true,
    registered: true,
    tier,
    uptimeSeconds: 600,
    rewardEligible: false,
    verification: {
      connected: true,
      verified: false,
      reasonCode:
        'UPTIME_VERIFICATION_PENDING'
    },
    metrics: {
      pendingRewardsBaseUnits: '0'
    }
  };
}

async function makeFixture(
  {
    tier = 'Operator'
  } = {}
) {
  const remoteOperator =
    Wallet.createRandom();

  const remoteSession =
    Wallet.createRandom();

  const localOperator =
    Wallet.createRandom();

  const delegation = {
    version: 1,
    purpose: 'operator-heartbeat',
    chainId: CHAIN_ID,
    operatorAddress:
      remoteOperator.address,
    nodeId:
      REMOTE_NODE_ID,
    sessionAddress:
      remoteSession.address,
    issuedAt:
      '2026-08-09T22:00:00.000Z',
    expiresAt:
      '2026-08-10T23:00:00.000Z'
  };

  const delegationSignature =
    await remoteOperator.signMessage(
      JSON.stringify(delegation)
    );

  const authorization = {
    version: 1,
    delegation,
    delegationSignature
  };

  const status =
    makeStatus(tier);

  const heartbeat =
    buildSignedHeartbeat({
      privateKey:
        remoteSession.privateKey,
      protocolVersion:
        '2.0.0',
      chainId:
        CHAIN_ID,
      operatorAddress:
        remoteOperator.address,
      sessionAddress:
        remoteSession.address,
      delegationHash:
        canonicalHash(delegation),
      authorizationExpiresAt:
        delegation.expiresAt,
      nodeId:
        REMOTE_NODE_ID,
      sequence:
        10,
      issuedAt:
        '2026-08-09T23:00:00.000Z',
      expiresAt:
        '2026-08-09T23:01:00.000Z',
      nonce:
        '11'.repeat(32),
      status
    });

  return {
    remoteOperator,
    remoteSession,
    localOperator,
    authorization,
    status,
    heartbeat
  };
}

function makeReplayState() {
  const accepted = [];

  return {
    accepted,

    async acceptHeartbeat(
      evidence
    ) {
      accepted.push({
        ...evidence
      });

      return evidence;
    }
  };
}

function makeNodeStatus({
  tier = 'Operator',
  stakeAtomic,
  isNodeWallet = true,
  registered = true
} = {}) {
  const resolvedStake =
    stakeAtomic ||
    (
      tier === 'Validator'
        ? '75000000000000'
        : '30000000000000'
    );

  return {
    address:
      '0x1111111111111111111111111111111111111111',

    registered,

    isNodeWallet,

    tier:
      registered
        ? (
            tier === 'Validator'
              ? '2'
              : '1'
          )
        : '0',

    tierLabel:
      registered
        ? tier
        : 'Not Registered',

    stakeAtomic:
      resolvedStake,

    operatorStakeRequirementAtomic:
      '30000000000000',

    validatorStakeRequirementAtomic:
      '75000000000000'
  };
}

test(
  'produces PASS for valid observed Operator',
  async () => {
    const fixture =
      await makeFixture({
        tier: 'Operator'
      });

    const replayState =
      makeReplayState();

    let queriedAddress = null;

    const worker =
      createNodeObservationWorker({
        localOperatorAddress:
          fixture.localOperator.address,

        localNodeId:
          LOCAL_NODE_ID,

        replayState,

        readRemoteNodeStatus:
          async address => {
            queriedAddress = address;

            return makeNodeStatus({
              tier: 'Operator'
            });
          },

        clock:
          () => new Date(OBSERVED_AT)
      });

    const observation =
      await worker.observe({
        heartbeat:
          fixture.heartbeat,

        authorization:
          fixture.authorization,

        status:
          fixture.status
      });

    assert.equal(
      observation.result,
      'PASS'
    );

    assert.equal(
      observation.reasonCode,
      'REGISTERED_OPERATOR'
    );

    assert.equal(
      observation.claimedTier,
      'Operator'
    );

    assert.equal(
      observation.registration.passed,
      true
    );

    assert.equal(
      observation.registration
        .stakeRequirementMet,
      true
    );

    assert.equal(
      queriedAddress,
      fixture.remoteOperator.address
    );

    assert.equal(
      replayState.accepted.length,
      1
    );

    assert.equal(
      replayState.accepted[0]
        .payloadHash,
      fixture.heartbeat.payloadHash
    );
  }
);

test(
  'produces PASS for valid observed Validator',
  async () => {
    const fixture =
      await makeFixture({
        tier: 'Validator'
      });

    const worker =
      createNodeObservationWorker({
        localOperatorAddress:
          fixture.localOperator.address,

        localNodeId:
          LOCAL_NODE_ID,

        replayState:
          makeReplayState(),

        readRemoteNodeStatus:
          async () =>
            makeNodeStatus({
              tier: 'Validator'
            }),

        clock:
          () => new Date(OBSERVED_AT)
      });

    const observation =
      await worker.observe({
        heartbeat:
          fixture.heartbeat,

        authorization:
          fixture.authorization,

        status:
          fixture.status
      });

    assert.equal(
      observation.result,
      'PASS'
    );

    assert.equal(
      observation.reasonCode,
      'REGISTERED_VALIDATOR'
    );

    assert.equal(
      observation.claimedTier,
      'Validator'
    );

    assert.equal(
      observation.registration
        .onChainTier,
      'Validator'
    );
  }
);

test(
  'produces FAIL for on-chain tier mismatch',
  async () => {
    const fixture =
      await makeFixture({
        tier: 'Validator'
      });

    const worker =
      createNodeObservationWorker({
        localOperatorAddress:
          fixture.localOperator.address,

        localNodeId:
          LOCAL_NODE_ID,

        replayState:
          makeReplayState(),

        readRemoteNodeStatus:
          async () =>
            makeNodeStatus({
              tier: 'Operator'
            }),

        clock:
          () => new Date(OBSERVED_AT)
      });

    const observation =
      await worker.observe({
        heartbeat:
          fixture.heartbeat,

        authorization:
          fixture.authorization,

        status:
          fixture.status
      });

    assert.equal(
      observation.result,
      'FAIL'
    );

    assert.equal(
      observation.reasonCode,
      'REGISTRATION_MISMATCH'
    );

    assert.equal(
      observation.registration.passed,
      false
    );

    assert.equal(
      observation.registration
        .configuredTierMatches,
      false
    );
  }
);

test(
  'produces FAIL for insufficient stake',
  async () => {
    const fixture =
      await makeFixture({
        tier: 'Operator'
      });

    const worker =
      createNodeObservationWorker({
        localOperatorAddress:
          fixture.localOperator.address,

        localNodeId:
          LOCAL_NODE_ID,

        replayState:
          makeReplayState(),

        readRemoteNodeStatus:
          async () =>
            makeNodeStatus({
              tier: 'Operator',
              stakeAtomic:
                '29999999999999'
            }),

        clock:
          () => new Date(OBSERVED_AT)
      });

    const observation =
      await worker.observe({
        heartbeat:
          fixture.heartbeat,

        authorization:
          fixture.authorization,

        status:
          fixture.status
      });

    assert.equal(
      observation.result,
      'FAIL'
    );

    assert.equal(
      observation.reasonCode,
      'REGISTRATION_MISMATCH'
    );

    assert.equal(
      observation.registration
        .stakeRequirementMet,
      false
    );
  }
);

test(
  'rejects status evidence not committed by heartbeat',
  async () => {
    const fixture =
      await makeFixture({
        tier: 'Operator'
      });

    const replayState =
      makeReplayState();

    let contractReads = 0;

    const worker =
      createNodeObservationWorker({
        localOperatorAddress:
          fixture.localOperator.address,

        localNodeId:
          LOCAL_NODE_ID,

        replayState,

        readRemoteNodeStatus:
          async () => {
            contractReads += 1;

            return makeNodeStatus({
              tier: 'Operator'
            });
          },

        clock:
          () => new Date(OBSERVED_AT)
      });

    const tamperedStatus = {
      ...fixture.status,
      tier: 'Validator'
    };

    await assert.rejects(
      worker.observe({
        heartbeat:
          fixture.heartbeat,

        authorization:
          fixture.authorization,

        status:
          tamperedStatus
      }),
      /does not match heartbeat statusHash/
    );

    assert.equal(
      replayState.accepted.length,
      0
    );

    assert.equal(
      contractReads,
      0
    );
  }
);

test(
  'propagates replay rejection before contract read',
  async () => {
    const fixture =
      await makeFixture();

    let contractReads = 0;

    const replayState = {
      async acceptHeartbeat() {
        throw new Error(
          'Observed heartbeat sequence replay detected'
        );
      }
    };

    const worker =
      createNodeObservationWorker({
        localOperatorAddress:
          fixture.localOperator.address,

        localNodeId:
          LOCAL_NODE_ID,

        replayState,

        readRemoteNodeStatus:
          async () => {
            contractReads += 1;

            return makeNodeStatus();
          },

        clock:
          () => new Date(OBSERVED_AT)
      });

    await assert.rejects(
      worker.observe({
        heartbeat:
          fixture.heartbeat,

        authorization:
          fixture.authorization,

        status:
          fixture.status
      }),
      /sequence replay detected/
    );

    assert.equal(
      contractReads,
      0
    );
  }
);
