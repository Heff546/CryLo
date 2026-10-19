'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..', '..');
const updater = fs.readFileSync(path.join(root, 'scripts', 'crylo.js'), 'utf8');
const installer = fs.readFileSync(path.join(root, 'electron', 'build', 'windows-installer-runtime.js'), 'utf8');
const ignored = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');

function wrapperFromSource(source) {
  const marker = "const marker = ':: CryLo managed snapshot launcher v2';";
  const at = source.indexOf(marker);
  assert(at >= 0, 'Missing immutable v2 launcher template');
  const prefix = 'const wrapper = ';
  const from = source.indexOf(prefix, at);
  assert(from > at && from - at < 250, 'Expected v2 launcher array');
  const tail = "].join('\\r\\n');";
  const to = source.indexOf(tail, from);
  assert(to >= 0, 'Expected Windows CRLF launcher text');
  const arrayExpression = source.slice(from + prefix.length, to + 1);
  const lines = vm.runInNewContext(arrayExpression, { marker: ':: CryLo managed snapshot launcher v2' });
  assert(Array.isArray(lines), 'Snapshot template must be an array');
  return lines.join('\r\n');
}

assert(ignored.includes('/.crylo-launcher-run-*.cmd'),
  'Active launcher snapshot must be Git-ignored');
assert(updater.includes("launcherDiff.status === 1") &&
       updater.includes("CRYLO_WINDOWS_SNAPSHOT_ACTIVE !== '1'"),
  'Unsafe direct-root CMD launcher must refuse source batch replacements');
assert(updater.includes("localAppData, 'CryLo', 'bin-v2'"),
  'Updater must register a separate command path');
assert(installer.includes("path.join(localAppData, 'CryLo', 'bin-v2')"),
  'Electron installer must use same separate command path');

const wrapper = wrapperFromSource(updater);
assert.strictEqual(wrapper, wrapperFromSource(installer),
  'CLI and Electron installer must register byte-identical safe launchers');

const expectedCommands = [
  'DisableDelayedExpansion',
  'copy /B /Y',
  'CRYLO_WINDOWS_SNAPSHOT_ACTIVE=1',
  'call "%CRYLO_SNAPSHOT_FILE%" %*',
  'del /Q "%CRYLO_SNAPSHOT_FILE%"'
];
for (const command of expectedCommands) {
  assert(wrapper.includes(command), 'Missing snapshot invariant: ' + command);
}

if (process.platform !== 'win32') {
  console.log('Windows launcher static contract verified. Live CMD test runs on Windows.');
  process.exit(0);
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'crylo-launcher-race-'));
try {
  const fakeUser = path.join(temporary, 'Test User');
  const checkout = path.join(fakeUser, 'CryLo');
  const managed = path.join(temporary, 'bin-v2');
  fs.mkdirSync(checkout, { recursive: true });
  fs.mkdirSync(managed);

  const sourceLauncher = path.join(checkout, 'crylo.cmd');
  const registeredLauncher = path.join(managed, 'crylo.cmd');

  // Simulate the same failure mode as a Git fast-forward of crylo.cmd:
  // the executed batch updates the source launcher while running.
  // The ACTIVE snapshot must continue to execute its remaining commands.
  fs.writeFileSync(sourceLauncher, [
    '@echo off',
    'echo SNAPSHOT_STARTED',
    '> "%~dp0crylo.cmd" echo @echo off',
    '>> "%~dp0crylo.cmd" echo echo MUTATED_SOURCE_ONLY',
    'echo SNAPSHOT_FINISHED',
    'exit /b 0',
    ''
  ].join('\r\n'));

  fs.writeFileSync(registeredLauncher, wrapper, 'utf8');
  const result = spawnSync('cmd.exe', [
    '/D', '/C', '"' + registeredLauncher + '"'
  ], {
    env: { ...process.env, USERPROFILE: fakeUser },
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 20000
  });

  if (result.error) throw result.error;
  assert.strictEqual(result.status, 0,
    'CMD returned nonzero:\n' + result.stdout + '\n' + result.stderr);
  assert(result.stdout.includes('SNAPSHOT_STARTED'));
  assert(result.stdout.includes('SNAPSHOT_FINISHED'),
    'CMD failed to resume snapshot after source batch was overwritten');
  assert(!result.stdout.includes('MUTATED_SOURCE_ONLY'),
    'CMD unexpectedly resumed the modified source batch');

  const stale = fs.readdirSync(checkout)
    .filter((name) => name.startsWith('.crylo-launcher-run-'));
  assert.deepStrictEqual(stale, [],
    'Temporary command snapshot must be cleaned up');

  assert.strictEqual(fs.readFileSync(registeredLauncher, 'utf8'), wrapper,
    'Versioned managed command must remain immutable');

  console.log('PASS: Windows CMD launcher survived a live self-update race');
  console.log('PASS: Temporary batch removed; permanent launcher preserved');
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
