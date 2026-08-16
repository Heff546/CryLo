'use strict';

const fs = require('fs');
const path = require('path');

const electronDir = path.resolve(__dirname, '..');
const root = path.resolve(electronDir, '..');

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function platformDefinition(platform) {
  if (platform === 'win') {
    return {
      daemon: 'CryLo-daemon.exe',
      walletRpc: 'CryLo-wallet-rpc.exe'
    };
  }

  if (platform === 'mac') {
    return {
      daemon: 'CryLo-daemon',
      walletRpc: 'CryLo-wallet-rpc'
    };
  }

  fail('Platform must be win or mac.');
}

function hasPair(directory, names) {
  return (
    fs.existsSync(path.join(directory, names.daemon)) &&
    fs.existsSync(path.join(directory, names.walletRpc))
  );
}

function collectReleaseBins(directory, names, depth, results) {
  if (depth < 0 || !fs.existsSync(directory)) return;

  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (_) {
    return;
  }

  if (path.basename(directory) === 'bin' && hasPair(directory, names)) {
    results.push(path.resolve(directory));
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    collectReleaseBins(
      path.join(directory, entry.name),
      names,
      depth - 1,
      results
    );
  }
}

const platform = process.argv[2];
const names = platformDefinition(platform);

if (process.env.CRYLO_RELEASE_BIN) {
  const configured = path.resolve(process.env.CRYLO_RELEASE_BIN);
  if (!hasPair(configured, names)) {
    fail(
      `CRYLO_RELEASE_BIN does not contain ${names.daemon} and ` +
      `${names.walletRpc}: ${configured}`
    );
  }

  process.stdout.write(`${configured}\n`);
  process.exit(0);
}

const direct = path.join(root, 'build', 'bin');
if (hasPair(direct, names)) {
  process.stdout.write(`${direct}\n`);
  process.exit(0);
}

const candidates = [];
collectReleaseBins(path.join(root, 'build'), names, 5, candidates);

const unique = [...new Set(candidates)].sort();

if (unique.length === 1) {
  process.stdout.write(`${unique[0]}\n`);
  process.exit(0);
}

if (unique.length === 0) {
  fail(
    `No ${platform} CryLo release binary pair was found. ` +
    'Set CRYLO_RELEASE_BIN to the native release bin directory.'
  );
}

console.error('ERROR: Multiple native CryLo release directories were found:');
for (const candidate of unique) {
  console.error(`  ${candidate}`);
}
console.error(
  'Set CRYLO_RELEASE_BIN explicitly so packaging cannot select a stale build.'
);
process.exit(1);
