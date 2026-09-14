'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..', '..');

function fail(message) {
  console.error(`ERROR: ${message}`);
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

function argumentsFor(name) {
  const values = [];

  for (let i = 2; i < process.argv.length; i += 1) {
    if (process.argv[i] !== name) {
      continue;
    }

    const value = process.argv[i + 1];

    if (!value || value.startsWith('--')) {
      fail(`${name} requires a value.`);
    }

    values.push(value);
    i += 1;
  }

  return values;
}

function git(args) {
  const result = spawnSync(
    'git',
    args,
    {
      cwd: root,
      encoding: 'utf8',
      shell: false
    }
  );

  if (result.error || result.status !== 0) {
    fail(`git ${args.join(' ')} failed.`);
  }

  return String(result.stdout || '').trim();
}

function requireReleaseTagAtHead(releaseTag) {
  const objectType = git([
    'cat-file',
    '-t',
    releaseTag
  ]);

  if (objectType !== 'tag') {
    fail(
      `Official release tag ${releaseTag} must be an annotated Git tag.`
    );
  }

  const head = git([
    'rev-parse',
    'HEAD'
  ]);

  const taggedCommit = git([
    'rev-parse',
    `${releaseTag}^{}`
  ]);

  if (taggedCommit !== head) {
    fail(
      `Release tag ${releaseTag} does not point to HEAD.\n` +
      `HEAD: ${head}\n` +
      `Tag:  ${taggedCommit}`
    );
  }

  console.log(
    `Release tag............ VERIFIED  ${releaseTag}`
  );

  console.log(
    `Release commit......... VERIFIED  ${head}`
  );
}

function requireCleanReleaseTree() {
  const status = git([
    'status',
    '--porcelain',
    '--untracked-files=all'
  ]);

  if (status) {
    fail(
      'Official CryLo release manifests require a clean Git tree.\n' +
      'Commit or remove all source changes before creating a manifest.'
    );
  }
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

const network = argument('--network', 'testnet');
const sequenceText = argument('--sequence');
const releaseTag = argument('--release-tag');

if (!['testnet', 'mainnet'].includes(network)) {
  fail(`Unsupported network: ${network}`);
}

if (
  !releaseTag ||
  !/^v[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(releaseTag)
) {
  fail(
    '--release-tag must be an explicit version tag such as ' +
    'v1.1.1-testnet.1 or v1.1.1.'
  );
}

requireCleanReleaseTree();

if (!sequenceText || !/^[1-9]\d*$/.test(sequenceText)) {
  fail('--sequence must be a positive integer.');
}

const releaseSequence = Number(sequenceText);

if (!Number.isSafeInteger(releaseSequence)) {
  fail('--sequence exceeds JavaScript safe integer range.');
}

const artifactArguments = argumentsFor('--artifact');

if (!artifactArguments.length) {
  fail(
    'At least one --artifact platform:architecture:path value is required.'
  );
}

const packageJson = JSON.parse(
  fs.readFileSync(
    path.join(root, 'electron', 'package.json'),
    'utf8'
  )
);

const expectedReleaseTag =
  network === 'testnet'
    ? `v${packageJson.version}-testnet.${releaseSequence}`
    : `v${packageJson.version}`;

if (releaseTag !== expectedReleaseTag) {
  fail(
    `Release tag does not match the signed release identity.\n` +
    `Expected: ${expectedReleaseTag}\n` +
    `Actual:   ${releaseTag}`
  );
}

requireReleaseTagAtHead(
  releaseTag
);

const artifacts = artifactArguments.map((definition) => {
  const first = definition.indexOf(':');
  const second =
    first === -1
      ? -1
      : definition.indexOf(':', first + 1);

  if (first <= 0 || second <= first + 1) {
    fail(
      `Invalid artifact definition: ${definition}\n` +
      'Expected platform:architecture:path'
    );
  }

  const platform = definition.slice(0, first);
  const architecture = definition.slice(first + 1, second);
  const suppliedPath = definition.slice(second + 1);

  if (!['linux', 'win', 'mac'].includes(platform)) {
    fail(`Unsupported artifact platform: ${platform}`);
  }

  if (!['arm64', 'x64'].includes(architecture)) {
    fail(`Unsupported artifact architecture: ${architecture}`);
  }

  const absolutePath = path.resolve(root, suppliedPath);

  if (!fs.existsSync(absolutePath)) {
    fail(`Artifact does not exist: ${absolutePath}`);
  }

  const stat = fs.statSync(absolutePath);

  if (!stat.isFile()) {
    fail(`Artifact is not a regular file: ${absolutePath}`);
  }

  return {
    platform,
    architecture,
    file: path.basename(absolutePath),
    size: stat.size,
    sha256: sha256(absolutePath)
  };
});

const artifactFileNames = new Set();

for (const artifact of artifacts) {
  if (artifactFileNames.has(artifact.file)) {
    fail(
      `Duplicate release artifact filename: ${artifact.file}. ` +
      'Every artifact in one CryLo release must have a unique filename.'
    );
  }

  artifactFileNames.add(artifact.file);
}

artifacts.sort((left, right) =>
  [
    left.platform,
    left.architecture,
    left.file
  ].join('\0').localeCompare(
    [
      right.platform,
      right.architecture,
      right.file
    ].join('\0')
  )
);

const now = new Date();

const manifest = {
  schema: 1,
  product: 'CryLo',
  network,
  version: packageJson.version,
  releaseTag,
  releaseSequence,
  gitCommit: git(['rev-parse', 'HEAD']),
  gitBranch: git(['branch', '--show-current']),
  createdUtc: now.toISOString(),
  signatureAlgorithm: 'Ed25519',
  hashAlgorithm: 'SHA-256',
  artifacts
};

const outputDirectory = path.join(
  root,
  'electron',
  'dist'
);

fs.mkdirSync(outputDirectory, { recursive: true });

const manifestPath = path.join(
  outputDirectory,
  'crylo-release-manifest.json'
);

const sumsPath = path.join(
  outputDirectory,
  'SHA256SUMS'
);

fs.writeFileSync(
  manifestPath,
  JSON.stringify(manifest, null, 2) + '\n',
  'utf8'
);

fs.writeFileSync(
  sumsPath,
  artifacts
    .map((artifact) =>
      `${artifact.sha256}  ${artifact.file}`
    )
    .join('\n') + '\n',
  'utf8'
);

console.log('CryLo release manifest created.');
console.log(`Manifest: ${manifestPath}`);
console.log(`SHA256SUMS: ${sumsPath}`);

for (const artifact of artifacts) {
  console.log(
    `${artifact.platform}/${artifact.architecture}: ` +
    `${artifact.file} ${artifact.sha256}`
  );
}
