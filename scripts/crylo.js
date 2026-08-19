'use strict';

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

  case 'install':
  case 'start':
  case 'stop':
  case 'status':
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
