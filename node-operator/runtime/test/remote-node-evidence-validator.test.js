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
} = require('../src/evidence/signed-heartbeat-builder');

const {
  validateRemoteNodeEvidence
} = require(
  '../src/evidence/remote-node-evidence-validator'
);

const CHAIN_ID = 5546;

const REMOTE_NODE_ID =
  'remote-operator-node-0001';

const LOCAL_NODE_ID =
  'local-operator-node-0001';

const STATUS = Object.freeze({
  chainId: CHAIN_ID,
  connected: true,
  rpcHealthy: true,
  walletMatched: true,
  registered: true,
  tier: 'Operator',
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
});

async function createFixture(options = {}) {
  const remoteOperator =
    Wallet.createRandom();

  const remoteSession =
    Wallet.createRandom();

  const localOperator =
    Wallet.createRandom();

  const issuedAt =
    options.issuedAt ||
    '2026-08-09T23:00:00.000Z';

  const authorizationExpiresAt =
    options.authorizationExpiresAt ||
    '2026-08-10T23:00:00.000Z';

  const heartbeatExpiresAt =
    options.heartbeatExpiresAt ||
    '2026-08-09T23:01:00.000Z';

  const delegation = {
    version: 1,
    purpose: 'operator-heartbeat',
    chainId: CHAIN_ID,
    operatorAddress:
      remoteOperator.address,
    nodeId:
      options.remoteNodeId ||
      REMOTE_NODE_ID,
    sessionAddress:
      remoteSession.address,
    issuedAt:
      '2026-08-09T22:00:00.000Z',
    expiresAt:
      authorizationExpiresAt
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
      authorizationExpiresAt,
      nodeId:
        options.remoteNodeId ||
        REMOTE_NODE_ID,
      sequence:
        10,
      issuedAt,
      expiresAt:
        heartbeatExpiresAt,
      nonce:
        '11'.repeat(32),
      status:
        STATUS
    });

  return {
    remoteOperator,
    remoteSession,
    localOperator,
    authorization,
    heartbeat
  };
}

test(
  'accepts valid evidence from another node',
  async () => {
    const fixture =
      await createFixture();

    const result =
      validateRemoteNodeEvidence({
        heartbeat:
          fixture.heartbeat,
        authorization:
          fixture.authorization,
        localOperatorAddress:
          fixture.localOperator.address,
        localNodeId:
          LOCAL_NODE_ID,
        now:
          new Date(
            '2026-08-09T23:00:30.000Z'
          )
      });

    assert.equal(result.valid, true);
    assert.equal(
      result.operatorAddress,
      fixture.remoteOperator.address
    );
    assert.equal(
      result.sessionAddress,
      fixture.remoteSession.address
    );
    assert.equal(
      result.nodeId,
      REMOTE_NODE_ID
    );
    assert.equal(
      result.payloadHash,
      fixture.heartbeat.payloadHash
    );
  }
);

test(
  'rejects observation of its own operator identity',
  async () => {
    const fixture =
      await createFixture();

    assert.throws(
      () =>
        validateRemoteNodeEvidence({
          heartbeat:
            fixture.heartbeat,
          authorization:
            fixture.authorization,
          localOperatorAddress:
            fixture.remoteOperator.address,
          localNodeId:
            LOCAL_NODE_ID,
          now:
            new Date(
              '2026-08-09T23:00:30.000Z'
            )
        }),
      /must not observe its own operator identity/
    );
  }
);

test(
  'rejects observation of its own node identity',
  async () => {
    const fixture =
      await createFixture({
        remoteNodeId:
          LOCAL_NODE_ID
      });

    assert.throws(
      () =>
        validateRemoteNodeEvidence({
          heartbeat:
            fixture.heartbeat,
          authorization:
            fixture.authorization,
          localOperatorAddress:
            fixture.localOperator.address,
          localNodeId:
            LOCAL_NODE_ID,
          now:
            new Date(
              '2026-08-09T23:00:30.000Z'
            )
        }),
      /must not observe its own node identity/
    );
  }
);

test(
  'rejects delegation for a different session',
  async () => {
    const fixture =
      await createFixture();

    const otherSession =
      Wallet.createRandom();

    const badAuthorization = {
      ...fixture.authorization,
      delegation: {
        ...fixture.authorization.delegation,
        sessionAddress:
          otherSession.address
      }
    };

    assert.throws(
      () =>
        validateRemoteNodeEvidence({
          heartbeat:
            fixture.heartbeat,
          authorization:
            badAuthorization,
          localOperatorAddress:
            fixture.localOperator.address,
          localNodeId:
            LOCAL_NODE_ID,
          now:
            new Date(
              '2026-08-09T23:00:30.000Z'
            )
        }),
      /session does not match heartbeat session/
    );
  }
);

test(
  'rejects invalid heartbeat session signature',
  async () => {
    const fixture =
      await createFixture();

    const attacker =
      Wallet.createRandom();

    const tampered = {
      ...fixture.heartbeat,
      signature:
        attacker.signingKey.sign(
          fixture.heartbeat.payloadHash
        ).serialized
    };

    assert.throws(
      () =>
        validateRemoteNodeEvidence({
          heartbeat:
            tampered,
          authorization:
            fixture.authorization,
          localOperatorAddress:
            fixture.localOperator.address,
          localNodeId:
            LOCAL_NODE_ID,
          now:
            new Date(
              '2026-08-09T23:00:30.000Z'
            )
        }),
      /signature signer mismatch/
    );
  }
);

test(
  'rejects expired heartbeat',
  async () => {
    const fixture =
      await createFixture();

    assert.throws(
      () =>
        validateRemoteNodeEvidence({
          heartbeat:
            fixture.heartbeat,
          authorization:
            fixture.authorization,
          localOperatorAddress:
            fixture.localOperator.address,
          localNodeId:
            LOCAL_NODE_ID,
          now:
            new Date(
              '2026-08-09T23:01:30.001Z'
            ),
          maxClockSkewMs:
            0
        }),
      /heartbeat has expired/
    );
  }
);

test(
  'rejects heartbeat issued too far in future',
  async () => {
    const fixture =
      await createFixture({
        issuedAt:
          '2026-08-09T23:01:00.000Z',
        heartbeatExpiresAt:
          '2026-08-09T23:02:00.000Z'
      });

    assert.throws(
      () =>
        validateRemoteNodeEvidence({
          heartbeat:
            fixture.heartbeat,
          authorization:
            fixture.authorization,
          localOperatorAddress:
            fixture.localOperator.address,
          localNodeId:
            LOCAL_NODE_ID,
          now:
            new Date(
              '2026-08-09T23:00:00.000Z'
            ),
          maxClockSkewMs:
            15_000
        }),
      /issued too far in the future/
    );
  }
);
