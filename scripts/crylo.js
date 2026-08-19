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
  crylo start         Start CryLo
  crylo stop          Stop CryLo
  crylo status        Show CryLo status
  crylo nexus         Manage CryLoNexus
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
  case 'start':
  case 'stop':
    fail(
      `"crylo ${command}" is reserved but not implemented yet.`
    );
    break;

  case 'nexus':
    fail(
      '"crylo nexus" is reserved but not implemented yet.'
    );
    break;

  default:
    fail(`Unknown CryLo command: ${command}`);
}
