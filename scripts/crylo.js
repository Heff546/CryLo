'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const releaseScript = path.join(
  root,
  'scripts',
  'release',
  'crylo-release.js'
);

const network = {
  mode: 'testnet',
  entryRelay: 'relay-us-1.crylo.network:22640',
  bootstrapReleaseSequence: 2
};

const runtimeDirectory = path.join(
  root,
  'build',
  '.crylo-runtime'
);

const daemonPidFile = path.join(
  runtimeDirectory,
  'daemon.pid'
);

const generatedElectronInputs = [
  'electron/bin/linux/BINARY-MANIFEST.txt',
  'electron/bin/linux/CryLo-daemon',
  'electron/bin/linux/CryLo-wallet-rpc'
];

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function run(command, args = [], options = {}) {
  const result = spawnSync(
    command,
    args,
    {
      cwd: root,
      env: process.env,
      stdio: options.capture ? 'pipe' : 'inherit',
      encoding: options.capture ? 'utf8' : undefined,
      shell: false
    }
  );

  if (result.error) {
    fail(result.error.message);
  }

  if (result.status !== 0) {
    if (options.capture) {
      if (result.stdout) {
        process.stdout.write(result.stdout);
      }
      if (result.stderr) {
        process.stderr.write(result.stderr);
      }
    }

    fail(
      `${command} exited with code ${result.status}.`
    );
  }

  return options.capture
    ? String(result.stdout || '').trim()
    : '';
}

function runNode(script, args = []) {
  const result = spawnSync(
    process.execPath,
    [script, ...args],
    {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
      shell: false
    }
  );

  if (result.error) {
    fail(result.error.message);
  }

  process.exit(result.status || 0);
}

function git(args, capture = false) {
  return run(
    'git',
    args,
    { capture }
  );
}

function waitForProbe(check, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (check()) {
      return true;
    }

    const wait = spawnSync(
      process.execPath,
      ['-e', 'setTimeout(() => {}, 250)'],
      {
        stdio: 'ignore',
        shell: false
      }
    );

    if (wait.error) {
      break;
    }
  }

  return false;
}

function restartSystemService(service) {
  return spawnSync(
    'sudo',
    ['systemctl', 'restart', service],
    {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
      shell: false
    }
  );
}

function deployInfrastructureRelease() {
  if (process.platform !== 'linux') {
    return;
  }

  const roles = [
    {
      service: 'crylo-anchor.service',
      label: 'Canonical Anchor',
      config: '/etc/crylo/crylo-anchor.conf'
    },
    {
      service: 'crylo-relay.service',
      label: 'Public Relay',
      config: '/etc/crylo/crylo-relay.conf'
    }
  ];

  const role = roles.find(
    (candidate) => probe(
      'systemctl',
      ['is-active', '--quiet', candidate.service]
    ).ok
  );

  if (!role) {
    return;
  }

  const { service, label, config } = role;

  if (!fs.existsSync(config)) {
    fail(`The ${label} configuration was not found: ${config}`);
  }

  const configText = fs.readFileSync(config, 'utf8');

  function configValue(name, fallback) {
    const expression = new RegExp(
      '^\\s*' + name + '\\s*=\\s*(.+?)\\s*$',
      'm'
    );

    const match = configText.match(expression);

    return match ? match[1] : fallback;
  }

  const configuredRpcHost = configValue(
    'rpc-bind-ip',
    '127.0.0.1'
  );

  const rpcHost =
    configuredRpcHost === '0.0.0.0'
      ? '127.0.0.1'
      : configuredRpcHost;

  const rpcPort = configValue(
    'rpc-bind-port',
    '22641'
  );

  const rpcUrl =
    `http://${rpcHost}:${rpcPort}/json_rpc`;

  const native = expectedNativeBin();

  if (!native) {
    fail(`Unable to determine the ${label} release binary.`);
  }

  const source = path.join(
    native.directory,
    native.daemon
  );

  const target = '/opt/crylo/bin/CryLo-daemon';
  const staged = `${target}.new`;

  if (!fs.existsSync(source)) {
    fail(`The new ${label} daemon was not found: ${source}`);
  }

  if (!fs.existsSync(target)) {
    fail(`The deployed ${label} daemon was not found: ${target}`);
  }

  const commit = git(
    ['rev-parse', '--short=10', 'HEAD'],
    true
  );

  const generated = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');

  const backup =
    `${target}.before-${commit}.${generated}.bak`;

  function rollback(message) {
    console.error(`ERROR: ${message}`);
    console.error(`Restoring the previous ${label} daemon...`);

    run('sudo', ['cp', '-a', backup, target]);

    const rollbackRestart = restartSystemService(service);

    if (
      rollbackRestart.error ||
      rollbackRestart.status !== 0
    ) {
      fail(
        `${label} rollback was copied into place, but its service ` +
        'could not be restarted.'
      );
    }

    fail(
      `${label}: the previous daemon was restored and restarted.`
    );
  }

  console.log();
  console.log(`===== DEPLOYING ${label.toUpperCase()} RELEASE =====`);
  console.log(`Source: ${source}`);
  console.log(`Target: ${target}`);
  console.log(`Backup: ${backup}`);
  console.log(`RPC health endpoint: ${rpcUrl}`);

  run('sudo', [
    'install',
    '-o', 'root',
    '-g', 'root',
    '-m', '0755',
    source,
    staged
  ]);

  run('sudo', [staged, '--version']);
  run('sudo', ['cp', '-a', target, backup]);
  run('sudo', ['mv', staged, target]);

  const restart = restartSystemService(service);

  if (restart.error || restart.status !== 0) {
    rollback(`The ${label} service restart failed.`);
  }

  const serviceReady = waitForProbe(
    () => probe(
      'systemctl',
      ['is-active', '--quiet', service]
    ).ok,
    40
  );

  if (!serviceReady) {
    rollback(
      `${label}: the service did not become active.`
    );
  }

  const mainPid = probe(
    'systemctl',
    [
      'show',
      service,
      '--property=MainPID',
      '--value'
    ]
  );

  if (!mainPid.ok || !/^\d+$/.test(mainPid.stdout)) {
    rollback(
      `${label}: the service did not report a valid process ID.`
    );
  }

  const executable = probe(
    'readlink',
    ['-f', `/proc/${mainPid.stdout}/exe`]
  );

  if (!executable.ok || executable.stdout !== target) {
    rollback(
      `${label}: the service is not running the deployed daemon.`
    );
  }

  const rpcReady = waitForProbe(() => {
    const response = probe(
      'curl',
      [
        '--fail',
        '--silent',
        '--max-time', '2',
        '-H', 'Content-Type: application/json',
        '-d',
        '{"jsonrpc":"2.0","id":"0","method":"get_info"}',
        rpcUrl
      ]
    );

    if (!response.ok) {
      return false;
    }

    try {
      const body = JSON.parse(response.stdout);

      return (
        body &&
        body.result &&
        body.result.status === 'OK' &&
        body.result.offline === false
      );
    } catch (_) {
      return false;
    }
  }, 120);

  if (!rpcReady) {
    rollback(
      `${label}: RPC did not become healthy.`
    );
  }

  console.log(`${label} deployment verified successfully.`);
  console.log(`Running daemon: ${binaryVersion(target)}`);
}

const releaseVerifierScript = path.join(
  root,
  'scripts',
  'release',
  'verify-release-manifest.js'
);

const releaseRepository = 'Heff546/CryLo';

function cryloConfigRoot() {
  const home =
    process.env.HOME ||
    process.env.USERPROFILE;

  if (!home) {
    fail(
      'Unable to determine the current user home directory.'
    );
  }

  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA ||
        path.join(home, 'AppData', 'Roaming'),
      'crylo-wallet'
    );
  }

  return path.join(
    process.env.XDG_CONFIG_HOME ||
      path.join(home, '.config'),
    'crylo-wallet'
  );
}

function releaseSecurityStatePath() {
  return path.join(
    cryloConfigRoot(),
    'release-security.json'
  );
}

function readReleaseSecurityState() {
  const statePath = releaseSecurityStatePath();

  if (!fs.existsSync(statePath)) {
    return null;
  }

  let state;

  try {
    state = JSON.parse(
      fs.readFileSync(statePath, 'utf8')
    );
  } catch (error) {
    fail(
      `CryLo release-security state is invalid: ${error.message}`
    );
  }

  if (
    !state ||
    state.network !== network.mode ||
    !Number.isSafeInteger(
      state.highestAcceptedReleaseSequence
    ) ||
    state.highestAcceptedReleaseSequence < 1
  ) {
    fail(
      'CryLo release-security state is invalid or belongs to ' +
      'a different network.'
    );
  }

  if (
    state.lastAcceptedGitCommit !== undefined &&
    (
      typeof state.lastAcceptedGitCommit !== 'string' ||
      !/^[0-9a-f]{40}$/i.test(
        state.lastAcceptedGitCommit
      )
    )
  ) {
    fail(
      'CryLo release-security state contains an invalid Git commit.'
    );
  }

  return state;
}

function writeReleaseSecurityState(authorization) {
  const statePath = releaseSecurityStatePath();
  const directory = path.dirname(statePath);

  fs.mkdirSync(directory, {
    recursive: true
  });

  const previous = readReleaseSecurityState();

  if (
    previous &&
    authorization.releaseSequence <
      previous.highestAcceptedReleaseSequence
  ) {
    fail(
      'Refusing to lower the accepted CryLo release sequence.'
    );
  }

  if (
    previous &&
    authorization.releaseSequence ===
      previous.highestAcceptedReleaseSequence
  ) {
    const identityMismatch =
      (
        previous.lastAcceptedGitCommit &&
        previous.lastAcceptedGitCommit.toLowerCase() !==
          authorization.gitCommit.toLowerCase()
      ) ||
      (
        previous.lastAcceptedReleaseTag &&
        previous.lastAcceptedReleaseTag !==
          authorization.releaseTag
      ) ||
      (
        previous.lastAcceptedVersion &&
        previous.lastAcceptedVersion !==
          authorization.version
      );

    if (identityMismatch) {
      fail(
        'Refusing release-sequence reuse for a different ' +
        'CryLo release identity.'
      );
    }
  }

  const state = {
    network: network.mode,
    highestAcceptedReleaseSequence:
      authorization.releaseSequence,
    lastAcceptedVersion:
      authorization.version,
    lastAcceptedReleaseTag:
      authorization.releaseTag,
    lastAcceptedGitCommit:
      authorization.gitCommit
  };

  const temporary =
    `${statePath}.tmp-${process.pid}-${Date.now()}`;

  let descriptor;

  try {
    descriptor = fs.openSync(
      temporary,
      'wx',
      0o600
    );

    fs.writeFileSync(
      descriptor,
      JSON.stringify(state, null, 2) + '\n',
      'utf8'
    );

    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;

    fs.renameSync(
      temporary,
      statePath
    );

    fs.chmodSync(
      statePath,
      0o600
    );
  } catch (error) {
    if (descriptor !== undefined && descriptor !== null) {
      try {
        fs.closeSync(descriptor);
      } catch (_) {
        // Best-effort cleanup.
      }
    }

    try {
      fs.rmSync(
        temporary,
        { force: true }
      );
    } catch (_) {
      // Best-effort cleanup.
    }

    fail(
      `Unable to persist CryLo release-security state: ${error.message}`
    );
  }

  console.log(
    `Accepted release sequence: ${authorization.releaseSequence}`
  );
  console.log(
    `Release security state: ${statePath}`
  );
}

function sha256File(file) {
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

      hash.update(
        buffer.subarray(0, count)
      );
    }
  } finally {
    fs.closeSync(descriptor);
  }

  return hash.digest('hex');
}

function httpsDownload(url, output) {
  let parsed;

  try {
    parsed = new URL(url);
  } catch (_) {
    throw new Error(
      `Invalid HTTPS download URL: ${url}`
    );
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(
      `Refusing non-HTTPS release URL: ${url}`
    );
  }

  const result = spawnSync(
    'curl',
    [
      '--fail',
      '--silent',
      '--show-error',
      '--location',
      '--proto', '=https',
      '--tlsv1.2',
      '--connect-timeout', '15',
      '--max-time', '120',
      '--output', output,
      url
    ],
    {
      cwd: root,
      env: process.env,
      encoding: 'utf8',
      shell: false
    }
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `HTTPS download failed with code ${result.status}: ${url}`
    );
  }
}

function httpsText(url) {
  let parsed;

  try {
    parsed = new URL(url);
  } catch (_) {
    throw new Error(
      `Invalid HTTPS URL: ${url}`
    );
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(
      `Refusing non-HTTPS URL: ${url}`
    );
  }

  const result = spawnSync(
    'curl',
    [
      '--fail',
      '--silent',
      '--show-error',
      '--location',
      '--proto', '=https',
      '--tlsv1.2',
      '--connect-timeout', '15',
      '--max-time', '60',
      '-H', 'Accept: application/vnd.github+json',
      '-H', 'X-GitHub-Api-Version: 2022-11-28',
      url
    ],
    {
      cwd: root,
      env: process.env,
      encoding: 'utf8',
      shell: false
    }
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `HTTPS request failed with code ${result.status}: ${url}`
    );
  }

  return String(result.stdout || '');
}

function verifyManifestWithCurrentTrust(
  manifestPath,
  signaturePath,
  publicKeyPath
) {
  const manifestBytes =
    fs.readFileSync(manifestPath);

  const publicKey = crypto.createPublicKey(
    fs.readFileSync(publicKeyPath)
  );

  if (publicKey.asymmetricKeyType !== 'ed25519') {
    throw new Error(
      'The currently trusted CryLo release key is not Ed25519.'
    );
  }

  const signatureText =
    fs.readFileSync(signaturePath, 'utf8').trim();

  if (
    !/^[A-Za-z0-9+/]+={0,2}$/.test(signatureText)
  ) {
    throw new Error(
      'The release manifest signature is not valid base64.'
    );
  }

  const signature = Buffer.from(
    signatureText,
    'base64'
  );

  if (signature.length !== 64) {
    throw new Error(
      'The release manifest does not contain a valid ' +
      'Ed25519 signature length.'
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
    throw new Error(
      'The release manifest signature does not verify with ' +
      'the currently trusted CryLo release key.'
    );
  }

  let manifest;

  try {
    manifest = JSON.parse(
      manifestBytes.toString('utf8')
    );
  } catch (error) {
    throw new Error(
      `Signed release manifest JSON is invalid: ${error.message}`
    );
  }

  return manifest;
}

function releaseTarget() {
  if (process.platform !== 'linux') {
    return null;
  }

  if (!['arm64', 'x64'].includes(process.arch)) {
    fail(
      `Signed CryLo Linux updates do not support architecture ` +
      `${process.arch}.`
    );
  }

  return {
    platform: 'linux',
    architecture: process.arch
  };
}

function authenticateRemoteRelease(
  remoteCommit,
  branch
) {
  const target = releaseTarget();

  if (!target) {
    return null;
  }

  const currentPublicKey = path.join(
    root,
    'scripts',
    'release',
    'keys',
    `crylo-${network.mode}-release-ed25519-public.pem`
  );

  if (!fs.existsSync(currentPublicKey)) {
    fail(
      `The currently trusted CryLo ${network.mode} release key ` +
      `was not found: ${currentPublicKey}`
    );
  }

  if (!fs.existsSync(releaseVerifierScript)) {
    fail(
      `The currently trusted CryLo release verifier was not found: ` +
      `${releaseVerifierScript}`
    );
  }

  const existingState =
    readReleaseSecurityState();

  const minimumSequence =
    existingState
      ? existingState.highestAcceptedReleaseSequence
      : network.bootstrapReleaseSequence;

  console.log();
  console.log('===== VERIFYING SIGNED CRYLO RELEASE =====');
  console.log(`Candidate commit: ${remoteCommit}`);
  console.log(`Rollback floor: ${minimumSequence}`);

  const apiUrl =
    `https://api.github.com/repos/${releaseRepository}/releases?per_page=100`;

  let releases;

  try {
    const response = httpsText(apiUrl);
    releases = JSON.parse(response);
  } catch (error) {
    fail(
      `Unable to retrieve CryLo release metadata: ${error.message}`
    );
  }

  if (!Array.isArray(releases)) {
    fail(
      'GitHub did not return a valid CryLo release list.'
    );
  }

  const temporaryRoot = fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      'crylo-release-auth-'
    )
  );

  const signedCandidates = [];

  try {
    for (const release of releases) {
      if (
        !release ||
        release.draft === true ||
        release.prerelease !== true ||
        typeof release.tag_name !== 'string' ||
        !Array.isArray(release.assets)
      ) {
        continue;
      }

      if (
        !/^v[0-9]+\.[0-9]+\.[0-9]+-testnet\.[1-9][0-9]*$/.test(
          release.tag_name
        )
      ) {
        continue;
      }

      const manifestAsset = release.assets.find(
        (asset) =>
          asset &&
          asset.name === 'crylo-release-manifest.json'
      );

      const signatureAsset = release.assets.find(
        (asset) =>
          asset &&
          asset.name === 'crylo-release-manifest.json.sig'
      );

      if (
        !manifestAsset ||
        !signatureAsset ||
        typeof manifestAsset.browser_download_url !== 'string' ||
        typeof signatureAsset.browser_download_url !== 'string'
      ) {
        continue;
      }

      const candidateDirectory = path.join(
        temporaryRoot,
        String(
          release.id ||
          release.tag_name.replace(/[^A-Za-z0-9._-]/g, '_')
        )
      );

      fs.mkdirSync(
        candidateDirectory,
        { recursive: true }
      );

      const manifestPath = path.join(
        candidateDirectory,
        'crylo-release-manifest.json'
      );

      const signaturePath =
        `${manifestPath}.sig`;

      let manifest;

      try {
        httpsDownload(
          manifestAsset.browser_download_url,
          manifestPath
        );

        httpsDownload(
          signatureAsset.browser_download_url,
          signaturePath
        );

        manifest = verifyManifestWithCurrentTrust(
          manifestPath,
          signaturePath,
          currentPublicKey
        );
      } catch (_) {
        continue;
      }

      if (
        manifest.schema !== 1 ||
        manifest.product !== 'CryLo' ||
        manifest.network !== network.mode ||
        manifest.signatureAlgorithm !== 'Ed25519' ||
        manifest.hashAlgorithm !== 'SHA-256' ||
        typeof manifest.version !== 'string' ||
        !manifest.version ||
        !Number.isSafeInteger(
          manifest.releaseSequence
        ) ||
        manifest.releaseSequence < minimumSequence ||
        typeof manifest.gitCommit !== 'string' ||
        !/^[0-9a-f]{40}$/i.test(
          manifest.gitCommit
        ) ||
        manifest.gitCommit.toLowerCase() !==
          remoteCommit.toLowerCase() ||
        manifest.gitBranch !== branch ||
        manifest.releaseTag !== release.tag_name
      ) {
        continue;
      }

      const expectedTag =
        `v${manifest.version}-testnet.${manifest.releaseSequence}`;

      if (manifest.releaseTag !== expectedTag) {
        continue;
      }

      if (
        existingState &&
        manifest.releaseSequence ===
          existingState.highestAcceptedReleaseSequence
      ) {
        const identityMismatch =
          (
            existingState.lastAcceptedGitCommit &&
            existingState.lastAcceptedGitCommit.toLowerCase() !==
              manifest.gitCommit.toLowerCase()
          ) ||
          (
            existingState.lastAcceptedReleaseTag &&
            existingState.lastAcceptedReleaseTag !==
              manifest.releaseTag
          ) ||
          (
            existingState.lastAcceptedVersion &&
            existingState.lastAcceptedVersion !==
              manifest.version
          );

        if (identityMismatch) {
          continue;
        }
      }

      signedCandidates.push({
        release,
        manifest,
        manifestPath,
        signaturePath,
        candidateDirectory
      });
    }

    if (!signedCandidates.length) {
      fail(
        'No trusted signed CryLo testnet release authorizes ' +
        `candidate commit ${remoteCommit}. ` +
        'The source tree was not modified.'
      );
    }

    signedCandidates.sort(
      (left, right) =>
        right.manifest.releaseSequence -
        left.manifest.releaseSequence
    );

    const selected = signedCandidates[0];
    const manifest = selected.manifest;

    const matchingArtifacts = Array.isArray(
      manifest.artifacts
    )
      ? manifest.artifacts.filter(
          (artifact) =>
            artifact &&
            artifact.platform === target.platform &&
            artifact.architecture === target.architecture
        )
      : [];

    if (matchingArtifacts.length !== 1) {
      fail(
        `Signed release ${manifest.releaseTag} must contain exactly ` +
        `one ${target.platform}/${target.architecture} artifact.`
      );
    }

    const artifact = matchingArtifacts[0];

    if (
      typeof artifact.file !== 'string' ||
      !artifact.file ||
      artifact.file !== path.basename(artifact.file) ||
      artifact.file.includes('/') ||
      artifact.file.includes('\\')
    ) {
      fail(
        'Signed release contains an invalid artifact filename.'
      );
    }

    const remoteArtifact = selected.release.assets.find(
      (asset) =>
        asset &&
        asset.name === artifact.file
    );

    if (
      !remoteArtifact ||
      typeof remoteArtifact.browser_download_url !== 'string'
    ) {
      fail(
        `Signed artifact ${artifact.file} is missing from ` +
        `${manifest.releaseTag}.`
      );
    }

    const artifactPath = path.join(
      selected.candidateDirectory,
      artifact.file
    );

    try {
      httpsDownload(
        remoteArtifact.browser_download_url,
        artifactPath
      );
    } catch (error) {
      fail(
        `Unable to download signed CryLo artifact: ${error.message}`
      );
    }

    const verification = spawnSync(
      process.execPath,
      [
        releaseVerifierScript,
        '--network', network.mode,
        '--platform', target.platform,
        '--architecture', target.architecture,
        '--minimum-sequence', String(minimumSequence),
        '--manifest', selected.manifestPath,
        '--signature', selected.signaturePath,
        '--public-key', currentPublicKey
      ],
      {
        cwd: root,
        env: process.env,
        stdio: 'inherit',
        shell: false
      }
    );

    if (verification.error) {
      fail(
        `Unable to run the trusted release verifier: ` +
        `${verification.error.message}`
      );
    }

    if (verification.status !== 0) {
      fail(
        'Signed CryLo release verification failed. ' +
        'The source tree was not modified.'
      );
    }

    console.log(
      `Authorized release....... ${manifest.releaseTag}`
    );
    console.log(
      `Authorized sequence...... ${manifest.releaseSequence}`
    );
    console.log(
      `Authorized commit........ ${manifest.gitCommit}`
    );

    return {
      releaseSequence: manifest.releaseSequence,
      releaseTag: manifest.releaseTag,
      version: manifest.version,
      gitCommit: manifest.gitCommit
    };
  } finally {
    try {
      fs.rmSync(
        temporaryRoot,
        {
          recursive: true,
          force: true
        }
      );
    } catch (_) {
      // Temporary verification cleanup is best effort.
    }
  }
}

function resumedReleaseAuthorization(
  currentCommit,
  remoteCommit
) {
  const commit =
    process.env.CRYLO_AUTHORIZED_COMMIT || '';

  const sequenceText =
    process.env.CRYLO_AUTHORIZED_SEQUENCE || '';

  const releaseTag =
    process.env.CRYLO_AUTHORIZED_TAG || '';

  const version =
    process.env.CRYLO_AUTHORIZED_VERSION || '';

  if (
    !/^[0-9a-f]{40}$/i.test(commit) ||
    commit.toLowerCase() !==
      currentCommit.toLowerCase() ||
    commit.toLowerCase() !==
      remoteCommit.toLowerCase() ||
    !/^[1-9][0-9]*$/.test(sequenceText) ||
    !releaseTag ||
    !version
  ) {
    fail(
      'CryLo update resume authorization is invalid. ' +
      'Run "crylo update" again without manually setting ' +
      'CRYLO_UPDATE_RESUMED.'
    );
  }

  const releaseSequence =
    Number(sequenceText);

  if (!Number.isSafeInteger(releaseSequence)) {
    fail(
      'CryLo update resume sequence exceeds the safe integer range.'
    );
  }

  return {
    releaseSequence,
    releaseTag,
    version,
    gitCommit: commit
  };
}

function downloadAuthorizedLinuxBundle(
  authorization
) {
  const target = releaseTarget();

  if (!target) {
    fail(
      'Exact signed release installation is currently Linux-only.'
    );
  }

  const publicKeyPath = path.join(
    root,
    'scripts',
    'release',
    'keys',
    `crylo-${network.mode}-release-ed25519-public.pem`
  );

  const apiUrl =
    `https://api.github.com/repos/${releaseRepository}/releases/tags/` +
    encodeURIComponent(
      authorization.releaseTag
    );

  let release;

  try {
    release = JSON.parse(
      httpsText(apiUrl)
    );
  } catch (error) {
    fail(
      `Unable to retrieve authorized CryLo release: ${error.message}`
    );
  }

  if (
    !release ||
    release.draft === true ||
    release.prerelease !== true ||
    release.tag_name !== authorization.releaseTag ||
    !Array.isArray(release.assets)
  ) {
    fail(
      'Authorized CryLo release metadata is invalid.'
    );
  }

  const temporaryRoot = fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      'crylo-authorized-install-'
    )
  );

  try {
    const manifestPath = path.join(
      temporaryRoot,
      'crylo-release-manifest.json'
    );

    const signaturePath =
      `${manifestPath}.sig`;

    const manifestAsset = release.assets.find(
      (asset) =>
        asset &&
        asset.name ===
          'crylo-release-manifest.json'
    );

    const signatureAsset = release.assets.find(
      (asset) =>
        asset &&
        asset.name ===
          'crylo-release-manifest.json.sig'
    );

    if (
      !manifestAsset ||
      !signatureAsset ||
      typeof manifestAsset.browser_download_url !== 'string' ||
      typeof signatureAsset.browser_download_url !== 'string'
    ) {
      throw new Error(
        'Authorized release is missing its signed manifest.'
      );
    }

    httpsDownload(
      manifestAsset.browser_download_url,
      manifestPath
    );

    httpsDownload(
      signatureAsset.browser_download_url,
      signaturePath
    );

    const manifest =
      verifyManifestWithCurrentTrust(
        manifestPath,
        signaturePath,
        publicKeyPath
      );

    if (
      manifest.schema !== 1 ||
      manifest.product !== 'CryLo' ||
      manifest.network !== network.mode ||
      manifest.version !== authorization.version ||
      manifest.releaseTag !== authorization.releaseTag ||
      manifest.releaseSequence !== authorization.releaseSequence ||
      typeof manifest.gitCommit !== 'string' ||
      manifest.gitCommit.toLowerCase() !==
        authorization.gitCommit.toLowerCase() ||
      manifest.signatureAlgorithm !== 'Ed25519' ||
      manifest.hashAlgorithm !== 'SHA-256'
    ) {
      throw new Error(
        'Authorized release manifest does not match the ' +
        'previously authenticated release.'
      );
    }

    const expectedTag =
      `v${manifest.version}-testnet.${manifest.releaseSequence}`;

    if (manifest.releaseTag !== expectedTag) {
      throw new Error(
        'Authorized release tag does not match its signed identity.'
      );
    }

    const matchingArtifacts = Array.isArray(
      manifest.artifacts
    )
      ? manifest.artifacts.filter(
          (artifact) =>
            artifact &&
            artifact.platform === target.platform &&
            artifact.architecture === target.architecture
        )
      : [];

    if (matchingArtifacts.length !== 1) {
      throw new Error(
        `Authorized release must contain exactly one ` +
        `${target.platform}/${target.architecture} artifact.`
      );
    }

    const artifact = matchingArtifacts[0];

    const expectedBundleName =
      `CryLo-Release-${authorization.version}-linux-` +
      `${target.architecture}.tar`;

    if (artifact.file !== expectedBundleName) {
      throw new Error(
        `Authorized release bundle filename mismatch.\n` +
        `Expected: ${expectedBundleName}\n` +
        `Actual:   ${artifact.file}`
      );
    }

    const remoteBundle = release.assets.find(
      (asset) =>
        asset &&
        asset.name === artifact.file
    );

    if (
      !remoteBundle ||
      typeof remoteBundle.browser_download_url !== 'string'
    ) {
      throw new Error(
        `Authorized signed bundle is missing: ${artifact.file}`
      );
    }

    const bundlePath = path.join(
      temporaryRoot,
      artifact.file
    );

    httpsDownload(
      remoteBundle.browser_download_url,
      bundlePath
    );

    const verification = spawnSync(
      process.execPath,
      [
        releaseVerifierScript,
        '--network', network.mode,
        '--platform', target.platform,
        '--architecture', target.architecture,
        '--minimum-sequence',
        String(authorization.releaseSequence),
        '--manifest', manifestPath,
        '--signature', signaturePath,
        '--public-key', publicKeyPath
      ],
      {
        cwd: root,
        env: process.env,
        stdio: 'inherit',
        shell: false
      }
    );

    if (verification.error) {
      throw verification.error;
    }

    if (verification.status !== 0) {
      throw new Error(
        'Authorized CryLo release bundle verification failed.'
      );
    }

    return {
      temporaryRoot,
      bundlePath
    };
  } catch (error) {
    try {
      fs.rmSync(
        temporaryRoot,
        {
          recursive: true,
          force: true
        }
      );
    } catch (_) {
      // Best-effort authenticated-download cleanup.
    }

    fail(
      `Exact CryLo release download failed: ${error.message}`
    );
  }
}

function installAuthorizedLinuxBundle(
  authorization
) {
  if (process.platform !== 'linux') {
    fail(
      'Exact CryLo release bundle installation is Linux-only.'
    );
  }

  const release =
    downloadAuthorizedLinuxBundle(
      authorization
    );

  let installationError = null;

  try {
    const native = expectedNativeBin();

    if (!native) {
      throw new Error(
        'Unable to determine the Linux native release directory.'
      );
    }

    const appImageName =
      `CryLo-Wallet-${authorization.version}-${process.arch}.AppImage`;

    const expectedEntries = [
      native.daemon,
      native.walletCli,
      native.walletRpc,
      appImageName
    ].sort();

    const listing = spawnSync(
      'tar',
      [
        '-tf',
        release.bundlePath
      ],
      {
        cwd: root,
        env: process.env,
        encoding: 'utf8',
        shell: false
      }
    );

    if (
      listing.error ||
      listing.status !== 0
    ) {
      throw new Error(
        'Unable to inspect the authenticated CryLo release bundle.'
      );
    }

    const entries = String(
      listing.stdout || ''
    )
      .split(/\r?\n/)
      .filter(Boolean)
      .sort();

    if (
      entries.length !== expectedEntries.length ||
      entries.some(
        (entry, index) =>
          entry !== expectedEntries[index] ||
          entry !== path.basename(entry) ||
          entry.includes('/') ||
          entry.includes('\\')
      )
    ) {
      throw new Error(
        'Authenticated CryLo release bundle contains unexpected entries.'
      );
    }

    const extractionDirectory = path.join(
      release.temporaryRoot,
      'extracted'
    );

    fs.mkdirSync(
      extractionDirectory,
      {
        recursive: true,
        mode: 0o700
      }
    );

    const extraction = spawnSync(
      'tar',
      [
        '-xf',
        release.bundlePath,
        '-C',
        extractionDirectory,
        '--no-same-owner',
        '--no-same-permissions'
      ],
      {
        cwd: root,
        env: process.env,
        stdio: 'inherit',
        shell: false
      }
    );

    if (
      extraction.error ||
      extraction.status !== 0
    ) {
      throw new Error(
        'Unable to extract the authenticated CryLo release bundle.'
      );
    }

    for (const entry of expectedEntries) {
      const extracted = path.join(
        extractionDirectory,
        entry
      );

      const stat = fs.lstatSync(
        extracted
      );

      if (!stat.isFile()) {
        throw new Error(
          `Authenticated bundle entry is not a regular file: ${entry}`
        );
      }
    }

    fs.mkdirSync(
      native.directory,
      {
        recursive: true
      }
    );

    const distDirectory = path.join(
      root,
      'electron',
      'dist'
    );

    fs.mkdirSync(
      distDirectory,
      {
        recursive: true
      }
    );

    const installations = [
      {
        source: path.join(
          extractionDirectory,
          native.daemon
        ),
        destination: path.join(
          native.directory,
          native.daemon
        )
      },
      {
        source: path.join(
          extractionDirectory,
          native.walletCli
        ),
        destination: path.join(
          native.directory,
          native.walletCli
        )
      },
      {
        source: path.join(
          extractionDirectory,
          native.walletRpc
        ),
        destination: path.join(
          native.directory,
          native.walletRpc
        )
      },
      {
        source: path.join(
          extractionDirectory,
          appImageName
        ),
        destination: path.join(
          distDirectory,
          appImageName
        )
      }
    ];

    const transactionId =
      `${process.pid}-${Date.now()}`;

    const staged = [];
    let transactionSucceeded = false;

    try {
      /*
       * Stage and hash every file before replacing anything.
       * Add each transaction record first so partial staging is
       * still cleaned if a later copy/hash operation fails.
       */
      for (const item of installations) {
        const temporary =
          `${item.destination}.new-${transactionId}`;

        const record = {
          ...item,
          temporary,
          expectedHash:
            sha256File(
              item.source
            ),
          backup:
            `${item.destination}.before-release-${transactionId}`,
          hadExisting:
            fs.existsSync(item.destination),
          installed: false,
          rollbackFailed: false
        };

        staged.push(
          record
        );

        fs.copyFileSync(
          record.source,
          record.temporary
        );

        fs.chmodSync(
          record.temporary,
          0o755
        );

        const stagedHash =
          sha256File(
            record.temporary
          );

        if (
          stagedHash !==
          record.expectedHash
        ) {
          throw new Error(
            `CryLo staging hash mismatch: ` +
            `${path.basename(record.destination)}`
          );
        }
      }

      /*
       * Replace each destination only after every release file
       * has staged successfully.
       */
      for (const item of staged) {
        if (item.hadExisting) {
          fs.copyFileSync(
            item.destination,
            item.backup
          );
        }

        fs.renameSync(
          item.temporary,
          item.destination
        );

        item.installed = true;

        const installedHash =
          sha256File(
            item.destination
          );

        if (
          installedHash !==
          item.expectedHash
        ) {
          throw new Error(
            `Installed CryLo artifact hash mismatch: ` +
            `${path.basename(item.destination)}`
          );
        }
      }

      transactionSucceeded = true;
    } catch (error) {
      const rollbackErrors = [];

      for (const item of [...staged].reverse()) {
        if (!item.installed) {
          continue;
        }

        try {
          if (item.hadExisting) {
            if (!fs.existsSync(item.backup)) {
              throw new Error(
                `rollback backup is missing: ${item.backup}`
              );
            }

            fs.copyFileSync(
              item.backup,
              item.destination
            );

            const restoredHash =
              sha256File(
                item.destination
              );

            const backupHash =
              sha256File(
                item.backup
              );

            if (
              restoredHash !==
              backupHash
            ) {
              throw new Error(
                'restored file does not match rollback backup'
              );
            }
          } else {
            fs.rmSync(
              item.destination,
              { force: true }
            );
          }
        } catch (rollbackError) {
          item.rollbackFailed = true;

          rollbackErrors.push(
            `${path.basename(item.destination)}: ` +
            `${rollbackError.message}`
          );
        }
      }

      if (rollbackErrors.length) {
        throw new Error(
          `Exact release installation failed: ${error.message}\n` +
          'One or more rollback operations also failed.\n' +
          'Recovery backups were preserved for those files:\n' +
          rollbackErrors
            .map((value) => `  ${value}`)
            .join('\n')
        );
      }

      throw new Error(
        `Exact release installation rolled back successfully: ` +
        `${error.message}`
      );
    } finally {
      for (const item of staged) {
        try {
          fs.rmSync(
            item.temporary,
            { force: true }
          );
        } catch (_) {
          // Best-effort staging cleanup.
        }

        /*
         * Never destroy a backup whose rollback failed.
         * On success, or after a verified successful rollback,
         * the temporary backup can be removed.
         */
        if (
          transactionSucceeded ||
          !item.rollbackFailed
        ) {
          try {
            fs.rmSync(
              item.backup,
              { force: true }
            );
          } catch (_) {
            // Best-effort successful-transaction cleanup.
          }
        }
      }
    }

    console.log();
    console.log(
      '===== EXACT SIGNED CRYLO RELEASE INSTALLED ====='
    );

    console.log(
      `Release................. ${authorization.releaseTag}`
    );

    console.log(
      `Sequence................ ${authorization.releaseSequence}`
    );

    console.log(
      `Commit.................. ${authorization.gitCommit}`
    );

    for (const item of installations) {
      console.log(
        `Installed............... ${item.destination}`
      );

      console.log(
        `SHA256.................. ${sha256File(item.destination)}`
      );
    }
  } catch (error) {
    installationError = error;
  } finally {
    try {
      fs.rmSync(
        release.temporaryRoot,
        {
          recursive: true,
          force: true
        }
      );
    } catch (_) {
      // Best-effort authenticated-release cleanup.
    }
  }

  if (installationError) {
    fail(
      `Exact CryLo release installation failed: ` +
      `${installationError.message}`
    );
  }
}

function update() {
  console.log('===== CRYLO UPDATE =====');

  const insideWorkTree = git(
    ['rev-parse', '--is-inside-work-tree'],
    true
  );

  if (insideWorkTree !== 'true') {
    fail('This CryLo installation is not a Git working tree.');
  }

  let status = git(
    ['status', '--porcelain'],
    true
  );

  if (status) {
    const changedPaths = status
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => line.slice(3));

    const generatedOnly = changedPaths.every(
      (changedPath) =>
        generatedElectronInputs.includes(changedPath)
    );

    if (generatedOnly) {
      console.log(
        'Restoring generated Electron binary staging files...'
      );

      git([
        'restore',
        '--source=HEAD',
        '--',
        ...generatedElectronInputs
      ]);

      status = git(
        ['status', '--porcelain'],
        true
      );
    }
  }

  if (status) {
    fail(
      'CryLo has local source changes. ' +
      'Update stopped without changing anything.'
    );
  }

  const branch = git(
    ['branch', '--show-current'],
    true
  );

  if (!branch) {
    fail(
      'CryLo is not currently on a branch. ' +
      'Update stopped without changing anything.'
    );
  }

  const upstreamResult = spawnSync(
    'git',
    [
      'rev-parse',
      '--abbrev-ref',
      '--symbolic-full-name',
      '@{upstream}'
    ],
    {
      cwd: root,
      env: process.env,
      encoding: 'utf8',
      shell: false
    }
  );

  let upstream;

  if (
    upstreamResult.error ||
    upstreamResult.status !== 0
  ) {
    upstream = `origin/${branch}`;

    console.log(
      `No configured upstream; using "${upstream}".`
    );
  } else {
    upstream = String(
      upstreamResult.stdout || ''
    ).trim();
  }

  if (!upstream.startsWith('origin/')) {
    fail(
      `CryLo update expected an origin upstream, found "${upstream}".`
    );
  }

  const before = git(
    ['rev-parse', 'HEAD'],
    true
  );

  console.log(`Branch: ${branch}`);
  console.log('Checking for CryLo updates...');

  const remoteBranch =
    upstream.slice('origin/'.length);

  /*
   * Fetch only updates the remote-tracking ref.
   * No fetched source is checked out or executed here.
   */
  git([
    'fetch',
    'origin',
    `+refs/heads/${remoteBranch}:refs/remotes/${upstream}`
  ]);

  const remote = git(
    ['rev-parse', upstream],
    true
  );

  if (before !== remote) {
    const base = git(
      ['merge-base', 'HEAD', upstream],
      true
    );

    if (base !== before) {
      fail(
        'The local and remote CryLo histories have diverged. ' +
        'Update stopped without modifying the source tree.'
      );
    }
  }

  const resumed =
    process.env.CRYLO_UPDATE_RESUMED === '1';

  let authorization = null;

  if (process.platform === 'linux') {
    if (resumed) {
      authorization = resumedReleaseAuthorization(
        before,
        remote
      );

      console.log();
      console.log(
        'Continuing previously authenticated CryLo update.'
      );
      console.log(
        `Authorized release....... ${authorization.releaseTag}`
      );
      console.log(
        `Authorized sequence...... ${authorization.releaseSequence}`
      );
      console.log(
        `Authorized commit........ ${authorization.gitCommit}`
      );
    } else {
      /*
       * Critical security boundary:
       * authenticate the candidate commit using the currently
       * installed updater, verifier, and public key BEFORE merge.
       */
      authorization = authenticateRemoteRelease(
        remote,
        branch
      );
    }
  }

  let after = before;

  if (before === remote) {
    console.log();
    console.log('CryLo source is already up to date.');
  } else {
    if (
      process.platform === 'linux' &&
      (
        !authorization ||
        authorization.gitCommit.toLowerCase() !==
          remote.toLowerCase()
      )
    ) {
      fail(
        'The candidate CryLo source commit was not authorized ' +
        'by a trusted signed release.'
      );
    }

    console.log();
    console.log(
      'Signed release authorized. Updating CryLo source...'
    );

    git([
      'merge',
      '--ff-only',
      upstream
    ]);

    after = git(
      ['rev-parse', 'HEAD'],
      true
    );

    if (after !== remote) {
      fail(
        'CryLo source did not advance to the authenticated commit.'
      );
    }

    console.log();
    console.log(
      `Updated CryLo: ${before.slice(0, 9)} -> ${after.slice(0, 9)}`
    );
  }

  if (
    after !== before &&
    !resumed
  ) {
    if (
      process.platform === 'linux' &&
      !authorization
    ) {
      fail(
        'Authenticated Linux update authorization was lost.'
      );
    }

    console.log();
    console.log(
      'Restarting with the authenticated CryLo updater...'
    );

    const resumedEnvironment = {
      ...process.env,
      CRYLO_UPDATE_RESUMED: '1'
    };

    if (authorization) {
      resumedEnvironment.CRYLO_AUTHORIZED_COMMIT =
        authorization.gitCommit;

      resumedEnvironment.CRYLO_AUTHORIZED_SEQUENCE =
        String(authorization.releaseSequence);

      resumedEnvironment.CRYLO_AUTHORIZED_TAG =
        authorization.releaseTag;

      resumedEnvironment.CRYLO_AUTHORIZED_VERSION =
        authorization.version;
    }

    const resumedProcess = spawnSync(
      process.execPath,
      [__filename, 'update'],
      {
        cwd: root,
        env: resumedEnvironment,
        stdio: 'inherit',
        shell: false
      }
    );

    if (resumedProcess.error) {
      fail(
        resumedProcess.error.message
      );
    }

    process.exit(
      resumedProcess.status || 0
    );
  }

  if (process.platform === 'linux') {
    if (!authorization) {
      fail(
        'Linux update reached installation without signed authorization.'
      );
    }

    console.log();
    console.log(
      'Installing the exact authenticated CryLo release bundle...'
    );

    installAuthorizedLinuxBundle(
      authorization
    );
  } else {
    console.log();
    console.log('Preparing build dependencies...');

    ensureLinuxBuildDependencies();

    console.log(
      'Building the current native CryLo and Electron release...'
    );

    const result = spawnSync(
      process.execPath,
      [releaseScript],
      {
        cwd: root,
        env: process.env,
        stdio: 'inherit',
        shell: false
      }
    );

    if (result.error) {
      fail(result.error.message);
    }

    if (result.status !== 0) {
      fail(
        'CryLo source was authenticated and updated, ' +
        'but the release build failed.'
      );
    }
  }

  deployInfrastructureRelease();
  installUserCommand();
  installLinuxDesktopLaunchers();

  /*
   * Advance rollback state only AFTER the build and deployment
   * completed successfully.
   */
  if (
    process.platform === 'linux' &&
    authorization
  ) {
    writeReleaseSecurityState(
      authorization
    );
  }

  console.log();
  console.log('CryLo update completed successfully.');
}

function probe(command, args = []) {
  const result = spawnSync(
    command,
    args,
    {
      cwd: root,
      env: process.env,
      encoding: 'utf8',
      shell: false
    }
  );

  return {
    ok: !result.error && result.status === 0,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim()
  };
}

function expectedNativeBin() {
  if (process.platform === 'win32') {
    return {
      directory: path.join(root, 'build', 'win-x64', 'bin'),
      daemon: 'CryLo-daemon.exe',
      walletCli: 'CryLo-wallet.exe',
      walletRpc: 'CryLo-wallet-rpc.exe'
    };
  }

  if (process.platform === 'linux') {
    const arch =
      process.arch === 'arm64'
        ? 'arm64'
        : 'x64';

    return {
      directory: path.join(root, 'build', `linux-${arch}`, 'bin'),
      daemon: 'CryLo-daemon',
      walletCli: 'CryLo-wallet',
      walletRpc: 'CryLo-wallet-rpc'
    };
  }

  if (process.platform === 'darwin') {
    const arch =
      process.arch === 'arm64'
        ? 'arm64'
        : 'x64';

    return {
      directory: path.join(root, 'build', `mac-${arch}`, 'bin'),
      daemon: 'CryLo-daemon',
      walletCli: 'CryLo-wallet',
      walletRpc: 'CryLo-wallet-rpc'
    };
  }

  return null;
}

function binaryVersion(binary) {
  if (!fs.existsSync(binary)) {
    return null;
  }

  const result = probe(binary, ['--version']);

  if (!result.ok) {
    return 'present, version unavailable';
  }

  return result.stdout.split(/\r?\n/)[0] || 'present';
}

function runningDaemon() {
  if (process.platform === 'win32') {
    const result = probe(
      process.env.ComSpec || 'cmd.exe',
      [
        '/d',
        '/s',
        '/c',
        'tasklist /FI "IMAGENAME eq CryLo-daemon.exe" /FO CSV /NH'
      ]
    );

    if (
      !result.ok ||
      !result.stdout ||
      /No tasks are running/i.test(result.stdout)
    ) {
      return null;
    }

    return result.stdout;
  }

  const result = probe(
    'ps',
    ['-eo', 'pid=,stat=,args=']
  );

  if (!result.ok) {
    return null;
  }

  const matches = result.stdout
    .split(/\r?\n/)
    .filter((line) =>
      line.includes('CryLo-daemon') &&
      !line.includes('scripts/crylo.js') &&
      !/^\s*\d+\s+Z/.test(line)
    );

  return matches.length
    ? matches.join('\n')
    : null;
}

function nativeDaemonPath() {
  const native = expectedNativeBin();

  if (!native) {
    fail(
      `CryLo does not currently support ${process.platform}/${process.arch}.`
    );
  }

  return path.join(
    native.directory,
    native.daemon
  );
}

function versionMajor(value) {
  const match = String(value || '').match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

function runAsRoot(command, args = []) {
  if (
    typeof process.getuid === 'function' &&
    process.getuid() === 0
  ) {
    run(command, args);
    return;
  }

  run('sudo', [command, ...args]);
}

function installedDebianPackage(packageName) {
  const result = spawnSync(
    '/usr/bin/dpkg-query',
    [
      '-W',
      '-f=${Status}',
      packageName
    ],
    {
      cwd: root,
      env: process.env,
      encoding: 'utf8',
      shell: false
    }
  );

  return (
    !result.error &&
    result.status === 0 &&
    String(result.stdout || '').trim() ===
      'install ok installed'
  );
}

function ensureLinuxNodeRuntime() {
  const trustedNodeSourceFingerprint =
    '6F71F525282841EEDAF851B42F59B5F99B1BE0B4';

  let node = probe('node', ['--version']);
  let nodeVersion = node.ok ? node.stdout : '';
  let npm = probe('npm', ['--version']);
  let npmVersion = npm.ok ? npm.stdout : '';

  if (versionMajor(nodeVersion) < 24) {
    console.log(
      `Node.js ${nodeVersion || 'not found'} does not meet ` +
      'the CryLo Node.js 24+ requirement.'
    );

    console.log(
      'Preparing authenticated NodeSource Node.js 24 repository...'
    );

    const tempDirectory = fs.mkdtempSync(
      '/tmp/crylo-nodesource-'
    );

    const downloadedKey = path.join(
      tempDirectory,
      'nodesource-repo.gpg.key'
    );

    const keyring = path.join(
      tempDirectory,
      'nodesource-repo.gpg'
    );

    const gpgHome = path.join(
      tempDirectory,
      'gnupg'
    );

    try {
      fs.mkdirSync(gpgHome, {
        mode: 0o700
      });

      run('curl', [
        '--fail',
        '--silent',
        '--show-error',
        '--location',
        '--proto', '=https',
        '--tlsv1.2',
        'https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key',
        '--output',
        downloadedKey
      ]);

      const fingerprintResult = spawnSync(
        'gpg',
        [
          '--batch',
          '--homedir', gpgHome,
          '--with-colons',
          '--import-options', 'show-only',
          '--import',
          downloadedKey
        ],
        {
          cwd: root,
          env: process.env,
          encoding: 'utf8',
          shell: false
        }
      );

      if (
        fingerprintResult.error ||
        fingerprintResult.status !== 0
      ) {
        fail(
          'Unable to inspect the NodeSource repository signing key.'
        );
      }

      const fingerprints = String(
        fingerprintResult.stdout || ''
      )
        .split(/\r?\n/)
        .filter((line) => line.startsWith('fpr:'))
        .map((line) => line.split(':')[9])
        .filter(Boolean);

      if (
        !fingerprints.includes(trustedNodeSourceFingerprint)
      ) {
        fail(
          'NodeSource repository signing key fingerprint mismatch.\n' +
          `Expected: ${trustedNodeSourceFingerprint}\n` +
          `Received: ${
            fingerprints.length
              ? fingerprints.join(', ')
              : 'none'
          }`
        );
      }

      console.log(
        `NodeSource key..... VERIFIED  ${trustedNodeSourceFingerprint}`
      );

      const dearmor = spawnSync(
        'gpg',
        [
          '--batch',
          '--yes',
          '--dearmor',
          '--output', keyring,
          downloadedKey
        ],
        {
          cwd: root,
          env: process.env,
          stdio: 'inherit',
          shell: false
        }
      );

      if (dearmor.error || dearmor.status !== 0) {
        fail(
          'Unable to create the authenticated NodeSource keyring.'
        );
      }

      runAsRoot('/usr/bin/install', [
        '-o', 'root',
        '-g', 'root',
        '-m', '0644',
        keyring,
        '/usr/share/keyrings/crylo-nodesource.gpg'
      ]);

      const dpkgArchitecture = probe(
        'dpkg',
        ['--print-architecture']
      );

      if (
        !dpkgArchitecture.ok ||
        !['arm64', 'amd64'].includes(dpkgArchitecture.stdout)
      ) {
        fail(
          'CryLo authenticated Node.js repository setup supports ' +
          `Debian arm64/amd64; found ${
            dpkgArchitecture.stdout || 'unknown'
          }.`
        );
      }

      const sourceLine =
        `deb [arch=${dpkgArchitecture.stdout} ` +
        'signed-by=/usr/share/keyrings/crylo-nodesource.gpg] ' +
        'https://deb.nodesource.com/node_24.x nodistro main\n';

      const sourceFile = path.join(
        tempDirectory,
        'crylo-nodesource.list'
      );

      fs.writeFileSync(
        sourceFile,
        sourceLine,
        {
          encoding: 'utf8',
          mode: 0o644
        }
      );

      runAsRoot('/usr/bin/install', [
        '-o', 'root',
        '-g', 'root',
        '-m', '0644',
        sourceFile,
        '/etc/apt/sources.list.d/crylo-nodesource.list'
      ]);

      console.log(
        'Refreshing package metadata with repository signature verification...'
      );

      runAsRoot('/usr/bin/apt-get', [
        'update'
      ]);

      runAsRoot('/usr/bin/apt-get', [
        'install',
        '-y',
        '--no-install-recommends',
        'nodejs'
      ]);
    } finally {
      try {
        fs.rmSync(
          tempDirectory,
          {
            recursive: true,
            force: true
          }
        );
      } catch (_) {
        // Temporary authenticated bootstrap cleanup is best effort.
      }
    }

    node = probe('node', ['--version']);
    nodeVersion = node.ok ? node.stdout : '';

    if (versionMajor(nodeVersion) < 24) {
      fail(
        'Node.js 24+ installation completed, but the active ' +
        `Node.js is still ${nodeVersion || 'unavailable'}.`
      );
    }
  }

  npm = probe('npm', ['--version']);
  npmVersion = npm.ok ? npm.stdout : '';

  if (versionMajor(npmVersion) < 12) {
    console.log(
      `npm ${npmVersion || 'not found'} does not meet ` +
      'the CryLo npm 12+ requirement.'
    );

    console.log('Installing/upgrading npm 12.x...');

    if (
      typeof process.getuid === 'function' &&
      process.getuid() === 0
    ) {
      run('npm', [
        'install',
        '--global',
        'npm@12'
      ]);
    } else {
      run('sudo', [
        'npm',
        'install',
        '--global',
        'npm@12'
      ]);
    }

    npm = probe('npm', ['--version']);
    npmVersion = npm.ok ? npm.stdout : '';

    if (versionMajor(npmVersion) < 12) {
      fail(
        'npm 12+ installation completed, but the active npm is still ' +
        `${npmVersion || 'unavailable'}.`
      );
    }
  }

  console.log(`Node.js........... OK  ${nodeVersion}`);
  console.log(`npm............... OK  ${npmVersion}`);
}

function ensureLinuxBuildDependencies() {
  if (process.platform !== 'linux') {
    return;
  }

  if (
    !fs.existsSync('/etc/debian_version') ||
    !fs.existsSync('/usr/bin/dpkg-query') ||
    !fs.existsSync('/usr/bin/apt-get')
  ) {
    fail(
      'Automatic CryLo Linux dependency preparation currently requires ' +
      'a Debian/Ubuntu-compatible system with dpkg and apt.'
    );
  }

  console.log('===== CRYLO LINUX BUILD ENVIRONMENT =====');
  console.log(`Architecture....... ${process.arch}`);

  const requiredPackages = [
    'build-essential',
    'ca-certificates',
    'cmake',
    'curl',
    'gnupg',
    'pkg-config',
    'python3',
    'protobuf-compiler',
    'libprotobuf-dev',
    'libusb-1.0-0-dev',
    'libhidapi-dev',
    'libudev-dev',
    'libzstd-dev',
    'nettle-dev',
    'libgmp-dev',
    'libminiupnpc-dev'
  ];

  let missingPackages = requiredPackages.filter(
    (packageName) => !installedDebianPackage(packageName)
  );

  if (missingPackages.length) {
    console.log(
      'Installing required CryLo build dependencies: ' +
      missingPackages.join(', ')
    );

    runAsRoot('/usr/bin/apt-get', [
      'install',
      '-y',
      '--no-install-recommends',
      ...missingPackages
    ]);

    missingPackages = requiredPackages.filter(
      (packageName) => !installedDebianPackage(packageName)
    );

    if (missingPackages.length) {
      fail(
        'Required CryLo build packages are still missing after installation: ' +
        missingPackages.join(', ')
      );
    }
  }

  console.log('APT packages....... OK');

  ensureLinuxNodeRuntime();

  const python = probe('python3', ['--version']);
  if (!python.ok) {
    fail('python3 is required for CryLo Trezor protobuf generation.');
  }
  console.log(`Python............. OK  ${python.stdout || python.stderr}`);

  const cmake = probe('cmake', ['--version']);
  if (!cmake.ok) {
    fail('cmake is required for the CryLo native build.');
  }
  console.log(
    `CMake.............. OK  ${
      cmake.stdout.split(/\r?\n/)[0]
    }`
  );

  const make = probe('make', ['--version']);
  if (!make.ok) {
    fail('make is required for the CryLo native build.');
  }
  console.log('make............... OK');

  const protoc = probe('protoc', ['--version']);
  if (!protoc.ok) {
    fail('protoc is required for CryLo Trezor support.');
  }
  console.log(`protoc............. OK  ${protoc.stdout}`);

  const pkgConfig = probe('pkg-config', ['--version']);
  if (!pkgConfig.ok) {
    fail('pkg-config is required for CryLo hardware-wallet checks.');
  }
  console.log(`pkg-config......... OK  ${pkgConfig.stdout}`);

  if (!probe('pkg-config', ['--exists', 'protobuf']).ok) {
    fail('The protobuf development library was not detected by pkg-config.');
  }
  console.log('Protobuf dev....... OK');

  if (!probe('pkg-config', ['--exists', 'libusb-1.0']).ok) {
    fail('LibUSB development support was not detected by pkg-config.');
  }
  console.log('LibUSB............. OK');

  const hidapiReady =
    probe('pkg-config', ['--exists', 'hidapi-hidraw']).ok ||
    probe('pkg-config', ['--exists', 'hidapi-libusb']).ok;

  if (!hidapiReady) {
    fail('HIDAPI development support was not detected by pkg-config.');
  }
  console.log('HIDAPI............. OK');

  console.log(
    `Build jobs......... ${
      process.arch === 'arm64'
        ? '1  (ARM64 safe mode)'
        : 'up to 2 by default on Linux x64'
    }`
  );

  console.log();
}

function installUserCommand() {
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA;

    if (!localAppData) {
      fail(
        'Unable to determine the current Windows user application directory.'
      );
    }

    const launcher = path.join(root, 'crylo.cmd');

    if (!fs.existsSync(launcher)) {
      fail(
        `CryLo Windows launcher was not found: ${launcher}`
      );
    }

    const commandDirectory = path.join(
      localAppData,
      'CryLo',
      'bin'
    );

    const commandPath = path.join(
      commandDirectory,
      'crylo.cmd'
    );

    fs.mkdirSync(
      commandDirectory,
      { recursive: true }
    );

    const marker = ':: CryLo managed launcher';

    if (fs.existsSync(commandPath)) {
      const existing = fs.readFileSync(
        commandPath,
        'utf8'
      );

      if (!existing.includes(marker)) {
        fail(
          `Cannot replace existing CryLo command: ${commandPath}`
        );
      }
    }

    const wrapper = [
      '@echo off',
      marker,
      `call "${launcher}" %*`,
      ''
    ].join('\r\n');

    fs.writeFileSync(
      commandPath,
      wrapper,
      'utf8'
    );

    const userPathResult = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '[Environment]::GetEnvironmentVariable("Path","User")'
      ],
      {
        cwd: root,
        env: process.env,
        encoding: 'utf8',
        shell: false
      }
    );

    if (
      userPathResult.error ||
      userPathResult.status !== 0
    ) {
      fail(
        'Unable to read the Windows user PATH.'
      );
    }

    const userPath = String(
      userPathResult.stdout || ''
    ).trim();

    const userEntries = userPath
      .split(';')
      .map((entry) => entry.trim())
      .filter(Boolean);

    const alreadyRegistered = userEntries.some(
      (entry) =>
        entry.toLowerCase() ===
        commandDirectory.toLowerCase()
    );

    if (!alreadyRegistered) {
      const updatedPath = userEntries.length
        ? `${userEntries.join(';')};${commandDirectory}`
        : commandDirectory;

      const pathUpdate = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `$value = [Environment]::GetEnvironmentVariable("CRYLO_USER_PATH_VALUE","Process"); ` +
            '[Environment]::SetEnvironmentVariable("Path",$value,"User")'
        ],
        {
          cwd: root,
          env: {
            ...process.env,
            CRYLO_USER_PATH_VALUE: updatedPath
          },
          stdio: 'inherit',
          shell: false
        }
      );

      if (
        pathUpdate.error ||
        pathUpdate.status !== 0
      ) {
        fail(
          'Unable to register CryLo in the Windows user PATH.'
        );
      }
    }

    console.log(
      `CryLo command registered: ${commandPath}`
    );

    if (!alreadyRegistered) {
      console.log(
        'Open a new terminal to use "crylo" from anywhere.'
      );
    }

    return;
  }

  const home = process.env.HOME;

  if (!home) {
    fail(
      'Unable to determine the current user home directory.'
    );
  }

  const launcher = path.join(root, 'crylo');

  if (!fs.existsSync(launcher)) {
    fail(
      `CryLo launcher was not found: ${launcher}`
    );
  }

  const candidates = [
    path.join(home, 'bin'),
    path.join(home, '.local', 'bin')
  ];

  const pathEntries = String(process.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean);

  let commandDirectory = candidates.find(
    (candidate) => pathEntries.includes(candidate)
  );

  if (!commandDirectory) {
    commandDirectory = path.join(home, '.local', 'bin');

    console.log(
      `NOTE: ${commandDirectory} is not currently in PATH.`
    );
  }

  fs.mkdirSync(
    commandDirectory,
    { recursive: true }
  );

  const commandPath = path.join(
    commandDirectory,
    'crylo'
  );

  let existing = null;

  try {
    existing = fs.lstatSync(commandPath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      fail(
        `Unable to inspect existing CryLo command: ${error.message}`
      );
    }
  }

  if (existing) {
    if (!existing.isSymbolicLink()) {
      fail(
        `Cannot register CryLo command because ${commandPath} ` +
        'already exists and is not a symbolic link.'
      );
    }

    const existingTarget = fs.readlinkSync(commandPath);
    const resolvedTarget = path.resolve(
      path.dirname(commandPath),
      existingTarget
    );

    if (resolvedTarget !== launcher) {
      fail(
        `Cannot replace existing CryLo command link: ${commandPath}`
      );
    }

    fs.unlinkSync(commandPath);
  }

  fs.symlinkSync(
    launcher,
    commandPath
  );

  console.log(
    `CryLo command registered: ${commandPath}`
  );

  if (!pathEntries.includes(commandDirectory)) {
    console.log(
      `Add ${commandDirectory} to PATH to run "crylo" from anywhere.`
    );
  }
}

function installLinuxDesktopLaunchers() {
  if (process.platform !== 'linux') {
    return;
  }

  const infrastructureServices = [
    'crylo-anchor.service',
    'crylo-relay.service'
  ];

  const infrastructureHost = infrastructureServices.some(
    (service) => probe(
      'systemctl',
      ['is-active', '--quiet', service]
    ).ok
  );

  if (infrastructureHost) {
    console.log(
      'Skipping desktop launchers on CryLo infrastructure host.'
    );
    return;
  }

  const home = process.env.HOME;

  if (!home) {
    fail(
      'Unable to determine the current user home directory ' +
      'for CryLo desktop launchers.'
    );
  }

  const electronDirectory = path.join(root, 'electron');
  const distDirectory = path.join(electronDirectory, 'dist');
  const sourceIcon = path.join(
    electronDirectory,
    'assets',
    'icon.png'
  );

  if (!fs.existsSync(sourceIcon)) {
    fail(`CryLo desktop icon was not found: ${sourceIcon}`);
  }

  if (!fs.existsSync(distDirectory)) {
    fail(
      `CryLo Electron release directory was not found: ${distDirectory}`
    );
  }

  const packageJson = JSON.parse(
    fs.readFileSync(
      path.join(
        electronDirectory,
        'package.json'
      ),
      'utf8'
    )
  );

  const canonicalAppImage = path.join(
    distDirectory,
    `CryLo-Wallet-${packageJson.version}-${process.arch}.AppImage`
  );

  let walletAppImage = null;

  /*
   * Official signed updates install the canonical hyphenated
   * AppImage name. Prefer it explicitly so the desktop launcher
   * cannot select a different local AppImage merely because its
   * modification time is newer.
   */
  if (fs.existsSync(canonicalAppImage)) {
    walletAppImage = canonicalAppImage;
  } else {
    const appImages = fs.readdirSync(distDirectory)
      .filter((name) => name.endsWith('.AppImage'))
      .filter((name) => {
        const lower = name.toLowerCase();

        if (process.arch === 'arm64') {
          return lower.includes('arm64');
        }

        return (
          !lower.includes('arm64') &&
          !lower.includes('aarch64')
        );
      })
      .map((name) => {
        const filePath = path.join(distDirectory, name);

        return {
          filePath,
          modified: fs.statSync(filePath).mtimeMs
        };
      })
      .sort((left, right) => right.modified - left.modified);

    if (!appImages.length) {
      fail(
        `No ${process.arch} CryLo Wallet AppImage was found in ` +
        `${distDirectory}.`
      );
    }

    walletAppImage = appImages[0].filePath;
  }

  fs.chmodSync(walletAppImage, 0o755);

  const localBin = path.join(home, '.local', 'bin');
  const applicationsDirectory = path.join(
    home,
    '.local',
    'share',
    'applications'
  );
  const iconsDirectory = path.join(
    home,
    '.local',
    'share',
    'icons',
    'hicolor',
    '512x512',
    'apps'
  );

  fs.mkdirSync(localBin, { recursive: true });
  fs.mkdirSync(applicationsDirectory, { recursive: true });
  fs.mkdirSync(iconsDirectory, { recursive: true });

  const walletIcon = path.join(
    iconsDirectory,
    'crylo-wallet.png'
  );
  const daemonIcon = path.join(
    iconsDirectory,
    'crylo-daemon.png'
  );

  fs.copyFileSync(sourceIcon, walletIcon);
  fs.copyFileSync(sourceIcon, daemonIcon);
  fs.chmodSync(walletIcon, 0o644);
  fs.chmodSync(daemonIcon, 0o644);

  const cryloCommandCandidates = [
    path.join(home, 'bin', 'crylo'),
    path.join(localBin, 'crylo')
  ];

  const cryloCommand = cryloCommandCandidates.find(
    (candidate) => fs.existsSync(candidate)
  );

  if (!cryloCommand) {
    fail(
      'CryLo command must be installed before desktop launchers. ' +
      `Checked: ${cryloCommandCandidates.join(', ')}`
    );
  }

  const daemonLauncher = path.join(
    path.dirname(cryloCommand),
    'crylo-daemon-launcher'
  );

  const shellQuote = (value) =>
    "'" + String(value).replace(/'/g, "'\\''") + "'";

  const daemonLauncherText = [
    '#!/usr/bin/env bash',
    'set +e',
    `CRYLO_COMMAND=${shellQuote(cryloCommand)}`,
    '"$CRYLO_COMMAND" start',
    'START_STATUS=$?',
    'echo',
    '"$CRYLO_COMMAND" status',
    'echo',
    'if [ "$START_STATUS" -ne 0 ]; then',
    '  echo "The CryLo daemon failed to start."',
    '  echo "Review the error and daemon log shown above."',
    '  echo',
    '  if [ -t 0 ]; then',
    '    while true; do',
    '      read -r -p "Type exit to close this window: " CRYLO_ACTION',
    '      if [ "$CRYLO_ACTION" = "exit" ]; then',
    '        exit "$START_STATUS"',
    '      fi',
    '      echo "Please type exit."',
    '    done',
    '  fi',
    '  exit "$START_STATUS"',
    'fi',
    'echo "The CryLo daemon is running in the background."',
    'echo',
    'if [ -t 0 ]; then',
    '  while true; do',
    '    echo "Type exit to close this window and leave the daemon running."',
    '    echo "Type crylo stop to stop the daemon."',
    '    read -r -p "> " CRYLO_ACTION',
    '    case "$CRYLO_ACTION" in',
    '      exit)',
    '        exit "$START_STATUS"',
    '        ;;',
    '      "crylo stop")',
    '        "$CRYLO_COMMAND" stop',
    '        echo',
    '        ;;',
    '      *)',
    '        echo "Please type exit or crylo stop."',
    '        echo',
    '        ;;',
    '    esac',
    '  done',
    'fi',
    'exit "$START_STATUS"',
    ''
  ].join('\n');

  fs.writeFileSync(
    daemonLauncher,
    daemonLauncherText,
    { encoding: 'utf8', mode: 0o755 }
  );
  fs.chmodSync(daemonLauncher, 0o755);

  const desktopExecQuote = (value) =>
    '"' + String(value)
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"') + '"';

  const walletDesktop = [
    '[Desktop Entry]',
    'Type=Application',
    'Version=1.0',
    'Name=CryLo Wallet',
    'Comment=Open the CryLo Wallet',
    `Exec=${desktopExecQuote(walletAppImage)}`,
    `Icon=${walletIcon}`,
    'Terminal=false',
    'Categories=Finance;',
    'StartupNotify=true',
    ''
  ].join('\n');

  const daemonDesktop = [
    '[Desktop Entry]',
    'Type=Application',
    'Version=1.0',
    'Name=CryLo Daemon',
    'Comment=Start the local CryLo Layer 1 daemon',
    `Exec=${desktopExecQuote(daemonLauncher)}`,
    `Icon=${daemonIcon}`,
    'Terminal=true',
    'Categories=Finance;',
    'StartupNotify=true',
    ''
  ].join('\n');

  const walletDesktopPath = path.join(
    applicationsDirectory,
    'crylo-wallet.desktop'
  );
  const daemonDesktopPath = path.join(
    applicationsDirectory,
    'crylo-daemon.desktop'
  );

  fs.writeFileSync(walletDesktopPath, walletDesktop, 'utf8');
  fs.writeFileSync(daemonDesktopPath, daemonDesktop, 'utf8');
  fs.chmodSync(walletDesktopPath, 0o755);
  fs.chmodSync(daemonDesktopPath, 0o755);

  const desktopProbe = probe(
    'xdg-user-dir',
    ['DESKTOP']
  );

  const desktopDirectory =
    desktopProbe.ok && desktopProbe.stdout
      ? desktopProbe.stdout
      : path.join(home, 'Desktop');

  fs.mkdirSync(desktopDirectory, { recursive: true });

  const desktopWalletPath = path.join(
    desktopDirectory,
    'CryLo Wallet.desktop'
  );
  const desktopDaemonPath = path.join(
    desktopDirectory,
    'CryLo Daemon.desktop'
  );

  fs.copyFileSync(walletDesktopPath, desktopWalletPath);
  fs.copyFileSync(daemonDesktopPath, desktopDaemonPath);
  fs.chmodSync(desktopWalletPath, 0o755);
  fs.chmodSync(desktopDaemonPath, 0o755);

  spawnSync(
    'gio',
    ['set', desktopWalletPath, 'metadata::trusted', 'true'],
    { stdio: 'ignore', shell: false }
  );

  spawnSync(
    'gio',
    ['set', desktopDaemonPath, 'metadata::trusted', 'true'],
    { stdio: 'ignore', shell: false }
  );

  spawnSync(
    'update-desktop-database',
    [applicationsDirectory],
    { stdio: 'ignore', shell: false }
  );

  console.log();
  console.log('CryLo desktop launchers installed:');
  console.log(`  CryLo Wallet: ${desktopWalletPath}`);
  console.log(`  CryLo Daemon: ${desktopDaemonPath}`);
}

function install() {
  console.log('===== CRYLO INSTALL =====');
  console.log(
    `Preparing CryLo for ${process.platform}/${process.arch}...`
  );
  console.log();

  ensureLinuxBuildDependencies();

  const result = spawnSync(
    process.execPath,
    [releaseScript],
    {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
      shell: false
    }
  );

  if (result.error) {
    fail(result.error.message);
  }

  if (result.status !== 0) {
    fail('CryLo installation build failed.');
  }

  const daemon = nativeDaemonPath();

  if (!fs.existsSync(daemon)) {
    fail(
      `CryLo release completed but the daemon was not found: ${daemon}`
    );
  }

  installUserCommand();
  installLinuxDesktopLaunchers();

  console.log();
  console.log('CryLo installation completed successfully.');
  console.log('Run "crylo start" to start CryLo.');
}

function start() {
  console.log('===== CRYLO START =====');

  if (runningDaemon()) {
    console.log('CryLo daemon is already running.');
    return;
  }

  const daemon = nativeDaemonPath();

  if (!fs.existsSync(daemon)) {
    fail(
      'CryLo is not installed yet. Run "crylo install" first.'
    );
  }

  const home =
    process.env.HOME ||
    process.env.USERPROFILE;

  if (!home) {
    fail(
      'Unable to determine the current user home directory.'
    );
  }

  const configRoot =
    process.platform === 'win32'
      ? path.join(
          process.env.APPDATA || path.join(home, 'AppData', 'Roaming'),
          'crylo-wallet'
        )
      : path.join(
          process.env.XDG_CONFIG_HOME || path.join(home, '.config'),
          'crylo-wallet'
        );

  const logDirectory = path.join(configRoot, 'logs');
  const daemonLog = path.join(logDirectory, 'daemon-background.log');

  const daemonArgs = [
    '--testnet',
    '--non-interactive',
    '--rpc-bind-ip',
    '127.0.0.1',
    '--rpc-bind-port',
    '22641',
    '--zmq-rpc-bind-ip',
    '127.0.0.1',
    '--zmq-rpc-bind-port',
    '22642',
    '--log-file',
    daemonLog,
    '--add-priority-node',
    network.entryRelay
  ];

  console.log(
    `Entry relay: ${network.entryRelay}`
  );

  console.log(
    `Daemon log: ${daemonLog}`
  );

  fs.mkdirSync(
    runtimeDirectory,
    { recursive: true }
  );

  fs.mkdirSync(
    logDirectory,
    { recursive: true }
  );

  const userSystemd =
    process.platform === 'linux' &&
    probe(
      'systemctl',
      ['--user', 'show-environment']
    ).ok;

  let childPid = null;

  if (userSystemd) {
    spawnSync(
      'systemctl',
      ['--user', 'stop', 'crylo-daemon.service'],
      { stdio: 'ignore', shell: false }
    );

    spawnSync(
      'systemctl',
      ['--user', 'reset-failed', 'crylo-daemon.service'],
      { stdio: 'ignore', shell: false }
    );

    const serviceStart = spawnSync(
      'systemd-run',
      [
        '--user',
        '--unit=crylo-daemon',
        '--collect',
        '--service-type=simple',
        '--setenv=TERM=dumb',
        '--property=Restart=on-failure',
        '--property=RestartSec=5s',
        `--property=WorkingDirectory=${root}`,
        '--',
        daemon,
        ...daemonArgs
      ],
      {
        cwd: root,
        env: process.env,
        stdio: 'inherit',
        shell: false
      }
    );

    if (
      serviceStart.error ||
      serviceStart.status !== 0
    ) {
      fail(
        'Unable to start the CryLo current-user daemon service.'
      );
    }
  } else {
    const daemonLogDescriptor = fs.openSync(
      daemonLog,
      'a'
    );

    const child = require('child_process').spawn(
      daemon,
      daemonArgs,
      {
        cwd: root,
        env: {
          ...process.env,
          TERM: 'dumb'
        },
        detached: true,
        stdio: [
          'ignore',
          daemonLogDescriptor,
          daemonLogDescriptor
        ],
        windowsHide: process.platform === 'win32',
        shell: false
      }
    );

    fs.closeSync(daemonLogDescriptor);

    if (!child.pid) {
      fail('CryLo daemon did not return a process ID.');
    }

    childPid = child.pid;
    child.unref();
  }

  const rpcProbeSource = [
    "const http = require('http');",
    "const body = JSON.stringify({",
    "  jsonrpc: '2.0',",
    "  id: '0',",
    "  method: 'get_info'",
    "});",
    "const request = http.request({",
    "  hostname: '127.0.0.1',",
    "  port: 22641,",
    "  path: '/json_rpc',",
    "  method: 'POST',",
    "  headers: {",
    "    'Content-Type': 'application/json',",
    "    'Content-Length': Buffer.byteLength(body)",
    "  },",
    "  timeout: 2000",
    "}, (response) => {",
    "  let data = '';",
    "  response.on('data', (chunk) => { data += chunk; });",
    "  response.on('end', () => {",
    "    try {",
    "      const parsed = JSON.parse(data);",
    "      process.exit(parsed.result && !parsed.error ? 0 : 1);",
    "    } catch (_) {",
    "      process.exit(1);",
    "    }",
    "  });",
    "});",
    "request.on('timeout', () => request.destroy());",
    "request.on('error', () => process.exit(1));",
    "request.write(body);",
    "request.end();"
  ].join('\n');

  const rpcReady = waitForProbe(
    () => {
      if (process.platform !== 'win32') {
        const response = probe(
          'curl',
          [
            '--fail',
            '--silent',
            '--max-time', '2',
            '-H', 'Content-Type: application/json',
            '-d',
            '{"jsonrpc":"2.0","id":"0","method":"get_info"}',
            'http://127.0.0.1:22641/json_rpc'
          ]
        );

        if (!response.ok) {
          return false;
        }

        try {
          const body = JSON.parse(response.stdout);

          return Boolean(
            body &&
            body.result &&
            !body.error
          );
        } catch (_) {
          return false;
        }
      }

      return probe(
        process.execPath,
        ['-e', rpcProbeSource]
      ).ok;
    },
    240
  );

  if (!rpcReady) {
    if (userSystemd) {
      spawnSync(
        'systemctl',
        ['--user', 'stop', 'crylo-daemon.service'],
        { stdio: 'ignore', shell: false }
      );
    } else if (childPid) {
      try {
        process.kill(childPid, 'SIGTERM');
      } catch (_) {
        // The failed daemon may already have exited.
      }
    }

    try {
      fs.unlinkSync(daemonPidFile);
    } catch (_) {
      // Nothing to clean up.
    }

    fail(
      'CryLo daemon did not make local RPC available on ' +
      '127.0.0.1:22641. ' +
      `Review the daemon log: ${daemonLog}`
    );
  }

  if (userSystemd) {
    const mainPid = probe(
      'systemctl',
      [
        '--user',
        'show',
        'crylo-daemon.service',
        '--property=MainPID',
        '--value'
      ]
    );

    if (
      !mainPid.ok ||
      !/^\d+$/.test(mainPid.stdout) ||
      mainPid.stdout === '0'
    ) {
      spawnSync(
        'systemctl',
        ['--user', 'stop', 'crylo-daemon.service'],
        { stdio: 'ignore', shell: false }
      );

      fail(
        'CryLo current-user daemon service did not report a valid process ID.'
      );
    }

    childPid = Number(mainPid.stdout);
  }

  fs.writeFileSync(
    daemonPidFile,
    `${childPid}\n`,
    'utf8'
  );

  console.log(
    'CryLo daemon started successfully and local RPC is ready.'
  );

  if (userSystemd) {
    console.log(
      'Background manager: current-user systemd service'
    );
  }
}

function stop() {
  console.log('===== CRYLO STOP =====');

  const userSystemd =
    process.platform === 'linux' &&
    probe(
      'systemctl',
      ['--user', 'show-environment']
    ).ok;

  if (
    userSystemd &&
    probe(
      'systemctl',
      ['--user', 'is-active', '--quiet', 'crylo-daemon.service']
    ).ok
  ) {
    const stopped = spawnSync(
      'systemctl',
      ['--user', 'stop', 'crylo-daemon.service'],
      {
        cwd: root,
        env: process.env,
        stdio: 'inherit',
        shell: false
      }
    );

    if (
      stopped.error ||
      stopped.status !== 0
    ) {
      fail(
        'Unable to stop the CryLo current-user daemon service.'
      );
    }

    try {
      fs.unlinkSync(daemonPidFile);
    } catch (_) {
      // No PID record to remove.
    }

    console.log('CryLo daemon stopped successfully.');
    return;
  }

  const daemon = runningDaemon();

  if (!daemon) {
    try {
      fs.unlinkSync(daemonPidFile);
    } catch (_) {
      // No stale PID file to remove.
    }

    console.log('CryLo daemon is not running.');
    return;
  }

  if (!fs.existsSync(daemonPidFile)) {
    fail(
      'A CryLo daemon is running, but it was not started by "crylo start". ' +
      'It was left running for safety.'
    );
  }

  const pidText = fs
    .readFileSync(daemonPidFile, 'utf8')
    .trim();

  if (!/^\d+$/.test(pidText)) {
    fail(
      'CryLo daemon PID file is invalid. ' +
      'The running daemon was left untouched.'
    );
  }

  const pid = Number(pidText);

  try {
    process.kill(pid, 0);
  } catch (_) {
    try {
      fs.unlinkSync(daemonPidFile);
    } catch (_) {
      // Nothing else to clean up.
    }

    fail(
      'The recorded CryLo daemon is no longer running. ' +
      'The stale PID record was removed.'
    );
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    fail(
      `Unable to stop the CryLo daemon: ${error.message}`
    );
  }

  let stopped = false;

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const wait = spawnSync(
      process.execPath,
      ['-e', 'setTimeout(() => {}, 250)'],
      {
        stdio: 'ignore',
        shell: false
      }
    );

    if (wait.error) {
      break;
    }

    try {
      process.kill(pid, 0);
    } catch (_) {
      stopped = true;
      break;
    }
  }

  if (!stopped) {
    fail(
      'CryLo daemon did not stop within 10 seconds. ' +
      'The PID record was preserved.'
    );
  }

  try {
    fs.unlinkSync(daemonPidFile);
  } catch (_) {
    // Nothing else to clean up.
  }

  console.log('CryLo daemon stopped successfully.');
}

function status() {
  console.log('===== CRYLO STATUS =====');

  const branch = probe(
    'git',
    ['branch', '--show-current']
  );

  const head = probe(
    'git',
    ['rev-parse', '--short=9', 'HEAD']
  );

  const workTree = probe(
    'git',
    ['status', '--porcelain']
  );

  console.log(
    `Platform: ${process.platform}/${process.arch}`
  );

  console.log(
    `Source: ${branch.stdout || 'unknown'} ` +
    `${head.stdout || 'unknown'}`
  );

  console.log(
    `Repository: ${
      workTree.ok && !workTree.stdout
        ? 'clean'
        : 'local changes present'
    }`
  );

  const native = expectedNativeBin();

  if (native) {
    const daemonPath = path.join(
      native.directory,
      native.daemon
    );

    const walletCliPath = path.join(
      native.directory,
      native.walletCli
    );

    const walletRpcPath = path.join(
      native.directory,
      native.walletRpc
    );

    const daemonVersion = binaryVersion(daemonPath);
    const walletCliVersion = binaryVersion(walletCliPath);
    const walletRpcVersion = binaryVersion(walletRpcPath);

    console.log();
    console.log('Universal release binaries:');

    console.log(
      `  Daemon: ${
        daemonVersion || 'not built'
      }`
    );

    console.log(
      `  Wallet: ${
        walletCliVersion || 'not built'
      }`
    );

    console.log(
      `  Wallet RPC: ${
        walletRpcVersion || 'not built'
      }`
    );

    console.log(
      `  Directory: ${native.directory}`
    );
  }

  const daemon = runningDaemon();

  console.log();
  console.log(
    `Daemon: ${daemon ? 'running' : 'not running'}`
  );

  if (daemon) {
    console.log(daemon);
  }
}

function help() {
  console.log(`
CryLo

Usage:
  crylo install       Install CryLo
  crylo update        Update CryLo
  crylo start         Start CryLo in the background
  crylo stop          Stop background CryLo
  crylo status        Show CryLo status
  crylo desktop       Install Wallet and Daemon desktop icons
  crylo release       Build a native CryLo release
  crylo --check       Check release build prerequisites
  crylo help          Show this help
`.trim());
}

const args = process.argv.slice(2);
const command = args[0] || 'help';

switch (command) {
  case 'help':
  case '--help':
  case '-h':
    help();
    break;

  case 'release':
    runNode(
      releaseScript,
      args.slice(1)
    );
    break;

  case '--check':
    runNode(
      releaseScript,
      ['--check']
    );
    break;

  case 'update':
    update();
    break;

  case 'status':
    status();
    break;

  case 'desktop':
    installUserCommand();
    installLinuxDesktopLaunchers();
    break;

  case 'install':
    install();
    break;

  case 'start':
    start();
    break;

  case 'stop':
    stop();
    break;

  default:
    fail(`Unknown CryLo command: ${command}`);
}
