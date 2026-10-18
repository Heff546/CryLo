'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..', '..');
const electronDir = path.join(root, 'electron');
const managedNodeVersion = '24.21.0';
const managedNpmVersion = '12.1.0';
const windowsOpenSSLVersion = '3.5.9';
const windowsOpenSSLSha256 =
  '603f5602e2eef00d77fbd429d34dcd5822bb301757a1bc9cdb24c670f1eb859a';
const windowsOpenSSLPatch = 'openssl-3.5.9-build-cleanup.patch';
const windowsOpenSSLPatchSha256 =
  '5e04f3cd27a246512a573ed865b0ddd1390ebe7d667b3b74dbadb44ab6488088';
const windowsOpenSSLBuildStampBase = [
  `version=${windowsOpenSSLVersion}`,
  `source_sha256=${windowsOpenSSLSha256}`,
  `patch_sha256=${windowsOpenSSLPatchSha256}`,
  'target=mingw64',
  'cflags=-pipe -O2',
  'arflags=cr',
  'tool_policy=target-prefixed-or-mingw64-binutils-v1'
].join('\n') + '\n';

const windowsSharedDependencyVersions = Object.freeze({
  'mingw-w64-x86_64-boost': '1.92.0',
  'mingw-w64-x86_64-protobuf': '36.2',
  'mingw-w64-x86_64-abseil-cpp': '20260526.0',
  'mingw-w64-x86_64-hidapi': '0.15.0',
  'mingw-w64-x86_64-libusb': '1.0.30',
  'mingw-w64-x86_64-zeromq': '4.3.5',
  'mingw-w64-x86_64-libsodium': '1.0.22',
  'mingw-w64-x86_64-unbound': '1.26.1',
  'mingw-w64-x86_64-libiconv': '1.19'
});

const windowsPlatformDependencyVersions = Object.freeze({
  'mingw-w64-x86_64-icu': '78.3'
});

const packageJson = JSON.parse(
  fs.readFileSync(
    path.join(electronDir, 'package.json'),
    'utf8'
  )
);

const releaseNetwork = process.env.CRYLO_NETWORK || 'testnet';

const {
  WINDOWS_BUILD_RUNTIME_MANIFEST,
  sha256: windowsRuntimeSha256,
  readWindowsBuildRuntimeManifest,
  detectPeArchitecture,
  isolatedWindowsPath
} = require('../../electron/scripts/windows-runtime-dlls');

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

function gitExecutable() {
  if (process.platform !== 'win32') {
    return 'git';
  }

  const runtimeText = String(
    process.env.CRYLO_GIT_RUNTIME || ''
  ).trim();

  if (!runtimeText) {
    fail(
      'CryLo Windows Git runtime is not declared. ' +
      'Run the release through crylo.cmd.'
    );
  }

  const localAppData = process.env.LOCALAPPDATA;

  if (!localAppData) {
    fail(
      'LOCALAPPDATA is unavailable for the managed CryLo Git runtime.'
    );
  }

  const trustedRoot = path.resolve(
    localAppData,
    'CryLo',
    'runtime'
  );

  const runtimeDirectory = path.resolve(
    runtimeText
  );

  let trustedReal;
  let runtimeReal;

  try {
    trustedReal = fs.realpathSync(trustedRoot);
    runtimeReal = fs.realpathSync(runtimeDirectory);
  } catch (error) {
    fail(
      `Unable to verify the managed CryLo Git runtime: ${error.message}`
    );
  }

  const trustedPrefix =
    trustedReal.toLowerCase() + path.sep;

  if (
    runtimeReal.toLowerCase() ===
      trustedReal.toLowerCase() ||
    !runtimeReal.toLowerCase().startsWith(
      trustedPrefix
    )
  ) {
    fail(
      'CryLo Windows Git runtime is outside the trusted ' +
      'CryLo user runtime directory.'
    );
  }

  const executable = path.join(
    runtimeReal,
    'cmd',
    'git.exe'
  );

  if (!fs.existsSync(executable)) {
    fail(
      `Managed CryLo Git executable is missing: ${executable}`
    );
  }

  return executable;
}

function windowsPowerShellExecutable() {
  if (process.platform !== 'win32') {
    return null;
  }

  const systemRoot =
    process.env.SystemRoot ||
    process.env.WINDIR ||
    'C:\\Windows';

  return path.join(
    systemRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  );
}

function gitCapture(args) {
  const result = spawnSync(
    gitExecutable(),
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

function expectedManagedRuntime(target) {
  if (target.platform === 'win') {
    const localAppData = process.env.LOCALAPPDATA;

    if (!localAppData) {
      fail('LOCALAPPDATA is required for the managed CryLo Windows runtime.');
    }

    return path.join(
      localAppData,
      'CryLo',
      'runtime',
      `node-v${managedNodeVersion}-win-x64`
    );
  }

  if (target.platform === 'linux') {
    const home = process.env.HOME;

    if (!home) {
      fail('HOME is required for the managed CryLo Linux runtime.');
    }

    return path.join(
      home,
      '.local',
      'share',
      'crylo',
      'runtime',
      `node-v${managedNodeVersion}-linux-${target.arch}`
    );
  }

  return null;
}

function managedNpmCli(target, runtimeDirectory) {
  if (target.platform === 'win') {
    return path.join(
      runtimeDirectory,
      'node_modules',
      'npm',
      'bin',
      'npm-cli.js'
    );
  }

  return path.join(
    runtimeDirectory,
    'lib',
    'node_modules',
    'npm',
    'bin',
    'npm-cli.js'
  );
}

function verifyManagedReleaseToolchain(target) {
  const expectedRuntime = path.resolve(
    expectedManagedRuntime(target)
  );
  const declaredRuntime = String(
    process.env.CRYLO_NODE_RUNTIME || ''
  ).trim();
  const launcher =
    target.platform === 'win'
      ? 'crylo.cmd release'
      : './crylo release';

  if (!declaredRuntime) {
    fail(
      `CryLo ${target.platform}/${target.arch} release builds must use ` +
      `the managed Node.js/npm runtime. Run "${launcher}".`
    );
  }

  const runtimeDirectory = path.resolve(declaredRuntime);

  if (runtimeDirectory !== expectedRuntime) {
    fail(
      'CryLo release runtime path mismatch.\n' +
      `Expected: ${expectedRuntime}\n` +
      `Actual:   ${runtimeDirectory}`
    );
  }

  const expectedNode =
    target.platform === 'win'
      ? path.join(runtimeDirectory, 'node.exe')
      : path.join(runtimeDirectory, 'bin', 'node');

  if (!fs.existsSync(expectedNode)) {
    fail(`Managed CryLo Node.js runtime is missing: ${expectedNode}`);
  }

  let activeNode;
  let managedNode;

  try {
    activeNode = fs.realpathSync(process.execPath);
    managedNode = fs.realpathSync(expectedNode);
  } catch (error) {
    fail(`Unable to verify the managed CryLo Node.js runtime: ${error.message}`);
  }

  if (activeNode !== managedNode) {
    fail(
      'CryLo release builder is not running from the managed Node.js runtime. ' +
      `Run "${launcher}".`
    );
  }

  if (process.version !== `v${managedNodeVersion}`) {
    fail(
      `CryLo release Node.js version mismatch. Expected ` +
      `v${managedNodeVersion}; found ${process.version}.`
    );
  }

  const npmCli = managedNpmCli(target, runtimeDirectory);

  if (!fs.existsSync(npmCli)) {
    fail(`Managed CryLo npm CLI is missing: ${npmCli}`);
  }

  const npmVersion = capture(
    process.execPath,
    [npmCli, '--version']
  );

  if (npmVersion !== managedNpmVersion) {
    fail(
      `CryLo release npm version mismatch. Expected ` +
      `${managedNpmVersion}; found ${npmVersion || 'unknown'}. ` +
      `Run "${launcher}" to repair the isolated runtime.`
    );
  }

  return {
    nodeVersion: process.version,
    npmVersion,
    npmCli,
    runtimeDirectory
  };
}


function linuxDependsContext(target) {
  if (target.platform !== 'linux') {
    fail('Linux depends context requested for a non-Linux target.');
  }

  const dependsDir = path.join(root, 'contrib', 'depends');
  const configGuess = path.join(dependsDir, 'config.guess');

  if (!fs.existsSync(configGuess)) {
    fail(`CryLo depends config.guess is missing: ${configGuess}`);
  }

  const guess = spawnSync(
    configGuess,
    [],
    {
      cwd: dependsDir,
      env: process.env,
      encoding: 'utf8',
      shell: false
    }
  );

  if (guess.error || guess.status !== 0) {
    fail('Unable to determine the CryLo Linux depends host triplet.');
  }

  const host = String(guess.stdout || '').trim();
  const expectedHost =
    target.arch === 'arm64' ? /^aarch64-/ : /^x86_64-/;

  if (!expectedHost.test(host)) {
    fail(
      `CryLo depends host triplet does not match ${target.arch}: ${host}`
    );
  }

  const prefix = path.join(dependsDir, host);

  return {
    dependsDir,
    host,
    prefix,
    toolchain: path.join(prefix, 'share', 'toolchain.cmake'),
    nativeProtoc: path.join(prefix, 'native', 'bin', 'protoc')
  };
}

function buildLinuxDepends(target, jobs) {
  const context = linuxDependsContext(target);

  console.log();
  console.log('===== BUILDING PINNED LINUX DEPENDS =====');
  console.log(`Depends host: ${context.host}`);
  console.log(`Depends prefix: ${context.prefix}`);
  console.log(`Parallel jobs: ${jobs}`);

  run(
    'make',
    [
      '-C', context.dependsDir,
      `HOST=${context.host}`,
      '-j', String(jobs)
    ]
  );

  const required = [
    context.toolchain,
    context.nativeProtoc,
    path.join(context.prefix, 'lib', 'libboost_filesystem.a'),
    path.join(context.prefix, 'lib', 'libcrypto.a'),
    path.join(context.prefix, 'lib', 'libssl.a'),
    path.join(context.prefix, 'lib', 'libzmq.a'),
    path.join(context.prefix, 'lib', 'libiconv.a'),
    path.join(context.prefix, 'lib', 'libunbound.a'),
    path.join(context.prefix, 'lib', 'libncurses.a'),
    path.join(context.prefix, 'lib', 'libtinfo.a'),
    path.join(context.prefix, 'lib', 'libreadline.a'),
    path.join(context.prefix, 'lib', 'libsodium.a'),
    path.join(context.prefix, 'lib', 'libprotobuf.a'),
    path.join(context.prefix, 'lib', 'libusb-1.0.a'),
    path.join(context.prefix, 'lib', 'libhidapi-libusb.a'),
    path.join(context.prefix, 'lib', 'libunwind.a')
  ];

  for (const file of required) {
    if (!fs.existsSync(file)) {
      fail(`Pinned CryLo Linux dependency is missing: ${file}`);
    }
  }

  console.log('Pinned Linux depends stack... VERIFIED');
  return context;
}

function verifyLinuxDependsConfigure(target, context, configureOutput) {
  const prefix = context.prefix;
  const cachePath = path.join(target.buildDir, 'CMakeCache.txt');

  if (!fs.existsSync(cachePath)) {
    fail(`Linux CMake cache was not produced: ${cachePath}`);
  }

  const cache = fs.readFileSync(cachePath, 'utf8');

  const requiredOutput = [
    `Found OpenSSL: ${path.join(prefix, 'lib', 'libcrypto.a')}`,
    `Found libunbound include (unbound.h) in ${path.join(prefix, 'include')}`,
    `Found Protobuf: ${context.nativeProtoc}`,
    `ZMQ_LIB: ${path.join(prefix, 'lib', 'libzmq.a')};${path.join(prefix, 'lib', 'libsodium.a')}`
  ];

  for (const fragment of requiredOutput) {
    if (!configureOutput.includes(fragment)) {
      fail(
        'Linux CMake configure did not confirm the pinned depends stack: ' +
        fragment
      );
    }
  }

  const requiredCache = [
    `CRYLO_NCURSES_LIBRARY:FILEPATH=${path.join(prefix, 'lib', 'libncurses.a')}`,
    `CRYLO_TINFO_LIBRARY:FILEPATH=${path.join(prefix, 'lib', 'libtinfo.a')}`,
    `UNBOUND_LIBRARIES:STRING=${path.join(prefix, 'lib', 'libunbound.a')}`
  ];

  for (const line of requiredCache) {
    if (!cache.includes(line)) {
      fail(`Linux CMake cache is not pinned as required: ${line}`);
    }
  }

  const forbiddenHostLibrary = new RegExp(
    '/usr/lib/[^\n; ]*(?:' +
    'libevent|libhogweed|libnettle|libgmp|libpgm|libnorm|' +
    'libgssapi|libminiupnpc|libz\\.a|libzstd\\.a|libncurses|libtinfo' +
    ')'
  );

  const combined = configureOutput + '\n' + cache;

  if (forbiddenHostLibrary.test(combined)) {
    fail(
      'Linux release configure attempted to use a forbidden host library ' +
      'instead of the pinned CryLo depends stack.'
    );
  }

  console.log('Linux pinned dependency configure... VERIFIED');
}

function windowsOpenSSLContext() {
  const prefix = path.join(
    root,
    'build',
    'windows-deps',
    `openssl-${windowsOpenSSLVersion}`
  );

  return {
    prefix,
    include: path.join(prefix, 'include'),
    crypto: path.join(prefix, 'lib', 'libcrypto.a'),
    ssl: path.join(prefix, 'lib', 'libssl.a'),
    header: path.join(prefix, 'include', 'openssl', 'opensslv.h'),
    stamp: path.join(prefix, '.crylo-openssl-build.txt'),
    source: path.join(
      root,
      'build',
      'windows-deps',
      'sources',
      `openssl-${windowsOpenSSLVersion}.tar.gz`
    ),
    work: path.join(
      root,
      'build',
      'windows-deps',
      'work',
      `openssl-${windowsOpenSSLVersion}`
    ),
    patch: path.join(
      root,
      'contrib',
      'depends',
      'patches',
      'openssl',
      windowsOpenSSLPatch
    ),
    recipe: path.join(
      root,
      'contrib',
      'depends',
      'packages',
      'openssl.mk'
    )
  };
}

function verifyWindowsDependencyVersions(bash) {
  const expected = {
    ...windowsSharedDependencyVersions,
    ...windowsPlatformDependencyVersions
  };

  const checks = Object.entries(expected)
    .map(([packageName, version]) => `${packageName}|${version}`)
    .join('\n');

  const script = `
set -e
export MSYSTEM=MINGW64
export PATH="/mingw64/bin:/usr/bin:$PATH"

normalize_pkg_version() {
  printf '%s' "$1" | sed -E 's/-[0-9]+$//'
}

while IFS='|' read -r package expected; do
  test -n "$package" || continue

  installed="$(pacman -Q "$package" 2>/dev/null | awk '{print $2}')" || {
    echo "ERROR: required Windows dependency is missing: $package"
    exit 1
  }

  upstream="$(normalize_pkg_version "$installed")"

  if test "$upstream" != "$expected"; then
    echo "ERROR: Windows dependency version mismatch: $package expected $expected found $installed"
    exit 1
  fi

  echo "VERIFIED: $package $installed"
done <<'CRYLO_DEPENDENCIES'
${checks}
CRYLO_DEPENDENCIES

verify_pc() {
  module="$1"
  expected="$2"
  actual="$(pkg-config --modversion "$module" 2>/dev/null)" || {
    echo "ERROR: required pkg-config module missing: $module"
    exit 1
  }

  case "$actual" in
    "$expected"|"$expected".0)
      ;;
    *)
      echo "ERROR: pkg-config version mismatch: $module expected $expected found $actual"
      exit 1
      ;;
  esac

  echo "VERIFIED: pkg-config $module $actual"
}

verify_pc protobuf 36.2
verify_pc hidapi 0.15.0
verify_pc libusb-1.0 1.0.30
verify_pc libzmq 4.3.5
verify_pc libsodium 1.0.22
verify_pc libunbound 1.26.1
verify_pc icu-i18n 78.3
`;

  runCapture(bash, ['-lc', script]);
}

function verifyWindowsOpenSSLRecipe(context) {
  if (!fs.existsSync(context.recipe)) {
    fail(`CryLo OpenSSL recipe is missing: ${context.recipe}`);
  }

  if (!fs.existsSync(context.patch)) {
    fail(`CryLo OpenSSL patch is missing: ${context.patch}`);
  }

  const recipe = fs.readFileSync(context.recipe, 'utf8');
  const requiredRecipeLines = [
    `$(package)_version=${windowsOpenSSLVersion}`,
    `$(package)_sha256_hash=${windowsOpenSSLSha256}`,
    `$(package)_patches=${windowsOpenSSLPatch}`,
    '$(package)_config_env=AR="$($(package)_ar)" ARFLAGS=$($(package)_arflags) RANLIB="$($(package)_ranlib)" CC="$($(package)_cc)"',
    '$(package)_config_opts=--prefix=$(host_prefix) --openssldir=$(host_prefix)/etc/openssl --libdir=lib',
    '$(package)_config_opts+=no-capieng',
    '$(package)_config_opts+=no-dso',
    '$(package)_config_opts+=no-dtls1',
    '$(package)_config_opts+=no-ec_nistp_64_gcc_128',
    '$(package)_config_opts+=no-gost',
    '$(package)_config_opts+=no-md2',
    '$(package)_config_opts+=no-rc5',
    '$(package)_config_opts+=no-rdrand',
    '$(package)_config_opts+=no-rfc3779',
    '$(package)_config_opts+=no-sctp',
    '$(package)_config_opts+=no-shared',
    '$(package)_config_opts+=no-ssl-trace',
    '$(package)_config_opts+=no-ssl3',
    '$(package)_config_opts+=no-tests',
    '$(package)_config_opts+=no-unit-test',
    '$(package)_config_opts+=no-weak-ssl-ciphers',
    '$(package)_config_opts+=no-zlib',
    '$(package)_config_opts+=no-zlib-dynamic',
    '$(package)_config_opts+=$($(package)_cflags) $($(package)_cppflags)',
    '$(package)_config_opts_x86_64_mingw32=mingw64',
    '$(MAKE) $($(package)_build_opts) build_libs',
    '$(MAKE) DESTDIR=$($(package)_staging_dir) install_sw',
    'rm -rf share bin etc'
  ];

  for (const line of requiredRecipeLines) {
    if (!recipe.includes(line)) {
      fail(`CryLo OpenSSL recipe mismatch: ${line}`);
    }
  }

  const patchHash = sha256File(context.patch);

  if (patchHash !== windowsOpenSSLPatchSha256) {
    fail(
      'CryLo OpenSSL patch SHA256 mismatch.\n' +
      `Expected: ${windowsOpenSSLPatchSha256}\n` +
      `Actual:   ${patchHash}`
    );
  }
}

function windowsOpenSSLToolchainStamp(bash) {
  const script = `
set -e
export MSYSTEM=MINGW64
export PATH="/mingw64/bin:/usr/bin:$PATH"

resolve_mingw_binutil() {
  preferred="$1"
  fallback="$2"

  if command -v "$preferred" >/dev/null 2>&1; then
    command -v "$preferred"
    return 0
  fi

  resolved="$(command -v "$fallback" 2>/dev/null || true)"

  case "$resolved" in
    /mingw64/bin/$fallback|/mingw64/bin/$fallback.exe)
      printf '%s\\n' "$resolved"
      return 0
      ;;
  esac

  echo "ERROR: $preferred is unavailable and $fallback is not the MSYS2 MinGW64 binutil" >&2
  return 1
}

CC_TOOL="$(command -v x86_64-w64-mingw32-gcc)"
AR_TOOL="$(resolve_mingw_binutil x86_64-w64-mingw32-ar ar)"
RANLIB_TOOL="$(resolve_mingw_binutil x86_64-w64-mingw32-ranlib ranlib)"

CC_VERSION="$(x86_64-w64-mingw32-gcc --version | sed -n '1p')"
AR_VERSION="$("$AR_TOOL" --version | sed -n '1p')"
RANLIB_VERSION="$("$RANLIB_TOOL" --version | sed -n '1p')"

printf 'cc_path=%s\\n' "$CC_TOOL"
printf 'cc_version=%s\\n' "$CC_VERSION"
printf 'ar_path=%s\\n' "$AR_TOOL"
printf 'ar_version=%s\\n' "$AR_VERSION"
printf 'ranlib_path=%s\\n' "$RANLIB_TOOL"
printf 'ranlib_version=%s\\n' "$RANLIB_VERSION"
`;

  const stamp = runCapture(bash, ['-lc', script]).trim();

  if (!stamp) {
    fail('Could not determine Windows OpenSSL toolchain identity.');
  }

  return stamp + '\n';
}

function windowsOpenSSLBuildStamp(toolchainStamp) {
  return windowsOpenSSLBuildStampBase + toolchainStamp;
}

function verifyInstalledWindowsOpenSSL(context, expectedStamp) {
  const required = [
    context.header,
    context.crypto,
    context.ssl,
    context.stamp
  ];

  if (required.some((file) => !fs.existsSync(file))) {
    return false;
  }

  const header = fs.readFileSync(context.header, 'utf8');

  if (
    !header.includes('# define OPENSSL_VERSION_MAJOR  3') ||
    !header.includes('# define OPENSSL_VERSION_MINOR  5') ||
    !header.includes('# define OPENSSL_VERSION_PATCH  9') ||
    !header.includes(`OPENSSL_VERSION_TEXT "OpenSSL ${windowsOpenSSLVersion} `)
  ) {
    return false;
  }

  if (fs.readFileSync(context.stamp, 'utf8') !== expectedStamp) {
    return false;
  }

  const stack = [context.prefix];

  while (stack.length > 0) {
    const current = stack.pop();

    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }

      if (/icu/i.test(entry.name)) {
        return false;
      }
    }
  }

  return true;
}

function buildWindowsPinnedOpenSSL(jobs) {
  const bash = findWindowsBash();
  const context = windowsOpenSSLContext();

  verifyWindowsOpenSSLRecipe(context);

  const toolchainStamp = windowsOpenSSLToolchainStamp(bash);
  const expectedStamp = windowsOpenSSLBuildStamp(toolchainStamp);

  if (verifyInstalledWindowsOpenSSL(context, expectedStamp)) {
    console.log(
      `Pinned Windows OpenSSL ${windowsOpenSSLVersion}... VERIFIED`
    );
    return context;
  }

  console.log();
  console.log('===== BUILDING PINNED WINDOWS OPENSSL =====');
  console.log(`Version: ${windowsOpenSSLVersion}`);
  console.log(`Prefix: ${context.prefix}`);
  console.log(`Parallel jobs: ${jobs}`);

  const rootMsys = toMsysPath(root);
  const prefixMsys = toMsysPath(context.prefix);
  const sourceMsys = toMsysPath(context.source);
  const workMsys = toMsysPath(context.work);
  const patchMsys = toMsysPath(context.patch);
  const sourceDirMsys = toMsysPath(path.dirname(context.source));
  const partMsys = `${sourceMsys}.part`;

  const script = `
set -e
export MSYSTEM=MINGW64
export PATH="/mingw64/bin:/usr/bin:$PATH"

for tool in curl perl tar patch sed awk sha256sum make x86_64-w64-mingw32-gcc ar ranlib; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "ERROR: required pinned OpenSSL build tool missing: $tool"
    exit 1
  }
done

resolve_mingw_binutil() {
  preferred="$1"
  fallback="$2"

  if command -v "$preferred" >/dev/null 2>&1; then
    command -v "$preferred"
    return 0
  fi

  resolved="$(command -v "$fallback" 2>/dev/null || true)"

  case "$resolved" in
    /mingw64/bin/$fallback|/mingw64/bin/$fallback.exe)
      printf '%s\n' "$resolved"
      return 0
      ;;
  esac

  echo "ERROR: $preferred is unavailable and $fallback is not the MSYS2 MinGW64 binutil" >&2
  return 1
}

AR_TOOL="$(resolve_mingw_binutil x86_64-w64-mingw32-ar ar)" || exit 1
RANLIB_TOOL="$(resolve_mingw_binutil x86_64-w64-mingw32-ranlib ranlib)" || exit 1

echo "OpenSSL AR: $AR_TOOL"
echo "OpenSSL RANLIB: $RANLIB_TOOL"

mkdir -p "${sourceDirMsys}"
rm -rf "${workMsys}"
rm -rf "${prefixMsys}"

if test -f "${sourceMsys}"; then
  current_sha="$(sha256sum "${sourceMsys}" | awk '{print $1}')"
  if test "$current_sha" != "${windowsOpenSSLSha256}"; then
    rm -f "${sourceMsys}"
  fi
fi

if test ! -f "${sourceMsys}"; then
  rm -f "${partMsys}"
  curl \\
    --silent \\
    --show-error \\
    --fail \\
    --location \\
    --proto '=https' \\
    --tlsv1.2 \\
    --retry 3 \\
    --retry-delay 2 \\
    --output "${partMsys}" \\
    "https://www.openssl.org/source/openssl-${windowsOpenSSLVersion}.tar.gz"

  downloaded_sha="$(sha256sum "${partMsys}" | awk '{print $1}')"
  if test "$downloaded_sha" != "${windowsOpenSSLSha256}"; then
    echo "ERROR: downloaded OpenSSL source SHA256 mismatch"
    rm -f "${partMsys}"
    exit 1
  fi

  mv "${partMsys}" "${sourceMsys}"
fi

final_sha="$(sha256sum "${sourceMsys}" | awk '{print $1}')"
if test "$final_sha" != "${windowsOpenSSLSha256}"; then
  echo "ERROR: pinned OpenSSL source SHA256 mismatch"
  exit 1
fi

mkdir -p "${workMsys}"
tar -xzf "${sourceMsys}" -C "${workMsys}" --strip-components=1
cd "${workMsys}"

patch -p1 < "${patchMsys}"

sed -i.old \\
  's|crypto ssl apps util tools fuzz providers doc|crypto ssl util tools providers|' \\
  build.info

export CC="x86_64-w64-mingw32-gcc"
export AR="$AR_TOOL"
export ARFLAGS="cr"
export RANLIB="$RANLIB_TOOL"

./Configure \\
  mingw64 \\
  --prefix="${prefixMsys}" \\
  --openssldir="${prefixMsys}/etc/openssl" \\
  --libdir=lib \\
  no-capieng \\
  no-dso \\
  no-dtls1 \\
  no-ec_nistp_64_gcc_128 \\
  no-gost \\
  no-md2 \\
  no-rc5 \\
  no-rdrand \\
  no-rfc3779 \\
  no-sctp \\
  no-shared \\
  no-ssl-trace \\
  no-ssl3 \\
  no-tests \\
  no-unit-test \\
  no-weak-ssl-ciphers \\
  no-zlib \\
  no-zlib-dynamic \\
  -pipe \\
  -O2

make -j${jobs} build_libs
make install_sw

rm -rf \\
  "${prefixMsys}/share" \\
  "${prefixMsys}/bin" \\
  "${prefixMsys}/etc"
`;

  run(bash, ['-lc', script]);

  fs.writeFileSync(context.stamp, expectedStamp, 'utf8');

  if (!verifyInstalledWindowsOpenSSL(context, expectedStamp)) {
    fail(
      `Pinned Windows OpenSSL ${windowsOpenSSLVersion} did not install correctly.`
    );
  }

  console.log(
    `Pinned Windows OpenSSL ${windowsOpenSSLVersion}... BUILT AND VERIFIED`
  );

  return context;
}

function verifyWindowsOpenSSLConfigure(target, context, configureOutput) {
  const cachePath = path.join(target.buildDir, 'CMakeCache.txt');

  if (!fs.existsSync(cachePath)) {
    fail(`Windows CMake cache was not produced: ${cachePath}`);
  }

  const cache = fs.readFileSync(cachePath, 'utf8');
  const normalize = (value) => path.resolve(value).replace(/\\/g, '/');
  const prefix = normalize(context.prefix);
  const cryptoLibrary = normalize(context.crypto);
  const sslLibrary = normalize(context.ssl);
  const includeDirectory = normalize(context.include);

  if (
    !configureOutput.includes('Found OpenSSL:') ||
    !configureOutput.includes(`(found version "${windowsOpenSSLVersion}")`)
  ) {
    fail(
      `Windows CMake did not confirm OpenSSL ${windowsOpenSSLVersion}.`
    );
  }

  const combined = (configureOutput + '\n' + cache).replace(/\\/g, '/');

  for (const required of [
    cryptoLibrary,
    sslLibrary,
    includeDirectory
  ]) {
    if (!combined.includes(required)) {
      fail(`Windows CMake did not bind to pinned OpenSSL path: ${required}`);
    }
  }

  const msysOpenSSL = /OPENSSL_(?:CRYPTO_LIBRARY|SSL_LIBRARY|INCLUDE_DIR)[^\n]*C:\/msys64\/mingw64/i;

  if (msysOpenSSL.test(combined)) {
    fail('Windows CMake selected MSYS2 OpenSSL instead of CryLo OpenSSL.');
  }

  if (!combined.includes(prefix)) {
    fail('Windows CMake cache does not contain the CryLo OpenSSL root.');
  }

  console.log(
    `Windows pinned OpenSSL ${windowsOpenSSLVersion} configure... VERIFIED`
  );
}

function verifyPrerequisites(target) {
  let nodeVersion = process.version;
  let npmVersion;

  if (
    target.platform === 'win' ||
    target.platform === 'linux'
  ) {
    const managed = verifyManagedReleaseToolchain(target);
    nodeVersion = managed.nodeVersion;
    npmVersion = managed.npmVersion;
  } else {
    const npmCommand = 'npm';

    if (major(nodeVersion) < 20) {
      fail(
        `Node.js 20 or newer is required for ${target.platform}. ` +
        `Found ${nodeVersion}.`
      );
    }

    if (!commandAvailable(npmCommand)) {
      fail('npm was not found.');
    }

    npmVersion = capture(npmCommand, ['--version']);

    if (major(npmVersion) < 9) {
      fail(
        `npm 9 or newer is required for ${target.platform}. ` +
        `Found ${npmVersion || 'unknown'}.`
      );
    }
  }

  console.log('===== CRYLO BUILD HOST =====');
  console.log(`Platform: ${target.platform}`);
  console.log(`Architecture: ${target.arch}`);
  console.log(`Node: ${nodeVersion}`);
  console.log(`npm: ${npmVersion}`);
  console.log(`CPU threads: ${os.cpus().length}`);

  if (target.platform === 'win') {
    const bash = findWindowsBash();

    const windowsPrereqScript = `
set -e
export MSYSTEM=MINGW64
export PATH="/mingw64/bin:/usr/bin:$PATH"

command -v pacman >/dev/null || {
  echo "ERROR: MSYS2 pacman missing"
  exit 1
}

command -v pkg-config >/dev/null || {
  echo "ERROR: pkg-config missing"
  exit 1
}

command -v cmake >/dev/null || { echo "ERROR: cmake missing"; exit 1; }
command -v make >/dev/null || { echo "ERROR: make missing"; exit 1; }
command -v x86_64-w64-mingw32-gcc >/dev/null || {
  echo "ERROR: MinGW64 compiler missing"
  exit 1
}
command -v python3 >/dev/null || {
  echo "ERROR: python3 missing; Trezor support requires Python 3"
  exit 1
}
command -v protoc >/dev/null || {
  echo "ERROR: protoc missing; Trezor support requires protobuf-compiler"
  exit 1
}
command -v curl >/dev/null || { echo "ERROR: curl missing"; exit 1; }
command -v perl >/dev/null || { echo "ERROR: perl missing"; exit 1; }
command -v tar >/dev/null || { echo "ERROR: tar missing"; exit 1; }
command -v patch >/dev/null || { echo "ERROR: patch missing"; exit 1; }
command -v sha256sum >/dev/null || { echo "ERROR: sha256sum missing"; exit 1; }
command -v ar >/dev/null || { echo "ERROR: ar missing"; exit 1; }
command -v ranlib >/dev/null || { echo "ERROR: ranlib missing"; exit 1; }
`;

    runCapture(
      bash,
      ['-lc', windowsPrereqScript]
    );

    verifyWindowsDependencyVersions(bash);
    verifyWindowsOpenSSLRecipe(windowsOpenSSLContext());

    console.log(`MSYS2: ${bash}`);
    console.log('CMake: ready');
    console.log('Make: ready');
    console.log('MinGW64: ready');
    console.log('Python: ready');
    console.log('protoc: ready');
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

    if (!commandAvailable('pkg-config')) {
      fail('pkg-config was not found.');
    }

    if (!commandAvailable('gcc') || !commandAvailable('g++')) {
      fail('GCC/G++ were not found for the native Linux depends build.');
    }

    const depends = linuxDependsContext(target);

    console.log('Python: ready');
    console.log('pkg-config: ready');
    console.log('GCC/G++: ready');
    console.log(`Depends host: ${depends.host}`);
    console.log(
      'Protobuf/LibUSB/HIDAPI: pinned by contrib/depends'
    );
  }

  if (target.platform === 'mac') {
    if (!commandAvailable('python3')) {
      fail('python3 was not found. Trezor support requires Python 3.');
    }

    if (!commandAvailable('protoc')) {
      fail('protoc was not found. Trezor support requires protobuf-compiler.');
    }

    console.log('Python: ready');
    console.log(`protoc: ${capture('protoc', ['--version'])}`);
    console.log('Trezor CMake prerequisites: preflight ready');
  }

  console.log();
}

function buildWindows(target, jobs) {
  const bash = findWindowsBash();
  const openSSL = buildWindowsPinnedOpenSSL(jobs);

  fs.rmSync(
    target.buildDir,
    { recursive: true, force: true }
  );

  const rootMsys = toMsysPath(root);
  const buildMsys = toMsysPath(target.buildDir);
  const openSSLMsys = toMsysPath(openSSL.prefix);

  const configureScript = `
set -e
export MSYSTEM=MINGW64
export PATH="/mingw64/bin:/usr/bin:$PATH"

command -v cmake >/dev/null || { echo "ERROR: cmake missing"; exit 1; }
command -v make >/dev/null || { echo "ERROR: make missing"; exit 1; }
command -v x86_64-w64-mingw32-gcc >/dev/null || {
  echo "ERROR: MinGW64 compiler missing"
  exit 1
}
command -v python3 >/dev/null || {
  echo "ERROR: python3 missing; Trezor support requires Python 3"
  exit 1
}
command -v protoc >/dev/null || {
  echo "ERROR: protoc missing; Trezor support requires protobuf-compiler"
  exit 1
}

mkdir -p "${buildMsys}"
cd "${buildMsys}"

OPENSSL_ROOT_WIN="$(cygpath -m "${openSSLMsys}")"
MSYS2_ROOT_WIN="$(cd / && pwd -W)"

cmake \\
  -G "MSYS Makefiles" \\
  -D STATIC=ON \\
  -D ARCH="x86-64" \\
  -D BUILD_64=ON \\
  -D CMAKE_BUILD_TYPE=Release \\
  -D BUILD_TAG="${target.buildTag}" \\
  -D BUILD_TESTS=OFF \\
  -D BUILD_DOCUMENTATION=OFF \\
  -D BUILD_DEBUG_UTILITIES=OFF \\
  -D USE_DEVICE_TREZOR=ON \\
  -D USE_DEVICE_TREZOR_LIBUSB=ON \\
  -D TREZOR_DEBUG=OFF \\
  -D BUILD_GUI_DEPS=OFF \\
  -D CRYLO_WINDOWS_OPENSSL_ROOT="$OPENSSL_ROOT_WIN" \\
  -D OPENSSL_ROOT_DIR="$OPENSSL_ROOT_WIN" \\
  -D OPENSSL_USE_STATIC_LIBS=TRUE \\
  -D CMAKE_TOOLCHAIN_FILE="${rootMsys}/cmake/64-bit-toolchain.cmake" \\
  -D MSYS2_FOLDER="$MSYS2_ROOT_WIN" \\
  "${rootMsys}"
`;

  const configureOutput = runCapture(
    bash,
    ['-lc', configureScript]
  );

  if (!configureOutput.includes('Trezor support enabled')) {
    fail(
      'CryLo requires Trezor support on Windows x64, but CMake did not ' +
      'confirm "Trezor support enabled".'
    );
  }

  console.log('Trezor support.... ENABLED');

  verifyWindowsOpenSSLConfigure(
    target,
    openSSL,
    configureOutput
  );

  const buildScript = `
set -e
export MSYSTEM=MINGW64
export PATH="/mingw64/bin:/usr/bin:$PATH"
cd "${buildMsys}"

cmake --build . \\
  --parallel ${jobs} \\
  --target daemon simplewallet wallet_rpc_server
`;

  run(bash, ['-lc', buildScript]);
}

function buildUnix(target, jobs) {
  const trezorRequired =
    target.platform === 'linux' || target.platform === 'mac';

  let linuxDepends = null;

  if (target.platform === 'linux') {
    linuxDepends = buildLinuxDepends(target, jobs);

    fs.rmSync(
      target.buildDir,
      { recursive: true, force: true }
    );
  }

  const args = [
    '-S', root,
    '-B', target.buildDir,
    '-D', 'STATIC=ON',
    '-D', `BUILD_TAG=${target.buildTag}`,
    '-D', 'BUILD_TESTS=OFF',
    '-D', 'BUILD_DOCUMENTATION=OFF',
    '-D', 'BUILD_DEBUG_UTILITIES=OFF',
    '-D', `USE_DEVICE_TREZOR=${trezorRequired ? 'ON' : 'OFF'}`,
    '-D', `USE_DEVICE_TREZOR_LIBUSB=${trezorRequired ? 'ON' : 'OFF'}`,
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

  if (linuxDepends) {
    args.push(
      '-D',
      `CMAKE_TOOLCHAIN_FILE=${linuxDepends.toolchain}`
    );
  }

  if (trezorRequired) {
    const configureOutput = runCapture('cmake', args);

    if (!configureOutput.includes('Trezor support enabled')) {
      fail(
        `CryLo requires Trezor support on ${target.platform}/${target.arch}, ` +
        'but CMake did not confirm "Trezor support enabled".'
      );
    }

    console.log('Trezor support.... ENABLED');

    if (linuxDepends) {
      verifyLinuxDependsConfigure(
        target,
        linuxDepends,
        configureOutput
      );
    }
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

  if (target.platform === 'win') {
    env.CRYLO_WINDOWS_RUNTIME_DLL_DIR = windowsMingwBin();
  }

  if (process.platform === 'win32') {
    const runtimeDirectory = path.resolve(
      String(process.env.CRYLO_NODE_RUNTIME || '')
    );
    const npmCli = managedNpmCli(target, runtimeDirectory);

    run(
      process.execPath,
      [npmCli, '--prefix', electronDir, 'run', 'build'],
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

  const runtimeStaging = path.join(
    root,
    'build',
    'electron-runtime',
    'win'
  );

  const runtimeManifestSource = path.join(
    runtimeStaging,
    WINDOWS_BUILD_RUNTIME_MANIFEST
  );

  const binaryManifestSource = path.join(
    runtimeStaging,
    'BINARY-MANIFEST.txt'
  );

  if (!fs.existsSync(runtimeManifestSource)) {
    fail(
      `Windows build/runtime manifest is missing: ${runtimeManifestSource}`
    );
  }

  if (!fs.existsSync(binaryManifestSource)) {
    fail(
      `Windows binary manifest is missing: ${binaryManifestSource}`
    );
  }

  let runtimeManifest;

  try {
    runtimeManifest = readWindowsBuildRuntimeManifest(
      runtimeManifestSource,
      {
        architecture: target.arch,
        network: releaseNetwork
      }
    );
  } catch (error) {
    fail(error.message);
  }

  const releaseCommit = gitCapture(['rev-parse', 'HEAD']);

  if (runtimeManifest.gitCommit !== releaseCommit) {
    fail(
      `Windows build/runtime manifest commit mismatch.\n` +
      `Manifest: ${runtimeManifest.gitCommit}\n` +
      `HEAD:     ${releaseCommit}`
    );
  }

  const expectedRoots = [...nativeFiles].sort();
  const manifestRoots = runtimeManifest.roots
    .map((entry) => entry.file)
    .sort();

  if (JSON.stringify(expectedRoots) !== JSON.stringify(manifestRoots)) {
    fail(
      'Windows build/runtime manifest does not describe the exact ' +
      'official native release root set.'
    );
  }

  for (const rootEntry of runtimeManifest.roots) {
    const source = path.join(nativeBin, rootEntry.file);

    if (
      fs.statSync(source).size !== rootEntry.size ||
      sha256File(source) !== rootEntry.sha256 ||
      detectPeArchitecture(source) !== target.arch
    ) {
      fail(
        `Windows build/runtime manifest root mismatch: ${rootEntry.file}`
      );
    }
  }

  for (const runtime of runtimeManifest.runtime) {
    const source = path.join(runtimeStaging, runtime.file);

    if (!fs.existsSync(source)) {
      fail(`Required staged Windows runtime DLL is missing: ${source}`);
    }

    if (
      fs.statSync(source).size !== runtime.size ||
      windowsRuntimeSha256(source) !== runtime.sha256 ||
      detectPeArchitecture(source) !== target.arch
    ) {
      fail(`Staged Windows runtime DLL mismatch: ${runtime.file}`);
    }
  }

  const binaryManifestText = fs.readFileSync(
    binaryManifestSource,
    'utf8'
  );

  if (
    !binaryManifestText.includes(
      `Runtime-Manifest-SHA256: ${sha256File(runtimeManifestSource)}`
    )
  ) {
    fail(
      'Windows binary manifest does not authenticate the build/runtime manifest.'
    );
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

    for (const runtime of runtimeManifest.runtime) {
      const source = path.join(runtimeStaging, runtime.file);
      const destination = path.join(staging, runtime.file);

      fs.copyFileSync(source, destination);

      if (
        fs.statSync(destination).size !== runtime.size ||
        sha256File(destination) !== runtime.sha256
      ) {
        fail(
          `Windows runtime DLL changed during official staging: ${runtime.file}`
        );
      }
    }

    fs.copyFileSync(
      runtimeManifestSource,
      path.join(staging, WINDOWS_BUILD_RUNTIME_MANIFEST)
    );

    fs.copyFileSync(
      binaryManifestSource,
      path.join(staging, 'BINARY-MANIFEST.txt')
    );

    fs.copyFileSync(
      installerSource,
      path.join(staging, canonicalInstaller)
    );

    const isolatedPath = isolatedWindowsPath(staging);

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

      if (
        releaseNetwork === 'testnet' &&
        !output.includes("CryLo Chain 'Testnet'")
      ) {
        fail(
          `Standalone Windows release verification returned an unexpected ` +
          `Testnet version for ${file}.`
        );
      }

      if (
        releaseNetwork === 'mainnet' &&
        /testnet/i.test(output)
      ) {
        fail(
          `Standalone Windows Mainnet release identifies as Testnet: ${file}.`
        );
      }
    }

    fs.rmSync(
      bundlePath,
      { force: true }
    );

    const powershell =
      windowsPowerShellExecutable();

    if (!fs.existsSync(powershell)) {
      fail(
        `Trusted Windows PowerShell executable was not found: ${powershell}`
      );
    }

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

    const entries = [
      ...nativeFiles,
      ...runtimeManifest.runtime.map((runtime) => runtime.file),
      WINDOWS_BUILD_RUNTIME_MANIFEST,
      'BINARY-MANIFEST.txt',
      canonicalInstaller
    ].sort();

    console.log();
    console.log(
      '===== OFFICIAL SIGNABLE RELEASE BUNDLE ====='
    );
    console.log(`Release tag: ${releaseTag}`);
    console.log(`Bundle: ${bundlePath}`);
    console.log(
      `Verified Windows runtime DLLs: ${runtimeManifest.runtime.length}`
    );

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
  } else {
    fail(
      'Official exact-artifact bundle creation is not yet enabled for macOS.'
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