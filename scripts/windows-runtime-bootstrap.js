'use strict';

// Ordinary-user Windows bootstrap. Runs only beneath SHA-256-pinned Node.js.
// No PowerShell, shell execution, developer tools, or system Node/Git.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  assertExistingPathIsNotReparse,
  assertTreeHasNoReparse,
  verifyNodeRuntime,
  verifyGitRuntime
} = require('../electron/build/windows-installer-runtime');

const NODE_VERSION = '24.21.0';
const NPM_VERSION = '12.1.0';
const NODE_DIRECTORY = 'node-v' + NODE_VERSION + '-win-x64';
const NODE_ARCHIVE_SHA256 = '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541';
const NODE_EXE_SHA256 = 'ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32';
const GIT_BUILD = '2.56.0.windows.1';
const GIT_DIRECTORY = 'mingit-' + GIT_BUILD + '-x64';
const GIT_ARCHIVE = 'MinGit-2.56.0-64-bit.zip';
const GIT_ARCHIVE_SHA256 = '064b440ff870ed5198527e8f3a92cdf5bd2fd0fedf5e718af95e3fdaddeff718';
const GIT_URL = 'https://github.com/git-for-windows/git/releases/download/v' + GIT_BUILD + '/' + GIT_ARCHIVE;

function fail(reason) { throw new Error(reason); }
function hash(file) {
  const digest = crypto.createHash('sha256');
  digest.update(fs.readFileSync(file));
  return digest.digest('hex');
}
function exists(target) {
  try { fs.lstatSync(target); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
function run(executable, args, label, options = {}) {
  const result = spawnSync(executable, args, {
    encoding: 'utf8', shell: false, windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
    ...options
  });
  if (result.error || result.status !== 0) {
    fail(label + ' failed (' + (result.status ?? 'spawn error') + '): ' +
      String(result.stderr || result.error || result.stdout || '').slice(0, 800));
  }
  return String(result.stdout || '').trim();
}
function directories() {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    fail('CryLo Windows managed bootstrap requires win32/x64.');
  }
  const appData = process.env.LOCALAPPDATA;
  const windows = process.env.SystemRoot || process.env.WINDIR;
  if (!appData || !windows || !path.isAbsolute(appData) || !path.isAbsolute(windows)) {
    fail('LOCALAPPDATA and SystemRoot must be absolute for a Windows normal user.');
  }
  const system = path.join(windows, 'System32');
  const runtime = path.join(appData, 'CryLo', 'runtime');
  for (const entry of [appData, path.join(appData, 'CryLo'), runtime]) {
    assertExistingPathIsNotReparse(entry, 'CryLo runtime parent');
  }
  return { runtime, system };
}
function verifyNode(node) {
  if (!exists(node) || hash(node) !== NODE_EXE_SHA256) {
    fail('CryLo managed Node.js executable SHA256 mismatch.');
  }
  verifyNodeRuntime(node);
}
function verifyNpm(runtimeNodeDirectory) {
  const node = path.join(runtimeNodeDirectory, 'node.exe');
  const cli = path.join(runtimeNodeDirectory, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (!exists(cli)) fail('Pinned CryLo npm CLI missing.');
  const version = run(node, [cli, '--version'], 'Pinned npm verification');
  if (version !== NPM_VERSION) fail('Pinned CryLo npm mismatch: ' + version);
  verifyNode(node);
}
function verifyAll(runtime) {
  const nodeHome = path.join(runtime, NODE_DIRECTORY);
  const gitHome = path.join(runtime, GIT_DIRECTORY);
  for (const backup of [
    nodeHome + '.pre-crylo-bootstrap', gitHome + '.pre-crylo-bootstrap',
    nodeHome + '.pre-crylo-install', gitHome + '.pre-crylo-install'
  ]) {
    if (exists(backup)) fail('CryLo recovery backup requires review: ' + backup);
  }
  verifyAllWithoutBackupCheck(runtime);
}
function verifyAllWithoutBackupCheck(runtime) {
  const nodeHome = path.join(runtime, NODE_DIRECTORY);
  const gitHome = path.join(runtime, GIT_DIRECTORY);
  assertTreeHasNoReparse(nodeHome, 'Activated CryLo Node/npm');
  assertTreeHasNoReparse(gitHome, 'Activated CryLo MinGit');
  verifyNpm(nodeHome);
  verifyGitRuntime(path.join(gitHome, 'cmd', 'git.exe'));
}
function curlDownload(system, url, file) {
  const curl = path.join(system, 'curl.exe');
  if (!exists(curl)) fail('Windows system curl.exe is required. No PowerShell fallback.');
  run(curl, [
    '--fail', '--location', '--silent', '--show-error',
    '--proto', '=https', '--proto-redir', '=https', '--max-redirs', '5',
    '--tlsv1.2', '--connect-timeout', '15', '--max-time', '180',
    '--output', file, url
  ], 'Authenticated CryLo runtime download');
}
function verifyStage(stage, runtime) {
  assertExistingPathIsNotReparse(stage, 'CryLo bootstrap staging directory');
  const stageResolved = path.resolve(stage).toLowerCase();
  const runtimeResolved = path.resolve(runtime).toLowerCase();
  if (path.dirname(stageResolved) !== runtimeResolved ||
      !path.basename(stage).startsWith('.crylo-bootstrap-')) {
    fail('CryLo staging directory is outside the isolated managed runtime.');
  }
  assertTreeHasNoReparse(stage, 'CryLo bootstrap staging directory');
}
function activate(stage, runtime, system) {
  verifyStage(stage, runtime);
  const archive = path.join(stage, NODE_DIRECTORY + '.zip');
  if (!exists(archive) || hash(archive) !== NODE_ARCHIVE_SHA256) {
    fail('CryLo Node archive did not pass pinned SHA-256 verification.');
  }
  const stagedNodeHome = path.join(stage, NODE_DIRECTORY);
  const stagedNode = path.join(stagedNodeHome, 'node.exe');
  verifyNode(stagedNode);
  if (hash(process.execPath) !== NODE_EXE_SHA256 ||
      fs.realpathSync(process.execPath).toLowerCase() !==
      fs.realpathSync(stagedNode).toLowerCase()) {
    fail('CryLo bootstrap must run only from its exact authenticated staged Node.');
  }

  const stagedNpmCli = path.join(stagedNodeHome, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (!exists(stagedNpmCli)) fail('Authenticated Node archive has no npm CLI.');
  run(stagedNode, [
    stagedNpmCli, 'install', '--global',
    '--prefix', stagedNodeHome,
    '--ignore-scripts', '--no-audit', '--no-fund',
    'npm@' + NPM_VERSION
  ], 'CryLo npm pinned staging', {
    env: { ...process.env, PATH: stagedNodeHome + ';' + (process.env.PATH || '') }
  });
  assertTreeHasNoReparse(stagedNodeHome, 'Staged CryLo Node/npm runtime');
  verifyNpm(stagedNodeHome);

  const gitArchive = path.join(stage, GIT_ARCHIVE);
  curlDownload(system, GIT_URL, gitArchive);
  if (hash(gitArchive) !== GIT_ARCHIVE_SHA256) {
    fail('CryLo MinGit SHA256 did not match pinned release archive.');
  }
  const stagedGit = path.join(stage, 'git-staged');
  fs.mkdirSync(stagedGit, { mode: 0o700 });
  const tar = path.join(system, 'tar.exe');
  if (!exists(tar)) fail('Windows system tar.exe is required.');
  run(tar, ['-xf', gitArchive, '-C', stagedGit], 'CryLo authenticated MinGit extraction');
  assertTreeHasNoReparse(stagedGit, 'Staged CryLo MinGit runtime');
  verifyGitRuntime(path.join(stagedGit, 'cmd', 'git.exe'));

  const plans = [
    { name: 'Node.js/npm', source: stagedNodeHome, final: path.join(runtime, NODE_DIRECTORY) },
    { name: 'MinGit', source: stagedGit, final: path.join(runtime, GIT_DIRECTORY) }
  ];
  for (const item of plans) {
    item.backup = item.final + '.pre-crylo-bootstrap';
    if (exists(item.backup) || exists(item.final + '.pre-crylo-install')) {
      fail('CryLo recovery state must be resolved before changing ' + item.name);
    }
    assertExistingPathIsNotReparse(item.final, 'Existing CryLo ' + item.name);
    if (exists(item.final)) assertTreeHasNoReparse(item.final, 'Existing CryLo ' + item.name);
  }

  const touched = [];
  try {
    for (const item of plans) {
      const old = exists(item.final);
      if (old) fs.renameSync(item.final, item.backup);
      touched.push({ ...item, old });
      // Copy rather than rename: staged node.exe is the running executable.
      fs.cpSync(item.source, item.final, {
        recursive: true, dereference: false,
        force: false, errorOnExist: true
      });
    }
    verifyAllWithoutBackupCheck(runtime);
  } catch (error) {
    for (const item of touched.reverse()) {
      if (exists(item.final)) {
        try {
          assertTreeHasNoReparse(item.final, 'Failed staged runtime');
          fs.rmSync(item.final, { recursive: true, force: true });
        } catch (cleanupError) {
          fail('CryLo rollback cannot clear staged ' + item.name +
            '; existing backup preserved: ' + item.backup + '; ' + cleanupError.message);
        }
      }
      if (item.old && exists(item.backup)) fs.renameSync(item.backup, item.final);
    }
    throw error;
  }
  for (const item of touched) {
    if (item.old) {
      assertTreeHasNoReparse(item.backup, 'Previous runtime backup');
      fs.rmSync(item.backup, { recursive: true, force: true });
    }
  }
  console.log('CryLo Windows Node/npm and MinGit runtime bootstrap verified without PowerShell.');
}
function main() {
  const { runtime, system } = directories();
  const mode = process.argv[2];
  if (!['verify', 'activate'].includes(mode)) fail('Usage: windows-runtime-bootstrap.js verify|activate [stage]');
  if (mode === 'verify') {
    const expected = path.join(runtime, NODE_DIRECTORY, 'node.exe');
    if (fs.realpathSync(process.execPath).toLowerCase() !== fs.realpathSync(expected).toLowerCase()) {
      fail('CryLo managed Node verification was called by an unexpected executable.');
    }
    verifyAll(runtime);
    console.log('CryLo Windows managed runtime: VERIFIED');
  } else {
    if (process.argv.length !== 4 || !path.isAbsolute(process.argv[3])) {
      fail('CryLo bootstrap requires an absolute private staging path.');
    }
    activate(process.argv[3], runtime, system);
  }
}
if (require.main === module) {
  try { main(); }
  catch (error) { console.error('ERROR: ' + error.message); process.exitCode = 1; }
}
module.exports = Object.freeze({
  verifyNpm, verifyAll, verifyAllWithoutBackupCheck,
  verifyStage, activate
});
