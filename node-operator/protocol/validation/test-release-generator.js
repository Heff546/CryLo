'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  spawnSync
} = require('child_process');

const PROTOCOL_ROOT = path.resolve(__dirname, '..');
const GENERATOR = path.join(
  __dirname,
  'generate-release-manifest.js'
);

function sha256(filename) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filename))
    .digest('hex');
}

function runGenerator(environment) {
  return spawnSync(
    process.execPath,
    [GENERATOR],
    {
      cwd: PROTOCOL_ROOT,
      env: {
        ...process.env,
        ...environment
      },
      encoding: 'utf8'
    }
  );
}

function createFixtureFiles(directory) {
  const amd64 = path.join(
    directory,
    'crylonexus-operator-linux-amd64-v2.0.0.tar.gz'
  );

  const arm64 = path.join(
    directory,
    'crylonexus-operator-linux-arm64-v2.0.0.tar.gz'
  );

  const amd64Sbom = path.join(
    directory,
    'sbom-amd64.spdx.json'
  );

  const arm64Sbom = path.join(
    directory,
    'sbom-arm64.spdx.json'
  );

  fs.writeFileSync(
    amd64,
    'CryLoNexus operator amd64 fixture\n'
  );

  fs.writeFileSync(
    arm64,
    'CryLoNexus operator arm64 fixture\n'
  );

  fs.writeFileSync(
    amd64Sbom,
    '{"fixture":"amd64"}\n'
  );

  fs.writeFileSync(
    arm64Sbom,
    '{"fixture":"arm64"}\n'
  );

  return {
    amd64,
    arm64,
    amd64Sbom,
    arm64Sbom
  };
}

function baseEnvironment(files, output) {
  return {
    CRYLONEXUS_VERSION: '2.0.0',
    CRYLONEXUS_MINIMUM_ELECTRON_VERSION: '2.0.0',
    CRYLONEXUS_RELEASE_CHANNEL: 'stable',
    CRYLONEXUS_SOURCE_COMMIT:
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    CRYLONEXUS_RELEASED_AT:
      '2026-07-01T12:00:00Z',
    CRYLONEXUS_RELEASE_REPOSITORY:
      'Heff546/CryLo',
    CRYLONEXUS_RELEASE_TAG: 'v2.0.0',
    CRYLONEXUS_AMD64_FILE: files.amd64,
    CRYLONEXUS_ARM64_FILE: files.arm64,
    CRYLONEXUS_AMD64_SBOM: files.amd64Sbom,
    CRYLONEXUS_ARM64_SBOM: files.arm64Sbom,
    CRYLONEXUS_MANIFEST_OUTPUT: output
  };
}

function testValidGeneration(directory, files) {
  const output = path.join(
    directory,
    'release-manifest.json'
  );

  const result = runGenerator(
    baseEnvironment(files, output)
  );

  assert.strictEqual(
    result.status,
    0,
    result.stderr || result.stdout
  );

  assert.ok(
    fs.existsSync(output),
    'Generator did not create the manifest'
  );

  const manifest = JSON.parse(
    fs.readFileSync(output, 'utf8')
  );

  assert.strictEqual(manifest.chainId, 5546);
  assert.strictEqual(
    manifest.network,
    'CryLoNexus Testnet'
  );
  assert.strictEqual(manifest.channel, 'stable');
  assert.strictEqual(manifest.version, '2.0.0');

  assert.strictEqual(
    manifest.assets['linux-amd64'].sha256,
    sha256(files.amd64)
  );

  assert.strictEqual(
    manifest.assets['linux-arm64'].sha256,
    sha256(files.arm64)
  );

  assert.strictEqual(
    manifest.assets['linux-amd64'].sizeBytes,
    fs.statSync(files.amd64).size
  );

  assert.strictEqual(
    manifest.assets['linux-arm64'].sizeBytes,
    fs.statSync(files.arm64).size
  );

  assert.strictEqual(
    manifest.assets['linux-amd64'].sbomFilename,
    path.basename(files.amd64Sbom)
  );

  assert.strictEqual(
    manifest.assets['linux-arm64'].sbomFilename,
    path.basename(files.arm64Sbom)
  );

  console.log(
    'PASS generator creates a valid testnet manifest'
  );
}

function testInvalidChannel(directory, files) {
  const output = path.join(
    directory,
    'invalid-channel.json'
  );

  const environment = baseEnvironment(
    files,
    output
  );

  environment.CRYLONEXUS_RELEASE_CHANNEL = 'beta';

  const result = runGenerator(environment);

  assert.notStrictEqual(result.status, 0);

  assert.match(
    result.stderr,
    /Unsupported release channel/
  );

  assert.ok(
    !fs.existsSync(output),
    'Invalid channel unexpectedly produced a manifest'
  );

  console.log(
    'PASS generator rejects unsupported release channels'
  );
}

function testMissingAsset(directory, files) {
  const output = path.join(
    directory,
    'missing-asset.json'
  );

  const environment = baseEnvironment(
    files,
    output
  );

  environment.CRYLONEXUS_ARM64_FILE = path.join(
    directory,
    'missing-arm64.tar.gz'
  );

  const result = runGenerator(environment);

  assert.notStrictEqual(result.status, 0);

  assert.match(
    result.stderr,
    /Release asset does not exist/
  );

  assert.ok(
    !fs.existsSync(output),
    'Missing asset unexpectedly produced a manifest'
  );

  console.log(
    'PASS generator rejects missing release assets'
  );
}

function testUnsafeFilename(directory, files) {
  const unsafeAmd64 = path.join(
    directory,
    'operator-amd64.tar.gz'
  );

  fs.writeFileSync(
    unsafeAmd64,
    'incorrectly named package\n'
  );

  const output = path.join(
    directory,
    'bad-filename.json'
  );

  const environment = baseEnvironment(
    files,
    output
  );

  environment.CRYLONEXUS_AMD64_FILE =
    unsafeAmd64;

  const result = runGenerator(environment);

  assert.notStrictEqual(result.status, 0);

  assert.match(
    result.stderr,
    /expected filename prefix/
  );

  assert.ok(
    !fs.existsSync(output),
    'Bad filename unexpectedly produced a manifest'
  );

  console.log(
    'PASS generator rejects incorrectly named assets'
  );
}

function main() {
  const directory = fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      'crylonexus-release-generator-'
    )
  );

  try {
    const files = createFixtureFiles(directory);

    testValidGeneration(directory, files);
    testInvalidChannel(directory, files);
    testMissingAsset(directory, files);
    testUnsafeFilename(directory, files);

    console.log(
      'All release-manifest generator tests passed.'
    );
  } finally {
    fs.rmSync(directory, {
      recursive: true,
      force: true
    });
  }
}

try {
  main();
} catch (error) {
  console.error(
    'Release-manifest generator tests failed.'
  );
  console.error(error);
  process.exit(1);
}
