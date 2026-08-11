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
  CONSENSUS_UNQUALIFIED,
  determineConsensus,
  createValidatorConsensusState
} = require(
  '../src/evidence/validator-consensus-state'
);

async function makeTempState() {
  const directory =
    await fs.mkdtemp(
      path.join(
        os.tmpdir(),
        'crylonexus-validator-consensus-'
      )
    );

  return {
    directory,
    statePath:
      path.join(
        directory,
        'validator-consensus-state.json'
      )
  };
}

function makeAcceptedReport({
  reporter,
  target,
  reportingNodeId =
    'reporting-node-0001',
  observedNodeId =
    'observed-node-0001',
  windowStartedAt =
    '2026-08-10T20:00:00.000Z',
  locallyQualified =
    true,
  reportIndex =
    1
}) {
  const startMs =
    Date.parse(windowStartedAt);

  return {
    reportHash:
      `0x${reportIndex
        .toString(16)
        .padStart(64, '0')}`,

    reportingOperatorAddress:
      reporter.address,

    reportingNodeId,

    observedOperatorAddress:
      target.address,

    observedNodeId,

    windowStartedAt,

    windowEndedAt:
      new Date(
        startMs + 20 * 60_000
      ).toISOString(),

    locallyQualified
  };
}

test(
  'determineConsensus returns PENDING below threshold',
  () => {
    assert.equal(
      determineConsensus({
        qualifiedCount: 2,
        unqualifiedCount: 0,
        minimumReports: 3
      }),
      CONSENSUS_PENDING
    );
  }
);

test(
  'determineConsensus returns QUALIFIED at threshold',
  () => {
    assert.equal(
      determineConsensus({
        qualifiedCount: 3,
        unqualifiedCount: 0,
        minimumReports: 3
      }),
      CONSENSUS_QUALIFIED
    );
  }
);

test(
  'determineConsensus returns UNQUALIFIED at threshold',
  () => {
    assert.equal(
      determineConsensus({
        qualifiedCount: 0,
        unqualifiedCount: 3,
        minimumReports: 3
      }),
      CONSENSUS_UNQUALIFIED
    );
  }
);

test(
  'accepts independent reporters into one pending window',
  async () => {
    const temp =
      await makeTempState();

    try {
      const target =
        Wallet.createRandom();

      const reporterA =
        Wallet.createRandom();

      const reporterB =
        Wallet.createRandom();

      const consensus =
        await createValidatorConsensusState({
          minimumReports: 3,
          statePath:
            temp.statePath
        });

      const first =
        await consensus.acceptReport(
          makeAcceptedReport({
            reporter:
              reporterA,
            target,
            reportIndex:
              1
          })
        );

      assert.equal(
        first.consensus,
        CONSENSUS_PENDING
      );

      assert.equal(
        first.reportCount,
        1
      );

      const second =
        await consensus.acceptReport(
          makeAcceptedReport({
            reporter:
              reporterB,
            target,
            reportingNodeId:
              'reporting-node-0002',
            reportIndex:
              2
          })
        );

      assert.equal(
        second.consensus,
        CONSENSUS_PENDING
      );

      assert.equal(
        second.reportCount,
        2
      );

      assert.equal(
        second.qualifiedCount,
        2
      );

      assert.equal(
        second.unqualifiedCount,
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
  'rejects duplicate reporting Operator for one target window',
  async () => {
    const temp =
      await makeTempState();

    try {
      const reporter =
        Wallet.createRandom();

      const target =
        Wallet.createRandom();

      const consensus =
        await createValidatorConsensusState({
          minimumReports: 3,
          statePath:
            temp.statePath
        });

      await consensus.acceptReport(
        makeAcceptedReport({
          reporter,
          target,
          reportIndex:
            1
        })
      );

      await assert.rejects(
        consensus.acceptReport(
          makeAcceptedReport({
            reporter,
            target,
            reportingNodeId:
              'different-node-id',
            reportIndex:
              2
          })
        ),
        /reporter already submitted/
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
  'finalizes QUALIFIED when enough independent reporters agree',
  async () => {
    const temp =
      await makeTempState();

    try {
      const target =
        Wallet.createRandom();

      const reporters =
        Array.from(
          { length: 3 },
          () => Wallet.createRandom()
        );

      const consensus =
        await createValidatorConsensusState({
          minimumReports: 3,
          statePath:
            temp.statePath
        });

      let result = null;

      for (
        let index = 0;
        index < reporters.length;
        index += 1
      ) {
        result =
          await consensus.acceptReport(
            makeAcceptedReport({
              reporter:
                reporters[index],
              target,
              reportingNodeId:
                `reporting-node-${index + 1}`,
              reportIndex:
                index + 1,
              locallyQualified:
                true
            })
          );
      }

      assert.equal(
        result.consensus,
        CONSENSUS_QUALIFIED
      );

      assert.equal(
        result.finalized,
        true
      );

      assert.equal(
        result.qualifiedCount,
        3
      );

      assert.equal(
        result.unqualifiedCount,
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
  'finalizes UNQUALIFIED when enough independent reporters agree',
  async () => {
    const temp =
      await makeTempState();

    try {
      const target =
        Wallet.createRandom();

      const reporters =
        Array.from(
          { length: 3 },
          () => Wallet.createRandom()
        );

      const consensus =
        await createValidatorConsensusState({
          minimumReports: 3,
          statePath:
            temp.statePath
        });

      let result = null;

      for (
        let index = 0;
        index < reporters.length;
        index += 1
      ) {
        result =
          await consensus.acceptReport(
            makeAcceptedReport({
              reporter:
                reporters[index],
              target,
              reportingNodeId:
                `reporting-node-${index + 1}`,
              reportIndex:
                index + 1,
              locallyQualified:
                false
            })
          );
      }

      assert.equal(
        result.consensus,
        CONSENSUS_UNQUALIFIED
      );

      assert.equal(
        result.finalized,
        true
      );

      assert.equal(
        result.qualifiedCount,
        0
      );

      assert.equal(
        result.unqualifiedCount,
        3
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
  'mixed votes remain PENDING until one side reaches threshold',
  async () => {
    const temp =
      await makeTempState();

    try {
      const target =
        Wallet.createRandom();

      const reporters =
        Array.from(
          { length: 3 },
          () => Wallet.createRandom()
        );

      const consensus =
        await createValidatorConsensusState({
          minimumReports: 3,
          statePath:
            temp.statePath
        });

      await consensus.acceptReport(
        makeAcceptedReport({
          reporter:
            reporters[0],
          target,
          reportingNodeId:
            'reporting-node-1',
          reportIndex:
            1,
          locallyQualified:
            true
        })
      );

      await consensus.acceptReport(
        makeAcceptedReport({
          reporter:
            reporters[1],
          target,
          reportingNodeId:
            'reporting-node-2',
          reportIndex:
            2,
          locallyQualified:
            false
        })
      );

      const result =
        await consensus.acceptReport(
          makeAcceptedReport({
            reporter:
              reporters[2],
            target,
            reportingNodeId:
              'reporting-node-3',
            reportIndex:
              3,
            locallyQualified:
              true
          })
        );

      assert.equal(
        result.consensus,
        CONSENSUS_PENDING
      );

      assert.equal(
        result.qualifiedCount,
        2
      );

      assert.equal(
        result.unqualifiedCount,
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
  'finalized window rejects additional reports',
  async () => {
    const temp =
      await makeTempState();

    try {
      const target =
        Wallet.createRandom();

      const reporters =
        Array.from(
          { length: 4 },
          () => Wallet.createRandom()
        );

      const consensus =
        await createValidatorConsensusState({
          minimumReports: 3,
          statePath:
            temp.statePath
        });

      for (
        let index = 0;
        index < 3;
        index += 1
      ) {
        await consensus.acceptReport(
          makeAcceptedReport({
            reporter:
              reporters[index],
            target,
            reportingNodeId:
              `reporting-node-${index + 1}`,
            reportIndex:
              index + 1,
            locallyQualified:
              true
          })
        );
      }

      await assert.rejects(
        consensus.acceptReport(
          makeAcceptedReport({
            reporter:
              reporters[3],
            target,
            reportingNodeId:
              'reporting-node-4',
            reportIndex:
              4,
            locallyQualified:
              false
          })
        ),
        /already finalized/
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
  'keeps separate target windows independent',
  async () => {
    const temp =
      await makeTempState();

    try {
      const reporter =
        Wallet.createRandom();

      const targetA =
        Wallet.createRandom();

      const targetB =
        Wallet.createRandom();

      const consensus =
        await createValidatorConsensusState({
          minimumReports: 3,
          statePath:
            temp.statePath
        });

      await consensus.acceptReport(
        makeAcceptedReport({
          reporter,
          target:
            targetA,
          observedNodeId:
            'target-node-a',
          reportIndex:
            1
        })
      );

      await consensus.acceptReport(
        makeAcceptedReport({
          reporter,
          target:
            targetB,
          observedNodeId:
            'target-node-b',
          reportIndex:
            2
        })
      );

      assert.equal(
        consensus.getWindows().length,
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
      const reporter =
        Wallet.createRandom();

      const target =
        Wallet.createRandom();

      const consensus =
        await createValidatorConsensusState({
          minimumReports: 3,
          statePath:
            temp.statePath
        });

      await consensus.acceptReport(
        makeAcceptedReport({
          reporter,
          target,
          windowStartedAt:
            '2026-08-10T20:00:00.000Z',
          reportIndex:
            1
        })
      );

      await consensus.acceptReport(
        makeAcceptedReport({
          reporter,
          target,
          windowStartedAt:
            '2026-08-10T20:20:00.000Z',
          reportIndex:
            2
        })
      );

      assert.equal(
        consensus.getWindows().length,
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
  'persists pending aggregation across restart',
  async () => {
    const temp =
      await makeTempState();

    try {
      const target =
        Wallet.createRandom();

      const reporterA =
        Wallet.createRandom();

      const reporterB =
        Wallet.createRandom();

      const first =
        await createValidatorConsensusState({
          minimumReports: 3,
          statePath:
            temp.statePath
        });

      await first.acceptReport(
        makeAcceptedReport({
          reporter:
            reporterA,
          target,
          reportingNodeId:
            'reporting-node-a',
          reportIndex:
            1
        })
      );

      const restarted =
        await createValidatorConsensusState({
          minimumReports: 3,
          statePath:
            temp.statePath
        });

      const result =
        await restarted.acceptReport(
          makeAcceptedReport({
            reporter:
              reporterB,
            target,
            reportingNodeId:
              'reporting-node-b',
            reportIndex:
              2
          })
        );

      assert.equal(
        result.reportCount,
        2
      );

      assert.equal(
        result.consensus,
        CONSENSUS_PENDING
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
  'persists finalized consensus across restart',
  async () => {
    const temp =
      await makeTempState();

    try {
      const target =
        Wallet.createRandom();

      const reporters =
        Array.from(
          { length: 3 },
          () => Wallet.createRandom()
        );

      const first =
        await createValidatorConsensusState({
          minimumReports: 3,
          statePath:
            temp.statePath
        });

      for (
        let index = 0;
        index < 3;
        index += 1
      ) {
        await first.acceptReport(
          makeAcceptedReport({
            reporter:
              reporters[index],
            target,
            reportingNodeId:
              `reporting-node-${index + 1}`,
            reportIndex:
              index + 1
          })
        );
      }

      const restarted =
        await createValidatorConsensusState({
          minimumReports: 3,
          statePath:
            temp.statePath
        });

      const windows =
        restarted.getWindows();

      assert.equal(
        windows.length,
        1
      );

      assert.equal(
        windows[0].consensus,
        CONSENSUS_QUALIFIED
      );

      assert.equal(
        windows[0].finalized,
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
  'rejects malformed consensus options',
  async () => {
    await assert.rejects(
      createValidatorConsensusState(
        null
      ),
      /must be a plain object/
    );

    await assert.rejects(
      createValidatorConsensusState({
        minimumReports:
          0
      }),
      /positive safe integer/
    );
  }
);

test(
  'rejects persisted state with a different consensus policy',
  async () => {
    const temp =
      await makeTempState();

    try {
      const reporter =
        Wallet.createRandom();

      const target =
        Wallet.createRandom();

      const first =
        await createValidatorConsensusState({
          minimumReports: 3,
          statePath:
            temp.statePath
        });

      await first.acceptReport(
        makeAcceptedReport({
          reporter,
          target,
          reportIndex:
            1
        })
      );

      await assert.rejects(
        createValidatorConsensusState({
          minimumReports: 2,
          statePath:
            temp.statePath
        }),
        /state is invalid|minimumReports/
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
  'rejects persisted state with inconsistent counters',
  async () => {
    const temp =
      await makeTempState();

    try {
      const reporter =
        Wallet.createRandom();

      const target =
        Wallet.createRandom();

      const consensus =
        await createValidatorConsensusState({
          minimumReports: 3,
          statePath:
            temp.statePath
        });

      await consensus.acceptReport(
        makeAcceptedReport({
          reporter,
          target,
          reportIndex:
            1
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
          parsed.windows
        )[0];

      parsed.windows[key]
        .qualifiedCount = 99;

      await fs.writeFile(
        temp.statePath,
        JSON.stringify(parsed),
        'utf8'
      );

      await assert.rejects(
        createValidatorConsensusState({
          minimumReports: 3,
          statePath:
            temp.statePath
        }),
        /qualifiedCount is inconsistent/
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
  'rejects persisted state with mismatched reporter key',
  async () => {
    const temp =
      await makeTempState();

    try {
      const reporter =
        Wallet.createRandom();

      const target =
        Wallet.createRandom();

      const consensus =
        await createValidatorConsensusState({
          minimumReports: 3,
          statePath:
            temp.statePath
        });

      await consensus.acceptReport(
        makeAcceptedReport({
          reporter,
          target,
          reportIndex:
            1
        })
      );

      const parsed =
        JSON.parse(
          await fs.readFile(
            temp.statePath,
            'utf8'
          )
        );

      const windowKey =
        Object.keys(
          parsed.windows
        )[0];

      const window =
        parsed.windows[
          windowKey
        ];

      const reporterKey =
        Object.keys(
          window.reporters
        )[0];

      const value =
        window.reporters[
          reporterKey
        ];

      delete window.reporters[
        reporterKey
      ];

      window.reporters[
        '0x0000000000000000000000000000000000000000'
      ] = value;

      await fs.writeFile(
        temp.statePath,
        JSON.stringify(parsed),
        'utf8'
      );

      await assert.rejects(
        createValidatorConsensusState({
          minimumReports: 3,
          statePath:
            temp.statePath
        }),
        /reporter key does not match/
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
  'rejects persisted state with incorrect finalized status',
  async () => {
    const temp =
      await makeTempState();

    try {
      const target =
        Wallet.createRandom();

      const reporters =
        Array.from(
          { length: 3 },
          () => Wallet.createRandom()
        );

      const consensus =
        await createValidatorConsensusState({
          minimumReports: 3,
          statePath:
            temp.statePath
        });

      for (
        let index = 0;
        index < 3;
        index += 1
      ) {
        await consensus.acceptReport(
          makeAcceptedReport({
            reporter:
              reporters[index],
            target,
            reportingNodeId:
              `reporting-node-${index + 1}`,
            reportIndex:
              index + 1
          })
        );
      }

      const parsed =
        JSON.parse(
          await fs.readFile(
            temp.statePath,
            'utf8'
          )
        );

      const key =
        Object.keys(
          parsed.windows
        )[0];

      parsed.windows[key]
        .finalized = false;

      await fs.writeFile(
        temp.statePath,
        JSON.stringify(parsed),
        'utf8'
      );

      await assert.rejects(
        createValidatorConsensusState({
          minimumReports: 3,
          statePath:
            temp.statePath
        }),
        /finalized flag is inconsistent/
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
