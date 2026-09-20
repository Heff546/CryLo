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
  const result = spawnSync(command, args, {
    cwd: electronDir,
    stdio: 'inherit',
    env: process.env,
    shell: false
  });

  if (result.error) {
    fail(result.error.message);
  }

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function detectedPlatform() {
  switch (process.platform) {
    case 'linux':
      return 'linux';
    case 'win32':
      return 'win';
    case 'darwin':
      return 'mac';
    default:
      fail(`Unsupported host platform: ${process.platform}`);
  }
}

const requestedPlatform = process.argv[2] || 'auto';
let arch = process.argv[3] || 'auto';

const platform =
  requestedPlatform === 'auto'
    ? detectedPlatform()
    : requestedPlatform;

if (!['linux', 'win', 'mac'].includes(platform)) {
  fail('Platform must be auto, linux, win, or mac.');
}

const requiredHost = {
  linux: 'linux',
  win: 'win32',
  mac: 'darwin'
}[platform];

if (process.platform !== requiredHost) {
  fail(
    `${platform} releases must be built on their native host. ` +
    `Current host: ${process.platform}; required: ${requiredHost}.`
  );
}

/*
 * Linux already has a mature release pipeline that discovers the current
 * CryLo release binaries and derives the target architecture from those
 * binaries. Keep that logic authoritative rather than duplicating it here.
 */
if (platform === 'linux') {
  console.log(
    'Detected Linux host. Delegating to the Linux auto-release pipeline...'
  );

  run('bash', [
    path.join(electronDir, 'scripts', 'release-linux.sh'),
    arch
  ]);

  process.exit(0);
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

const npmCommand = process.platform === 'win32' ? null : 'npm';
const npmCli = process.platform === 'win32' ? process.env.npm_execpath : null;

if (process.platform === 'win32' && (!npmCli || !fs.existsSync(npmCli))) {
  fail(
    'Pinned npm CLI path is unavailable. Run this release through an npm script.'
  );
}

function runNpm(args) {
  if (process.platform === 'win32') {
    run(process.execPath, [npmCli, ...args]);
    return;
  }

  run(npmCommand, args);
}

console.log('Restoring pinned Electron release dependencies...');
runNpm(['ci']);

runNpm([
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

let builderCommand;
let builderRunArgs;

if (process.platform === 'win32') {
  const electronBuilderPackage = require.resolve(
    'electron-builder/package.json',
    { paths: [electronDir] }
  );
  const electronBuilderMetadata = JSON.parse(
    fs.readFileSync(electronBuilderPackage, 'utf8')
  );
  const electronBuilderBin =
    typeof electronBuilderMetadata.bin === 'string'
      ? electronBuilderMetadata.bin
      : electronBuilderMetadata.bin &&
        electronBuilderMetadata.bin['electron-builder'];

  if (!electronBuilderBin) {
    fail('Pinned electron-builder package does not expose its CLI entry point.');
  }

  builderCommand = process.execPath;
  builderRunArgs = [
    path.resolve(path.dirname(electronBuilderPackage), electronBuilderBin),
    ...builderArgs.slice(1)
  ];
} else {
  builderCommand = path.join(
    electronDir,
    'node_modules',
    '.bin',
    'electron-builder'
  );
  builderRunArgs = builderArgs.slice(1);
}

if (!fs.existsSync(builderCommand)) {
  fail(`Pinned electron-builder CLI is missing: ${builderCommand}`);
}

if (process.platform === 'win32' && !fs.existsSync(builderRunArgs[0])) {
  fail(`Pinned electron-builder CLI is missing: ${builderRunArgs[0]}`);
}

console.log(`Building CryLo Wallet for ${platform}/${arch}...`);
run(builderCommand, builderRunArgs);

console.log(`Completed ${platform}/${arch} Electron release.`);
