'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const electronDir = path.resolve(__dirname, '..');

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function run(command, args) {
  const useWindowsCmdShim =
    process.platform === 'win32' &&
    command.toLowerCase().endsWith('.cmd');

  const result = spawnSync(command, args, {
    cwd: electronDir,
    stdio: 'inherit',
    env: process.env,
    shell: useWindowsCmdShim
  });

  if (result.error) {
    fail(result.error.message);
  }

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

const platform = process.argv[2];
let arch = process.argv[3] || 'auto';

if (!['win', 'mac'].includes(platform)) {
  fail('Platform must be win or mac.');
}

const requiredHost =
  platform === 'win' ? 'win32' : 'darwin';

if (process.platform !== requiredHost) {
  fail(
    `${platform} releases must be built on their native host. ` +
    `Current host: ${process.platform}; required: ${requiredHost}.`
  );
}

if (arch === 'auto') {
  arch = process.arch;
}

if (!['x64', 'arm64'].includes(arch)) {
  fail('Architecture must be auto, x64, or arm64.');
}

if (platform === 'win' && arch !== 'x64') {
  fail('Only Windows x64 is supported by the current release matrix.');
}

console.log(
  `Preparing bundled CryLoNexus Node Service runtime for ${platform}/${arch}...`
);

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';

run(npmCommand, [
  '--prefix',
  path.resolve(electronDir, '..', 'node-operator', 'runtime'),
  'ci',
  '--omit=dev',
  '--ignore-scripts'
]);

run(process.execPath, [
  path.join(electronDir, 'scripts', 'sync-native-binaries.js'),
  platform,
  arch
]);

run(process.execPath, [
  path.join(electronDir, 'scripts', 'verify-native-binaries.js'),
  platform,
  arch
]);

const dist = path.join(electronDir, 'dist');
fs.mkdirSync(dist, { recursive: true });

const builderArgs =
  platform === 'win'
    ? ['electron-builder', '--win', `--${arch}`]
    : ['electron-builder', '--mac', `--${arch}`];

console.log(`Building CryLo Wallet for ${platform}/${arch}...`);
run(npxCommand, builderArgs);

console.log(`Completed ${platform}/${arch} Electron release.`);
