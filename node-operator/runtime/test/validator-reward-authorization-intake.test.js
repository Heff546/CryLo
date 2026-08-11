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
  createValidatorConsensusState
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
        'crylonexus-validator-reward-intake-'
      )
    );

  return {
    directory,

    consensusPath:
      path.join(
        directory,
        'validator-consensus-state.json'
      ),

    authorizationPath:
      path.join(
        directory,
        'validator-reward-authorization-state.json'
      )
  };
}

function makeAcceptedReport({
  reporter,
  target,
  reportingNodeId,
  locallyQualified,
  reportIndex,
  windowStartedAt =
    '2026-08-10T20:00:00.000Z'
}) {
  const startMs =
    Date.parse(
      windowStartedAt
    );

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

    observedNodeId:
      'target-node-0001',

    windowStartedAt,

    windowEndedAt:
      new Date(
        startMs + 20 * 60_000
      ).toISOString(),

    locallyQualified
  };
}

async function createPipeline(
  temp
) {
  const consensusState =
    await createValidatorConsensusState({
      minimumReports:
        3,

      statePath:
        temp.consensusPath
    });

  const authorizationState =
    await createValidatorRewardAuthorizationState({
      statePath:
        temp.authorizationPath
    });

  async function acceptReport(
    report
  ) {
    const consensus =
      await consensusState
        .acceptReport(
          report
        );

    if (
      consensus.finalized !== true
    ) {
      return {
        consensus,
        authorization:
          null
      };
    }

    const authorization =
      await authorizationState
        .recordConsensus(
          consensus
        );

    return {
      consensus,
      authorization
    };
  }

  return {
    consensusState,
    authorizationState,
    acceptReport
  };
}

test(
  'pending consensus creates no reward authorization record',
  async () => {
    const temp =
      await makeTempState();

    try {
      const target =
        Wallet.createRandom();

      const reporter =
        Wallet.createRandom();

      const pipeline =
        await createPipeline(
          temp
        );

      const result =
        await pipeline.acceptReport(
          makeAcceptedReport({
            reporter,
            target,
            reportingNodeId:
              'reporting-node-1',
            locallyQualified:
              true,
            reportIndex:
              1
          })
        );

      assert.equal(
        result.consensus.consensus,
        CONSENSUS_PENDING
      );

      assert.equal(
        result.authorization,
        null
      );

      assert.equal(
        pipeline.authorizationState
          .getRecords().length,
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
  'qualified consensus creates one awaiting-contract-verification record',
  async () => {
    const temp =
      await makeTempState();

    try {
      const target =
        Wallet.createRandom();

      const pipeline =
        await createPipeline(
          temp
        );

      let result = null;

      for (
        let index = 0;
        index < 3;
        index += 1
      ) {
        result =
          await pipeline.acceptReport(
            makeAcceptedReport({
              reporter:
                Wallet.createRandom(),
              target,
              reportingNodeId:
                `reporting-node-${index + 1}`,
              locallyQualified:
                true,
              reportIndex:
                index + 1
            })
          );
      }

      assert.equal(
        result.consensus.consensus,
        CONSENSUS_QUALIFIED
      );

      assert.equal(
        result.authorization
          .authorizationStatus,
        AUTHORIZATION_AWAITING_CONTRACT_VERIFICATION
      );

      assert.equal(
        pipeline.authorizationState
          .getRecords().length,
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
  'unqualified consensus creates one denied record',
  async () => {
    const temp =
      await makeTempState();

    try {
      const target =
        Wallet.createRandom();

      const pipeline =
        await createPipeline(
          temp
        );

      let result = null;

      for (
        let index = 0;
        index < 3;
        index += 1
      ) {
        result =
          await pipeline.acceptReport(
            makeAcceptedReport({
              reporter:
                Wallet.createRandom(),
              target,
              reportingNodeId:
                `reporting-node-${index + 1}`,
              locallyQualified:
                false,
              reportIndex:
                index + 1
            })
          );
      }

      assert.equal(
        result.consensus.consensus,
        CONSENSUS_UNQUALIFIED
      );

      assert.equal(
        result.authorization
          .authorizationStatus,
        AUTHORIZATION_DENIED_BY_CONSENSUS
      );

      assert.equal(
        pipeline.authorizationState
          .getRecords().length,
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
  'finalized consensus cannot create a second authorization record',
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

      const pipeline =
        await createPipeline(
          temp
        );

      for (
        let index = 0;
        index < 3;
        index += 1
      ) {
        await pipeline.acceptReport(
          makeAcceptedReport({
            reporter:
              reporters[index],
            target,
            reportingNodeId:
              `reporting-node-${index + 1}`,
            locallyQualified:
              true,
            reportIndex:
              index + 1
          })
        );
      }

      assert.equal(
        pipeline.authorizationState
          .getRecords().length,
        1
      );

      await assert.rejects(
        pipeline.acceptReport(
          makeAcceptedReport({
            reporter:
              reporters[3],
            target,
            reportingNodeId:
              'reporting-node-4',
            locallyQualified:
              true,
            reportIndex:
              4
          })
        ),
        /already finalized/
      );

      assert.equal(
        pipeline.authorizationState
          .getRecords().length,
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
  'authorization survives restart without duplication',
  async () => {
    const temp =
      await makeTempState();

    try {
      const target =
        Wallet.createRandom();

      const first =
        await createPipeline(
          temp
        );

      for (
        let index = 0;
        index < 3;
        index += 1
      ) {
        await first.acceptReport(
          makeAcceptedReport({
            reporter:
              Wallet.createRandom(),
            target,
            reportingNodeId:
              `reporting-node-${index + 1}`,
            locallyQualified:
              true,
            reportIndex:
              index + 1
          })
        );
      }

      const original =
        first.authorizationState
          .getRecords()[0];

      const restarted =
        await createPipeline(
          temp
        );

      const records =
        restarted.authorizationState
          .getRecords();

      assert.equal(
        records.length,
        1
      );

      assert.equal(
        records[0].authorizationId,
        original.authorizationId
      );

      assert.equal(
        records[0].authorizationStatus,
        AUTHORIZATION_AWAITING_CONTRACT_VERIFICATION
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
