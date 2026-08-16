'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const electronDir = path.resolve(__dirname, '..');

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function sha256(file) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(file))
    .digest('hex');
}

function platformDefinition(platform) {
  if (platform === 'win') {
    return {
      host: 'win32',
      dir: 'win',
      daemon: 'CryLo-daemon.exe',
      walletRpc: 'CryLo-wallet-rpc.exe'
    };
  }

  if (platform === 'mac') {
    return {
      host: 'darwin',
      dir: 'mac',
      daemon: 'CryLo-daemon',
      walletRpc: 'CryLo-wallet-rpc'
    };
  }

  fail('Platform must be win or mac.');
}

const platform = process.argv[2];
const requestedArch = process.argv[3];

if (!['x64', 'arm64'].includes(requestedArch)) {
  fail('Architecture must be x64 or arm64.');
}

const definition = platformDefinition(platform);

if (process.platform !== definition.host) {
  fail(
    `${platform} verification must run on its native host. ` +
    `Current host: ${process.platform}; required: ${definition.host}.`
  );
}

const sourceDirectory = execFileSync(
  process.execPath,
  [
    path.join(__dirname, 'find-native-release-bin.js'),
    platform
  ],
  { encoding: 'utf8' }
).trim();

const destinationDirectory = path.join(
  electronDir,
  'bin',
  definition.dir
);

const detector = path.join(
  __dirname,
  'detect-native-binary-arch.js'
);

const manifestPath = path.join(
  destinationDirectory,
  'BINARY-MANIFEST.txt'
);

if (!fs.existsSync(manifestPath)) {
  fail(`Binary manifest is missing: ${manifestPath}`);
}

const manifest = fs.readFileSync(manifestPath, 'utf8');

if (!manifest.includes(`Platform: ${platform}`)) {
  fail('Binary manifest platform is missing or incorrect.');
}

if (!manifest.includes(`Architecture: ${requestedArch}`)) {
  fail('Binary manifest architecture is missing or incorrect.');
}

for (const name of [
  definition.daemon,
  definition.walletRpc
]) {
  const source = path.join(sourceDirectory, name);
  const destination = path.join(destinationDirectory, name);

  if (!fs.existsSync(source)) {
    fail(`Missing source binary: ${source}`);
  }

  if (!fs.existsSync(destination)) {
    fail(`Missing staged binary: ${destination}`);
  }

  const sourceArch = execFileSync(
    process.execPath,
    [detector, source],
    { encoding: 'utf8' }
  ).trim();

  const destinationArch = execFileSync(
    process.execPath,
    [detector, destination],
    { encoding: 'utf8' }
  ).trim();

  if (
    sourceArch !== requestedArch ||
    destinationArch !== requestedArch
  ) {
    fail(
      `${name} architecture mismatch: source=${sourceArch}, ` +
      `staged=${destinationArch}, expected=${requestedArch}`
    );
  }

  const sourceHash = sha256(source);
  const destinationHash = sha256(destination);

  if (sourceHash !== destinationHash) {
    fail(`Stale staged binary: ${name}`);
  }

  console.log(`OK: ${name} [${requestedArch}] ${destinationHash}`);
}

console.log(
  `${platform} binaries verified for ${requestedArch}.`
);
