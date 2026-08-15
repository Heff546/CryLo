'use strict';

const test =
  require('node:test');

const assert =
  require('node:assert/strict');

const fs =
  require('node:fs/promises');

const os =
  require('node:os');

const path =
  require('node:path');

const {
  Wallet
} = require('ethers');

const {
  PURPOSE
} = require(
  '../src/evidence/validator-reward-approval-authorization'
);

const {
  REWARD_ELIGIBLE
} = require(
  '../src/evidence/validator-reward-eligibility-state'
);

const {
  validatorRewardApprovalDelegationTypedData
} = require(
  '../src/evidence/validator-reward-approval-eip712'
);

const {
  createValidatorRewardApprovalRuntime
} = require(
  '../src/evidence/validator-reward-approval-runtime'
);

const FINALIZER =
  '0xF100000000000000000000000000000000000001';

test(
  'signs, persists, retries and delivers current Pi1 approval envelope',
  async () => {
    const directory =
      await fs.mkdtemp(
        path.join(
          os.tmpdir(),
          'crylo-approval-runtime-'
        )
      );

    try {
      const validator =
        Wallet.createRandom();

      const session =
        Wallet.createRandom();

      const delegation = {
        version: 2,
        purpose: PURPOSE,
        chainId: 5546,

        validatorAddress:
          validator.address,

        nodeId:
          'validator-node-001',

        sessionAddress:
          session.address,

        finalizationContract:
          FINALIZER,

        issuedAt:
          '2026-08-11T04:00:00.000Z',

        expiresAt:
          '2026-08-12T04:00:00.000Z'
      };

      const typed =
        validatorRewardApprovalDelegationTypedData(
          delegation
        );

      const authorization = {
        version: 2,

        delegation,

        delegationSignature:
          await validator.signTypedData(
            typed.domain,
            typed.types,
            typed.value
          )
      };

      const authorizationPath =
        path.join(
          directory,
          'authorization.json'
        );

      const keyPath =
        path.join(
          directory,
          'session.key'
        );

      await fs.writeFile(
        authorizationPath,
        JSON.stringify(
          authorization,
          null,
          2
        ) + '\n'
      );

      await fs.writeFile(
        keyPath,
        session.privateKey + '\n',
        {
          mode: 0o600
        }
      );

      await fs.chmod(
        keyPath,
        0o600
      );

      let received =
        null;

      const runtime =
        await createValidatorRewardApprovalRuntime({
          validatorAddress:
            validator.address,

          validatorNodeId:
            'validator-node-001',

          dataDirectory:
            directory,

          env: {
            CRYLONEXUS_VALIDATOR_REWARD_APPROVAL_AUTHORIZATION_FILE:
              authorizationPath,

            CRYLONEXUS_VALIDATOR_SESSION_KEY_FILE:
              keyPath,

            CRYLONEXUS_REWARD_SUBMIT_HOST:
              'reward.example',

            CRYLONEXUS_REWARD_SUBMIT_PORT:
              '9443',

            CRYLONEXUS_REWARD_SUBMIT_ROUTE:
              '/v1/validator/reward-approvals'
          },

          nowMs:
            Date.parse(
              '2026-08-11T06:00:00.000Z'
            ),

          async sendApproval(
            envelope
          ) {
            received =
              envelope;

            return {
              accepted:
                true
            };
          }
        });

      assert.ok(runtime);

      const queued =
        await runtime.enqueueDecisions([
          {
            observedOperatorAddress:
              '0x1111111111111111111111111111111111111111',

            observedNodeId:
              'operator-node-001',

            windowStartedAt:
              '2026-08-11T05:00:00.000Z',

            windowEndedAt:
              '2026-08-11T05:20:00.000Z',

            authorizationId:
              '0x' + '11'.repeat(32),

            verificationId:
              '0x' + '22'.repeat(32),

            decisionId:
              '0x' + '33'.repeat(32),

            contractOutcome:
              'CONTRACT_VERIFIED',

            contractReasonCode:
              'VERIFIED',

            rewardEligibility:
              REWARD_ELIGIBLE
          }
        ]);

      assert.equal(
        queued.createdCount,
        1
      );

      const delivered =
        await runtime.processPending();

      assert.equal(
        delivered.deliveredCount,
        1
      );

      assert.ok(received);

      assert.equal(
        received.authorization
          .delegation.validatorAddress,
        validator.address
      );

      assert.equal(
        received.approval
          .approvingSessionAddress,
        session.address
      );

      assert.equal(
        received.approval
          .finalizationContract,
        FINALIZER
      );

      /*
       * Same decision generates the same deterministic
       * approval and therefore cannot create a duplicate
       * delivery record.
       */
      const second =
        await runtime.enqueueDecisions([
          {
            observedOperatorAddress:
              '0x1111111111111111111111111111111111111111',

            observedNodeId:
              'operator-node-001',

            windowStartedAt:
              '2026-08-11T05:00:00.000Z',

            windowEndedAt:
              '2026-08-11T05:20:00.000Z',

            authorizationId:
              '0x' + '11'.repeat(32),

            verificationId:
              '0x' + '22'.repeat(32),

            decisionId:
              '0x' + '33'.repeat(32),

            contractOutcome:
              'CONTRACT_VERIFIED',

            contractReasonCode:
              'VERIFIED',

            rewardEligibility:
              REWARD_ELIGIBLE
          }
        ]);

      assert.equal(
        second.existingCount,
        1
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
  'approval runtime stays disabled when no signing delivery configuration exists',
  async () => {
    const result =
      await createValidatorRewardApprovalRuntime({
        validatorAddress:
          Wallet.createRandom()
            .address,

        validatorNodeId:
          'validator-node-001',

        dataDirectory:
          os.tmpdir(),

        env: {}
      });

    assert.equal(
      result,
      null
    );
  }
);
