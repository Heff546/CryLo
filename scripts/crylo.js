'use strict';

const fs = require('fs');
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
  entryRelay: 'relay-us-1.crylo.network:22640'
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

function update() {
  console.log('===== CRYLO UPDATE =====');

  const insideWorkTree = git(
    ['rev-parse', '--is-inside-work-tree'],
    true
  );

  if (insideWorkTree !== 'true') {
    fail('This CryLo installation is not a Git working tree.');
  }

  const status = git(
    ['status', '--porcelain'],
    true
  );

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

  if (
    upstreamResult.error ||
    upstreamResult.status !== 0
  ) {
    fail(
      `Branch "${branch}" does not have a configured upstream.`
    );
  }

  const upstream = String(
    upstreamResult.stdout || ''
  ).trim();

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

  git(['fetch', 'origin']);

  const remote = git(
    ['rev-parse', upstream],
    true
  );

  if (before === remote) {
    console.log();
    console.log('CryLo is already up to date.');
    return;
  }

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

  console.log('Updating CryLo source...');
  git(['merge', '--ff-only', upstream]);

  const after = git(
    ['rev-parse', 'HEAD'],
    true
  );

  console.log();
  console.log(`Updated CryLo: ${before.slice(0, 9)} -> ${after.slice(0, 9)}`);
  console.log();
  console.log('Building the updated native CryLo and Electron release...');

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
      'CryLo source was updated successfully, but the release build failed.'
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
    ['-eo', 'pid=,args=']
  );

  if (!result.ok) {
    return null;
  }

  const matches = result.stdout
    .split(/\r?\n/)
    .filter((line) =>
      line.includes('CryLo-daemon') &&
      !line.includes('scripts/crylo.js')
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

function ensureLinuxBuildDependencies() {
  if (process.platform !== 'linux') {
    return;
  }

  if (
    !fs.existsSync('/etc/debian_version') ||
    !fs.existsSync('/usr/bin/dpkg-query') ||
    !fs.existsSync('/usr/bin/apt-get')
  ) {
    console.log(
      'Automatic build dependency installation is not available ' +
      'for this Linux distribution.'
    );
    return;
  }

  const requiredPackages = [
    'libzstd-dev',
    'libusb-1.0-0-dev',
    'libudev-dev',
    'nettle-dev',
    'libgmp-dev'
  ];

  const missingPackages = requiredPackages.filter((packageName) => {
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
      result.error ||
      result.status !== 0 ||
      String(result.stdout || '').trim() !==
        'install ok installed'
    );
  });

  if (!missingPackages.length) {
    console.log('Linux build dependencies are ready.');
    return;
  }

  console.log(
    `Installing required CryLo build dependencies: ` +
    `${missingPackages.join(', ')}`
  );

  const installer =
    typeof process.getuid === 'function' &&
    process.getuid() === 0
      ? '/usr/bin/apt-get'
      : 'sudo';

  const installerArgs =
    installer === '/usr/bin/apt-get'
      ? [
          'install',
          '-y',
          '--no-install-recommends',
          ...missingPackages
        ]
      : [
          '/usr/bin/apt-get',
          'install',
          '-y',
          '--no-install-recommends',
          ...missingPackages
        ];

  const result = spawnSync(
    installer,
    installerArgs,
    {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
      shell: false
    }
  );

  if (result.error) {
    fail(
      `Unable to install CryLo build dependencies: ` +
      `${result.error.message}`
    );
  }

  if (result.status !== 0) {
    fail(
      'Required CryLo build dependency installation failed.'
    );
  }

  console.log('CryLo build dependencies installed successfully.');
  console.log();
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

  const daemonArgs = [
    '--testnet',
    '--add-priority-node',
    network.entryRelay
  ];

  console.log(
    `Entry relay: ${network.entryRelay}`
  );

  fs.mkdirSync(
    runtimeDirectory,
    { recursive: true }
  );

  const child = require('child_process').spawn(
    daemon,
    daemonArgs,
    {
      cwd: root,
      env: process.env,
      detached: true,
      stdio: 'ignore',
      windowsHide: process.platform === 'win32',
      shell: false
    }
  );

  if (!child.pid) {
    fail('CryLo daemon did not return a process ID.');
  }

  fs.writeFileSync(
    daemonPidFile,
    `${child.pid}\n`,
    'utf8'
  );

  child.unref();

  const started = (() => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
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

      if (runningDaemon()) {
        return true;
      }
    }

    return false;
  })();

  if (!started) {
    try {
      fs.unlinkSync(daemonPidFile);
    } catch (_) {
      // Nothing to clean up.
    }

    fail(
      'CryLo daemon did not remain running after startup.'
    );
  }

  console.log('CryLo daemon started successfully.');
}

function daemonUI() {
  console.log('===== CRYLO DAEMON UI =====');

  if (runningDaemon()) {
    fail(
      'CryLo daemon is already running. ' +
      'Stop it before opening the daemon UI.'
    );
  }

  const daemon = nativeDaemonPath();

  if (!fs.existsSync(daemon)) {
    fail(
      'CryLo is not installed yet. Run "crylo install" first.'
    );
  }

  const daemonArgs = [
    '--testnet',
    '--add-priority-node',
    network.entryRelay
  ];

  console.log(
    `Entry relay: ${network.entryRelay}`
  );
  console.log(
    'Starting CryLo daemon UI...'
  );
  console.log();

  const result = spawnSync(
    daemon,
    daemonArgs,
    {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
      shell: false
    }
  );

  if (result.error) {
    fail(
      `Unable to start the CryLo daemon UI: ${result.error.message}`
    );
  }

  if (
    result.status !== null &&
    result.status !== 0
  ) {
    fail(
      `CryLo daemon UI exited with code ${result.status}.`
    );
  }
}

function stop() {
  console.log('===== CRYLO STOP =====');

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
    // Daemon is already stopped.
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

    const walletRpcPath = path.join(
      native.directory,
      native.walletRpc
    );

    const daemonVersion = binaryVersion(daemonPath);
    const walletVersion = binaryVersion(walletRpcPath);

    console.log();
    console.log('Universal release binaries:');

    console.log(
      `  Daemon: ${
        daemonVersion || 'not built'
      }`
    );

    console.log(
      `  Wallet RPC: ${
        walletVersion || 'not built'
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
  crylo daemon UI     Start the CryLo daemon UI
  crylo stop          Stop background CryLo
  crylo status        Show CryLo status
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

  case 'install':
    install();
    break;

  case 'start':
    start();
    break;

  case 'daemon':
    if (args.length !== 2 || args[1] !== 'UI') {
      fail(
        'Unknown CryLo daemon command. Use "crylo daemon UI".'
      );
    }

    daemonUI();
    break;

  case 'stop':
    stop();
    break;

  default:
    fail(`Unknown CryLo command: ${command}`);
}
