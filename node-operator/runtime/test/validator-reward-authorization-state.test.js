'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { Wallet } = require('ethers');

const {
  CONSENSUS_PENDING,
  CONSENSUS_QUALIFIED,
  CONSENSUS_UNQUALIFIED
} = require(
  '../src/evidence/validator-consensus-state'
);

const {
  AUTHORIZATION_AWAITING_CONTRACT_VERIFICATION,
  AUTHORIZATION_DENIED_BY_CONSENSUS,
  createValidatorRewardAuthorizationState
} = require(
  '../src/evidence/validator-reward-authorization-state'
);

async function makeTempState() {
  const directory =
    await fs.mkdtemp(
      path.join(
        os.tmpdir(),
        'crylonexus-validator-reward-auth-'
      )
    );

  return {
    directory,
    statePath:
      path.join(
        directory,
        'validator-reward-authorization-state.json'
      )
  };
}

function makeConsensusWindow({
  target,
  observedNodeId =
    'target-node-0001',
  windowStartedAt =
    '2026-08-10T20:00:00.000Z',
  consensus =
    CONSENSUS_QUALIFIED,
  finalized =
    true,
  minimumReports =
    3,
  qualifiedCount,
  unqualifiedCount
}) {
  const startMs =
    Date.parse(
      windowStartedAt
    );

  const q =
    qualifiedCount === undefined
      ? (
          consensus ===
            CONSENSUS_QUALIFIED
            ? minimumReports
            : 0
        )
      : qualifiedCount;

  const u =
    unqualifiedCount === undefined
      ? (
          consensus ===
            CONSENSUS_UNQUALIFIED
            ? minimumReports
            : 0
        )
      : unqualifiedCount;

  return {
    observedOperatorAddress:
      target.address,

    observedNodeId,

    windowStartedAt,

    windowEndedAt:
      new Date(
        startMs + 20 * 60_000
      ).toISOString(),

    minimumReports,

    reportCount:
      q + u,

    qualifiedCount:
      q,

    unqualifiedCount:
      u,

    consensus,

    finalized
  };
}

test(
  'records qualified consensus as awaiting contract verification',
  async () => {
    const temp =
      await makeTempState();

    try {
      const target =
        Wallet.createRandom();

      const state =
        await createValidatorRewardAuthorizationState({
          statePath:
            temp.statePath
        });

      const record =
        await state.recordConsensus(
          makeConsensusWindow({
            target,
            consensus:
              CONSENSUS_QUALIFIED
          })
        );

      assert.equal(
        record.authorizationStatus,
        AUTHORIZATION_AWAITING_CONTRACT_VERIFICATION
      );

      assert.equal(
        record.consensus,
        CONSENSUS_QUALIFIED
      );

      assert.equal(
        typeof record.authorizationId,
        'string'
      );

      assert.equal(
        record.authorizationId.length,
        66
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
  'records unqualified consensus as denied',
  async () => {
    const temp =
      await makeTempState();

    try {
      const target =
        Wallet.createRandom();

      const state =
        await createValidatorRewardAuthorizationState({
          statePath:
            temp.statePath
        });

      const record =
        await state.recordConsensus(
          makeConsensusWindow({
            target,
            consensus:
              CONSENSUS_UNQUALIFIED
          })
        );

      assert.equal(
        record.authorizationStatus,
        AUTHORIZATION_DENIED_BY_CONSENSUS
      );

      assert.equal(
        record.consensus,
        CONSENSUS_UNQUALIFIED
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
  'rejects pending consensus',
  async () => {
    const temp =
      await makeTempState();

    try {
      const target =
        Wallet.createRandom();

      const state =
        await createValidatorRewardAuthorizationState({
          statePath:
            temp.statePath
        });

      await assert.rejects(
        state.recordConsensus(
          makeConsensusWindow({
            target,
            consensus:
              CONSENSUS_PENDING,
            finalized:
              false,
            qualifiedCount:
              2,
            unqualifiedCount:
              1
          })
        ),
        /requires finalized|Pending Validator consensus/
      );

      assert.equal(
        state.getRecords().length,
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
  'rejects duplicate authorization window',
  async () => {
    const temp =
      await makeTempState();

    try {
      const target =
        Wallet.createRandom();

      const state =
        await createValidatorRewardAuthorizationState({
          statePath:
            temp.statePath
        });

      const window =
        makeConsensusWindow({
          target
        });

      await state.recordConsensus(
        window
      );

      await assert.rejects(
        state.recordConsensus(
          window
        ),
        /already recorded/
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
  'produces deterministic authorization ID',
  async () => {
    const firstTemp =
      await makeTempState();

    const secondTemp =
      await makeTempState();

    try {
      const target =
        Wallet.createRandom();

      const window =
        makeConsensusWindow({
          target
        });

      const first =
        await createValidatorRewardAuthorizationState({
          statePath:
            firstTemp.statePath
        });

      const second =
        await createValidatorRewardAuthorizationState({
          statePath:
            secondTemp.statePath
        });

      const firstRecord =
        await first.recordConsensus(
          window
        );

      const secondRecord =
        await second.recordConsensus(
          window
        );

      assert.equal(
        firstRecord.authorizationId,
        secondRecord.authorizationId
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
  'keeps separate target windows independent',
  async () => {
    const temp =
      await makeTempState();

    try {
      const targetA =
        Wallet.createRandom();

      const targetB =
        Wallet.createRandom();

      const state =
        await createValidatorRewardAuthorizationState({
          statePath:
            temp.statePath
        });

      await state.recordConsensus(
        makeConsensusWindow({
          target:
            targetA,
          observedNodeId:
            'target-node-a'
        })
      );

      await state.recordConsensus(
        makeConsensusWindow({
          target:
            targetB,
          observedNodeId:
            'target-node-b'
        })
      );

      assert.equal(
        state.getRecords().length,
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
  'keeps later windows independent',
  async () => {
    const temp =
      await makeTempState();

    try {
      const target =
        Wallet.createRandom();

      const state =
        await createValidatorRewardAuthorizationState({
          statePath:
            temp.statePath
        });

      await state.recordConsensus(
        makeConsensusWindow({
          target,
          windowStartedAt:
            '2026-08-10T20:00:00.000Z'
        })
      );

      await state.recordConsensus(
        makeConsensusWindow({
          target,
          windowStartedAt:
            '2026-08-10T20:20:00.000Z'
        })
      );

      assert.equal(
        state.getRecords().length,
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
  'persists authorization records across restart',
  async () => {
    const temp =
      await makeTempState();

    try {
      const target =
        Wallet.createRandom();

      const first =
        await createValidatorRewardAuthorizationState({
          statePath:
            temp.statePath
        });

      const record =
        await first.recordConsensus(
          makeConsensusWindow({
            target
          })
        );

      const restarted =
        await createValidatorRewardAuthorizationState({
          statePath:
            temp.statePath
        });

      const records =
        restarted.getRecords();

      assert.equal(
        records.length,
        1
      );

      assert.equal(
        records[0].authorizationId,
        record.authorizationId
      );

      await assert.rejects(
        restarted.recordConsensus(
          makeConsensusWindow({
            target
          })
        ),
        /already recorded/
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
  'rejects inconsistent consensus counts',
  async () => {
    const temp =
      await makeTempState();

    try {
      const target =
        Wallet.createRandom();

      const state =
        await createValidatorRewardAuthorizationState({
          statePath:
            temp.statePath
        });

      await assert.rejects(
        state.recordConsensus({
          ...makeConsensusWindow({
            target
          }),
          reportCount:
            99
        }),
        /counts are inconsistent/
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
  'rejects persisted record with mismatched window key',
  async () => {
    const temp =
      await makeTempState();

    try {
      const target =
        Wallet.createRandom();

      const state =
        await createValidatorRewardAuthorizationState({
          statePath:
            temp.statePath
        });

      await state.recordConsensus(
        makeConsensusWindow({
          target
        })
      );

      const parsed =
        JSON.parse(
          await fs.readFile(
            temp.statePath,
            'utf8'
          )
        );

      const key =
        Object.keys(
          parsed.records
        )[0];

      const record =
        parsed.records[key];

      delete parsed.records[key];

      parsed.records[
        'tampered-window-key'
      ] = record;

      await fs.writeFile(
        temp.statePath,
        JSON.stringify(parsed),
        'utf8'
      );

      await assert.rejects(
        createValidatorRewardAuthorizationState({
          statePath:
            temp.statePath
        }),
        /window key does not match/
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
  'rejects persisted record with tampered authorization ID',
  async () => {
    const temp =
      await makeTempState();

    try {
      const target =
        Wallet.createRandom();

      const state =
        await createValidatorRewardAuthorizationState({
          statePath:
            temp.statePath
        });

      await state.recordConsensus(
        makeConsensusWindow({
          target
        })
      );

      const parsed =
        JSON.parse(
          await fs.readFile(
            temp.statePath,
            'utf8'
          )
        );

      const key =
        Object.keys(
          parsed.records
        )[0];

      parsed.records[key]
        .authorizationId =
          `0x${'ff'.repeat(32)}`;

      await fs.writeFile(
        temp.statePath,
        JSON.stringify(parsed),
        'utf8'
      );

      await assert.rejects(
        createValidatorRewardAuthorizationState({
          statePath:
            temp.statePath
        }),
        /authorization ID is inconsistent/
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
  'rejects persisted record with inconsistent status',
  async () => {
    const temp =
      await makeTempState();

    try {
      const target =
        Wallet.createRandom();

      const state =
        await createValidatorRewardAuthorizationState({
          statePath:
            temp.statePath
        });

      await state.recordConsensus(
        makeConsensusWindow({
          target
        })
      );

      const parsed =
        JSON.parse(
          await fs.readFile(
            temp.statePath,
            'utf8'
          )
        );

      const key =
        Object.keys(
          parsed.records
        )[0];

      parsed.records[key]
        .authorizationStatus =
          AUTHORIZATION_DENIED_BY_CONSENSUS;

      await fs.writeFile(
        temp.statePath,
        JSON.stringify(parsed),
        'utf8'
      );

      await assert.rejects(
        createValidatorRewardAuthorizationState({
          statePath:
            temp.statePath
        }),
        /status is inconsistent/
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
  'rejects persisted qualified record below quorum',
  async () => {
    const temp =
      await makeTempState();

    try {
      const target =
        Wallet.createRandom();

      const state =
        await createValidatorRewardAuthorizationState({
          statePath:
            temp.statePath
        });

      await state.recordConsensus(
        makeConsensusWindow({
          target
        })
      );

      const parsed =
        JSON.parse(
          await fs.readFile(
            temp.statePath,
            'utf8'
          )
        );

      const key =
        Object.keys(
          parsed.records
        )[0];

      parsed.records[key]
        .qualifiedCount = 2;

      parsed.records[key]
        .reportCount = 2;

      await fs.writeFile(
        temp.statePath,
        JSON.stringify(parsed),
        'utf8'
      );

      await assert.rejects(
        createValidatorRewardAuthorizationState({
          statePath:
            temp.statePath
        }),
        /lacks sufficient qualified reports/
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
  'rejects persisted pending consensus',
  async () => {
    const temp =
      await makeTempState();

    try {
      const target =
        Wallet.createRandom();

      const state =
        await createValidatorRewardAuthorizationState({
          statePath:
            temp.statePath
        });

      await state.recordConsensus(
        makeConsensusWindow({
          target
        })
      );

      const parsed =
        JSON.parse(
          await fs.readFile(
            temp.statePath,
            'utf8'
          )
        );

      const key =
        Object.keys(
          parsed.records
        )[0];

      parsed.records[key]
        .consensus =
          CONSENSUS_PENDING;

      await fs.writeFile(
        temp.statePath,
        JSON.stringify(parsed),
        'utf8'
      );

      await assert.rejects(
        createValidatorRewardAuthorizationState({
          statePath:
            temp.statePath
        }),
        /must be finalized/
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
