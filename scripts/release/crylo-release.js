'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..', '..');
const electronDir = path.join(root, 'electron');

const packageJson = JSON.parse(
  fs.readFileSync(
    path.join(electronDir, 'package.json'),
    'utf8'
  )
);

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

function gitCapture(args) {
  const result = spawnSync(
    'git',
    args,
    {
      cwd: root,
      env: process.env,
      encoding: 'utf8',
      shell: false
    }
  );

  if (result.error || result.status !== 0) {
    fail(`git ${args.join(' ')} failed.`);
  }

  return String(result.stdout || '').trim();
}

function requireOfficialReleaseTag(releaseTag) {
  if (
    !/^v[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(releaseTag)
  ) {
    fail(`Invalid official release tag: ${releaseTag}`);
  }

  const status = gitCapture([
    'status',
    '--porcelain',
    '--untracked-files=all'
  ]);

  if (status) {
    fail('Official CryLo release builds require a clean Git tree.');
  }

  const objectType = gitCapture([
    'cat-file',
    '-t',
    releaseTag
  ]);

  if (objectType !== 'tag') {
    fail(
      `Official release tag ${releaseTag} must be an annotated Git tag.`
    );
  }

  const head = gitCapture([
    'rev-parse',
    'HEAD'
  ]);

  const taggedCommit = gitCapture([
    'rev-parse',
    `${releaseTag}^{}`
  ]);

  if (taggedCommit !== head) {
    fail(
      `Official release tag ${releaseTag} does not point to HEAD.\n` +
      `HEAD: ${head}\n` +
      `Tag:  ${taggedCommit}`
    );
  }

  console.log(
    `Official release tag... VERIFIED  ${releaseTag}`
  );

  console.log(
    `Official release commit VERIFIED  ${head}`
  );
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    env: options.env || process.env,
    stdio: 'inherit',
    shell: false
  });

  if (result.error) {
    fail(`${command}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function runCapture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    env: options.env || process.env,
    encoding: 'utf8',
    shell: false
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (result.error) {
    fail(`${command}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }

  return (
    String(result.stdout || '') +
    '\n' +
    String(result.stderr || '')
  );
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    shell: false
  });

  if (result.error || result.status !== 0) {
    return null;
  }

  return String(result.stdout || '').trim();
}

function commandAvailable(command) {
  const probe =
    process.platform === 'win32'
      ? spawnSync(process.env.ComSpec || 'cmd.exe',
          ['/d', '/s', '/c', `where ${command} >nul 2>nul`],
          { shell: false })
      : spawnSync('sh',
          ['-c', `command -v "${command}" >/dev/null 2>&1`],
          { shell: false });

  return probe.status === 0;
}

function major(version) {
  const match = String(version || '').match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

function detectTarget() {
  const arch = process.arch;

  if (!['x64', 'arm64'].includes(arch)) {
    fail(`Unsupported architecture: ${arch}`);
  }

  switch (process.platform) {
    case 'win32':
      if (arch !== 'x64') {
        fail('Only Windows x64 is currently supported.');
      }

      return {
        platform: 'win',
        arch,
        buildTag: 'win-x64',
        buildDir: path.join(root, 'build', 'win-x64'),
        daemon: 'CryLo-daemon.exe',
        walletCli: 'CryLo-wallet.exe',
        walletRpc: 'CryLo-wallet-rpc.exe'
      };

    case 'linux':
      return {
        platform: 'linux',
        arch,
        buildTag: arch === 'arm64' ? 'linux-armv8' : 'linux-x64',
        buildDir: path.join(root, 'build', `linux-${arch}`),
        daemon: 'CryLo-daemon',
        walletCli: 'CryLo-wallet',
        walletRpc: 'CryLo-wallet-rpc'
      };

    case 'darwin':
      return {
        platform: 'mac',
        arch,
        buildTag: arch === 'arm64' ? 'mac-arm64' : 'mac-x64',
        buildDir: path.join(root, 'build', `mac-${arch}`),
        daemon: 'CryLo-daemon',
        walletCli: 'CryLo-wallet',
        walletRpc: 'CryLo-wallet-rpc'
      };

    default:
      fail(`Unsupported operating system: ${process.platform}`);
  }
}

function findWindowsBash() {
  const candidates = [
    process.env.CRYLO_MSYS2_BASH,
    'C:\\msys64\\usr\\bin\\bash.exe',
    'C:\\tools\\msys64\\usr\\bin\\bash.exe'
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  fail(
    'MSYS2 was not found. Install the CryLo Windows build prerequisites ' +
    'or set CRYLO_MSYS2_BASH to the MSYS2 bash.exe path.'
  );
}

function toMsysPath(value) {
  const resolved = path.resolve(value);
  const match = resolved.match(/^([A-Za-z]):\\(.*)$/);

  if (!match) {
    return resolved.replace(/\\/g, '/');
  }

  return `/${match[1].toLowerCase()}/${match[2].replace(/\\/g, '/')}`;
}

function verifyPrerequisites(target) {
  const nodeVersion = process.version;
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

  const minimumNodeMajor =
    target.platform === 'linux'
      ? 24
      : 20;

  const minimumNpmMajor =
    target.platform === 'linux'
      ? 12
      : 9;

  if (major(nodeVersion) < minimumNodeMajor) {
    fail(
      `Node.js ${minimumNodeMajor} or newer is required for ` +
      `${target.platform}. Found ${nodeVersion}.`
    );
  }

  if (!commandAvailable(npmCommand)) {
    fail('npm was not found.');
  }

  const npmVersion =
    process.platform === 'win32'
      ? capture(process.env.ComSpec || 'cmd.exe',
          ['/d', '/s', '/c', 'npm.cmd --version'])
      : capture('npm', ['--version']);

  if (major(npmVersion) < minimumNpmMajor) {
    fail(
      `npm ${minimumNpmMajor} or newer is required for ` +
      `${target.platform}. Found ${npmVersion || 'unknown'}.`
    );
  }

  console.log('===== CRYLO BUILD HOST =====');
  console.log(`Platform: ${target.platform}`);
  console.log(`Architecture: ${target.arch}`);
  console.log(`Node: ${nodeVersion}`);
  console.log(`npm: ${npmVersion}`);
  console.log(`CPU threads: ${os.cpus().length}`);

  if (target.platform === 'win') {
    const bash = findWindowsBash();
    console.log(`MSYS2: ${bash}`);
    console.log();
    return;
  }

  if (!commandAvailable('cmake')) {
    fail('cmake was not found.');
  }

  if (!commandAvailable('make')) {
    fail('make was not found.');
  }

  if (target.platform === 'linux') {
    if (!commandAvailable('python3')) {
      fail('python3 was not found. Trezor support requires Python 3.');
    }

    if (!commandAvailable('protoc')) {
      fail('protoc was not found. Trezor support requires protobuf-compiler.');
    }

    if (!commandAvailable('pkg-config')) {
      fail('pkg-config was not found.');
    }

    const protobufProbe = spawnSync(
      'pkg-config',
      ['--exists', 'protobuf'],
      { shell: false }
    );

    if (
      protobufProbe.error ||
      protobufProbe.status !== 0
    ) {
      fail('protobuf development support was not detected.');
    }

    const usbProbe = spawnSync(
      'pkg-config',
      ['--exists', 'libusb-1.0'],
      { shell: false }
    );

    if (usbProbe.status !== 0) {
      fail('LibUSB development support was not detected.');
    }

    const hidrawProbe = spawnSync(
      'pkg-config',
      ['--exists', 'hidapi-hidraw'],
      { shell: false }
    );

    const hidusbProbe = spawnSync(
      'pkg-config',
      ['--exists', 'hidapi-libusb'],
      { shell: false }
    );

    if (
      hidrawProbe.status !== 0 &&
      hidusbProbe.status !== 0
    ) {
      fail('HIDAPI development support was not detected.');
    }

    console.log('Python: ready');
    console.log(`protoc: ${capture('protoc', ['--version'])}`);
    console.log('Protobuf: ready');
    console.log('LibUSB: ready');
    console.log('HIDAPI: ready');
  }

  console.log();
}

function buildWindows(target, jobs) {
  const bash = findWindowsBash();

  const rootMsys = toMsysPath(root);
  const buildMsys = toMsysPath(target.buildDir);

  const script = `
set -e
export MSYSTEM=MINGW64
export PATH="/mingw64/bin:/usr/bin:$PATH"

command -v cmake >/dev/null || { echo "ERROR: cmake missing"; exit 1; }
command -v make >/dev/null || { echo "ERROR: make missing"; exit 1; }
command -v x86_64-w64-mingw32-gcc >/dev/null || {
  echo "ERROR: MinGW64 compiler missing"
  exit 1
}

mkdir -p "${buildMsys}"
cd "${buildMsys}"

cmake \
  -G "MSYS Makefiles" \
  -D STATIC=ON \
  -D ARCH="x86-64" \
  -D BUILD_64=ON \
  -D CMAKE_BUILD_TYPE=Release \
  -D BUILD_TAG="${target.buildTag}" \
  -D BUILD_TESTS=OFF \
  -D BUILD_DOCUMENTATION=OFF \
  -D BUILD_DEBUG_UTILITIES=OFF \
  -D USE_DEVICE_TREZOR=OFF \
  -D TREZOR_DEBUG=OFF \
  -D BUILD_GUI_DEPS=OFF \
  -D CMAKE_TOOLCHAIN_FILE="${rootMsys}/cmake/64-bit-toolchain.cmake" \
  -D MSYS2_FOLDER="$(cd / && pwd -W)" \
  "${rootMsys}"

cmake --build . \
  --parallel ${jobs} \
  --target daemon simplewallet wallet_rpc_server
`;

  run(bash, ['-lc', script]);
}

function buildUnix(target, jobs) {
  const trezorRequired = target.platform === 'linux';

  const args = [
    '-S', root,
    '-B', target.buildDir,
    '-D', 'STATIC=ON',
    '-D', `BUILD_TAG=${target.buildTag}`,
    '-D', 'BUILD_TESTS=OFF',
    '-D', 'BUILD_DOCUMENTATION=OFF',
    '-D', 'BUILD_DEBUG_UTILITIES=OFF',
    '-D', `USE_DEVICE_TREZOR=${trezorRequired ? 'ON' : 'OFF'}`,
    '-D', 'TREZOR_DEBUG=OFF',
    '-D', 'BUILD_GUI_DEPS=OFF',
    '-D', 'CMAKE_BUILD_TYPE=Release',
    '-D', 'BUILD_64=ON'
  ];

  if (target.arch === 'arm64') {
    args.push('-D', 'ARCH=armv8-a');

    if (target.platform === 'mac') {
      args.push('-D', 'CMAKE_OSX_ARCHITECTURES=arm64');
    }
  } else {
    args.push('-D', 'ARCH=x86-64');
  }

  if (trezorRequired) {
    const configureOutput = runCapture('cmake', args);

    if (!configureOutput.includes('Trezor support enabled')) {
      fail(
        'CryLo requires Trezor support on Linux, but CMake did not ' +
        'confirm "Trezor support enabled".'
      );
    }

    console.log('Trezor support.... ENABLED');
  } else {
    run('cmake', args);
  }

  run('cmake', [
    '--build', target.buildDir,
    '--parallel', String(jobs),
    '--target',
    'daemon',
    'simplewallet',
    'wallet_rpc_server'
  ]);
}

function verifyNativePair(target) {
  const bin = path.join(target.buildDir, 'bin');
  const daemon = path.join(bin, target.daemon);
  const walletCli = path.join(bin, target.walletCli);
  const walletRpc = path.join(bin, target.walletRpc);

  if (!fs.existsSync(daemon)) {
    fail(`Native daemon was not produced: ${daemon}`);
  }

  if (!fs.existsSync(walletCli)) {
    fail(`Native wallet CLI was not produced: ${walletCli}`);
  }

  if (!fs.existsSync(walletRpc)) {
    fail(`Native wallet-RPC was not produced: ${walletRpc}`);
  }

  return bin;
}

function packageElectron(target, nativeBin) {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

  const env = {
    ...process.env,
    CRYLO_RELEASE_BIN: nativeBin
  };

  if (process.platform === 'win32') {
    run(
      process.env.ComSpec || 'cmd.exe',
      ['/d', '/s', '/c', 'npm.cmd --prefix electron run build'],
      { env }
    );
  } else {
    run(
      npmCommand,
      ['--prefix', electronDir, 'run', 'build'],
      { env }
    );
  }
}

function createLinuxReleaseBundle(
  target,
  nativeBin,
  releaseTag
) {
  if (target.platform !== 'linux') {
    fail(
      'Official exact-artifact bundle creation is currently enabled ' +
      'for Linux only.'
    );
  }

  if (!commandAvailable('tar')) {
    fail(
      'tar is required to create the official CryLo Linux release bundle.'
    );
  }

  const appImageSource = path.join(
    electronDir,
    'dist',
    `CryLo Wallet-${packageJson.version}-${target.arch}.AppImage`
  );

  if (!fs.existsSync(appImageSource)) {
    fail(
      `Expected Electron AppImage was not produced: ${appImageSource}`
    );
  }

  const nativeFiles = [
    target.daemon,
    target.walletCli,
    target.walletRpc
  ];

  for (const file of nativeFiles) {
    const source = path.join(nativeBin, file);

    if (!fs.existsSync(source)) {
      fail(
        `Required official native release file is missing: ${source}`
      );
    }
  }

  const canonicalAppImage =
    `CryLo-Wallet-${packageJson.version}-${target.arch}.AppImage`;

  const bundleName =
    `CryLo-Release-${packageJson.version}-linux-${target.arch}.tar`;

  const bundlePath = path.join(
    electronDir,
    'dist',
    bundleName
  );

  const staging = fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      'crylo-official-release-'
    )
  );

  try {
    for (const file of nativeFiles) {
      const source = path.join(nativeBin, file);
      const destination = path.join(staging, file);

      fs.copyFileSync(source, destination);
      fs.chmodSync(destination, 0o755);
    }

    const stagedAppImage = path.join(
      staging,
      canonicalAppImage
    );

    fs.copyFileSync(
      appImageSource,
      stagedAppImage
    );

    fs.chmodSync(
      stagedAppImage,
      0o755
    );

    fs.rmSync(
      bundlePath,
      { force: true }
    );

    const entries = [
      target.daemon,
      target.walletCli,
      target.walletRpc,
      canonicalAppImage
    ].sort();

    run(
      'tar',
      [
        '--sort=name',
        '--format=ustar',
        '--owner=0',
        '--group=0',
        '--numeric-owner',
        '--mtime=1970-01-01T00:00:00Z',
        '-cf',
        bundlePath,
        ...entries
      ],
      {
        cwd: staging
      }
    );

    if (!fs.existsSync(bundlePath)) {
      fail(
        `Official CryLo release bundle was not created: ${bundlePath}`
      );
    }

    console.log();
    console.log(
      '===== OFFICIAL SIGNABLE RELEASE BUNDLE ====='
    );
    console.log(`Release tag: ${releaseTag}`);
    console.log(`Bundle: ${bundlePath}`);

    for (const entry of entries) {
      console.log(`  ${entry}`);
    }

    return bundlePath;
  } finally {
    fs.rmSync(
      staging,
      {
        recursive: true,
        force: true
      }
    );
  }
}

const officialReleaseTag =
  argument('--release-tag');

if (officialReleaseTag) {
  requireOfficialReleaseTag(
    officialReleaseTag
  );
}

const target = detectTarget();

const defaultJobs =
  target.platform === 'linux' && target.arch === 'arm64'
    ? 1
    : target.platform === 'linux' && target.arch === 'x64'
      ? Math.max(1, Math.min(2, os.cpus().length))
      : 1;

const requestedJobs =
  process.env.CRYLO_JOBS === undefined
    ? defaultJobs
    : Number(process.env.CRYLO_JOBS);

const jobs =
  Number.isInteger(requestedJobs) && requestedJobs > 0
    ? requestedJobs
    : defaultJobs;

verifyPrerequisites(target);

if (process.argv.includes('--check')) {
  console.log();
  console.log('CryLo build prerequisite check passed.');
  process.exit(0);
}

console.log();
console.log('===== BUILDING CRYLO NATIVE RELEASE =====');
console.log(`Build directory: ${target.buildDir}`);
console.log(`Parallel jobs: ${jobs}`);
console.log();

if (target.platform === 'win') {
  buildWindows(target, jobs);
} else {
  buildUnix(target, jobs);
}

const nativeBin = verifyNativePair(target);

console.log();
console.log('===== NATIVE RELEASE COMPLETE =====');
console.log(nativeBin);

console.log();
console.log('===== BUILDING MATCHING ELECTRON RELEASE =====');
packageElectron(target, nativeBin);

let officialBundle = null;

if (officialReleaseTag) {
  officialBundle = createLinuxReleaseBundle(
    target,
    nativeBin,
    officialReleaseTag
  );
}

console.log();
console.log('========================================');
console.log('       CRYLO RELEASE COMPLETE');
console.log('========================================');
console.log(`Platform: ${target.platform}/${target.arch}`);
console.log(`Native binaries: ${nativeBin}`);
console.log(`Electron artifacts: ${path.join(electronDir, 'dist')}`);

if (officialBundle) {
  console.log(
    `Official bundle: ${officialBundle}`
  );
}