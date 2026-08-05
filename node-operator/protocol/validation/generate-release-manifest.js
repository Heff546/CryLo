'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const PROTOCOL_ROOT = path.resolve(__dirname, '..');
const SCHEMA_PATH = path.join(
  PROTOCOL_ROOT,
  'schemas',
  'release-manifest.schema.json'
);

const PRODUCT = 'CryLoNexus Operator';
const NETWORK = 'CryLoNexus Mainnet';
const CHAIN_ID = 5546;
const SERVICE_NAME = 'crylo-nexus-operator.service';

const SUPPORTED_CHANNELS = new Set([
  'stable',
  'release-candidate',
  'development'
]);

const SUPPORTED_ASSETS = {
  'linux-amd64': 'CRYLONEXUS_AMD64_FILE',
  'linux-arm64': 'CRYLONEXUS_ARM64_FILE'
};

function fail(message) {
  throw new Error(message);
}

function requireEnvironment(name) {
  const value = process.env[name];

  if (!value || !value.trim()) {
    fail(`Missing required environment variable: ${name}`);
  }

  return value.trim();
}

function optionalEnvironment(name) {
  const value = process.env[name];

  if (!value || !value.trim()) {
    return null;
  }

  return value.trim();
}

function validateVersion(name, value) {
  const pattern =
    /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;

  if (!pattern.test(value)) {
    fail(`${name} is not a supported semantic version: ${value}`);
  }

  return value;
}

function validateCommit(value) {
  if (!/^[0-9a-fA-F]{40}$/.test(value)) {
    fail(
      'CRYLONEXUS_SOURCE_COMMIT must be a full 40-character Git commit SHA'
    );
  }

  return value.toLowerCase();
}

function resolveInputFile(filename) {
  const resolved = path.resolve(filename);

  if (!fs.existsSync(resolved)) {
    fail(`Release asset does not exist: ${resolved}`);
  }

  const stat = fs.statSync(resolved);

  if (!stat.isFile()) {
    fail(`Release asset is not a regular file: ${resolved}`);
  }

  if (stat.size < 1) {
    fail(`Release asset is empty: ${resolved}`);
  }

  return {
    path: resolved,
    stat
  };
}

function calculateSha256(filename) {
  const hash = crypto.createHash('sha256');
  const contents = fs.readFileSync(filename);

  hash.update(contents);

  return hash.digest('hex');
}

function validateFilename(filename) {
  if (
    filename.includes('/') ||
    filename.includes('\\') ||
    filename === '.' ||
    filename === '..'
  ) {
    fail(`Unsafe release asset filename: ${filename}`);
  }

  return filename;
}

function createDownloadUrl({
  repository,
  tag,
  filename
}) {
  if (!repository) {
    return null;
  }

  return (
    `https://github.com/${repository}/releases/download/` +
    `${encodeURIComponent(tag)}/${encodeURIComponent(filename)}`
  );
}

function buildAsset({
  platform,
  environmentName,
  repository,
  tag
}) {
  const suppliedPath = requireEnvironment(environmentName);
  const input = resolveInputFile(suppliedPath);
  const filename = validateFilename(
    path.basename(input.path)
  );

  const expectedPrefix =
    platform === 'linux-amd64'
      ? 'crylonexus-operator-linux-amd64-'
      : 'crylonexus-operator-linux-arm64-';

  if (!filename.startsWith(expectedPrefix)) {
    fail(
      `${environmentName} must use the expected filename prefix: ` +
      expectedPrefix
    );
  }

  const asset = {
    filename,
    sha256: calculateSha256(input.path),
    sizeBytes: input.stat.size
  };

  const downloadUrl = createDownloadUrl({
    repository,
    tag,
    filename
  });

  if (downloadUrl) {
    asset.downloadUrl = downloadUrl;
  }

  const sbomEnvironment =
    platform === 'linux-amd64'
      ? 'CRYLONEXUS_AMD64_SBOM'
      : 'CRYLONEXUS_ARM64_SBOM';

  const sbomPath = optionalEnvironment(sbomEnvironment);

  if (sbomPath) {
    const sbomInput = resolveInputFile(sbomPath);
    asset.sbomFilename = validateFilename(
      path.basename(sbomInput.path)
    );
  }

  return asset;
}

function validateManifest(manifest) {
  const schema = JSON.parse(
    fs.readFileSync(SCHEMA_PATH, 'utf8')
  );

  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    allowUnionTypes: true
  });

  addFormats(ajv);

  const validate = ajv.compile(schema);

  if (validate(manifest)) {
    return;
  }

  const errors = (validate.errors || []).map((error) => {
    const location = error.instancePath || '$';
    return `${location} ${error.message}`;
  });

  fail(
    'Generated release manifest failed schema validation:\n' +
    errors.map((error) => `- ${error}`).join('\n')
  );
}

function writeManifest(outputPath, manifest) {
  const resolvedOutput = path.resolve(outputPath);
  const outputDirectory = path.dirname(resolvedOutput);

  fs.mkdirSync(outputDirectory, {
    recursive: true
  });

  const temporaryPath =
    `${resolvedOutput}.tmp-${process.pid}`;

  fs.writeFileSync(
    temporaryPath,
    JSON.stringify(manifest, null, 2) + '\n',
    {
      encoding: 'utf8',
      mode: 0o644,
      flag: 'wx'
    }
  );

  fs.renameSync(temporaryPath, resolvedOutput);

  return resolvedOutput;
}

function main() {
  const version = validateVersion(
    'CRYLONEXUS_VERSION',
    requireEnvironment('CRYLONEXUS_VERSION')
  );

  const minimumElectronVersion = validateVersion(
    'CRYLONEXUS_MINIMUM_ELECTRON_VERSION',
    requireEnvironment(
      'CRYLONEXUS_MINIMUM_ELECTRON_VERSION'
    )
  );

  const channel = requireEnvironment(
    'CRYLONEXUS_RELEASE_CHANNEL'
  );

  if (!SUPPORTED_CHANNELS.has(channel)) {
    fail(`Unsupported release channel: ${channel}`);
  }

  const sourceCommit = validateCommit(
    requireEnvironment('CRYLONEXUS_SOURCE_COMMIT')
  );

  const releasedAt = requireEnvironment(
    'CRYLONEXUS_RELEASED_AT'
  );

  if (!Number.isFinite(Date.parse(releasedAt))) {
    fail(
      'CRYLONEXUS_RELEASED_AT must be a valid ISO-8601 timestamp'
    );
  }

  const repository = optionalEnvironment(
    'CRYLONEXUS_RELEASE_REPOSITORY'
  );

  if (
    repository &&
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)
  ) {
    fail(
      'CRYLONEXUS_RELEASE_REPOSITORY must use owner/repository format'
    );
  }

  const tag =
    optionalEnvironment('CRYLONEXUS_RELEASE_TAG') ||
    `v${version}`;

  const releaseNotesUrl = repository
    ? `https://github.com/${repository}/releases/tag/` +
      encodeURIComponent(tag)
    : null;

  const manifest = {
    schemaVersion: 1,
    product: PRODUCT,
    version,
    channel,
    network: NETWORK,
    chainId: CHAIN_ID,
    protocolVersion: 1,
    configSchemaVersion: 1,
    statusSchemaVersion: 1,
    serviceName: SERVICE_NAME,
    minimumElectronVersion,
    releasedAt,
    sourceCommit,
    assets: {}
  };

  if (releaseNotesUrl) {
    manifest.releaseNotesUrl = releaseNotesUrl;
  }

  for (
    const [platform, environmentName] of
    Object.entries(SUPPORTED_ASSETS)
  ) {
    manifest.assets[platform] = buildAsset({
      platform,
      environmentName,
      repository,
      tag
    });
  }

  validateManifest(manifest);

  const outputPath =
    optionalEnvironment('CRYLONEXUS_MANIFEST_OUTPUT') ||
    path.join(
      process.cwd(),
      'release-manifest.json'
    );

  const writtenPath = writeManifest(
    outputPath,
    manifest
  );

  console.log(`Release manifest written: ${writtenPath}`);
  console.log(`Version: ${manifest.version}`);
  console.log(`Channel: ${manifest.channel}`);
  console.log(`Source commit: ${manifest.sourceCommit}`);

  for (
    const [platform, asset] of
    Object.entries(manifest.assets)
  ) {
    console.log(
      `${platform}: ${asset.filename} ` +
      `${asset.sizeBytes} bytes ${asset.sha256}`
    );
  }
}

try {
  main();
} catch (error) {
  console.error('Release manifest generation failed.');
  console.error(error.message || error);
  process.exit(1);
}
