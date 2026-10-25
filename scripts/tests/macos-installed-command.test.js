'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const test=require('node:test');
const root=path.resolve(__dirname,'../..');
const command=path.join(root,'scripts/release/macos-installed-command.sh');
const client=path.join(root,'scripts/release/macos-installed-update.js');
const builder=path.join(root,'electron/scripts/build-mac-installer.js');
const config=JSON.parse(fs.readFileSync(path.join(root,'electron/package.json'),'utf8'));
const source=fs.readFileSync(command,'utf8');

test('installed command exposes crylo update without a checkout or network',()=>{
  const help=cp.spawnSync('/bin/sh',[command,'help'],{encoding:'utf8'});
  assert.equal(help.status,0,help.stderr);
  assert.match(help.stdout,/crylo update/);
  const noargs=cp.spawnSync('/bin/sh',[command],{encoding:'utf8'});
  assert.equal(noargs.status,0,noargs.stderr);
  assert.match(noargs.stdout,/crylo update/);
  const invalid=cp.spawnSync('/bin/sh',[command,'unknown'],{encoding:'utf8'});
  assert.equal(invalid.status,2);
  assert.doesNotMatch(source,/sudo|xattr|spctl|installer -pkg/);
});
test('installed command pins exact native Node 24.21.0 for both architectures',()=>{
  const checkout=fs.readFileSync(path.join(root,'crylo'),'utf8');
  for(const hash of [
    '1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097',
    'bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057'
  ]){
    assert.ok(source.includes(hash),'installed CLI missing trusted Node SHA');
    assert.ok(checkout.includes(hash),'installed CLI drifted from checkout SHA');
  }
  assert.match(source,/shasum -a 256 -c -/);
  assert.match(source,/unset NODE_OPTIONS NODE_PATH NODE_EXTRA_CA_CERTS/);
  assert.match(source,/exec "\$NODE" "\$CLIENT"/);
});
test('Mac PKG and Electron Resources contain installed CLI and trusted client',()=>{
  const installer=fs.readFileSync(builder,'utf8');
  assert.match(installer,/macos-installed-command\.sh/);
  assert.match(installer,/usr', 'local', 'bin', 'crylo/);
  const resourceNames=config.build.mac.extraResources.map(item=>item.to);
  for(const name of ['macos-update-client.js','macos-installed-update.js',
    'macos-package-trust.js','macos-unsigned-update-stage.js',
    'crylo-testnet-release-ed25519-public.pem']){
    assert.ok(resourceNames.includes('macos-update/'+name),name);
  }
  const nodeScript=fs.readFileSync(client,'utf8');
  assert.match(nodeScript,/discoverVerifiedMacRelease/);
  assert.match(nodeScript,/downloadAndStageMacUpdate/);
  assert.match(nodeScript,/spawnSync\('\/usr\/bin\/open'/);
  assert.doesNotMatch(nodeScript,/sudo|xattr|spctl|installer -pkg/);
});
