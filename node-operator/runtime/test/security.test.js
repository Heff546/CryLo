'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  findForbiddenField
} = require('../src/security');

test('detects nested secret fields', () => {
  const result = findForbiddenField({
    safe: {
      privateKey: 'not-allowed'
    }
  });

  assert.equal(
    result,
    '$.safe.privateKey'
  );
});

test('accepts non-secret configuration fields', () => {
  const result = findForbiddenField({
    operatorAddress:
      '0x1111111111111111111111111111111111111111'
  });

  assert.equal(result, null);
});
