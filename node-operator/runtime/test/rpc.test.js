'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseHexInteger
} = require('../src/rpc');

test('parses hexadecimal RPC integers', () => {
  assert.equal(
    parseHexInteger('0x15aa', 'chain ID'),
    5546
  );

  assert.equal(
    parseHexInteger('0x64', 'block number'),
    100
  );
});

test('rejects invalid RPC integer values', () => {
  assert.throws(
    () => parseHexInteger('5546', 'chain ID'),
    /Invalid chain ID/
  );
});
