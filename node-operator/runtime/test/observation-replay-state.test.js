'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  createObservationReplayState
} = require(
  '../src/evidence/observation-replay-state'
);

const OPERATOR =
  '0x1111111111111111111111111111111111111111';

const NODE_ID =
  'remote-node-0001';

async function createTempState() {
  const directory =
    await fs.mkdtemp(
      path.join(
        os.tmpdir(),
        'crylonexus-replay-'
      )
    );

  return {
    directory,
    statePath:
      path.join(
        directory,
        'replay-state.json'
      )
  };
}

function heartbeatEvidence(
  overrides = {}
) {
  return {
    operatorAddress:
      OPERATOR,
    nodeId:
      NODE_ID,
    sequence:
      10,
    nonce:
      '11'.repeat(32),
    payloadHash:
      `0x${'22'.repeat(32)}`,
    observedAt:
      '2026-08-09T23:00:30.000Z',
    ...overrides
  };
}

test(
  'accepts first heartbeat for a peer',
  async () => {
    const temp =
      await createTempState();

    try {
      const replay =
        await createObservationReplayState({
          statePath:
            temp.statePath
        });

      const result =
        await replay.acceptHeartbeat(
          heartbeatEvidence()
        );

      assert.equal(
        result.lastSequence,
        10
      );

      assert.equal(
        result.nodeId,
        NODE_ID
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
  'accepts strictly increasing sequence',
  async () => {
    const temp =
      await createTempState();

    try {
      const replay =
        await createObservationReplayState({
          statePath:
            temp.statePath
        });

      await replay.acceptHeartbeat(
        heartbeatEvidence()
      );

      const result =
        await replay.acceptHeartbeat(
          heartbeatEvidence({
            sequence: 11,
            nonce:
              '33'.repeat(32),
            payloadHash:
              `0x${'44'.repeat(32)}`
          })
        );

      assert.equal(
        result.lastSequence,
        11
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
  'rejects sequence rollback',
  async () => {
    const temp =
      await createTempState();

    try {
      const replay =
        await createObservationReplayState({
          statePath:
            temp.statePath
        });

      await replay.acceptHeartbeat(
        heartbeatEvidence()
      );

      await assert.rejects(
        replay.acceptHeartbeat(
          heartbeatEvidence({
            sequence: 9,
            nonce:
              '33'.repeat(32),
            payloadHash:
              `0x${'44'.repeat(32)}`
          })
        ),
        /sequence rollback detected/
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
  'rejects duplicate sequence',
  async () => {
    const temp =
      await createTempState();

    try {
      const replay =
        await createObservationReplayState({
          statePath:
            temp.statePath
        });

      await replay.acceptHeartbeat(
        heartbeatEvidence()
      );

      await assert.rejects(
        replay.acceptHeartbeat(
          heartbeatEvidence({
            nonce:
              '33'.repeat(32),
            payloadHash:
              `0x${'44'.repeat(32)}`
          })
        ),
        /sequence replay detected/
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
  'rejects nonce reuse',
  async () => {
    const temp =
      await createTempState();

    try {
      const replay =
        await createObservationReplayState({
          statePath:
            temp.statePath
        });

      await replay.acceptHeartbeat(
        heartbeatEvidence()
      );

      await assert.rejects(
        replay.acceptHeartbeat(
          heartbeatEvidence({
            sequence: 11,
            payloadHash:
              `0x${'44'.repeat(32)}`
          })
        ),
        /nonce replay detected/
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
  'rejects payload hash reuse',
  async () => {
    const temp =
      await createTempState();

    try {
      const replay =
        await createObservationReplayState({
          statePath:
            temp.statePath
        });

      await replay.acceptHeartbeat(
        heartbeatEvidence()
      );

      await assert.rejects(
        replay.acceptHeartbeat(
          heartbeatEvidence({
            sequence: 11,
            nonce:
              '33'.repeat(32)
          })
        ),
        /payload replay detected/
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
  'persists replay state across restart',
  async () => {
    const temp =
      await createTempState();

    try {
      const first =
        await createObservationReplayState({
          statePath:
            temp.statePath
        });

      await first.acceptHeartbeat(
        heartbeatEvidence()
      );

      const restarted =
        await createObservationReplayState({
          statePath:
            temp.statePath
        });

      await assert.rejects(
        restarted.acceptHeartbeat(
          heartbeatEvidence({
            sequence: 9,
            nonce:
              '33'.repeat(32),
            payloadHash:
              `0x${'44'.repeat(32)}`
          })
        ),
        /sequence rollback detected/
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
  'tracks different peers independently',
  async () => {
    const temp =
      await createTempState();

    try {
      const replay =
        await createObservationReplayState({
          statePath:
            temp.statePath
        });

      await replay.acceptHeartbeat(
        heartbeatEvidence()
      );

      const secondPeer =
        await replay.acceptHeartbeat(
          heartbeatEvidence({
            operatorAddress:
              '0x2222222222222222222222222222222222222222',
            sequence: 1,
            nonce:
              '55'.repeat(32),
            payloadHash:
              `0x${'66'.repeat(32)}`
          })
        );

      assert.equal(
        secondPeer.lastSequence,
        1
      );

      const firstPeer =
        await replay.getPeerState(
          OPERATOR,
          NODE_ID
        );

      assert.equal(
        firstPeer.lastSequence,
        10
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
  'rejects reuse of an older nonce',
  async () => {
    const temp =
      await createTempState();

    try {
      const replay =
        await createObservationReplayState({
          statePath:
            temp.statePath
        });

      await replay.acceptHeartbeat(
        heartbeatEvidence({
          sequence: 10,
          nonce:
            '11'.repeat(32),
          payloadHash:
            `0x${'22'.repeat(32)}`
        })
      );

      await replay.acceptHeartbeat(
        heartbeatEvidence({
          sequence: 11,
          nonce:
            '33'.repeat(32),
          payloadHash:
            `0x${'44'.repeat(32)}`
        })
      );

      await assert.rejects(
        replay.acceptHeartbeat(
          heartbeatEvidence({
            sequence: 12,
            nonce:
              '11'.repeat(32),
            payloadHash:
              `0x${'66'.repeat(32)}`
          })
        ),
        /nonce replay detected/
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
