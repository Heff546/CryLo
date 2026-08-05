'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  NONCE_BYTE_LENGTH,
  NONCE_HEX_LENGTH,
  assertCanonicalNonce,
  createNonceProvider,
  generateNonce,
  isCanonicalNonce
} = require('../src/evidence');

test('generates a canonical 32-byte nonce', () => {
  const nonce = generateNonce();

  assert.equal(nonce.length, NONCE_HEX_LENGTH);
  assert.match(nonce, /^[0-9a-f]{64}$/);
  assert.equal(Buffer.from(nonce, 'hex').length, NONCE_BYTE_LENGTH);
});

test('uses exactly 32 bytes from the entropy source', () => {
  let requestedLength = null;

  const provider = createNonceProvider({
    randomBytes(length) {
      requestedLength = length;
      return Buffer.alloc(length, 0xab);
    }
  });

  assert.equal(
    provider.generateNonce(),
    'ab'.repeat(NONCE_BYTE_LENGTH)
  );

  assert.equal(requestedLength, NONCE_BYTE_LENGTH);
});

test('preserves leading zero bytes in hexadecimal output', () => {
  const entropy = Buffer.alloc(NONCE_BYTE_LENGTH, 0);
  entropy[NONCE_BYTE_LENGTH - 1] = 1;

  const provider = createNonceProvider({
    randomBytes() {
      return entropy;
    }
  });

  assert.equal(
    provider.generateNonce(),
    `${'00'.repeat(NONCE_BYTE_LENGTH - 1)}01`
  );
});

test('separate entropy values produce separate nonces', () => {
  let counter = 0;

  const provider = createNonceProvider({
    randomBytes(length) {
      counter += 1;
      return Buffer.alloc(length, counter);
    }
  });

  const first = provider.generateNonce();
  const second = provider.generateNonce();

  assert.notEqual(first, second);
  assert.equal(first, '01'.repeat(NONCE_BYTE_LENGTH));
  assert.equal(second, '02'.repeat(NONCE_BYTE_LENGTH));
});

test('validates canonical nonce strings', () => {
  const valid = '0123456789abcdef'.repeat(4);

  assert.equal(isCanonicalNonce(valid), true);
  assert.equal(assertCanonicalNonce(valid), valid);
});

test('rejects malformed nonce strings', () => {
  const invalidValues = [
    '',
    '00',
    '0x' + '00'.repeat(NONCE_BYTE_LENGTH),
    'AA'.repeat(NONCE_BYTE_LENGTH),
    'gg'.repeat(NONCE_BYTE_LENGTH),
    '00'.repeat(NONCE_BYTE_LENGTH - 1),
    '00'.repeat(NONCE_BYTE_LENGTH + 1),
    null,
    undefined,
    42,
    Buffer.alloc(NONCE_BYTE_LENGTH)
  ];

  for (const value of invalidValues) {
    assert.equal(isCanonicalNonce(value), false);

    assert.throws(
      () => assertCanonicalNonce(value),
      /exactly 32 bytes/
    );
  }
});

test('rejects invalid nonce provider options', () => {
  for (const options of [null, [], 'invalid', 42]) {
    assert.throws(
      () => createNonceProvider(options),
      /options must be a plain object/
    );
  }

  assert.throws(
    () => createNonceProvider({ randomBytes: true }),
    /entropy source must be a function/
  );
});

test('rejects entropy sources returning the wrong type', () => {
  const provider = createNonceProvider({
    randomBytes() {
      return new Uint8Array(NONCE_BYTE_LENGTH);
    }
  });

  assert.throws(
    () => provider.generateNonce(),
    /must return a Buffer/
  );
});

test('rejects entropy sources returning the wrong length', () => {
  for (const length of [
    0,
    NONCE_BYTE_LENGTH - 1,
    NONCE_BYTE_LENGTH + 1
  ]) {
    const provider = createNonceProvider({
      randomBytes() {
        return Buffer.alloc(length);
      }
    });

    assert.throws(
      () => provider.generateNonce(),
      /exactly 32 bytes/
    );
  }
});

test('propagates entropy source failures without fallback', () => {
  const provider = createNonceProvider({
    randomBytes() {
      throw new Error('entropy unavailable');
    }
  });

  assert.throws(
    () => provider.generateNonce(),
    /entropy unavailable/
  );
});

test('nonce provider exposes no persistence or signing methods', () => {
  const provider = createNonceProvider({
    randomBytes(length) {
      return Buffer.alloc(length, 0x11);
    }
  });

  assert.deepEqual(
    Object.keys(provider).sort(),
    ['generateNonce']
  );

  assert.equal(Object.isFrozen(provider), true);
});
