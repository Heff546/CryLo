'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  Wallet
} = require('ethers');

const {
  buildSignedNodeObservation,
  verifySignedNodeObservation
} = require(
  '../src/evidence/signed-node-observation'
);

const OBSERVING_NODE_ID =
  'observing-node-0001';

const OBSERVED_NODE_ID =
  'observed-node-0001';

function makeObservation(
  overrides = {}
) {
  const observedOperator =
    Wallet.createRandom();

  const observedSession =
    Wallet.createRandom();

  return {
    protocolVersion:
      '2.0.0',

    chainId:
      5546,

    observedOperatorAddress:
      observedOperator.address,

    observedNodeId:
      OBSERVED_NODE_ID,

    observedSessionAddress:
      observedSession.address,

    heartbeatSequence:
      10,

    heartbeatPayloadHash:
      `0x${'11'.repeat(32)}`,

    statusHash:
      `0x${'22'.repeat(32)}`,

    observedAt:
      '2026-08-09T23:00:30.000Z',

    claimedTier:
      'Operator',

    registration: {
      passed: true,
      registered: true,
      isNodeWallet: true,
      onChainTier:
        'Operator',
      stakeAtomic:
        '30000000000000',
      stakeRequirementAtomic:
        '30000000000000',
      configuredTierMatches:
        true,
      stakeRequirementMet:
        true,
      messageCode:
        'REGISTERED_OPERATOR'
    },

    result:
      'PASS',

    reasonCode:
      'REGISTERED_OPERATOR',

    ...overrides
  };
}

test(
  'builds and verifies a signed node observation',
  () => {
    const observingOperator =
      Wallet.createRandom();

    const observingSession =
      Wallet.createRandom();

    const observation =
      makeObservation();

    const signed =
      buildSignedNodeObservation({
        observation,

        observingOperatorAddress:
          observingOperator.address,

        observingNodeId:
          OBSERVING_NODE_ID,

        observingSessionPrivateKey:
          observingSession.privateKey
      });

    const verified =
      verifySignedNodeObservation(
        signed
      );

    assert.equal(
      verified.valid,
      true
    );

    assert.equal(
      verified.observingOperatorAddress,
      observingOperator.address
    );

    assert.equal(
      verified.observingSessionAddress,
      observingSession.address
    );

    assert.equal(
      verified.observedNodeId,
      OBSERVED_NODE_ID
    );

    assert.equal(
      verified.result,
      'PASS'
    );
  }
);

test(
  'produces deterministic observation hash and signature',
  () => {
    const observingOperator =
      Wallet.createRandom();

    const observingSession =
      Wallet.createRandom();

    const observation =
      makeObservation();

    const first =
      buildSignedNodeObservation({
        observation,

        observingOperatorAddress:
          observingOperator.address,

        observingNodeId:
          OBSERVING_NODE_ID,

        observingSessionPrivateKey:
          observingSession.privateKey
      });

    const second =
      buildSignedNodeObservation({
        observation,

        observingOperatorAddress:
          observingOperator.address,

        observingNodeId:
          OBSERVING_NODE_ID,

        observingSessionPrivateKey:
          observingSession.privateKey
      });

    assert.equal(
      first.observationHash,
      second.observationHash
    );

    assert.equal(
      first.signature,
      second.signature
    );
  }
);

test(
  'preserves a FAIL observation',
  () => {
    const observingOperator =
      Wallet.createRandom();

    const observingSession =
      Wallet.createRandom();

    const observation =
      makeObservation({
        registration: {
          passed: false,
          registered: true,
          isNodeWallet: true,
          onChainTier:
            'Operator',
          stakeAtomic:
            '29999999999999',
          stakeRequirementAtomic:
            '30000000000000',
          configuredTierMatches:
            true,
          stakeRequirementMet:
            false,
          messageCode:
            'REGISTRATION_MISMATCH'
        },

        result:
          'FAIL',

        reasonCode:
          'REGISTRATION_MISMATCH'
      });

    const signed =
      buildSignedNodeObservation({
        observation,

        observingOperatorAddress:
          observingOperator.address,

        observingNodeId:
          OBSERVING_NODE_ID,

        observingSessionPrivateKey:
          observingSession.privateKey
      });

    const verified =
      verifySignedNodeObservation(
        signed
      );

    assert.equal(
      verified.result,
      'FAIL'
    );

    assert.equal(
      verified.reasonCode,
      'REGISTRATION_MISMATCH'
    );
  }
);

test(
  'rejects tampered signed observation payload',
  () => {
    const observingOperator =
      Wallet.createRandom();

    const observingSession =
      Wallet.createRandom();

    const signed =
      buildSignedNodeObservation({
        observation:
          makeObservation(),

        observingOperatorAddress:
          observingOperator.address,

        observingNodeId:
          OBSERVING_NODE_ID,

        observingSessionPrivateKey:
          observingSession.privateKey
      });

    const tampered = {
      ...signed,
      result:
        signed.result === 'PASS'
          ? 'FAIL'
          : 'PASS'
    };

    assert.throws(
      () =>
        verifySignedNodeObservation(
          tampered
        ),
      /hash does not match/
    );
  }
);

test(
  'rejects tampered observation signature',
  () => {
    const observingOperator =
      Wallet.createRandom();

    const observingSession =
      Wallet.createRandom();

    const attacker =
      Wallet.createRandom();

    const signed =
      buildSignedNodeObservation({
        observation:
          makeObservation(),

        observingOperatorAddress:
          observingOperator.address,

        observingNodeId:
          OBSERVING_NODE_ID,

        observingSessionPrivateKey:
          observingSession.privateKey
      });

    const tampered = {
      ...signed,

      signature:
        attacker.signingKey.sign(
          signed.observationHash
        ).serialized
    };

    assert.throws(
      () =>
        verifySignedNodeObservation(
          tampered
        ),
      /signature signer mismatch/
    );
  }
);

test(
  'rejects signing self-observation by operator identity',
  () => {
    const observingOperator =
      Wallet.createRandom();

    const observingSession =
      Wallet.createRandom();

    const observation =
      makeObservation({
        observedOperatorAddress:
          observingOperator.address
      });

    assert.throws(
      () =>
        buildSignedNodeObservation({
          observation,

          observingOperatorAddress:
            observingOperator.address,

          observingNodeId:
            OBSERVING_NODE_ID,

          observingSessionPrivateKey:
            observingSession.privateKey
        }),
      /must not sign an observation of its own operator identity/
    );
  }
);

test(
  'rejects signing self-observation by node identity',
  () => {
    const observingOperator =
      Wallet.createRandom();

    const observingSession =
      Wallet.createRandom();

    const observation =
      makeObservation({
        observedNodeId:
          OBSERVING_NODE_ID
      });

    assert.throws(
      () =>
        buildSignedNodeObservation({
          observation,

          observingOperatorAddress:
            observingOperator.address,

          observingNodeId:
            OBSERVING_NODE_ID,

          observingSessionPrivateKey:
            observingSession.privateKey
        }),
      /must not sign an observation of its own node identity/
    );
  }
);
