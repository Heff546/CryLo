'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  canonicalJson,
  canonicalJsonBytes
} = require('../src/evidence/canonical-json');

test('sorts object keys recursively', () => {
  const first = {
    z: 3,
    nested: {
      y: 2,
      a: 1
    },
    a: true
  };

  const second = {
    a: true,
    nested: {
      a: 1,
      y: 2
    },
    z: 3
  };

  const expected =
    '{"a":true,"nested":{"a":1,"y":2},"z":3}';

  assert.equal(
    canonicalJson(first),
    expected
  );

  assert.equal(
    canonicalJson(second),
    expected
  );
});

test('preserves array order', () => {
  assert.equal(
    canonicalJson({
      values: [3, 2, 1]
    }),
    '{"values":[3,2,1]}'
  );
});

test('normalizes negative zero', () => {
  assert.equal(
    canonicalJson({
      value: -0
    }),
    '{"value":0}'
  );
});

test('returns UTF-8 bytes', () => {
  const bytes = canonicalJsonBytes({
    message: 'CryLoNexus'
  });

  assert.ok(Buffer.isBuffer(bytes));

  assert.equal(
    bytes.toString('utf8'),
    '{"message":"CryLoNexus"}'
  );
});

test('rejects unsupported values', () => {
  const cases = [
    [{ unsafe: undefined }, /undefined/],
    [{ unsafe: () => true }, /function/],
    [{ unsafe: Symbol('x') }, /symbol/],
    [{ unsafe: 1n }, /bigint/],
    [{ unsafe: Number.NaN }, /non-finite/],
    [
      { unsafe: Number.POSITIVE_INFINITY },
      /non-finite/
    ]
  ];

  for (const [value, pattern] of cases) {
    assert.throws(
      () => canonicalJson(value),
      pattern
    );
  }
});

test('rejects sparse arrays', () => {
  const values = [];

  values[1] = 'present';

  assert.throws(
    () => canonicalJson(values),
    /sparse arrays/
  );
});

test('rejects non-plain objects', () => {
  assert.throws(
    () =>
      canonicalJson({
        createdAt: new Date()
      }),
    /plain objects/
  );

  assert.throws(
    () =>
      canonicalJson({
        values: new Map()
      }),
    /plain objects/
  );
});

test('rejects circular structures', () => {
  const value = {
    safe: true
  };

  value.circular = value;

  assert.throws(
    () => canonicalJson(value),
    /circular structures/
  );
});

test('allows repeated non-circular references', () => {
  const child = {
    value: 1
  };

  assert.equal(
    canonicalJson({
      first: child,
      second: child
    }),
    '{"first":{"value":1},"second":{"value":1}}'
  );
});
