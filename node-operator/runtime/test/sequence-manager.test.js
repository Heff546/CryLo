'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  INITIAL_NEXT_SEQUENCE,
  PROTOCOL_VERSION,
  createSequenceManager,
  readSequenceState,
  validateSequenceState,
  writeSequenceStateAtomic
} = require('../src/evidence');

function createFixture() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'crylonexus-sequence-')
  );

  return {
    directory,
    statePath: path.join(directory, 'sequence.json')
  };
}

function removeFixture(fixture) {
  fs.rmSync(fixture.directory, {
    recursive: true,
    force: true
  });
}

test('missing state begins at sequence zero without writing a file', () => {
  const fixture = createFixture();

  try {
    const manager = createSequenceManager({
      statePath: fixture.statePath
    });

    assert.equal(
      manager.peekNextSequence(),
      INITIAL_NEXT_SEQUENCE
    );

    assert.equal(fs.existsSync(fixture.statePath), false);
  } finally {
    removeFixture(fixture);
  }
});

test('allocates monotonically increasing sequences', () => {
  const fixture = createFixture();

  try {
    const manager = createSequenceManager({
      statePath: fixture.statePath
    });

    assert.equal(manager.allocateNextSequence(), 0);
    assert.equal(manager.allocateNextSequence(), 1);
    assert.equal(manager.allocateNextSequence(), 2);
    assert.equal(manager.peekNextSequence(), 3);
  } finally {
    removeFixture(fixture);
  }
});

test('persists sequence state across manager restarts', () => {
  const fixture = createFixture();

  try {
    const firstManager = createSequenceManager({
      statePath: fixture.statePath
    });

    assert.equal(firstManager.allocateNextSequence(), 0);
    assert.equal(firstManager.allocateNextSequence(), 1);

    const restartedManager = createSequenceManager({
      statePath: fixture.statePath
    });

    assert.equal(restartedManager.peekNextSequence(), 2);
    assert.equal(restartedManager.allocateNextSequence(), 2);
    assert.equal(restartedManager.peekNextSequence(), 3);
  } finally {
    removeFixture(fixture);
  }
});

test('persists the exact versioned state schema', () => {
  const fixture = createFixture();

  try {
    const manager = createSequenceManager({
      statePath: fixture.statePath
    });

    manager.allocateNextSequence();

    const parsed = JSON.parse(
      fs.readFileSync(fixture.statePath, 'utf8')
    );

    assert.deepEqual(parsed, {
      protocolVersion: PROTOCOL_VERSION,
      nextSequence: 1
    });

    if (process.platform !== 'win32') {
      assert.equal(
        fs.statSync(fixture.statePath).mode & 0o777,
        0o600
      );
    }
  } finally {
    removeFixture(fixture);
  }
});

test('rejects malformed JSON state', () => {
  const fixture = createFixture();

  try {
    fs.writeFileSync(fixture.statePath, '{"nextSequence":', 'utf8');

    assert.throws(
      () => readSequenceState(fixture.statePath),
      /malformed JSON/
    );
  } finally {
    removeFixture(fixture);
  }
});

test('rejects missing, additional, and unsupported state fields', () => {
  assert.throws(
    () => validateSequenceState({
      protocolVersion: PROTOCOL_VERSION
    }),
    /exactly protocolVersion and nextSequence/
  );

  assert.throws(
    () => validateSequenceState({
      protocolVersion: PROTOCOL_VERSION,
      nextSequence: 0,
      signature: 'not-allowed'
    }),
    /exactly protocolVersion and nextSequence/
  );

  assert.throws(
    () => validateSequenceState({
      protocolVersion: '2.0.0',
      nextSequence: 0
    }),
    /Unsupported sequence state protocol version/
  );
});

test('rejects invalid sequence values', () => {
  for (const nextSequence of [
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    '1',
    null
  ]) {
    assert.throws(
      () => validateSequenceState({
        protocolVersion: PROTOCOL_VERSION,
        nextSequence
      }),
      /non-negative safe integer/
    );
  }
});

test('rejects a sequence state path reached through a directory symlink or junction', () => {
  const fixture = createFixture();
  const realDirectory = path.join(fixture.directory, 'real');
  const redirectDirectory = path.join(fixture.directory, 'redirect');

  try {
    fs.mkdirSync(realDirectory);
    fs.symlinkSync(
      realDirectory,
      redirectDirectory,
      process.platform === 'win32' ? 'junction' : 'dir'
    );

    const redirectedStatePath =
      path.join(redirectDirectory, 'sequence.json');

    assert.throws(
      () => createSequenceManager({
        statePath: redirectedStatePath
      }),
      /symbolic link|reparse redirect/
    );

    assert.throws(
      () => readSequenceState(redirectedStatePath),
      /symbolic link|reparse redirect/
    );

    assert.throws(
      () => writeSequenceStateAtomic(
        redirectedStatePath,
        {
          protocolVersion: PROTOCOL_VERSION,
          nextSequence: 1
        }
      ),
      /symbolic link|reparse redirect/
    );

    assert.deepEqual(
      fs.readdirSync(realDirectory),
      []
    );
  } finally {
    try {
      fs.unlinkSync(redirectDirectory);
    } catch (error) {
      if (!error || error.code !== 'ENOENT') {
        throw error;
      }
    }

    removeFixture(fixture);
  }
});

test('rejects sequence directory replacement after manager creation', () => {
  const fixture = createFixture();
  const stateDirectory = path.join(fixture.directory, 'state');
  const movedDirectory = path.join(fixture.directory, 'state-original');
  const redirectTarget = path.join(fixture.directory, 'redirect-target');
  const statePath = path.join(stateDirectory, 'sequence.json');

  try {
    fs.mkdirSync(stateDirectory);
    fs.mkdirSync(redirectTarget);

    const manager = createSequenceManager({
      statePath
    });

    fs.renameSync(stateDirectory, movedDirectory);
    fs.symlinkSync(
      redirectTarget,
      stateDirectory,
      process.platform === 'win32' ? 'junction' : 'dir'
    );

    assert.throws(
      () => manager.allocateNextSequence(),
      /symbolic link|reparse redirect/
    );

    assert.deepEqual(
      fs.readdirSync(redirectTarget),
      []
    );
  } finally {
    try {
      fs.unlinkSync(stateDirectory);
    } catch (error) {
      if (!error || error.code !== 'ENOENT') {
        throw error;
      }
    }

    removeFixture(fixture);
  }
});
test('rejects invalid manager options and paths', () => {
  assert.throws(
    () => createSequenceManager(),
    /options must be a plain object/
  );

  assert.throws(
    () => createSequenceManager({}),
    /path must be a non-empty string/
  );

  assert.throws(
    () => createSequenceManager({ statePath: '   ' }),
    /path must be a non-empty string/
  );
});

test('atomic state writes leave no temporary files', () => {
  const fixture = createFixture();

  try {
    writeSequenceStateAtomic(fixture.statePath, {
      protocolVersion: PROTOCOL_VERSION,
      nextSequence: 27
    });

    assert.equal(
      readSequenceState(fixture.statePath).nextSequence,
      27
    );

    const remainingFiles = fs.readdirSync(fixture.directory);

    assert.deepEqual(remainingFiles, ['sequence.json']);
  } finally {
    removeFixture(fixture);
  }
});

test('an existing allocation lock fails closed', () => {
  const fixture = createFixture();

  try {
    writeSequenceStateAtomic(fixture.statePath, {
      protocolVersion: PROTOCOL_VERSION,
      nextSequence: 8
    });

    fs.mkdirSync(`${fixture.statePath}.lock`);

    const manager = createSequenceManager({
      statePath: fixture.statePath
    });

    assert.throws(
      () => manager.allocateNextSequence(),
      /locked by another allocator/
    );

    assert.equal(
      readSequenceState(fixture.statePath).nextSequence,
      8
    );
  } finally {
    removeFixture(fixture);
  }
});

test('separate manager instances do not reuse sequences', () => {
  const fixture = createFixture();

  try {
    const firstManager = createSequenceManager({
      statePath: fixture.statePath
    });

    const secondManager = createSequenceManager({
      statePath: fixture.statePath
    });

    assert.equal(firstManager.allocateNextSequence(), 0);
    assert.equal(secondManager.allocateNextSequence(), 1);
    assert.equal(firstManager.allocateNextSequence(), 2);
    assert.equal(secondManager.peekNextSequence(), 3);
  } finally {
    removeFixture(fixture);
  }
});

test('sequence exhaustion fails without modifying state', () => {
  const fixture = createFixture();

  try {
    writeSequenceStateAtomic(fixture.statePath, {
      protocolVersion: PROTOCOL_VERSION,
      nextSequence: Number.MAX_SAFE_INTEGER
    });

    const manager = createSequenceManager({
      statePath: fixture.statePath
    });

    assert.throws(
      () => manager.allocateNextSequence(),
      /allocation is exhausted/
    );

    assert.equal(
      readSequenceState(fixture.statePath).nextSequence,
      Number.MAX_SAFE_INTEGER
    );

    assert.equal(
      fs.existsSync(`${fixture.statePath}.lock`),
      false
    );
  } finally {
    removeFixture(fixture);
  }
});
