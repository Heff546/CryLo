'use strict';

const crypto = require('crypto');
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

const windowsRuntimeDlls = [
  {
    file: 'libgcc_s_seh-1.dll',
    size: 150998,
    sha256: 'b37c1770c8ca092700875845b34918803ee6311573eba1c32ff4b1166e4a0e1e'
  },
  {
    file: 'libiconv-2.dll',
    size: 1143148,
    sha256: '7a282a854e01be726c6cccfe46f548c716aa45b3014818468253aaa4efbcd067'
  },
  {
    file: 'libicudt78.dll',
    size: 33120806,
    sha256: '60255653982986c9fb72ad1b10b8dc502e498d890e0218cb0a47bc5907aa4e43'
  },
  {
    file: 'libicuin78.dll',
    size: 3186867,
    sha256: 'c9bb34526709a81bfae231d4190f13adad0b4c63e345262f448aaa720291feec'
  },
  {
    file: 'libicuuc78.dll',
    size: 1999466,
    sha256: '27edc25710faa3489cd9cbd6cbc64c305b69ce5dbb9e0a29273d85e9badddde9'
  },
  {
    file: 'libstdc++-6.dll',
    size: 2661299,
    sha256: '887c21dbe2a211ac4d1a790e4f608b7dee27fae12352856963004e7a715d2e6c'
  },
  {
    file: 'libwinpthread-1.dll',
    size: 63875,
    sha256: '8d7a192a8fbbccb0cebeac272701f66a580f493eff2336739a96144119260723'
  }
];

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

      hash.update(buffer.subarray(0, count));
    }
  } finally {
    fs.closeSync(descriptor);
  }

  return hash.digest('hex');
}

function peMachine(file) {
  const descriptor = fs.openSync(file, 'r');

  try {
    const dosHeader = Buffer.alloc(64);
    const dosBytes = fs.readSync(
      descriptor,
      dosHeader,
      0,
      dosHeader.length,
      0
    );

    if (
      dosBytes !== dosHeader.length ||
      dosHeader[0] !== 0x4d ||
      dosHeader[1] !== 0x5a
    ) {
      fail(`Invalid Windows PE file: ${file}`);
    }

    const peOffset = dosHeader.readUInt32LE(0x3c);
    const peHeader = Buffer.alloc(6);
    const peBytes = fs.readSync(
      descriptor,
      peHeader,
      0,
      peHeader.length,
      peOffset
    );

    if (
      peBytes !== peHeader.length ||
      peHeader[0] !== 0x50 ||
      peHeader[1] !== 0x45 ||
      peHeader[2] !== 0x00 ||
      peHeader[3] !== 0x00
    ) {
      fail(`Invalid Windows PE signature: ${file}`);
    }

    return peHeader.readUInt16LE(4);
  } finally {
    fs.closeSync(descriptor);
  }
}

function windowsMingwBin() {
  const bash = findWindowsBash();
  const msysRoot = path.resolve(
    path.dirname(bash),
    '..',
    '..'
  );

  return path.join(
    msysRoot,
    'mingw64',
    'bin'
  );
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


function createWindowsReleaseBundle(
  target,
  nativeBin,
  releaseTag
) {
  if (
    target.platform !== 'win' ||
    target.arch !== 'x64'
  ) {
    fail(
      'Official Windows exact-artifact bundle creation supports win/x64 only.'
    );
  }

  const installerSource = path.join(
    electronDir,
    'dist',
    `CryLo Wallet Setup ${packageJson.version}.exe`
  );

  if (!fs.existsSync(installerSource)) {
    fail(
      `Expected Windows installer was not produced: ${installerSource}`
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

  const mingwBin = windowsMingwBin();

  for (const runtime of windowsRuntimeDlls) {
    const source = path.join(
      mingwBin,
      runtime.file
    );

    if (!fs.existsSync(source)) {
      fail(
        `Required pinned Windows runtime DLL is missing: ${source}`
      );
    }

    const stat = fs.statSync(source);

    if (stat.size !== runtime.size) {
      fail(
        `Pinned Windows runtime DLL size mismatch: ${runtime.file}\n` +
        `Expected: ${runtime.size}\n` +
        `Actual:   ${stat.size}`
      );
    }

    const actualHash = sha256File(source);

    if (actualHash !== runtime.sha256) {
      fail(
        `Pinned Windows runtime DLL SHA-256 mismatch: ${runtime.file}\n` +
        `Expected: ${runtime.sha256}\n` +
        `Actual:   ${actualHash}`
      );
    }

    if (peMachine(source) !== 0x8664) {
      fail(
        `Pinned Windows runtime DLL is not AMD64/x64: ${runtime.file}`
      );
    }
  }

  const canonicalInstaller =
    `CryLo-Wallet-Setup-${packageJson.version}-${target.arch}.exe`;

  const bundleName =
    `CryLo-Release-${packageJson.version}-win-${target.arch}.zip`;

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
      fs.copyFileSync(
        path.join(nativeBin, file),
        path.join(staging, file)
      );
    }

    for (const runtime of windowsRuntimeDlls) {
      const source = path.join(
        mingwBin,
        runtime.file
      );
      const destination = path.join(
        staging,
        runtime.file
      );

      fs.copyFileSync(
        source,
        destination
      );

      if (sha256File(destination) !== runtime.sha256) {
        fail(
          `Pinned Windows runtime DLL changed during staging: ${runtime.file}`
        );
      }
    }

    fs.copyFileSync(
      installerSource,
      path.join(staging, canonicalInstaller)
    );

    const systemRoot =
      process.env.SystemRoot ||
      process.env.WINDIR ||
      'C:\\Windows';

    const isolatedPath = [
      path.join(systemRoot, 'System32'),
      systemRoot
    ].join(';');

    for (const file of nativeFiles) {
      const executable = path.join(
        staging,
        file
      );

      const verification = spawnSync(
        executable,
        ['--version'],
        {
          cwd: staging,
          env: {
            ...process.env,
            PATH: isolatedPath
          },
          encoding: 'utf8',
          shell: false,
          windowsHide: true
        }
      );

      if (
        verification.error ||
        verification.status !== 0
      ) {
        fail(
          `Standalone Windows release verification failed for ${file}.`
        );
      }

      const output =
        String(verification.stdout || '') +
        String(verification.stderr || '');

      if (!output.includes("CryLo Chain 'Testnet'")) {
        fail(
          `Standalone Windows release verification returned an unexpected ` +
          `version for ${file}.`
        );
      }
    }

    fs.rmSync(
      bundlePath,
      { force: true }
    );

    const powershell = process.env.SystemRoot
      ? path.join(
          process.env.SystemRoot,
          'System32',
          'WindowsPowerShell',
          'v1.0',
          'powershell.exe'
        )
      : 'powershell.exe';

    const archiveEnvironment = {
      ...process.env,
      CRYLO_BUNDLE_SOURCE: staging,
      CRYLO_BUNDLE_DESTINATION: bundlePath
    };

    run(
      powershell,
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        [
          "$ErrorActionPreference = 'Stop'",
          "$source = $env:CRYLO_BUNDLE_SOURCE",
          "$destination = $env:CRYLO_BUNDLE_DESTINATION",
          "if (Test-Path -LiteralPath $destination) { Remove-Item -LiteralPath $destination -Force }",
          "Compress-Archive -Path (Join-Path $source '*') -DestinationPath $destination -CompressionLevel Optimal -Force"
        ].join('; ')
      ],
      {
        env: archiveEnvironment
      }
    );

    if (!fs.existsSync(bundlePath)) {
      fail(
        `Official CryLo Windows release bundle was not created: ${bundlePath}`
      );
    }

    console.log();
    console.log(
      '===== OFFICIAL SIGNABLE RELEASE BUNDLE ====='
    );
    console.log(`Release tag: ${releaseTag}`);
    console.log(`Bundle: ${bundlePath}`);

    for (const entry of [
      ...nativeFiles,
      ...windowsRuntimeDlls.map((runtime) => runtime.file),
      canonicalInstaller
    ].sort()) {
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

  const appImageFileName =
    target.arch === 'x64'
      ? `CryLo Wallet-${packageJson.version}.AppImage`
      : `CryLo Wallet-${packageJson.version}-${target.arch}.AppImage`;

  const appImageSource = path.join(
    electronDir,
    'dist',
    appImageFileName
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


function createMacReleaseBundle(
  target,
  nativeBin,
  releaseTag
) {
  if (
    target.platform !== 'mac' ||
    !['x64', 'arm64'].includes(target.arch)
  ) {
    fail(
      'Official macOS exact-artifact bundle creation supports mac/x64 and mac/arm64 only.'
    );
  }

  const tarCommand = '/usr/bin/tar';

  if (!fs.existsSync(tarCommand)) {
    fail(
      'The macOS tar utility is required to create the official CryLo release bundle.'
    );
  }

  const distDirectory = path.join(
    electronDir,
    'dist'
  );

  if (!fs.existsSync(distDirectory)) {
    fail(
      `Electron release directory was not produced: ${distDirectory}`
    );
  }

  const versionText =
    packageJson.version.toLowerCase();

  const dmgCandidates = fs.readdirSync(
    distDirectory
  )
    .filter((name) => name.toLowerCase().endsWith('.dmg'))
    .filter((name) => name.toLowerCase().includes(versionText))
    .filter((name) => {
      const lower = name.toLowerCase();

      if (target.arch === 'arm64') {
        return lower.includes('arm64');
      }

      return (
        !lower.includes('arm64') &&
        !lower.includes('aarch64')
      );
    });

  if (dmgCandidates.length !== 1) {
    fail(
      `Expected exactly one Electron DMG for mac/${target.arch}, found ` +
      `${dmgCandidates.length}: ${dmgCandidates.join(', ') || '(none)'}`
    );
  }

  const dmgSource = path.join(
    distDirectory,
    dmgCandidates[0]
  );

  const nativeFiles = [
    target.daemon,
    target.walletCli,
    target.walletRpc
  ];

  for (const file of nativeFiles) {
    const sourceFile = path.join(
      nativeBin,
      file
    );

    if (!fs.existsSync(sourceFile)) {
      fail(
        `Required official native release file is missing: ${sourceFile}`
      );
    }
  }

  const canonicalDmg =
    `CryLo-Wallet-${packageJson.version}-mac-${target.arch}.dmg`;

  const bundleName =
    `CryLo-Release-${packageJson.version}-mac-${target.arch}.tar`;

  const bundlePath = path.join(
    distDirectory,
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
      const sourceFile = path.join(
        nativeBin,
        file
      );

      const destination = path.join(
        staging,
        file
      );

      fs.copyFileSync(
        sourceFile,
        destination
      );

      fs.chmodSync(
        destination,
        0o755
      );
    }

    const stagedDmg = path.join(
      staging,
      canonicalDmg
    );

    fs.copyFileSync(
      dmgSource,
      stagedDmg
    );

    fs.chmodSync(
      stagedDmg,
      0o644
    );

    fs.rmSync(
      bundlePath,
      { force: true }
    );

    const entries = [
      target.daemon,
      target.walletCli,
      target.walletRpc,
      canonicalDmg
    ].sort();

    run(
      tarCommand,
      [
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
        `Official CryLo macOS release bundle was not created: ${bundlePath}`
      );
    }

    const listing = spawnSync(
      tarCommand,
      [
        '-tf',
        bundlePath
      ],
      {
        cwd: staging,
        env: process.env,
        encoding: 'utf8',
        shell: false
      }
    );

    if (
      listing.error ||
      listing.status !== 0
    ) {
      fail(
        'Unable to verify the official CryLo macOS release bundle.'
      );
    }

    const bundledEntries = String(
      listing.stdout || ''
    )
      .split(/\r?\n/)
      .filter(Boolean)
      .sort();

    if (
      bundledEntries.length !== entries.length ||
      bundledEntries.some(
        (entry, index) => entry !== entries[index]
      )
    ) {
      fail(
        'Official CryLo macOS release bundle contains unexpected entries.'
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
  if (target.platform === 'linux') {
    officialBundle = createLinuxReleaseBundle(
      target,
      nativeBin,
      officialReleaseTag
    );
  } else if (target.platform === 'win') {
    officialBundle = createWindowsReleaseBundle(
      target,
      nativeBin,
      officialReleaseTag
    );
  } else if (target.platform === 'mac') {
    officialBundle = createMacReleaseBundle(
      target,
      nativeBin,
      officialReleaseTag
    );
  } else {
    fail(
      `Official exact-artifact bundle creation is not enabled for ` +
      `${target.platform}/${target.arch}.`
    );
  }
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