'use strict';

const crypto = require('node:crypto');

const NONCE_BYTE_LENGTH = 32;
const NONCE_HEX_LENGTH = NONCE_BYTE_LENGTH * 2;
const NONCE_PATTERN = /^[0-9a-f]{64}$/;

function isCanonicalNonce(value) {
  return (
    typeof value === 'string' &&
    value.length === NONCE_HEX_LENGTH &&
    NONCE_PATTERN.test(value)
  );
}

function assertCanonicalNonce(value) {
  if (!isCanonicalNonce(value)) {
    throw new TypeError(
      'Evidence nonce must be exactly 32 bytes encoded as 64 lowercase hexadecimal characters'
    );
  }

  return value;
}

function createNonceProvider(options = {}) {
  if (
    options === null ||
    typeof options !== 'object' ||
    Array.isArray(options)
  ) {
    throw new TypeError('Nonce provider options must be a plain object');
  }

  const randomBytes =
    options.randomBytes === undefined
      ? crypto.randomBytes
      : options.randomBytes;

  if (typeof randomBytes !== 'function') {
    throw new TypeError('Nonce entropy source must be a function');
  }

  function generateNonce() {
    const entropy = randomBytes(NONCE_BYTE_LENGTH);

    if (!Buffer.isBuffer(entropy)) {
      throw new TypeError('Nonce entropy source must return a Buffer');
    }

    if (entropy.length !== NONCE_BYTE_LENGTH) {
      throw new RangeError(
        `Nonce entropy source must return exactly ${NONCE_BYTE_LENGTH} bytes`
      );
    }

    return assertCanonicalNonce(entropy.toString('hex'));
  }

  return Object.freeze({
    generateNonce
  });
}

const defaultNonceProvider = createNonceProvider();

function generateNonce() {
  return defaultNonceProvider.generateNonce();
}

module.exports = Object.freeze({
  NONCE_BYTE_LENGTH,
  NONCE_HEX_LENGTH,
  assertCanonicalNonce,
  createNonceProvider,
  generateNonce,
  isCanonicalNonce
});
