'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');

function fail(message) {
  console.error(
    `ERROR: CryLo release authenticity verification failed.\n${message}`
  );
  process.exit(1);
}

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);

  if (index === -1) {
    return fallback;
  }

  const value = process.argv[index + 1];

  if (!value || value.startsWith('--')) {
    fail(`${name} requires a value.`);
  }

  return value;
}

function positiveIntegerArgument(name, fallback = null) {
  const value = argument(name, fallback);

  if (value === null) {
    return null;
  }

  if (!/^[1-9]\d*$/.test(String(value))) {
    fail(`${name} must be a positive integer.`);
  }

  const number = Number(value);

  if (!Number.isSafeInteger(number)) {
    fail(`${name} exceeds JavaScript safe integer range.`);
  }

  return number;
}

function sha256(file) {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);

  try {
    while (true) {
      const count = fs.readSync(
        descriptor,
        buffer,
        0,
        buffer.length,
        null
      );

      if (count === 0) {
        break;
      }

      hash.update(buffer.subarray(0, count));
    }
  } finally {
    fs.closeSync(descriptor);
  }

  return hash.digest('hex');
}

function validArtifactFileName(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value === path.basename(value) &&
    !value.includes('/') &&
    !value.includes('\\') &&
    value !== '.' &&
    value !== '..'
  );
}

const expectedNetwork =
  argument('--network', 'testnet');

if (!['testnet', 'mainnet'].includes(expectedNetwork)) {
  fail(`Unsupported expected network: ${expectedNetwork}`);
}

const expectedPlatform =
  argument('--platform');

if (
  expectedPlatform !== null &&
  !['linux', 'win', 'mac'].includes(expectedPlatform)
) {
  fail(`Unsupported expected platform: ${expectedPlatform}`);
}

const expectedArchitecture =
  argument('--architecture');

if (
  expectedArchitecture !== null &&
  !['arm64', 'x64'].includes(expectedArchitecture)
) {
  fail(
    `Unsupported expected architecture: ${expectedArchitecture}`
  );
}

if (
  (expectedPlatform === null) !==
  (expectedArchitecture === null)
) {
  fail(
    '--platform and --architecture must be supplied together.'
  );
}

const minimumSequence =
  positiveIntegerArgument('--minimum-sequence');

const manifestPath = path.resolve(
  argument(
    '--manifest',
    path.join(
      root,
      'electron',
      'dist',
      'crylo-release-manifest.json'
    )
  )
);

const signaturePath = path.resolve(
  argument(
    '--signature',
    `${manifestPath}.sig`
  )
);

const publicKeyPath = path.resolve(
  argument(
    '--public-key',
    path.join(
      root,
      'scripts',
      'release',
      'keys',
      `crylo-${expectedNetwork}-release-ed25519-public.pem`
    )
  )
);

for (const required of [
  manifestPath,
  signaturePath,
  publicKeyPath
]) {
  if (!fs.existsSync(required)) {
    fail(`Required verification file is missing: ${required}`);
  }
}

const manifestBytes =
  fs.readFileSync(manifestPath);

const publicKey = crypto.createPublicKey(
  fs.readFileSync(publicKeyPath)
);

if (publicKey.asymmetricKeyType !== 'ed25519') {
  fail(
    `Trusted public key is ` +
    `${publicKey.asymmetricKeyType || 'unknown'}, not Ed25519.`
  );
}

const signatureText =
  fs.readFileSync(signaturePath, 'utf8').trim();

if (
  !/^[A-Za-z0-9+/]+={0,2}$/.test(signatureText)
) {
  fail('Detached signature is not valid base64.');
}

let signature;

try {
  signature = Buffer.from(
    signatureText,
    'base64'
  );
} catch (error) {
  fail(`Detached signature could not be decoded: ${error.message}`);
}

if (signature.length !== 64) {
  fail(
    `Detached Ed25519 signature has invalid length: ` +
    `${signature.length}.`
  );
}

if (
  !crypto.verify(
    null,
    manifestBytes,
    publicKey,
    signature
  )
) {
  fail('Detached Ed25519 manifest signature is invalid.');
}

let manifest;

try {
  manifest = JSON.parse(
    manifestBytes.toString('utf8')
  );
} catch (error) {
  fail(`Manifest JSON is invalid: ${error.message}`);
}

if (manifest.schema !== 1) {
  fail(`Unsupported manifest schema: ${manifest.schema}`);
}

if (manifest.product !== 'CryLo') {
  fail(`Unexpected manifest product: ${manifest.product}`);
}

if (manifest.network !== expectedNetwork) {
  fail(
    `Manifest network is ${manifest.network}; ` +
    `expected ${expectedNetwork}.`
  );
}

if (
  typeof manifest.version !== 'string' ||
  manifest.version.length === 0
) {
  fail('Manifest version is invalid.');
}

if (
  typeof manifest.releaseTag !== 'string' ||
  !/^v[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(
    manifest.releaseTag
  )
) {
  fail('Manifest releaseTag is invalid.');
}

if (
  typeof manifest.gitCommit !== 'string' ||
  !/^[0-9a-f]{40}$/i.test(manifest.gitCommit)
) {
  fail('Manifest Git commit is invalid.');
}

if (manifest.signatureAlgorithm !== 'Ed25519') {
  fail(
    `Unsupported signature algorithm: ` +
    `${manifest.signatureAlgorithm}`
  );
}

if (manifest.hashAlgorithm !== 'SHA-256') {
  fail(
    `Unsupported hash algorithm: ` +
    `${manifest.hashAlgorithm}`
  );
}

if (
  !Number.isSafeInteger(manifest.releaseSequence) ||
  manifest.releaseSequence < 1
) {
  fail('Manifest releaseSequence is invalid.');
}

const expectedReleaseTag =
  expectedNetwork === 'testnet'
    ? `v${manifest.version}-testnet.${manifest.releaseSequence}`
    : `v${manifest.version}`;

if (manifest.releaseTag !== expectedReleaseTag) {
  fail(
    `Manifest releaseTag does not match its signed identity.\n` +
    `Expected: ${expectedReleaseTag}\n` +
    `Actual:   ${manifest.releaseTag}`
  );
}

if (
  minimumSequence !== null &&
  manifest.releaseSequence < minimumSequence
) {
  fail(
    `Release sequence ${manifest.releaseSequence} is older than ` +
    `minimum accepted sequence ${minimumSequence}.`
  );
}

const created = Date.parse(manifest.createdUtc);

if (!Number.isFinite(created)) {
  fail('Manifest creation timestamp is invalid.');
}

const now = Date.now();
const maximumClockSkew = 5 * 60 * 1000;

if (created > now + maximumClockSkew) {
  fail(
    `Manifest creation time is unexpectedly in the future: ` +
    `${manifest.createdUtc}.`
  );
}

if (
  !Array.isArray(manifest.artifacts) ||
  manifest.artifacts.length === 0
) {
  fail('Manifest contains no release artifacts.');
}

const seenArtifactKeys = new Set();
const seenArtifactFileNames = new Set();

for (const artifact of manifest.artifacts) {
  if (
    !artifact ||
    !['linux', 'win', 'mac'].includes(artifact.platform) ||
    !['arm64', 'x64'].includes(artifact.architecture) ||
    !validArtifactFileName(artifact.file) ||
    typeof artifact.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/i.test(artifact.sha256) ||
    !Number.isSafeInteger(artifact.size) ||
    artifact.size < 0
  ) {
    fail('Manifest contains an invalid artifact entry.');
  }

  const key = [
    artifact.platform,
    artifact.architecture,
    artifact.file
  ].join('\0');

  if (seenArtifactKeys.has(key)) {
    fail(
      `Manifest contains a duplicate artifact entry: ${artifact.file}`
    );
  }

  if (seenArtifactFileNames.has(artifact.file)) {
    fail(
      `Manifest contains a duplicate artifact filename: ${artifact.file}`
    );
  }

  seenArtifactKeys.add(key);
  seenArtifactFileNames.add(
    artifact.file
  );
}

let selectedArtifacts = manifest.artifacts;

if (
  expectedPlatform !== null &&
  expectedArchitecture !== null
) {
  selectedArtifacts = manifest.artifacts.filter(
    (artifact) =>
      artifact.platform === expectedPlatform &&
      artifact.architecture === expectedArchitecture
  );

  if (selectedArtifacts.length !== 1) {
    fail(
      `Expected exactly one ${expectedPlatform}/${expectedArchitecture} ` +
      `artifact, found ${selectedArtifacts.length}.`
    );
  }
}

const artifactDirectory =
  path.resolve(path.dirname(manifestPath));

for (const artifact of selectedArtifacts) {
  const artifactPath =
    path.resolve(artifactDirectory, artifact.file);

  if (path.dirname(artifactPath) !== artifactDirectory) {
    fail(
      `Artifact path escapes release directory: ${artifact.file}`
    );
  }

  if (!fs.existsSync(artifactPath)) {
    fail(
      `Release artifact is missing: ${artifact.file}`
    );
  }

  const stat = fs.statSync(artifactPath);

  if (!stat.isFile()) {
    fail(
      `Release artifact is not a regular file: ${artifact.file}`
    );
  }

  if (stat.size !== artifact.size) {
    fail(
      `Release artifact size mismatch: ${artifact.file}\n` +
      `Expected: ${artifact.size}\n` +
      `Actual:   ${stat.size}`
    );
  }

  const actualHash = sha256(artifactPath);

  if (
    actualHash.toLowerCase() !==
    artifact.sha256.toLowerCase()
  ) {
    fail(
      `Release artifact SHA-256 mismatch: ${artifact.file}\n` +
      `Expected: ${artifact.sha256}\n` +
      `Actual:   ${actualHash}`
    );
  }
}

const publicKeyDer = publicKey.export({
  type: 'spki',
  format: 'der'
});

const fingerprint = crypto
  .createHash('sha256')
  .update(publicKeyDer)
  .digest('hex');

console.log('===== CRYLO RELEASE AUTHENTICITY =====');
console.log('Manifest signature..... VERIFIED');
console.log(`Release key SHA256..... ${fingerprint}`);
console.log(`Network................ ${manifest.network}`);
console.log(`Version................ ${manifest.version}`);
console.log(`Release tag............ ${manifest.releaseTag}`);
console.log(`Release sequence....... ${manifest.releaseSequence}`);
console.log(`Git commit............. ${manifest.gitCommit}`);

if (
  expectedPlatform !== null &&
  expectedArchitecture !== null
) {
  console.log(
    `Target................. ` +
    `${expectedPlatform}/${expectedArchitecture}`
  );
}

console.log(`Artifacts checked...... ${selectedArtifacts.length}`);
console.log('Artifact hashes........ VERIFIED');
console.log('Artifact sizes......... VERIFIED');

if (minimumSequence !== null) {
  console.log(
    `Rollback floor......... ${minimumSequence} VERIFIED`
  );
}

console.log();
console.log('Release authenticity... VERIFIED');
