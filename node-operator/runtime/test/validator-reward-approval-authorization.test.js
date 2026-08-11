'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  Wallet
} = require('ethers');

const {
  PURPOSE,
  verifyValidatorRewardApprovalAuthorization,
  loadValidatorRewardApprovalAuthorization
} = require(
  '../src/evidence/validator-reward-approval-authorization'
);

async function buildAuthorization(
  overrides = {}
) {
  const validator =
    overrides.validator ||
    Wallet.createRandom();

  const session =
    overrides.session ||
    Wallet.createRandom();

  const delegation = {
    version:
      1,

    purpose:
      PURPOSE,

    chainId:
      5546,

    validatorAddress:
      validator.address,

    nodeId:
      'validator-node-001',

    sessionAddress:
      session.address,

    issuedAt:
      '2026-08-11T05:00:00.000Z',

    expiresAt:
      '2026-08-12T05:00:00.000Z',

    ...(overrides.delegation || {})
  };

  const delegationSignature =
    await validator.signMessage(
      JSON.stringify(
        delegation
      )
    );

  return {
    validator,
    session,

    authorization: {
      version:
        1,

      delegation,

      delegationSignature
    }
  };
}

test(
  'verifies Validator reward approval delegation',
  async () => {
    const {
      validator,
      session,
      authorization
    } =
      await buildAuthorization();

    const result =
      verifyValidatorRewardApprovalAuthorization({
        authorization,

        expectedValidatorAddress:
          validator.address,

        expectedValidatorNodeId:
          'validator-node-001',

        expectedSessionAddress:
          session.address,

        nowMs:
          Date.parse(
            '2026-08-11T06:00:00.000Z'
          )
      });

    assert.equal(
      result.validatorAddress,
      validator.address
    );

    assert.equal(
      result.validatorNodeId,
      'validator-node-001'
    );

    assert.equal(
      result.sessionAddress,
      session.address
    );
  }
);

test(
  'rejects wrong authorization purpose',
  async () => {
    const {
      authorization
    } =
      await buildAuthorization({
        delegation: {
          purpose:
            'operator-heartbeat'
        }
      });

    assert.throws(
      () =>
        verifyValidatorRewardApprovalAuthorization({
          authorization,
          nowMs:
            Date.parse(
              '2026-08-11T06:00:00.000Z'
            )
        }),
      /purpose mismatch/
    );
  }
);

test(
  'rejects wrong Validator wallet',
  async () => {
    const {
      authorization
    } =
      await buildAuthorization();

    assert.throws(
      () =>
        verifyValidatorRewardApprovalAuthorization({
          authorization,

          expectedValidatorAddress:
            Wallet.createRandom()
              .address,

          nowMs:
            Date.parse(
              '2026-08-11T06:00:00.000Z'
            )
        }),
      /wallet mismatch/
    );
  }
);

test(
  'rejects wrong Validator node ID',
  async () => {
    const {
      authorization
    } =
      await buildAuthorization();

    assert.throws(
      () =>
        verifyValidatorRewardApprovalAuthorization({
          authorization,

          expectedValidatorNodeId:
            'validator-node-002',

          nowMs:
            Date.parse(
              '2026-08-11T06:00:00.000Z'
            )
        }),
      /node ID mismatch/
    );
  }
);

test(
  'rejects wrong approval session',
  async () => {
    const {
      authorization
    } =
      await buildAuthorization();

    assert.throws(
      () =>
        verifyValidatorRewardApprovalAuthorization({
          authorization,

          expectedSessionAddress:
            Wallet.createRandom()
              .address,

          nowMs:
            Date.parse(
              '2026-08-11T06:00:00.000Z'
            )
        }),
      /session mismatch/
    );
  }
);

test(
  'rejects tampered delegation signature',
  async () => {
    const {
      authorization
    } =
      await buildAuthorization();

    const tampered = {
      ...authorization,

      delegation: {
        ...authorization.delegation,

        nodeId:
          'validator-node-tampered'
      }
    };

    assert.throws(
      () =>
        verifyValidatorRewardApprovalAuthorization({
          authorization:
            tampered,

          nowMs:
            Date.parse(
              '2026-08-11T06:00:00.000Z'
            )
        }),
      /signature mismatch/
    );
  }
);

test(
  'rejects expired delegation',
  async () => {
    const {
      authorization
    } =
      await buildAuthorization();

    assert.throws(
      () =>
        verifyValidatorRewardApprovalAuthorization({
          authorization,

          nowMs:
            Date.parse(
              '2026-08-13T05:00:00.000Z'
            )
        }),
      /expired/
    );
  }
);

test(
  'rejects authorization containing session private key',
  async () => {
    const {
      authorization,
      session
    } =
      await buildAuthorization();

    assert.throws(
      () =>
        verifyValidatorRewardApprovalAuthorization({
          authorization: {
            ...authorization,

            sessionPrivateKey:
              session.privateKey
          },

          nowMs:
            Date.parse(
              '2026-08-11T06:00:00.000Z'
            )
        }),
      /must not contain a session private key/
    );
  }
);

test(
  'loads verified authorization from disk',
  async () => {
    const directory =
      await fs.mkdtemp(
        path.join(
          os.tmpdir(),
          'crylo-validator-approval-auth-'
        )
      );

    try {
      const {
        validator,
        session,
        authorization
      } =
        await buildAuthorization();

      const authorizationPath =
        path.join(
          directory,
          'authorization.json'
        );

      await fs.writeFile(
        authorizationPath,
        JSON.stringify(
          authorization,
          null,
          2
        )
      );

      const loaded =
        await loadValidatorRewardApprovalAuthorization({
          authorizationPath,

          expectedValidatorAddress:
            validator.address,

          expectedValidatorNodeId:
            'validator-node-001',

          expectedSessionAddress:
            session.address,

          nowMs:
            Date.parse(
              '2026-08-11T06:00:00.000Z'
            )
        });

      assert.equal(
        loaded.authorizationPath,
        authorizationPath
      );

      assert.equal(
        loaded.validatorAddress,
        validator.address
      );
    } finally {
      await fs.rm(
        directory,
        {
          recursive:
            true,
          force:
            true
        }
      );
    }
  }
);

test(
  'rejects malformed authorization options',
  async () => {
    assert.throws(
      () =>
        verifyValidatorRewardApprovalAuthorization({
          authorization:
            null
        }),
      /must be a plain object/
    );
  }
);
