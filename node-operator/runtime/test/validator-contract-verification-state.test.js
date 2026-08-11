'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { Wallet } = require('ethers');

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

async function makeTempState() {
  const directory =
    await fs.mkdtemp(
      path.join(
        os.tmpdir(),
        'crylo-validator-contract-verification-'
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
      'observed-node-001',

    windowStartedAt:
      '2026-08-10T20:00:00.000Z',

    windowEndedAt:
      '2026-08-10T20:20:00.000Z',

    authorizationStatus:
      'AWAITING_CONTRACT_VERIFICATION',

    ...overrides
  };
}

function verification(
  overrides = {}
) {
  return {
    outcome:
      CONTRACT_VERIFIED,

    verified:
      true,

    reasonCode:
      'VERIFIED',

    nodeTier:
      '1',

    nodeTierLabel:
      'Operator',

    stakeAtomic:
      '30000000000000',

    stakeRequirementAtomic:
      '30000000000000',

    registered:
      true,

    nodeWallet:
      true,

    stakeRequirementMet:
      true,

    ...overrides
  };
}

test(
  'persists verified contract result',
  async () => {
    const temp =
      await makeTempState();

    try {
      const state =
        await createValidatorContractVerificationState({
          statePath:
            temp.statePath
        });

      const auth =
        authorization();

      const record =
        await state.recordVerification(
          auth,
          verification()
        );

      assert.equal(
        record.authorizationId,
        auth.authorizationId
      );

      assert.equal(
        record.outcome,
        CONTRACT_VERIFIED
      );

      assert.equal(
        record.reasonCode,
        'VERIFIED'
      );

      assert.match(
        record.verificationId,
        /^0x[0-9a-fA-F]{64}$/
      );
    } finally {
      await fs.rm(
        temp.directory,
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
  'persists rejected contract result',
  async () => {
    const temp =
      await makeTempState();

    try {
      const state =
        await createValidatorContractVerificationState({
          statePath:
            temp.statePath
        });

      const record =
        await state.recordVerification(
          authorization(),
          verification({
            outcome:
              CONTRACT_REJECTED,
            verified:
              false,
            reasonCode:
              'INSUFFICIENT_STAKE',
            stakeAtomic:
              '29999999999999',
            stakeRequirementMet:
              false
          })
        );

      assert.equal(
        record.outcome,
        CONTRACT_REJECTED
      );

      assert.equal(
        record.reasonCode,
        'INSUFFICIENT_STAKE'
      );
    } finally {
      await fs.rm(
        temp.directory,
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
  'rejects duplicate verification for one authorization',
  async () => {
    const temp =
      await makeTempState();

    try {
      const state =
        await createValidatorContractVerificationState({
          statePath:
            temp.statePath
        });

      const auth =
        authorization();

      await state.recordVerification(
        auth,
        verification()
      );

      await assert.rejects(
        state.recordVerification(
          auth,
          verification()
        ),
        /already exists/
      );
    } finally {
      await fs.rm(
        temp.directory,
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
  'persists verification across restart',
  async () => {
    const temp =
      await makeTempState();

    try {
      const auth =
        authorization();

      const first =
        await createValidatorContractVerificationState({
          statePath:
            temp.statePath
        });

      const created =
        await first.recordVerification(
          auth,
          verification()
        );

      const second =
        await createValidatorContractVerificationState({
          statePath:
            temp.statePath
        });

      const loaded =
        second.getVerification(
          auth.authorizationId
        );

      assert.deepEqual(
        loaded,
        created
      );
    } finally {
      await fs.rm(
        temp.directory,
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
  'keeps separate authorizations independent',
  async () => {
    const temp =
      await makeTempState();

    try {
      const state =
        await createValidatorContractVerificationState({
          statePath:
            temp.statePath
        });

      const first =
        authorization({
          authorizationId:
            '0x' + '22'.repeat(32)
        });

      const second =
        authorization({
          authorizationId:
            '0x' + '33'.repeat(32)
        });

      await state.recordVerification(
        first,
        verification()
      );

      await state.recordVerification(
        second,
        verification()
      );

      assert.equal(
        state.listVerifications().length,
        2
      );
    } finally {
      await fs.rm(
        temp.directory,
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
  'rejects tampered persisted verification ID',
  async () => {
    const temp =
      await makeTempState();

    try {
      const state =
        await createValidatorContractVerificationState({
          statePath:
            temp.statePath
        });

      await state.recordVerification(
        authorization(),
        verification()
      );

      const persisted =
        JSON.parse(
          await fs.readFile(
            temp.statePath,
            'utf8'
          )
        );

      const key =
        Object.keys(
          persisted.records
        )[0];

      persisted.records[
        key
      ].verificationId =
        '0x' + 'ff'.repeat(32);

      await fs.writeFile(
        temp.statePath,
        JSON.stringify(
          persisted,
          null,
          2
        )
      );

      await assert.rejects(
        createValidatorContractVerificationState({
          statePath:
            temp.statePath
        }),
        /verification ID mismatch/
      );
    } finally {
      await fs.rm(
        temp.directory,
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
  'rejects persisted authorization key mismatch',
  async () => {
    const temp =
      await makeTempState();

    try {
      const state =
        await createValidatorContractVerificationState({
          statePath:
            temp.statePath
        });

      await state.recordVerification(
        authorization(),
        verification()
      );

      const persisted =
        JSON.parse(
          await fs.readFile(
            temp.statePath,
            'utf8'
          )
        );

      const key =
        Object.keys(
          persisted.records
        )[0];

      const record =
        persisted.records[
          key
        ];

      delete persisted.records[
        key
      ];

      persisted.records[
        '0x' + 'aa'.repeat(32)
      ] = record;

      await fs.writeFile(
        temp.statePath,
        JSON.stringify(
          persisted,
          null,
          2
        )
      );

      await assert.rejects(
        createValidatorContractVerificationState({
          statePath:
            temp.statePath
        }),
        /authorization key mismatch/
      );
    } finally {
      await fs.rm(
        temp.directory,
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
  'verification ID commits the observed node identity',
  async () => {
    const firstTemp =
      await makeTempState();

    const secondTemp =
      await makeTempState();

    try {
      const firstState =
        await createValidatorContractVerificationState({
          statePath:
            firstTemp.statePath
        });

      const secondState =
        await createValidatorContractVerificationState({
          statePath:
            secondTemp.statePath
        });

      const baseAuthorization =
        authorization();

      const first =
        await firstState.recordVerification(
          baseAuthorization,
          verification()
        );

      const second =
        await secondState.recordVerification(
          {
            ...baseAuthorization,
            observedNodeId:
              'observed-node-002'
          },
          verification()
        );

      assert.notEqual(
        first.verificationId,
        second.verificationId
      );

      assert.equal(
        first.observedNodeId,
        'observed-node-001'
      );

      assert.equal(
        second.observedNodeId,
        'observed-node-002'
      );
    } finally {
      await fs.rm(
        firstTemp.directory,
        {
          recursive: true,
          force: true
        }
      );

      await fs.rm(
        secondTemp.directory,
        {
          recursive: true,
          force: true
        }
      );
    }
  }
);

test(
  'rejects non-canonical verification window timestamps',
  async () => {
    const temp =
      await makeTempState();

    try {
      const state =
        await createValidatorContractVerificationState({
          statePath:
            temp.statePath
        });

      await assert.rejects(
        state.recordVerification(
          authorization({
            windowStartedAt:
              '2026-08-10 20:00:00'
          }),
          verification()
        ),
        /canonical UTC timestamp/
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
