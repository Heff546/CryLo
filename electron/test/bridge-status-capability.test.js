'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { saveBridgeStatusCapability, getBridgeStatusCapability } =
  require('../security/bridge-status-store');

const id = 'abcdef1234567890';
const token = 'a'.repeat(64);

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crylo-bridge-cap-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('private bridge status capability survives process-like reload', (t) => {
  const data = fixture(t);
  saveBridgeStatusCapability(data, id, token);
  assert.equal(getBridgeStatusCapability(data, id), token);
  assert.equal(getBridgeStatusCapability(data, '1234567890abcdef'), null);
  saveBridgeStatusCapability(data, id, token);
  assert.equal(getBridgeStatusCapability(data, id), token);

  if (process.platform !== 'win32') {
    const parent = path.join(data, 'bridge-private');
    const file = path.join(parent, 'status-capabilities.json');
    assert.equal(fs.statSync(parent).mode & 0o077, 0);
    assert.equal(fs.statSync(file).mode & 0o077, 0);
  }
});

test('invalid or conflicting capabilities are rejected', (t) => {
  const data = fixture(t);
  assert.throws(() => saveBridgeStatusCapability(data, id, 'short'));
  assert.throws(() => saveBridgeStatusCapability(data, 'not-hex', token));
  saveBridgeStatusCapability(data, id, token);
  assert.throws(() => saveBridgeStatusCapability(data, id, 'b'.repeat(64)));
  assert.equal(getBridgeStatusCapability(data, id), token);
});

test('symlink and over-permissive capability storage fail closed', (t) => {
  if (process.platform === 'win32') {
    t.skip('Windows capability storage uses per-user AppData ACLs');
    return;
  }
  const data = fixture(t);
  const privateDir = path.join(data, 'bridge-private');
  fs.mkdirSync(privateDir, { mode: 0o700 });
  const target = path.join(data, 'target');
  fs.writeFileSync(target, '{}', { mode: 0o600 });
  const vault = path.join(privateDir, 'status-capabilities.json');
  fs.symlinkSync(target, vault);
  assert.throws(() => getBridgeStatusCapability(data, id));
  fs.unlinkSync(vault);
  fs.writeFileSync(vault, '{}', { mode: 0o600 });
  fs.chmodSync(vault, 0o644);
  assert.throws(() => getBridgeStatusCapability(data, id));
});

test('renderer cannot receive or log the bearer token via bridge IPC', () => {
  const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
  assert.match(main, /saveBridgeStatusCapability\(/);
  assert.match(main, /const \{ statusToken: _privateStatusToken, \.\.\.safeData \} = data/);
  assert.match(main, /'X-Bridge-Status-Token': token/);
  assert.match(main, /method: 'POST',[\s\S]*'X-Bridge-Status-Token'/);
  assert.match(renderer, /res\.status === 'minted'/);
  assert.doesNotMatch(main, /http:\/\/34\.19\.201\.107/);
  assert.doesNotMatch(main, /\`\$\{BRIDGE_API_URL\}\/bridge\/status\//);
});

test('mainnet wallet data and mining network are isolated from testnet', () => {
  const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  assert.match(main, /CRYLO_NETWORK_MODE === 'mainnet'/);
  assert.match(main, /'wallets-mainnet'/);
  assert.match(main, /'CryLo-mainnet'/);
  assert.match(main, /l1Network !== 'mainnet'/);
  assert.match(main, /Nexus Foundation does not confirm CryLo L1 mainnet/);
  assert.match(main, /assertDaemonNetwork\(\)/);
  assert.match(main, /secureIpcHandle\('miner-start'[\s\S]*await assertDaemonNetwork\(\)/);
  assert.match(main, /https:.*loopback|endpoint\.protocol !== 'https:'|endpoint\.protocol === 'https:'/s);
});
