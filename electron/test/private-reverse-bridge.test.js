'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const renderer = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
const abi = JSON.parse(fs.readFileSync(
  path.join(__dirname, '../src/abis/BridgeManager.private-v3.json'), 'utf8'
));

function burnHandler() {
  const start = main.indexOf("secureIpcHandle('nexus-burn-for-crylo'");
  const end = main.indexOf("secureIpcHandle('bridge-request'", start);
  assert.ok(start >= 0 && end > start, 'Expected isolated Electron private burn handler');
  return main.slice(start, end);
}

test('new reverse bridge must refuse old deployed contract before touching user funds', () => {
  const src = burnHandler();
  assert.match(src, /runtime\.bridgePrivacyVersion !== 'private-v3'/);
  assert.match(src, /getNexusRuntimeConfig\(true\)/);
  assert.match(src, /No wCryLo was burned/);
  assert.match(main, /bridgePrivacyVersion: String\(data\.bridgePrivacyVersion \|\| ''\)/);
  assert.match(main, /Number\(network\.chainId\) !== chainId/);
});

test('private native destination is never passed to EVM burn function', () => {
  const src = burnHandler();
  assert.match(src, /ethers\.hexlify\(ethers\.randomBytes\(32\)\)/);
  assert.match(src, /ethers\.keccak256\(ethers\.toUtf8Bytes\(cryloAddress\)\)/);
  assert.match(src, /'CryLoPrivateRelease:v1'/);
  assert.match(src, /wallet\.signMessage\(ethers\.getBytes\(destinationCommitment\)\)/);
  assert.match(src, /nexusApiUrl\('\/bridge\/outbound-intent'\)/);
  assert.match(src, /registered\.destinationCommitment/);
  assert.match(src, /bridge\.burnForCryLo\(\s*burnId,\s*destinationCommitment,\s*amount/);
  assert.doesNotMatch(src, /bridge\.burnForCryLo\(\s*burnId,\s*cryloAddress/);
  const exposed = src.slice(src.indexOf('const tx = await bridge.burnForCryLo('),
    src.indexOf('const receipt = await tx.wait();'));
  assert.ok(!exposed.includes('cryloAddress'), 'Native recipient leaked into on-chain call');
});

test('old plaintext ABI cannot be used for the new reverse bridge', () => {
  assert.deepEqual(
    abi.abi.find(x=>x.type==='function' && x.name==='burnForCryLo').inputs.map(x=>x.type),
    ['bytes32','bytes32','uint256']
  );
  const event = abi.abi.find(x=>x.type==='event' && x.name==='BurnedForCryLo');
  assert.deepEqual(event.inputs.map(x=>x.type),['bytes32','address','bytes32','uint256']);
  assert.equal(JSON.stringify(abi).includes('cryloAddress'),false);
  assert.match(main, /require\('\.\/src\/abis\/BridgeManager\.private-v3\.json'\)/);
  assert.match(renderer, /nexusBurnForCryLo\(amountText, State\.walletName, State\.address\)/);
});

test('signed offchain registration must succeed before irreversible onchain burn', () => {
  const src = burnHandler();
  const register = src.indexOf("nexusApiUrl('/bridge/outbound-intent')");
  const signature = src.indexOf('wallet.signMessage');
  const accepted = src.indexOf("if (!response.ok || !registered?.ok");
  const burn = src.indexOf('bridge.burnForCryLo(');
  assert.ok(signature>=0 && signature < register && register < accepted && accepted < burn);
  assert.match(src, /redirect: 'error'/);
  assert.match(main, /endpoint\.protocol !== 'https:'/);
  assert.match(main, /bridge-release-status/);
});
