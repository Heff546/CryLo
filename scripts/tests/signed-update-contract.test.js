'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const updater = fs.readFileSync(path.join(root, 'scripts', 'crylo.js'), 'utf8');
const verifier = fs.readFileSync(path.join(root, 'scripts', 'release', 'verify-release-manifest.js'), 'utf8');

test('macOS updates fail closed before any branch or source mutation', () => {
  const start = updater.indexOf('function update() {');
  const end = updater.indexOf('\nfunction probe(', start);
  assert.ok(start >= 0 && end > start);
  const body = updater.slice(start, end);
  const guard = body.indexOf("if (process.platform === 'darwin') {");
  const mutation = body.indexOf("const insideWorkTree = git(");
  assert.ok(guard >= 0 && guard < mutation);
  assert.match(body.slice(guard, mutation), /Refusing the legacy Git-branch update path/);
  assert.match(body.slice(guard, mutation), /fail\(/);
});

test('Linux and Windows signed update targets remain explicitly defined', () => {
  const start = updater.indexOf('function releaseTarget() {');
  const end = updater.indexOf('\nfunction expectedSignedBundleName(', start);
  assert.ok(start >= 0 && end > start);
  const body = updater.slice(start, end);
  assert.match(body, /process.platform === 'linux'/);
  assert.match(body, /process.platform === 'win32'/);
  assert.match(body, /architecture: process.arch/);
  assert.match(body, /architecture: 'x64'/);
  assert.match(body, /return null;/);
});

test('signed release verifier remains bound to exact platform and architecture', () => {
  assert.match(verifier, /expectedPlatform/);
  assert.match(verifier, /expectedArchitecture/);
  assert.match(verifier, /Ed25519/);
  assert.match(verifier, /SHA-256/);
});
