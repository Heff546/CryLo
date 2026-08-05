'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  canonicalHash,
  canonicalJson,
  heartbeatPayloadHash,
  statusHash,
  unsignedPayloadFromHeartbeat,
  validateUnsignedHeartbeat
} = require('../src/evidence');

const vectorDir = path.resolve(
  __dirname,
  '..',
  '..',
  'protocol',
  'test-vectors'
);

function readVector(filename) {
  return JSON.parse(
    fs.readFileSync(path.join(vectorDir, filename), 'utf8')
  );
}

test('CEP-1 canonical JSON vector remains stable', () => {
  const vector = readVector('cep1-canonical-json.json');

  assert.equal(
    canonicalJson(vector.input),
    vector.expectedCanonicalJson
  );

  assert.equal(
    canonicalHash(vector.input),
    vector.expectedCanonicalHash
  );
});

test('CEP-2 status hash vector remains stable', () => {
  const vector = readVector('cep2-status-hash.json');

  assert.equal(
    canonicalJson(vector.input),
    vector.expectedCanonicalJson
  );

  assert.equal(
    statusHash(vector.input),
    vector.expectedStatusHash
  );
});

test('CEP-2 heartbeat payload vector remains stable', () => {
  const vector = readVector('cep2-heartbeat-hash.json');

  assert.deepEqual(
    unsignedPayloadFromHeartbeat(vector.heartbeat),
    vector.expectedUnsignedPayload
  );

  assert.equal(
    canonicalJson(vector.expectedUnsignedPayload),
    vector.expectedCanonicalPayloadJson
  );

  assert.equal(
    heartbeatPayloadHash(vector.expectedUnsignedPayload),
    vector.expectedPayloadHash
  );

  assert.equal(
    validateUnsignedHeartbeat(vector.heartbeat),
    true
  );
});
