'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const updater = fs.readFileSync(path.join(root, 'scripts', 'crylo.js'), 'utf8');
const verifier = fs.readFileSync(path.join(root, 'scripts', 'release', 'verify-release-manifest.js'), 'utf8');
const macStage = fs.readFileSync(path.join(root, 'scripts', 'release', 'macos-unsigned-update-stage.js'), 'utf8');

test('macOS update exits after authenticated staging before source-update path', () => {
  const start = updater.indexOf('function update() {');
  const end = updater.indexOf('\nfunction probe(', start);
  assert.ok(start >= 0 && end > start);
  const body = updater.slice(start, end);
  const guard = body.indexOf("if (process.platform === 'darwin') {");
  const sourceUpdate = body.indexOf('const insideWorkTree = git(');
  assert.ok(guard >= 0 && guard < sourceUpdate);
  assert.match(body.slice(guard, sourceUpdate),
    /prepareAuthorizedMacUpdate\(\);\s*return;/);
});

test('macOS updater requires signed-release discovery before protected staging',()=>{
  const start=updater.indexOf('function prepareAuthorizedMacUpdate() {');
  const end=updater.indexOf('\nfunction update() {',start);
  assert.ok(start>0 && end>start);
  const source=updater.slice(start,end);
  const auth=source.indexOf('authenticateSignedRelease(before)');
  const download=source.indexOf('downloadAuthorizedReleaseBundle(authorization)');
  const stage=source.indexOf('stageVerifiedMacPackage({');
  assert.ok(auth>0 && download>auth && stage>download);
  assert.match(source,/minimumSequence/);
  assert.match(source,/publicKeyPath/);
  assert.match(source,/process\.arch/);
  assert.match(source,/finally\s*\{\s*fs\.rmSync\(download\.temporaryRoot/);
  assert.doesNotMatch(source,/git\(\[\s*'merge'/);
  assert.doesNotMatch(source,/writeReleaseSecurityState\(/);
  assert.doesNotMatch(source,/spawnSync\(['"]\/usr\/sbin\/installer/);
  assert.match(macStage,/releaseSecurityStateAdvanced: false/);
  assert.match(macStage,/installation: 'user-approval-required'/);
});

test('Linux, Windows and Mac signed update targets are explicitly architecture-bound', () => {
  const start = updater.indexOf('function releaseTarget() {');
  const end = updater.indexOf('\nfunction expectedSignedBundleName(', start);
  assert.ok(start >= 0 && end > start);
  const source = updater.slice(start, end);
  assert.match(source, /process.platform === 'linux'/);
  assert.match(source, /process.platform === 'win32'/);
  assert.match(source, /process.platform === 'darwin'/);
  assert.match(source, /architecture: process.arch/);
  assert.match(source, /architecture: 'x64'/);
  assert.match(source, /platform: 'mac'/);
  assert.match(source, /return null;/);
});

test('launch macOS unsigned PKG name stays bound to version and CPU architecture',()=>{
  const start=updater.indexOf('function expectedSignedBundleName(');
  const end=updater.indexOf('\nfunction fetchAuthenticatedReleaseSource(',start);
  assert.ok(start>0 && end>start);
  const source=updater.slice(start,end);
  assert.match(source,/target.platform === 'mac'/);
  assert.match(source,/mac-\$\{target\.architecture\}-unsigned\.pkg/);
});

test('signed release verifier remains bound to exact platform and architecture', () => {
  assert.match(verifier, /expectedPlatform/);
  assert.match(verifier, /expectedArchitecture/);
  assert.match(verifier, /Ed25519/);
  assert.match(verifier, /SHA-256/);
});
