'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SigningKey,
  Signature,
  computeAddress,
  getAddress
} = require('ethers');

const {
  assertCanonicalPayloadHash,
  assertCanonicalSignature,
  assertPrivateKey,
  createHeartbeatSigner,
  isCanonicalSignature,
  recoverHeartbeatSigner,
  signHeartbeatPayload,
  verifyHeartbeatSignature
} = require('../src/evidence');

const PRIVATE_KEY =
  '0x' + '11'.repeat(32);

const OTHER_PRIVATE_KEY =
  '0x' + '22'.repeat(32);

const PAYLOAD_HASH =
  '0x' + 'ab'.repeat(32);

const OTHER_PAYLOAD_HASH =
  '0x' + 'cd'.repeat(32);

const OPERATOR_ADDRESS = getAddress(
  computeAddress(PRIVATE_KEY)
);

test('signs the exact canonical payload digest', () => {
  const signed = signHeartbeatPayload(
    PAYLOAD_HASH,
    PRIVATE_KEY
  );

  const expectedSignature = Signature.from(
    new SigningKey(PRIVATE_KEY).sign(PAYLOAD_HASH)
  ).serialized;

  assert.deepEqual(signed, {
    payloadHash: PAYLOAD_HASH,
    signature: expectedSignature,
    operatorAddress: OPERATOR_ADDRESS
  });

  assert.equal(Object.isFrozen(signed), true);
});

test('heartbeat signatures are deterministic', () => {
  const first = signHeartbeatPayload(
    PAYLOAD_HASH,
    PRIVATE_KEY
  );

  const second = signHeartbeatPayload(
    PAYLOAD_HASH,
    PRIVATE_KEY
  );

  assert.equal(first.signature, second.signature);
  assert.equal(first.operatorAddress, second.operatorAddress);
});

test('recovers the operator address from the payload hash', () => {
  const signed = signHeartbeatPayload(
    PAYLOAD_HASH,
    PRIVATE_KEY
  );

  assert.equal(
    recoverHeartbeatSigner(
      signed.payloadHash,
      signed.signature
    ),
    OPERATOR_ADDRESS
  );
});

test('verifies an expected operator address', () => {
  const signed = signHeartbeatPayload(
    PAYLOAD_HASH,
    PRIVATE_KEY
  );

  const result = verifyHeartbeatSignature({
    payloadHash: signed.payloadHash,
    signature: signed.signature,
    expectedOperatorAddress: OPERATOR_ADDRESS.toLowerCase()
  });

  assert.deepEqual(result, {
    payloadHash: PAYLOAD_HASH,
    signature: signed.signature,
    operatorAddress: OPERATOR_ADDRESS,
    valid: true
  });

  assert.equal(Object.isFrozen(result), true);
});

test('rejects an operator-address mismatch', () => {
  const signed = signHeartbeatPayload(
    PAYLOAD_HASH,
    PRIVATE_KEY
  );

  const otherAddress = getAddress(
    computeAddress(OTHER_PRIVATE_KEY)
  );

  assert.throws(
    () => verifyHeartbeatSignature({
      payloadHash: signed.payloadHash,
      signature: signed.signature,
      expectedOperatorAddress: otherAddress
    }),
    /signature signer mismatch/
  );
});

test('modified payload hashes fail expected-signer verification', () => {
  const signed = signHeartbeatPayload(
    PAYLOAD_HASH,
    PRIVATE_KEY
  );

  assert.throws(
    () => verifyHeartbeatSignature({
      payloadHash: OTHER_PAYLOAD_HASH,
      signature: signed.signature,
      expectedOperatorAddress: OPERATOR_ADDRESS
    }),
    /signature signer mismatch/
  );
});

test('validates canonical payload hashes', () => {
  assert.equal(
    assertCanonicalPayloadHash(PAYLOAD_HASH),
    PAYLOAD_HASH
  );

  for (const value of [
    '',
    'ab'.repeat(32),
    '0x' + 'AB'.repeat(32),
    '0x' + 'ab'.repeat(31),
    '0x' + 'ab'.repeat(33),
    null,
    42
  ]) {
    assert.throws(
      () => assertCanonicalPayloadHash(value),
      /canonical lowercase Keccak-256 hash/
    );
  }
});

test('validates canonical private keys', () => {
  assert.equal(assertPrivateKey(PRIVATE_KEY), PRIVATE_KEY);

  for (const value of [
    '',
    '11'.repeat(32),
    '0x' + 'AA'.repeat(32),
    '0x' + '11'.repeat(31),
    '0x' + '11'.repeat(33),
    null,
    42
  ]) {
    assert.throws(
      () => assertPrivateKey(value),
      /32 lowercase hexadecimal bytes/
    );
  }

  assert.throws(
    () => assertPrivateKey('0x' + '00'.repeat(32)),
    /not a valid secp256k1 private key/
  );
});

test('validates canonical signatures', () => {
  const signed = signHeartbeatPayload(
    PAYLOAD_HASH,
    PRIVATE_KEY
  );

  assert.equal(isCanonicalSignature(signed.signature), true);

  assert.equal(
    assertCanonicalSignature(signed.signature),
    signed.signature
  );

  for (const value of [
    '',
    signed.signature.slice(2),
    signed.signature.toUpperCase(),
    '0x' + '00'.repeat(64),
    '0x' + '00'.repeat(65),
    '0x' + '00'.repeat(66),
    null,
    42
  ]) {
    assert.equal(isCanonicalSignature(value), false);

    assert.throws(
      () => assertCanonicalSignature(value),
      /canonical 65-byte lowercase/
    );
  }
});

test('rejects invalid expected operator addresses', () => {
  const signed = signHeartbeatPayload(
    PAYLOAD_HASH,
    PRIVATE_KEY
  );

  for (const expectedOperatorAddress of [
    '',
    '0x1234',
    null,
    42
  ]) {
    assert.throws(
      () => verifyHeartbeatSignature({
        payloadHash: signed.payloadHash,
        signature: signed.signature,
        expectedOperatorAddress
      }),
      /Expected operator address/
    );
  }
});

test('creates an immutable heartbeat signer without exposing its key', () => {
  const signer = createHeartbeatSigner({
    privateKey: PRIVATE_KEY
  });

  assert.equal(signer.operatorAddress, OPERATOR_ADDRESS);
  assert.equal(Object.isFrozen(signer), true);

  assert.deepEqual(
    Object.keys(signer).sort(),
    ['operatorAddress', 'sign']
  );

  assert.equal('privateKey' in signer, false);

  const signed = signer.sign(PAYLOAD_HASH);

  assert.equal(signed.operatorAddress, OPERATOR_ADDRESS);
});

test('heartbeat signer exposes no networking or persistence methods', () => {
  const signer = createHeartbeatSigner({
    privateKey: PRIVATE_KEY
  });

  for (const forbiddenMethod of [
    'connect',
    'send',
    'submit',
    'persist',
    'save',
    'load',
    'buildHeartbeat',
    'allocateSequence',
    'generateNonce',
    'claimRewards'
  ]) {
    assert.equal(forbiddenMethod in signer, false);
  }
});
