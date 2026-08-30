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
      label: 'Canonical Anchor'
    },
    {
      service: 'crylo-relay.service',
      label: 'Public Relay'
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

  const { service, label } = role;

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

  if (probe('cmp', ['-s', source, target]).ok) {
    console.log(
      `${label} already runs the current daemon binary.`
    );
    return;
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
        'http://127.0.0.1:22641/json_rpc'
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

  const remoteBranch = upstream.slice('origin/'.length);

  git([
    'fetch',
    'origin',
    `+refs/heads/${remoteBranch}:refs/remotes/${upstream}`
  ]);

  const remote = git(
    ['rev-parse', upstream],
    true
  );

  let after = before;

  if (before === remote) {
    console.log();
    console.log('CryLo source is already up to date.');
  } else {
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

    after = git(
      ['rev-parse', 'HEAD'],
      true
    );

    console.log();
    console.log(`Updated CryLo: ${before.slice(0, 9)} -> ${after.slice(0, 9)}`);
  }

  console.log();
  console.log('Preparing build dependencies...');

  ensureLinuxBuildDependencies();

  console.log('Building the current native CryLo and Electron release...');

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

  console.log();
  console.log('Restoring generated Electron binary staging files...');

  git([
    'restore',
    '--source=HEAD',
    '--',
    ...generatedElectronInputs
  ]);

  if (result.error) {
    fail(result.error.message);
  }

  if (result.status !== 0) {
    fail(
      'CryLo source was updated successfully, but the release build failed.'
    );
  }

  deployInfrastructureRelease();
  installUserCommand();

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
    '--non-interactive',
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

  case 'stop':
    stop();
    break;

  default:
    fail(`Unknown CryLo command: ${command}`);
}
