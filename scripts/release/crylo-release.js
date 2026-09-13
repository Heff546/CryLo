'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..', '..');
const electronDir = path.join(root, 'electron');

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
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

console.log();
console.log('========================================');
console.log('       CRYLO RELEASE COMPLETE');
console.log('========================================');
console.log(`Platform: ${target.platform}/${target.arch}`);
console.log(`Native binaries: ${nativeBin}`);
console.log(`Electron artifacts: ${path.join(electronDir, 'dist')}`);