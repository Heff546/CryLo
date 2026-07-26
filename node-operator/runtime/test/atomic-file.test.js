'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  writeJsonAtomic
} = require('../src/atomic-file');

test('writes JSON atomically', async () => {
  const directory =
    await fs.mkdtemp(
      path.join(
        os.tmpdir(),
        'crylonexus-atomic-'
      )
    );

  const filePath =
    path.join(directory, 'status.json');

  await writeJsonAtomic(filePath, {
    healthy: true
  });

  const loaded =
    JSON.parse(
      await fs.readFile(
        filePath,
        'utf8'
      )
    );

  assert.deepEqual(loaded, {
    healthy: true
  });
});
