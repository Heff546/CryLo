'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { saveBridgeStatusCapability, getBridgeStatusCapability } =
  require('../security/bridge-status-store');
const { nexusApiUrl, verifyNexusRpcUrl } =
  require('../security/nexus-endpoint-policy');

const paymentId = 'abcdef1234567890';
const secret = 'a'.repeat(64);

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crylo-bridge-status-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('private status capability persists across calls with owner-only permissions', (t) => {
  const dir = tmp(t);
  saveBridgeStatusCapability(dir, paymentId, secret);
  assert.equal(getBridgeStatusCapability(dir, paymentId), secret);
  assert.equal(getBridgeStatusCapability(dir, '0123456789abcdef'), null);
  saveBridgeStatusCapability(dir, paymentId, secret);
  if (process.platform !== 'win32') {
    const privateDir = path.join(dir, 'bridge-private');
    assert.equal(fs.statSync(privateDir).mode & 0o077, 0);
    assert.equal(fs.statSync(path.join(privateDir, 'status-capabilities.json')).mode & 0o077, 0);
  }
});

test('private capability storage rejects invalid tokens and collisions', (t) => {
  const dir = tmp(t);
  assert.throws(() => saveBridgeStatusCapability(dir, paymentId, 'short'));
  assert.throws(() => saveBridgeStatusCapability(dir, 'bad-id', secret));
  saveBridgeStatusCapability(dir, paymentId, secret);
  assert.throws(() => saveBridgeStatusCapability(dir, paymentId, 'b'.repeat(64)));
});

test('unsafe private file symlinks and permissions fail closed', (t) => {
  if (process.platform === 'win32') {
    t.skip('Windows AppData directory ACLs are owned by the OS');
    return;
  }
  const dir = tmp(t);
  const privateDir = path.join(dir, 'bridge-private');
  fs.mkdirSync(privateDir, { mode: 0o700 });
  const target = path.join(dir, 'target');
  fs.writeFileSync(target, '{}', { mode: 0o600 });
  const file = path.join(privateDir, 'status-capabilities.json');
  fs.symlinkSync(target, file);
  assert.throws(() => getBridgeStatusCapability(dir, paymentId));
  fs.unlinkSync(file);
  fs.writeFileSync(file, '{}', { mode: 0o600 });
  fs.chmodSync(file, 0o644);
  assert.throws(() => getBridgeStatusCapability(dir, paymentId));
});

test('Nexus Testnet private bridge API accepts only HTTPS or loopback HTTP', () => {
  assert.equal(nexusApiUrl('https://bridge.example.test/crylonexus-api',
    '/bridge/status'), 'https://bridge.example.test/crylonexus-api/bridge/status');
  assert.equal(nexusApiUrl('http://127.0.0.1:8088',
    '/bridge/status'), 'http://127.0.0.1:8088/bridge/status');
  assert.throws(() => nexusApiUrl('', '/bridge/request'));
  assert.throws(() => nexusApiUrl('http://34.19.201.107/crylonexus-api', '/bridge/request'));
  assert.throws(() => nexusApiUrl('http://192.168.1.1:8088', '/bridge/status'));
  assert.throws(() => nexusApiUrl('https://user:pass@bridge.example.test', '/bridge/status'));
  assert.throws(() => nexusApiUrl('https://bridge.example.test/#leak', '/bridge/status'));
  assert.throws(() => nexusApiUrl('https://bridge.example.test/?token=abc', '/bridge/status'));
  assert.throws(() => nexusApiUrl('https://bridge.example.test', '//evil.example.test'));
  assert.throws(() => nexusApiUrl('https://bridge.example.test', '/../secrets'));
});

test('Nexus RPC endpoint blocks public plaintext transports and embedded credentials', () => {
  assert.equal(verifyNexusRpcUrl('https://rpc.example.test/ext/bc/id/rpc'),
    'https://rpc.example.test/ext/bc/id/rpc');
  assert.equal(verifyNexusRpcUrl('http://localhost:9654/ext/bc/id/rpc'),
    'http://localhost:9654/ext/bc/id/rpc');
  assert.throws(() => verifyNexusRpcUrl('http://10.0.0.8:9654/ext/bc/id/rpc'));
  assert.throws(() => verifyNexusRpcUrl('https://user:pass@rpc.example.test'));
});

test('Testnet wallet does not return private status tokens to renderer', () => {
  const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
  assert.match(main, /saveBridgeStatusCapability\(getUserDataPath\(\), data.paymentId, data.statusToken\)/);
  assert.match(main, /const \{ statusToken: _privateStatusToken, \.\.\.safeData \} = data/);
  assert.match(main, /'X-Bridge-Status-Token': token/);
  assert.match(main, /nexusApiUrl\('\/bridge\/status'\)/);
  assert.match(main, /method: 'POST',[\s\S]*'X-Bridge-Status-Token'/);
  assert.match(main, /redirect: 'error'/);
  assert.doesNotMatch(main, /\`\$\{BRIDGE_API_URL\}\/bridge\/status\//);
  assert.doesNotMatch(main, /http:\/\/34\.19\.201\.107/);
  assert.match(renderer, /res.status === 'minted'/);
  assert.doesNotMatch(renderer, /if \(res.processed\)/);
});
