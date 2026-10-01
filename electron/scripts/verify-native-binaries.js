'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const {
  WINDOWS_BUILD_RUNTIME_MANIFEST,
  sha256,
  readWindowsBuildRuntimeManifest,
  detectPeArchitecture,
  isolatedWindowsPath
} = require('./windows-runtime-dlls');

const electronDir = path.resolve(__dirname, '..');
const root = path.resolve(electronDir, '..');

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function platformDefinition(platform) {
  if (platform === 'win') {
    return {
      host: 'win32',
      dir: 'win',
      daemon: 'CryLo-daemon.exe',
      walletCli: 'CryLo-wallet.exe',
      walletRpc: 'CryLo-wallet-rpc.exe'
    };
  }

  if (platform === 'mac') {
    return {
      host: 'darwin',
      dir: 'mac',
      daemon: 'CryLo-daemon',
      walletCli: null,
      walletRpc: 'CryLo-wallet-rpc'
    };
  }

  fail('Platform must be win or mac.');
}

function runVersion(binary, options = {}) {
  const result = spawnSync(binary, ['--version'], {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: 'utf8',
    timeout: 10000,
    shell: false,
    windowsHide: true
  });

  if (result.error || result.status !== 0) {
    const detail = (
      String(result.stdout || '') +
      String(result.stderr || '')
    ).trim();

    fail(
      `${path.basename(binary)} --version failed` +
      (detail ? `:\n${detail}` : '.')
    );
  }

  return (
    String(result.stdout || '') +
    String(result.stderr || '')
  ).trim();
}

const platform = process.argv[2];
const requestedArch = process.argv[3];
const network = process.env.CRYLO_NETWORK || 'testnet';

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

const destinationDirectory =
  platform === 'win'
    ? path.join(root, 'build', 'electron-runtime', definition.dir)
    : path.join(electronDir, 'bin', definition.dir);

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

const manifestText = fs.readFileSync(manifestPath, 'utf8');

if (!manifestText.includes(`Platform: ${platform}`)) {
  fail('Binary manifest platform is missing or incorrect.');
}

if (!manifestText.includes(`Architecture: ${requestedArch}`)) {
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

if (platform === 'win') {
  const runtimeManifestPath = path.join(
    destinationDirectory,
    WINDOWS_BUILD_RUNTIME_MANIFEST
  );

  if (!fs.existsSync(runtimeManifestPath)) {
    fail(`Windows build/runtime manifest is missing: ${runtimeManifestPath}`);
  }

  let runtimeManifest;

  try {
    runtimeManifest = readWindowsBuildRuntimeManifest(
      runtimeManifestPath,
      {
        architecture: requestedArch,
        network
      }
    );
  } catch (error) {
    fail(error.message);
  }

  const expectedRoots = [
    definition.daemon,
    definition.walletCli,
    definition.walletRpc
  ].sort();

  const actualRoots = runtimeManifest.roots
    .map((entry) => entry.file)
    .sort();

  if (JSON.stringify(actualRoots) !== JSON.stringify(expectedRoots)) {
    fail(
      'Windows build/runtime manifest does not describe the exact CryLo ' +
      'daemon, wallet CLI, and wallet-RPC root set.'
    );
  }

  for (const rootEntry of runtimeManifest.roots) {
    const source = path.join(sourceDirectory, rootEntry.file);

    if (!fs.existsSync(source)) {
      fail(`Windows runtime root is missing: ${source}`);
    }

    if (
      fs.statSync(source).size !== rootEntry.size ||
      sha256(source) !== rootEntry.sha256 ||
      detectPeArchitecture(source) !== requestedArch
    ) {
      fail(`Windows runtime root mismatch: ${rootEntry.file}`);
    }
  }

  const expectedDlls = new Set(
    runtimeManifest.runtime.map((entry) => entry.file.toLowerCase())
  );

  const stagedDlls = fs.readdirSync(destinationDirectory)
    .filter((entry) => entry.toLowerCase().endsWith('.dll'));

  for (const name of stagedDlls) {
    if (!expectedDlls.has(name.toLowerCase())) {
      fail(`Unexpected staged Windows runtime DLL: ${name}`);
    }
  }

  if (stagedDlls.length !== expectedDlls.size) {
    fail(
      `Windows runtime DLL count mismatch: staged=${stagedDlls.length}, ` +
      `manifest=${expectedDlls.size}`
    );
  }

  for (const runtime of runtimeManifest.runtime) {
    const destination = path.join(destinationDirectory, runtime.file);

    if (!fs.existsSync(destination)) {
      fail(`Missing staged runtime DLL: ${destination}`);
    }

    if (
      fs.statSync(destination).size !== runtime.size ||
      sha256(destination) !== runtime.sha256 ||
      detectPeArchitecture(destination) !== requestedArch
    ) {
      fail(`Staged Windows runtime DLL mismatch: ${runtime.file}`);
    }

    console.log(
      `OK: ${runtime.file} ` +
      `[${runtime.package} ${runtime.packageVersion}] ${runtime.sha256}`
    );
  }

  if (
    !manifestText.includes(
      `Runtime-Manifest-SHA256: ${sha256(runtimeManifestPath)}`
    )
  ) {
    fail('Binary manifest does not authenticate the Windows runtime manifest.');
  }

  const isolated = fs.mkdtempSync(
    path.join(os.tmpdir(), 'crylo-win-standalone-verify-')
  );

  try {
    for (const rootEntry of runtimeManifest.roots) {
      fs.copyFileSync(
        path.join(sourceDirectory, rootEntry.file),
        path.join(isolated, rootEntry.file)
      );
    }

    for (const runtime of runtimeManifest.runtime) {
      fs.copyFileSync(
        path.join(destinationDirectory, runtime.file),
        path.join(isolated, runtime.file)
      );
    }

    const isolatedEnv = {
      ...process.env,
      PATH: isolatedWindowsPath(isolated)
    };

    for (const rootEntry of runtimeManifest.roots) {
      const output = runVersion(
        path.join(isolated, rootEntry.file),
        {
          cwd: isolated,
          env: isolatedEnv
        }
      );

      if (network === 'testnet' && !/testnet/i.test(output)) {
        fail(`${rootEntry.file} does not identify as Testnet in isolation.`);
      }

      if (network === 'mainnet' && /testnet/i.test(output)) {
        fail(`${rootEntry.file} identifies as Testnet during a Mainnet build.`);
      }
    }
  } finally {
    fs.rmSync(
      isolated,
      { recursive: true, force: true }
    );
  }

  console.log(
    `Windows runtime closure verified: ${runtimeManifest.runtime.length} DLLs.`
  );
}

console.log(
  `${platform} binaries verified for ${requestedArch}.`
);
