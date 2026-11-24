'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  TESTNET_CHAIN_ID,
  validateBundledNexusConfig,
  resolveNexusFoundationOrigin,
  expectedNexusChainId
} = require('../security/nexus-foundation-bootstrap');

const shipped = require('../security/nexus-foundation-endpoints.json');
function configured(origin) {
  return { schema: 1, network: 'testnet',
    chainId: TESTNET_CHAIN_ID, foundationApiOrigin: origin };
}

test('release embeds explicit testnet identity but no invented HTTPS Foundation endpoint', () => {
  assert.deepEqual(shipped, configured(null));
  assert.equal(expectedNexusChainId(shipped), 5546);
  assert.throws(
    () => resolveNexusFoundationOrigin(shipped, {}),
    /not yet enabled.*crylo update/i
  );
});

test('ordinary user resolves an official HTTPS origin directly from the packaged release', () => {
  const signed = configured('https://foundation.example.test/crylonexus-api');
  assert.equal(
    resolveNexusFoundationOrigin(signed, {}),
    'https://foundation.example.test/crylonexus-api'
  );
  assert.equal(expectedNexusChainId(signed), 5546);
});

test('unsigned or malicious external endpoint settings never silently become production defaults', () => {
  for (const address of [
    'http://34.19.201.107/crylonexus-api',
    'http://127.0.0.1:8088',
    'http://192.168.0.2:8088',
    'https://private:secret@bridge.example.test',
    'https://bridge.example.test/?token=sensitive',
    'https://bridge.example.test/#frag',
    'javascript:alert(1)',
    '',
    123
  ]) {
    assert.throws(() => validateBundledNexusConfig(configured(address)));
  }
  for (const malformed of [
    null, {}, { ...configured(null), network: 'mainnet' },
    { ...configured(null), chainId: 546 },
    { ...configured(null), schema: 99 },
    { ...configured(null), foundationApiOrigin: undefined }
  ]) {
    assert.throws(() => validateBundledNexusConfig(malformed));
  }
});

test('explicit local operator override allows only HTTPS or local loopback HTTP', () => {
  assert.equal(
    resolveNexusFoundationOrigin(shipped, {
      CRYLONEXUS_API_URL: 'https://bridge.example.test/crylonexus-api'
    }),
    'https://bridge.example.test/crylonexus-api'
  );
  assert.equal(
    resolveNexusFoundationOrigin(shipped, {
      CRYLONEXUS_API_URL: 'http://127.0.0.1:8088'
    }),
    'http://127.0.0.1:8088'
  );
  for (const bad of [
    '', 'http://34.19.201.107', 'http://192.168.0.8',
    'https://x:y@bridge.example.test', 'https://bridge.example.test/?token=secret',
    'file:///etc/passwd'
  ]) {
    assert.throws(() => resolveNexusFoundationOrigin(shipped, {
      CRYLONEXUS_API_URL: bad
    }));
  }
});

test('main-process bridge endpoints consume signed bootstrap and reject wrong network identity', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /resolveNexusFoundationOrigin\(BUNDLED_NEXUS_CONFIG\)/);
  assert.match(main, /data\.cryloL1Network !== BUNDLED_NEXUS_CONFIG\.network/);
  assert.match(main, /chainId !== expectedNexusChainId\(BUNDLED_NEXUS_CONFIG\)/);
  assert.doesNotMatch(main, /process\.env\.CRYLONEXUS_API_URL \|\|/);
  assert.doesNotMatch(main, /http:\/\/34\.19\.201\.107/);
});
