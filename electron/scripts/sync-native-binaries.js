'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const windowsRuntimeDlls = require('./windows-runtime-dlls');

const electronDir = path.resolve(__dirname, '..');
const root = path.resolve(electronDir, '..');

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

function runVersion(binary) {
  const result = spawnSync(binary, ['--version'], {
    encoding: 'utf8',
    timeout: 10000
  });

  const text = `${result.stdout || ''}${result.stderr || ''}`.trim();
  return text.split(/\r?\n/)[0] || 'unknown';
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

const files = [
  definition.daemon,
  definition.walletRpc
];

function findWindowsRuntimeDirectory() {
  if (process.env.CRYLO_WINDOWS_RUNTIME_DLL_DIR) {
    return path.resolve(process.env.CRYLO_WINDOWS_RUNTIME_DLL_DIR);
  }

  const bashCandidates = [
    process.env.CRYLO_MSYS2_BASH,
    'C:\\msys64\\usr\\bin\\bash.exe',
    'C:\\tools\\msys64\\usr\\bin\\bash.exe'
  ].filter(Boolean);

  for (const bash of bashCandidates) {
    if (fs.existsSync(bash)) {
      return path.resolve(
        path.dirname(bash),
        '..',
        '..',
        'mingw64',
        'bin'
      );
    }
  }

  fail(
    'MSYS2 runtime DLL directory was not found. Set ' +
    'CRYLO_WINDOWS_RUNTIME_DLL_DIR or CRYLO_MSYS2_BASH.'
  );
}

const windowsRuntimeDirectory =
  platform === 'win'
    ? findWindowsRuntimeDirectory()
    : null;

for (const name of files) {
  const source = path.join(sourceDirectory, name);
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

if (platform === 'win') {
  for (const runtime of windowsRuntimeDlls) {
    const source = path.join(windowsRuntimeDirectory, runtime.file);

    if (!fs.existsSync(source)) {
      fail(`Required pinned Windows runtime DLL is missing: ${source}`);
    }

    if (fs.statSync(source).size !== runtime.size) {
      fail(`Pinned Windows runtime DLL size mismatch: ${runtime.file}`);
    }

    if (sha256(source) !== runtime.sha256) {
      fail(`Pinned Windows runtime DLL SHA-256 mismatch: ${runtime.file}`);
    }
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
} else {
  fail(`Unsupported network: ${network}`);
}

fs.mkdirSync(destinationDirectory, { recursive: true });

for (const entry of fs.readdirSync(destinationDirectory)) {
  if (
    entry.endsWith('.log') ||
    entry.includes('.old-') ||
    entry.includes('.before-') ||
    entry.endsWith('.bak')
  ) {
    fs.rmSync(
      path.join(destinationDirectory, entry),
      { force: true, recursive: true }
    );
  }
}

const manifest = [];
manifest.push(`CryLo Electron ${platform} Binary Manifest`);
manifest.push(`Generated-UTC: ${new Date().toISOString()}`);
manifest.push(`Platform: ${platform}`);
manifest.push(`Architecture: ${requestedArch}`);
manifest.push(`Network: ${network}`);
manifest.push(`Source-Directory: ${sourceDirectory}`);
manifest.push('');

for (const name of files) {
  const source = path.join(sourceDirectory, name);
  const destination = path.join(destinationDirectory, name);

  fs.copyFileSync(source, destination);

  const sourceHash = sha256(source);
  const destinationHash = sha256(destination);

  if (sourceHash !== destinationHash) {
    fail(`Copy verification failed for ${name}.`);
  }

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

if (platform === 'win') {
  manifest.push(`Runtime-DLL-Directory: ${windowsRuntimeDirectory}`);
  manifest.push('');

  for (const runtime of windowsRuntimeDlls) {
    const source = path.join(windowsRuntimeDirectory, runtime.file);
    const destination = path.join(destinationDirectory, runtime.file);

    fs.copyFileSync(source, destination);

    const destinationHash = sha256(destination);
    if (
      fs.statSync(destination).size !== runtime.size ||
      destinationHash !== runtime.sha256
    ) {
      fail(`Copy verification failed for pinned runtime DLL ${runtime.file}.`);
    }

    manifest.push(`File: ${runtime.file}`);
    manifest.push(`Size: ${runtime.size}`);
    manifest.push(`SHA256: ${runtime.sha256}`);
    manifest.push('Pinned-Windows-Runtime: yes');
    manifest.push('');

    console.log(`Synchronized pinned runtime: ${runtime.file}`);
  }
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
