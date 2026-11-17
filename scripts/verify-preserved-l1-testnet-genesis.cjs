#!/usr/bin/env node
'use strict';

// Offline release guard: protect the existing CryLo L1 testnet baseline.
// This script does not start a daemon, change genesis, or touch wallet data.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const expected = Object.freeze({
  'src/blockchain_utilities/crylo_genesis.cpp': '54e2785a9ca7b99439d155533d5d8c589db54c90',
  'src/blocks/checkpoints.dat': 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391'
});

for (const [relative, pinnedBlob] of Object.entries(expected)) {
  const actual = execFileSync('git', ['hash-object', '--', relative], {
    cwd: root, encoding: 'utf8'
  }).trim();
  assert.equal(actual, pinnedBlob, relative + ' differs from signed Testnet.25 baseline');
  process.stdout.write('PRESERVED ' + relative + ' ' + actual + '\n');
}
process.stdout.write('CryLo L1 tracked testnet genesis and checkpoints preserved.\n');
