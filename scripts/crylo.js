'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
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
      path.join(root, 'scripts', 'release', 'crylo-release.js'),
      args.slice(1)
    );
    break;

  case '--check':
    runNode(
      path.join(root, 'scripts', 'release', 'crylo-release.js'),
      ['--check']
    );
    break;

  case 'install':
  case 'update':
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
