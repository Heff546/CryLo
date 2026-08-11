'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { Wallet } = require('ethers');

const {
  AUTHORIZATION_AWAITING_CONTRACT_VERIFICATION,
  AUTHORIZATION_DENIED_BY_CONSENSUS
} = require(
  '../src/evidence/validator-reward-authorization-state'
);

const {
  CONTRACT_VERIFIED,
  CONTRACT_REJECTED
} = require(
  '../src/evidence/validator-contract-verification'
);

const {
  createValidatorContractVerificationState
} = require(
  '../src/evidence/validator-contract-verification-state'
);

const {
  createValidatorContractVerifier
} = require(
  '../src/evidence/validator-contract-verifier'
);

async function makeTempState() {
  const directory =
    await fs.mkdtemp(
      path.join(
        os.tmpdir(),
        'crylo-validator-contract-verifier-'
      )
    );

  return {
    directory,
    statePath:
      path.join(
        directory,
        'state.json'
      )
  };
}

function authorization(
  overrides = {}
) {
  return {
    authorizationId:
      '0x' + '11'.repeat(32),

    observedOperatorAddress:
      Wallet.createRandom().address,

    observedNodeId:
      'target-node-0001',

    windowStartedAt:
      '2026-08-10T20:00:00.000Z',

    windowEndedAt:
      '2026-08-10T20:20:00.000Z',

    authorizationStatus:
      AUTHORIZATION_AWAITING_CONTRACT_VERIFICATION,

    ...overrides
  };
}

function operatorNode(
  overrides = {}
) {
  return {
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
      '75000000000000',

    ...overrides
  };
}

async function makeVerifier({
  temp,
  readNode
}) {
  const verificationState =
    await createValidatorContractVerificationState({
      statePath:
        temp.statePath
    });

  const verifier =
    createValidatorContractVerifier({
      readNode,
      verificationState
    });

  return {
    verifier,
    verificationState
  };
}

test(
  'verifies awaiting authorization against NodeStaking state',
  async () => {
    const temp =
      await makeTempState();

    try {
      const auth =
        authorization();

      const {
        verifier,
        verificationState
      } =
        await makeVerifier({
          temp,

          async readNode(
            walletAddress
          ) {
            assert.equal(
              walletAddress,
              auth.observedOperatorAddress
            );

            return operatorNode();
          }
        });

      const result =
        await verifier.verifyAuthorization(
          auth
        );

      assert.equal(
        result.verification.outcome,
        CONTRACT_VERIFIED
      );

      assert.equal(
        result.record.outcome,
        CONTRACT_VERIFIED
      );

      assert.equal(
        verificationState
          .listVerifications().length,
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
  'persists rejected eligibility result',
  async () => {
    const temp =
      await makeTempState();

    try {
      const {
        verifier
      } =
        await makeVerifier({
          temp,

          async readNode() {
            return operatorNode({
              stakeAtomic:
                '29999999999999'
            });
          }
        });

      const result =
        await verifier.verifyAuthorization(
          authorization()
        );

      assert.equal(
        result.verification.outcome,
        CONTRACT_REJECTED
      );

      assert.equal(
        result.record.reasonCode,
        'INSUFFICIENT_STAKE'
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
  'accepts upgraded Validator target',
  async () => {
    const temp =
      await makeTempState();

    try {
      const {
        verifier
      } =
        await makeVerifier({
          temp,

          async readNode() {
            return operatorNode({
              tier:
                '2',
              tierLabel:
                'Validator',
              stakeAtomic:
                '75000000000000'
            });
          }
        });

      const result =
        await verifier.verifyAuthorization(
          authorization()
        );

      assert.equal(
        result.verification.outcome,
        CONTRACT_VERIFIED
      );

      assert.equal(
        result.verification.nodeTier,
        '2'
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
  'RPC failure leaves authorization retryable and writes nothing',
  async () => {
    const temp =
      await makeTempState();

    try {
      const {
        verifier,
        verificationState
      } =
        await makeVerifier({
          temp,

          async readNode() {
            throw new Error(
              'RPC unavailable'
            );
          }
        });

      await assert.rejects(
        verifier.verifyAuthorization(
          authorization()
        ),
        /RPC unavailable/
      );

      assert.equal(
        verificationState
          .listVerifications().length,
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

test(
  'rejects authorization not awaiting contract verification',
  async () => {
    const temp =
      await makeTempState();

    try {
      let reads = 0;

      const {
        verifier,
        verificationState
      } =
        await makeVerifier({
          temp,

          async readNode() {
            reads += 1;
            return operatorNode();
          }
        });

      await assert.rejects(
        verifier.verifyAuthorization(
          authorization({
            authorizationStatus:
              AUTHORIZATION_DENIED_BY_CONSENSUS
          })
        ),
        /not awaiting contract verification/
      );

      assert.equal(
        reads,
        0
      );

      assert.equal(
        verificationState
          .listVerifications().length,
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

test(
  'duplicate verification remains one-time',
  async () => {
    const temp =
      await makeTempState();

    try {
      const auth =
        authorization();

      const {
        verifier,
        verificationState
      } =
        await makeVerifier({
          temp,

          async readNode() {
            return operatorNode();
          }
        });

      await verifier.verifyAuthorization(
        auth
      );

      await assert.rejects(
        verifier.verifyAuthorization(
          auth
        ),
        /already exists/
      );

      assert.equal(
        verificationState
          .listVerifications().length,
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
  'rejects malformed verifier dependencies',
  async () => {
    assert.throws(
      () =>
        createValidatorContractVerifier(
          null
        ),
      /must be a plain object/
    );

    assert.throws(
      () =>
        createValidatorContractVerifier({
          readNode:
            'invalid',

          verificationState: {
            recordVerification() {}
          }
        }),
      /must be a function/
    );
  }
);
