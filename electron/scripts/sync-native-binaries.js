'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const {
  WINDOWS_BUILD_RUNTIME_MANIFEST,
  sha256,
  discoverWindowsBuildRuntime,
  writeWindowsBuildRuntimeManifest,
  windowsRuntimeDirectory,
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

  const text = `${result.stdout || ''}${result.stderr || ''}`.trim();
  return text.split(/\r?\n/)[0] || 'unknown';
}

function copyVerified(source, destination) {
  fs.copyFileSync(source, destination);

  const sourceHash = sha256(source);
  const destinationHash = sha256(destination);

  if (sourceHash !== destinationHash) {
    fail(`Copy verification failed for ${path.basename(source)}.`);
  }

  return destinationHash;
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
    `${platform} CryLo runtime staging must run on its native host. ` +
    `Current host: ${process.platform}; required: ${definition.host}.`
  );
}

if (platform === 'win' && requestedArch !== 'x64') {
  fail('Only Windows x64 is supported by the current CryLo release matrix.');
}

if (!['testnet', 'mainnet'].includes(network)) {
  fail(`Unsupported network: ${network}`);
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

const packagedNativeFiles = [
  definition.daemon,
  definition.walletRpc
];

const discoveryRootNames =
  platform === 'win'
    ? [
        definition.daemon,
        definition.walletCli,
        definition.walletRpc
      ]
    : packagedNativeFiles;

for (const name of discoveryRootNames) {
  const source = path.join(sourceDirectory, name);

  if (!fs.existsSync(source)) {
    fail(`Required native release file is missing: ${source}`);
  }

  const arch = execFileSync(
    process.execPath,
    [detector, source],
    { encoding: 'utf8' }
  ).trim();

  if (arch !== requestedArch) {
    fail(
      `${name} is ${arch}, but the requested Electron target is ` +
      `${requestedArch}.`
    );
  }
}

const mainJs = fs.readFileSync(
  path.join(electronDir, 'main.js'),
  'utf8'
);

if (network === 'testnet') {
  if (!mainJs.includes("'--testnet'")) {
    fail(
      'Testnet packaging refused: Electron main.js does not launch ' +
      'wallet-RPC with --testnet.'
    );
  }
} else if (network === 'mainnet') {
  if (mainJs.includes("'--testnet'")) {
    fail(
      'Mainnet packaging refused: Electron still launches wallet-RPC ' +
      'with --testnet.'
    );
  }
}

fs.mkdirSync(destinationDirectory, { recursive: true });

for (const entry of fs.readdirSync(destinationDirectory)) {
  if (
    entry.endsWith('.log') ||
    entry.includes('.old-') ||
    entry.includes('.before-') ||
    entry.endsWith('.bak') ||
    (
      platform === 'win' &&
      (
        entry.toLowerCase().endsWith('.dll') ||
        entry === 'CryLo-daemon.exe' ||
        entry === 'CryLo-wallet.exe' ||
        entry === 'CryLo-wallet-rpc.exe' ||
        entry === 'BINARY-MANIFEST.txt' ||
        entry === WINDOWS_BUILD_RUNTIME_MANIFEST
      )
    )
  ) {
    fs.rmSync(
      path.join(destinationDirectory, entry),
      { force: true, recursive: true }
    );
  }
}

if (platform === 'win') {
  let runtimeManifest;

  try {
    runtimeManifest = discoverWindowsBuildRuntime({
      rootFiles: discoveryRootNames.map((name) =>
        path.join(sourceDirectory, name)
      ),
      architecture: requestedArch,
      network
    });
  } catch (error) {
    fail(error.message);
  }

  runtimeManifest.gitCommit = execFileSync(
    'git',
    ['rev-parse', 'HEAD'],
    {
      cwd: root,
      encoding: 'utf8'
    }
  ).trim();

  const runtimeSourceDirectory = windowsRuntimeDirectory();

  for (const runtime of runtimeManifest.runtime) {
    const source = path.join(runtimeSourceDirectory, runtime.file);
    const destination = path.join(destinationDirectory, runtime.file);
    const copiedHash = copyVerified(source, destination);

    if (
      fs.statSync(destination).size !== runtime.size ||
      copiedHash !== runtime.sha256
    ) {
      fail(`Runtime DLL changed during staging: ${runtime.file}`);
    }

    console.log(
      `Synchronized runtime: ${runtime.file} ` +
      `[${runtime.package} ${runtime.packageVersion}]`
    );
  }

  const validationDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'crylo-win-runtime-verify-')
  );

  try {
    for (const name of discoveryRootNames) {
      copyVerified(
        path.join(sourceDirectory, name),
        path.join(validationDirectory, name)
      );
    }

    for (const runtime of runtimeManifest.runtime) {
      copyVerified(
        path.join(destinationDirectory, runtime.file),
        path.join(validationDirectory, runtime.file)
      );
    }

    const validationEnv = {
      ...process.env,
      PATH: isolatedWindowsPath(validationDirectory)
    };

    for (const rootEntry of runtimeManifest.roots) {
      const executable = path.join(validationDirectory, rootEntry.file);
      const version = runVersion(
        executable,
        {
          cwd: validationDirectory,
          env: validationEnv
        }
      );

      if (network === 'testnet' && !/testnet/i.test(version)) {
        fail(`${rootEntry.file} does not identify as Testnet.`);
      }

      if (network === 'mainnet' && /testnet/i.test(version)) {
        fail(`${rootEntry.file} identifies as Testnet during a Mainnet build.`);
      }

      rootEntry.version = version;
    }
  } finally {
    fs.rmSync(
      validationDirectory,
      { recursive: true, force: true }
    );
  }

  for (const name of packagedNativeFiles) {
    const source = path.join(sourceDirectory, name);
    const destination = path.join(destinationDirectory, name);

    copyVerified(source, destination);
    console.log(`Synchronized: ${name} [${requestedArch}]`);
  }

  const runtimeManifestPath = path.join(
    destinationDirectory,
    WINDOWS_BUILD_RUNTIME_MANIFEST
  );

  try {
    writeWindowsBuildRuntimeManifest(
      runtimeManifestPath,
      runtimeManifest
    );
  } catch (error) {
    fail(error.message);
  }

  const manifest = [];
  manifest.push('CryLo Electron win Binary Manifest');
  manifest.push(`Generated-UTC: ${new Date().toISOString()}`);
  manifest.push('Platform: win');
  manifest.push(`Architecture: ${requestedArch}`);
  manifest.push(`Network: ${network}`);
  manifest.push(
    `Runtime-Manifest: ${WINDOWS_BUILD_RUNTIME_MANIFEST}`
  );
  manifest.push(
    `Runtime-Manifest-SHA256: ${sha256(runtimeManifestPath)}`
  );
  manifest.push('');

  for (const name of packagedNativeFiles) {
    const destination = path.join(destinationDirectory, name);
    const rootEntry = runtimeManifest.roots.find(
      (entry) => entry.file === name
    );

    manifest.push(`File: ${name}`);
    manifest.push(`Size: ${fs.statSync(destination).size}`);
    manifest.push(`SHA256: ${sha256(destination)}`);
    manifest.push(`Version: ${rootEntry.version}`);
    manifest.push('');
  }

  const discoveryOnlyRoot = runtimeManifest.roots.find(
    (entry) => entry.file === definition.walletCli
  );

  if (discoveryOnlyRoot) {
    manifest.push(`Discovery-Root: ${discoveryOnlyRoot.file}`);
    manifest.push(`Size: ${discoveryOnlyRoot.size}`);
    manifest.push(`SHA256: ${discoveryOnlyRoot.sha256}`);
    manifest.push(`Version: ${discoveryOnlyRoot.version}`);
    manifest.push('');
  }

  manifest.push(
    `Windows-Runtime-DLL-Count: ${runtimeManifest.runtime.length}`
  );
  manifest.push('');

  fs.writeFileSync(
    path.join(destinationDirectory, 'BINARY-MANIFEST.txt'),
    `${manifest.join('\n')}\n`,
    'utf8'
  );

  console.log(
    fs.readFileSync(
      path.join(destinationDirectory, 'BINARY-MANIFEST.txt'),
      'utf8'
    )
  );

  process.exit(0);
}

const manifest = [];
manifest.push(`CryLo Electron ${platform} Binary Manifest`);
manifest.push(`Generated-UTC: ${new Date().toISOString()}`);
manifest.push(`Platform: ${platform}`);
manifest.push(`Architecture: ${requestedArch}`);
manifest.push(`Network: ${network}`);
manifest.push(`Source-Directory: ${sourceDirectory}`);
manifest.push('');

for (const name of packagedNativeFiles) {
  const source = path.join(sourceDirectory, name);
  const destination = path.join(destinationDirectory, name);

  const destinationHash = copyVerified(source, destination);
  const version = runVersion(destination);

  if (network === 'testnet' && !/testnet/i.test(version)) {
    fail(`${name} does not identify as Testnet.`);
  }

  if (network === 'mainnet' && /testnet/i.test(version)) {
    fail(`${name} identifies as Testnet during a Mainnet build.`);
  }

  manifest.push(`File: ${name}`);
  manifest.push(`Size: ${fs.statSync(destination).size}`);
  manifest.push(`SHA256: ${destinationHash}`);
  manifest.push(`Version: ${version}`);
  manifest.push('');

  console.log(`Synchronized: ${name} [${requestedArch}]`);
}

fs.writeFileSync(
  path.join(destinationDirectory, 'BINARY-MANIFEST.txt'),
  `${manifest.join('\n')}\n`,
  'utf8'
);

console.log(
  fs.readFileSync(
    path.join(destinationDirectory, 'BINARY-MANIFEST.txt'),
    'utf8'
  )
);
