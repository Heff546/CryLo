'use strict';

const {
  SigningKey,
  Signature,
  computeAddress,
  getAddress,
  recoverAddress
} = require('ethers');

const { isCanonicalHash } = require('./hashing');

const PRIVATE_KEY_PATTERN = /^0x[0-9a-f]{64}$/;
const SIGNATURE_PATTERN = /^0x[0-9a-f]{130}$/;
const SECP256K1_ORDER = BigInt(
  '0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141'
);

function assertCanonicalPayloadHash(payloadHash) {
  if (!isCanonicalHash(payloadHash)) {
    throw new TypeError(
      'Heartbeat payloadHash must be a canonical lowercase Keccak-256 hash'
    );
  }

  return payloadHash;
}

function assertPrivateKey(privateKey) {
  if (
    typeof privateKey !== 'string' ||
    !PRIVATE_KEY_PATTERN.test(privateKey)
  ) {
    throw new TypeError(
      'Heartbeat signing private key must be 32 lowercase hexadecimal bytes with a 0x prefix'
    );
  }

  const scalar = BigInt(privateKey);

  if (scalar === 0n || scalar >= SECP256K1_ORDER) {
    throw new RangeError(
      'Heartbeat signing private key is not a valid secp256k1 private key'
    );
  }

  try {
    new SigningKey(privateKey);
  } catch (error) {
    throw new RangeError(
      'Heartbeat signing private key is not a valid secp256k1 private key',
      { cause: error }
    );
  }

  return privateKey;
}

function isCanonicalSignature(signature) {
  if (
    typeof signature !== 'string' ||
    !SIGNATURE_PATTERN.test(signature)
  ) {
    return false;
  }

  try {
    return Signature.from(signature).serialized === signature;
  } catch {
    return false;
  }
}

function assertCanonicalSignature(signature) {
  if (!isCanonicalSignature(signature)) {
    throw new TypeError(
      'Heartbeat signature must be a canonical 65-byte lowercase secp256k1 signature'
    );
  }

  return signature;
}

function normalizeOperatorAddress(address) {
  if (typeof address !== 'string') {
    throw new TypeError('Expected operator address must be a string');
  }

  try {
    return getAddress(address);
  } catch (error) {
    throw new TypeError(
      'Expected operator address must be a valid EVM address',
      { cause: error }
    );
  }
}

function recoverHeartbeatSigner(payloadHash, signature) {
  const normalizedHash = assertCanonicalPayloadHash(payloadHash);
  const normalizedSignature = assertCanonicalSignature(signature);

  try {
    return getAddress(
      recoverAddress(normalizedHash, normalizedSignature)
    );
  } catch (error) {
    throw new Error(
      'Unable to recover heartbeat signer',
      { cause: error }
    );
  }
}

function verifyHeartbeatSignature({
  payloadHash,
  signature,
  expectedOperatorAddress
}) {
  const recoveredOperatorAddress = recoverHeartbeatSigner(
    payloadHash,
    signature
  );

  if (expectedOperatorAddress !== undefined) {
    const normalizedExpectedOperatorAddress =
      normalizeOperatorAddress(expectedOperatorAddress);

    if (recoveredOperatorAddress !== normalizedExpectedOperatorAddress) {
      throw new Error(
        `Heartbeat signature signer mismatch: expected ${normalizedExpectedOperatorAddress}, recovered ${recoveredOperatorAddress}`
      );
    }
  }

  return Object.freeze({
    payloadHash,
    signature,
    operatorAddress: recoveredOperatorAddress,
    valid: true
  });
}

function signHeartbeatPayload(payloadHash, privateKey) {
  const normalizedHash = assertCanonicalPayloadHash(payloadHash);
  const normalizedPrivateKey = assertPrivateKey(privateKey);

  const signingKey = new SigningKey(normalizedPrivateKey);
  const signature = Signature.from(
    signingKey.sign(normalizedHash)
  ).serialized;

  assertCanonicalSignature(signature);

  const operatorAddress = getAddress(
    computeAddress(normalizedPrivateKey)
  );

  const recoveredOperatorAddress = recoverHeartbeatSigner(
    normalizedHash,
    signature
  );

  if (recoveredOperatorAddress !== operatorAddress) {
    throw new Error(
      'Heartbeat signature self-verification failed'
    );
  }

  return Object.freeze({
    payloadHash: normalizedHash,
    signature,
    operatorAddress
  });
}

function createHeartbeatSigner(options) {
  if (
    options === null ||
    typeof options !== 'object' ||
    Array.isArray(options)
  ) {
    throw new TypeError(
      'Heartbeat signer options must be a plain object'
    );
  }

  const privateKey = assertPrivateKey(options.privateKey);
  const operatorAddress = getAddress(computeAddress(privateKey));

  function sign(payloadHash) {
    return signHeartbeatPayload(payloadHash, privateKey);
  }

  return Object.freeze({
    operatorAddress,
    sign
  });
}

module.exports = Object.freeze({
  assertCanonicalPayloadHash,
  assertCanonicalSignature,
  assertPrivateKey,
  createHeartbeatSigner,
  isCanonicalSignature,
  recoverHeartbeatSigner,
  signHeartbeatPayload,
  verifyHeartbeatSignature
});
