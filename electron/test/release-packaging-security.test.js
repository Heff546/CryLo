'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const electronRoot = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(electronRoot, 'package.json'), 'utf8'));
const main = fs.readFileSync(path.join(electronRoot, 'main.js'), 'utf8');
const afterPack = fs.readFileSync(path.join(electronRoot, 'scripts', 'after-pack.js'), 'utf8');
const lock = JSON.parse(fs.readFileSync(path.join(electronRoot, 'package-lock.json'), 'utf8'));

test('the trusted IPC policy ships inside the application for every OS', () => {
  assert.ok(config.build && Array.isArray(config.build.files));
  assert.ok(config.build.files.includes('main.js'));
  assert.ok(config.build.files.includes('preload.js'));
  assert.ok(config.build.files.includes('security/**/*'));
  assert.match(main, /require\('\.\/security\/renderer-policy'\)/);
  assert.ok(fs.existsSync(path.join(electronRoot, 'security', 'renderer-policy.js')));
  assert.equal(config.build.mac.target[0], 'dir');
  assert.ok(config.build.linux);
  assert.ok(config.build.win);
});

test('release packaging continues to verify exact bundled native executables', () => {
  assert.match(afterPack, /stagedHash !== packagedHash/);
  assert.match(afterPack, /WINDOWS_BUILD_RUNTIME_MANIFEST/);
  assert.match(afterPack, /platformDefinition\(context\.electronPlatformName\)/);
});

test('the wallet preserves isolated preload and denies renderer Node privileges', () => {
  assert.match(main, /preload: path\.join\(__dirname, 'preload\.js'\)/);
  assert.match(main, /contextIsolation: true/);
  assert.match(main, /nodeIntegration: false/);
  assert.match(main, /sandbox: true/);
  assert.doesNotMatch(main, /sandbox: false/);
});

test('patched Electron runtime and authorized postinstall match the authenticated npm lock', () => {
  const expected = '44.9.3';
  assert.equal(config.devDependencies.electron, expected);
  assert.equal(lock.packages[''].devDependencies.electron, expected);
  const pinned = lock.packages['node_modules/electron'];
  assert.equal(pinned.version, expected);
  assert.equal(pinned.resolved, 'https://registry.npmjs.org/electron/-/electron-44.9.3.tgz');
  assert.equal(pinned.integrity, 'sha512-Cv9/yMnZxNWsMlIe8T4v//NKHdUvbeyoTJoXE3BIcRxus2meeFaO9h/P3zB5d4cBXum51IgAYrT2QjpIDWKpJA==');
  assert.equal(config.allowScripts['electron@44.9.3'], true);
  assert.equal(config.allowScripts['electron@44.7.1'], undefined);
});
