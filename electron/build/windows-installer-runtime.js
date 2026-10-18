'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const NODE_VERSION = '24.21.0';
const NODE_DIR_NAME = `node-v${NODE_VERSION}-win-x64`;
const NODE_EXE_SHA256 = 'ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32';
const NODE_ARCHIVE_SHA256 = '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541';

const GIT_VERSION = '2.56.0';
const GIT_BUILD = '2.56.0.windows.1';
const GIT_DIR_NAME = 'mingit-2.56.0.windows.1-x64';
const GIT_ARCHIVE_NAME = `MinGit-${GIT_VERSION}-64-bit.zip`;
const GIT_ARCHIVE_SHA256 = '064b440ff870ed5198527e8f3a92cdf5bd2fd0fedf5e718af95e3fdaddeff718';

const CRYLO_REPOSITORY = 'https://github.com/Heff546/CryLo.git';
const CRYLO_MANAGED_BRANCH = 'crylo-managed';
const CRYLO_LAUNCHER_MARKER = ':: CryLo managed launcher';

function fail(message) {
  throw new Error(message);
}

function sha256(file) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(file))
    .digest('hex');
}

function normalizeForCompare(value) {
  return path.resolve(value).replace(/[\\/]+$/, '').toLowerCase();
}

function assertExistingPathIsNotReparse(target, label) {
  if (!fs.existsSync(target)) {
    return;
  }

  /*
   * Do not compare the textual spelling of target with realpath().
   *
   * On Windows, an ordinary DOS 8.3 alias such as:
   *
   *   C:\Users\CRYLOI~1
   *
   * can canonicalize to:
   *
   *   C:\Users\CryLoInstallTest
   *
   * even when no symbolic link, junction, or other traversed link exists.
   * Treating that textual difference as proof of reparse traversal causes
   * legitimate NSIS %TEMP% paths to be rejected.
   *
   * Instead, inspect every existing path component with lstatSync(). A
   * Windows junction/symbolic link encountered in the path is reported by
   * Node as a symbolic-link entry and is rejected before the target is used.
   */
  const resolved = path.resolve(target);
  const parsed = path.parse(resolved);

  let current = parsed.root;

  if (current && fs.existsSync(current)) {
    const rootStat = fs.lstatSync(current);
    if (rootStat.isSymbolicLink()) {
      fail(`${label} traverses a symbolic-link/reparse path: ${current}`);
    }
  }

  const remainder = resolved.slice(parsed.root.length);
  const components = remainder
    .split(/[\\/]+/)
    .filter(Boolean);

  for (const component of components) {
    current = path.join(current, component);

    if (!fs.existsSync(current)) {
      fail(`${label} path component unexpectedly does not exist: ${current}`);
    }

    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      fail(`${label} traverses a symbolic-link/reparse path: ${current}`);
    }
  }
}

function assertTreeHasNoReparse(root, label) {
  if (!fs.existsSync(root)) {
    return;
  }

  assertExistingPathIsNotReparse(root, label);

  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const stat = fs.lstatSync(full);

      if (stat.isSymbolicLink()) {
        fail(`${label} contains a symbolic-link/reparse entry: ${full}`);
      }

      if (entry.isDirectory()) {
        /*
         * stat.isSymbolicLink() above rejects junction/symlink entries.
         * Do not reject a directory merely because realpath() expands an
         * ordinary Windows 8.3 short-name alias.
         */
        stack.push(full);
      }
    }
  }
}

function ensureDirectory(target) {
  fs.mkdirSync(target, { recursive: true });
  assertExistingPathIsNotReparse(target, 'CryLo managed directory');
}

function removeIfExists(target) {
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
}

function moveDirectory(source, destination) {
  try {
    fs.renameSync(source, destination);
    return;
  } catch (error) {
    if (!error || error.code !== 'EXDEV') {
      throw error;
    }
  }

  fs.cpSync(source, destination, {
    recursive: true,
    force: false,
    errorOnExist: true,
    dereference: false
  });
  fs.rmSync(source, { recursive: true, force: true });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024
  });

  if (result.error || result.status !== 0) {
    const detail = `${result.stdout || ''}${result.stderr || ''}`.trim();
    fail(
      `${options.label || path.basename(command)} failed` +
      (detail ? `:\n${detail}` : '.')
    );
  }

  return String(result.stdout || '').trim();
}

function verifyNodeRuntime(nodeExe) {
  if (!fs.existsSync(nodeExe) || !fs.statSync(nodeExe).isFile()) {
    fail(`Managed Node.js executable is missing: ${nodeExe}`);
  }

  assertExistingPathIsNotReparse(nodeExe, 'Managed Node.js executable');

  if (sha256(nodeExe) !== NODE_EXE_SHA256) {
    fail(`Managed Node.js executable SHA256 mismatch: ${nodeExe}`);
  }

  const version = run(nodeExe, ['--version'], {
    label: 'Managed Node.js version verification'
  });
  if (version !== `v${NODE_VERSION}`) {
    fail(`Managed Node.js version mismatch: ${version}`);
  }

  const arch = run(nodeExe, ['-p', 'process.arch'], {
    label: 'Managed Node.js architecture verification'
  });
  if (arch !== 'x64') {
    fail(`Managed Node.js architecture mismatch: ${arch}`);
  }
}

function verifyGitRuntime(gitExe) {
  if (!fs.existsSync(gitExe) || !fs.statSync(gitExe).isFile()) {
    fail(`Managed MinGit executable is missing: ${gitExe}`);
  }

  assertExistingPathIsNotReparse(gitExe, 'Managed MinGit executable');

  const version = run(gitExe, ['--version'], {
    label: 'Managed MinGit version verification'
  });
  if (version !== `git version ${GIT_BUILD}`) {
    fail(`Managed MinGit version mismatch: ${version}`);
  }
}

function installNodeRuntime(pluginDir, runtimeDir) {
  const stagedRoot = path.join(pluginDir, 'crylo-node-stage');
  const staged = path.join(stagedRoot, NODE_DIR_NAME);
  const stagedNode = path.join(staged, 'node.exe');
  const final = path.join(runtimeDir, NODE_DIR_NAME);
  const finalNode = path.join(final, 'node.exe');
  const backup = path.join(runtimeDir, `${NODE_DIR_NAME}.pre-crylo-install`);

  assertTreeHasNoReparse(staged, 'Staged Node.js runtime');
  verifyNodeRuntime(stagedNode);

  if (fs.existsSync(final)) {
    try {
      assertTreeHasNoReparse(final, 'Existing Node.js runtime');
      verifyNodeRuntime(finalNode);
      return finalNode;
    } catch (_) {
      // Invalid managed runtime is repaired transactionally below.
    }
  }

  if (fs.existsSync(backup)) {
    fail(`Node.js recovery path already exists: ${backup}`);
  }

  assertExistingPathIsNotReparse(runtimeDir, 'CryLo runtime directory');
  assertExistingPathIsNotReparse(final, 'CryLo Node.js runtime path');

  const hadOld = fs.existsSync(final);
  let installed = false;

  try {
    if (hadOld) {
      assertTreeHasNoReparse(final, 'Existing Node.js runtime');
      fs.renameSync(final, backup);
    }

    fs.cpSync(staged, final, {
      recursive: true,
      force: false,
      errorOnExist: true,
      dereference: false
    });
    installed = true;

    assertTreeHasNoReparse(final, 'Installed Node.js runtime');
    verifyNodeRuntime(finalNode);

    if (hadOld) {
      fs.rmSync(backup, { recursive: true, force: true });
    }

    return finalNode;
  } catch (error) {
    if (installed && fs.existsSync(final)) {
      fs.rmSync(final, { recursive: true, force: true });
    }

    if (hadOld && fs.existsSync(backup) && !fs.existsSync(final)) {
      fs.renameSync(backup, final);
    }

    throw error;
  }
}

function extractArchive(tarExe, archive, destination, label) {
  removeIfExists(destination);
  ensureDirectory(destination);

  run(tarExe, ['-xf', archive, '-C', destination], {
    label: `${label} extraction`
  });
}

function installGitRuntime(pluginDir, runtimeDir, tarExe) {
  const archive = path.join(pluginDir, GIT_ARCHIVE_NAME);
  const staged = path.join(pluginDir, 'crylo-git-stage');
  const stagedGit = path.join(staged, 'cmd', 'git.exe');
  const final = path.join(runtimeDir, GIT_DIR_NAME);
  const finalGit = path.join(final, 'cmd', 'git.exe');
  const backup = path.join(runtimeDir, `${GIT_DIR_NAME}.pre-crylo-install`);

  if (!fs.existsSync(archive) || sha256(archive) !== GIT_ARCHIVE_SHA256) {
    fail('Embedded MinGit archive SHA256 verification failed.');
  }

  if (fs.existsSync(final)) {
    try {
      assertTreeHasNoReparse(final, 'Existing MinGit runtime');
      verifyGitRuntime(finalGit);
      return finalGit;
    } catch (_) {
      // Invalid managed runtime is repaired transactionally below.
    }
  }

  extractArchive(tarExe, archive, staged, 'MinGit');
  assertTreeHasNoReparse(staged, 'Staged MinGit runtime');
  verifyGitRuntime(stagedGit);

  if (fs.existsSync(backup)) {
    fail(`MinGit recovery path already exists: ${backup}`);
  }

  assertExistingPathIsNotReparse(runtimeDir, 'CryLo runtime directory');
  assertExistingPathIsNotReparse(final, 'CryLo MinGit runtime path');

  const hadOld = fs.existsSync(final);
  let installed = false;

  try {
    if (hadOld) {
      assertTreeHasNoReparse(final, 'Existing MinGit runtime');
      fs.renameSync(final, backup);
    }

    moveDirectory(staged, final);
    installed = true;

    assertTreeHasNoReparse(final, 'Installed MinGit runtime');
    verifyGitRuntime(finalGit);

    if (hadOld) {
      fs.rmSync(backup, { recursive: true, force: true });
    }

    return finalGit;
  } catch (error) {
    if (installed && fs.existsSync(final)) {
      fs.rmSync(final, { recursive: true, force: true });
    }

    if (hadOld && fs.existsSync(backup) && !fs.existsSync(final)) {
      fs.renameSync(backup, final);
    }

    throw error;
  }
}

function parseBuildManifest(manifestPath) {
  if (!fs.existsSync(manifestPath) || !fs.statSync(manifestPath).isFile()) {
    fail(`Packaged CryLo Windows runtime manifest is missing: ${manifestPath}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const commit = String(manifest.gitCommit || '');

  if (
    manifest.product !== 'CryLo' ||
    manifest.kind !== 'windows-build-runtime' ||
    manifest.platform !== 'win' ||
    manifest.architecture !== 'x64' ||
    !/^[a-f0-9]{40}$/i.test(commit)
  ) {
    fail('Packaged CryLo Windows runtime manifest is invalid for source bootstrap.');
  }

  return commit.toLowerCase();
}

function git(gitExe, cwd, args, options = {}) {
  return run(gitExe, ['-C', cwd, ...args], {
    env: options.env,
    label: options.label || `git ${args.join(' ')}`
  });
}

function gitRaw(gitExe, cwd, args, options = {}) {
  const result = spawnSync(gitExe, ['-C', cwd, ...args], {
    env: options.env || process.env,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024
  });

  if (result.error || result.status !== 0) {
    const detail = `${result.stdout || ''}${result.stderr || ''}`.trim();
    fail(
      `${options.label || `git ${args.join(' ')}`} failed` +
      (detail ? `:\n${detail}` : '.')
    );
  }

  return String(result.stdout || '');
}

function normalizeGitPath(value) {
  return String(value).replace(/\\/g, '/');
}

function pathIsInsideRoot(root, target) {
  const relative = path.relative(
    path.resolve(root),
    path.resolve(target)
  );

  return (
    relative === '' ||
    (
      relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    )
  );
}

function trackedGitSymlinks(gitExe, checkout, options = {}) {
  const tree = gitRaw(
    gitExe,
    checkout,
    ['ls-tree', '-r', '-z', '--full-tree', 'HEAD'],
    {
      env: options.env,
      label: 'CryLo Git symlink tree verification'
    }
  );

  const tracked = new Map();

  for (const record of tree.split('\0')) {
    if (!record) {
      continue;
    }

    const tab = record.indexOf('\t');
    if (tab <= 0) {
      fail('Unable to parse CryLo Git tree while validating symbolic links.');
    }

    const metadata = record.slice(0, tab).split(' ');
    if (metadata.length !== 3) {
      fail('Unable to parse CryLo Git tree metadata while validating symbolic links.');
    }

    const [mode, type, object] = metadata;

    if (mode !== '120000') {
      continue;
    }

    if (
      type !== 'blob' ||
      !/^[a-f0-9]{40,64}$/i.test(object)
    ) {
      fail('CryLo Git tree contains an invalid symbolic-link object.');
    }

    const relative = normalizeGitPath(
      record.slice(tab + 1)
    );

    if (
      !relative ||
      relative.startsWith('/') ||
      relative === '..' ||
      relative.startsWith('../') ||
      relative.includes('/../')
    ) {
      fail(`CryLo Git tree contains an unsafe symbolic-link path: ${relative}`);
    }

    const target = gitRaw(
      gitExe,
      checkout,
      ['cat-file', 'blob', object],
      {
        env: options.env,
        label: `CryLo Git symbolic-link target verification: ${relative}`
      }
    );

    if (
      target.includes('\0') ||
      target.includes('\r') ||
      target.includes('\n')
    ) {
      fail(`CryLo Git symbolic-link target is invalid: ${relative}`);
    }

    tracked.set(
      relative,
      normalizeGitPath(target)
    );
  }

  return tracked;
}

function assertGitCheckoutTreeSafe(gitExe, checkout, label, options = {}) {
  if (!fs.existsSync(checkout)) {
    return;
  }

  assertExistingPathIsNotReparse(checkout, label);

  const trackedSymlinks = trackedGitSymlinks(
    gitExe,
    checkout,
    options
  );

  const stack = [checkout];

  while (stack.length > 0) {
    const current = stack.pop();

    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const stat = fs.lstatSync(full);

      if (stat.isSymbolicLink()) {
        const relative = normalizeGitPath(
          path.relative(checkout, full)
        );

        if (!trackedSymlinks.has(relative)) {
          fail(
            `${label} contains an untracked symbolic-link/reparse entry: ${full}`
          );
        }

        const actualTarget = normalizeGitPath(
          fs.readlinkSync(full)
        );

        const expectedTarget = trackedSymlinks.get(relative);

        if (actualTarget !== expectedTarget) {
          fail(
            `${label} contains a tracked symbolic link whose target differs from Git HEAD: ` +
            `${full}`
          );
        }

        let real;
        try {
          real = fs.realpathSync.native(full);
        } catch (_) {
          fail(
            `${label} contains an unresolved tracked symbolic link: ${full}`
          );
        }

        if (!pathIsInsideRoot(checkout, real)) {
          fail(
            `${label} contains a tracked symbolic link that escapes the checkout: ` +
            `${full} -> ${real}`
          );
        }

        continue;
      }

      if (entry.isDirectory()) {
        /*
         * Untracked junction/symlink entries were already rejected by the
         * lstatSync().isSymbolicLink() branch above. Keep ordinary directories
         * traversable even when Windows expands an 8.3 alias in realpath().
         */
        stack.push(full);
      }
    }
  }
}

function validateExistingCryLoCheckout(gitExe, checkout) {
  assertExistingPathIsNotReparse(checkout, 'Existing CryLo checkout');

  const gitMeta = path.join(checkout, '.git');
  if (!fs.existsSync(gitMeta)) {
    fail(`Existing CryLo path is not a Git checkout: ${checkout}`);
  }

  if (git(gitExe, checkout, ['rev-parse', '--is-inside-work-tree']) !== 'true') {
    fail('Existing CryLo path is not a valid Git working tree.');
  }

  const origin = git(gitExe, checkout, ['remote', 'get-url', 'origin']);
  if (origin !== CRYLO_REPOSITORY) {
    fail(`Existing CryLo checkout origin mismatch: ${origin}`);
  }

  assertGitCheckoutTreeSafe(
    gitExe,
    checkout,
    'Existing CryLo checkout'
  );

  for (const required of ['crylo.cmd', path.join('scripts', 'crylo.js')]) {
    const requiredPath = path.join(checkout, required);
    if (!fs.existsSync(requiredPath) || !fs.statSync(requiredPath).isFile()) {
      fail(`Existing CryLo checkout is missing required file: ${required}`);
    }
  }
}

function prepareCryLoCheckout(gitExe, manifestPath, userProfile) {
  const commit = parseBuildManifest(manifestPath);
  const final = path.join(userProfile, 'CryLo');
  const stage = path.join(userProfile, 'CryLo.pre-crylo-install');

  if (fs.existsSync(final)) {
    validateExistingCryLoCheckout(gitExe, final);
    return final;
  }

  if (fs.existsSync(stage)) {
    fail(`CryLo source recovery/staging path already exists: ${stage}`);
  }

  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0'
  };

  let created = false;

  try {
    run(gitExe, ['clone', '--origin', 'origin', '--no-checkout', CRYLO_REPOSITORY, stage], {
      env,
      label: 'CryLo source clone'
    });

    const origin = git(gitExe, stage, ['remote', 'get-url', 'origin'], { env });
    if (origin !== CRYLO_REPOSITORY) {
      fail('Cloned CryLo origin verification failed.');
    }

    git(gitExe, stage, ['cat-file', '-e', `${commit}^{commit}`], {
      env,
      label: 'CryLo release commit verification'
    });

    git(gitExe, stage, ['checkout', '-B', CRYLO_MANAGED_BRANCH, commit], {
      env,
      label: 'CryLo release checkout'
    });

    const head = git(gitExe, stage, ['rev-parse', 'HEAD'], { env }).toLowerCase();
    if (head !== commit) {
      fail('CryLo source checkout commit verification failed.');
    }

    const status = git(
      gitExe,
      stage,
      ['status', '--porcelain', '--untracked-files=all'],
      { env }
    );
    if (status) {
      fail('CryLo source checkout is not clean.');
    }

    assertGitCheckoutTreeSafe(
      gitExe,
      stage,
      'Staged CryLo source checkout',
      { env }
    );

    for (const required of ['crylo.cmd', path.join('scripts', 'crylo.js')]) {
      const requiredPath = path.join(stage, required);
      if (!fs.existsSync(requiredPath) || !fs.statSync(requiredPath).isFile()) {
        fail(`Cloned CryLo checkout is missing required file: ${required}`);
      }
    }

    moveDirectory(stage, final);
    created = true;

    const installedHead = git(gitExe, final, ['rev-parse', 'HEAD'], { env }).toLowerCase();
    const installedOrigin = git(gitExe, final, ['remote', 'get-url', 'origin'], { env });

    if (installedHead !== commit || installedOrigin !== CRYLO_REPOSITORY) {
      fail('Installed CryLo source checkout verification failed.');
    }

    assertGitCheckoutTreeSafe(
      gitExe,
      final,
      'Installed CryLo source checkout',
      { env }
    );

    return final;
  } catch (error) {
    removeIfExists(stage);
    if (created) {
      removeIfExists(final);
    }
    throw error;
  }
}

function queryUserPath(regExe, spawn = spawnSync) {
  const result = spawn(regExe, ['query', 'HKCU\\Environment', '/v', 'Path'], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    return { value: '', type: 'REG_EXPAND_SZ' };
  }

  const text = String(result.stdout || '');
  const match = text.match(/^\s*Path\s+(REG_(?:EXPAND_)?SZ)\s+(.*)$/mi);

  if (!match) {
    fail('Unable to parse the existing per-user PATH registry value.');
  }

  return {
    type: match[1],
    value: match[2].trim()
  };
}

function registerCryLoCommand(checkout, localAppData, systemRoot, options = {}) {
  const launcher = path.join(checkout, 'crylo.cmd');
  const commandDirectory = path.join(localAppData, 'CryLo', 'bin');
  const commandPath = path.join(commandDirectory, 'crylo.cmd');
  const regExe = options.regExe || path.join(systemRoot, 'System32', 'reg.exe');
  const registrySpawn = options.spawnSync || spawnSync;
  const registryRun = options.run || run;

  if (!fs.existsSync(launcher) || !fs.statSync(launcher).isFile()) {
    fail('Managed CryLo launcher is missing.');
  }

  let createdCommandDirectory = false;
  if (fs.existsSync(commandDirectory)) {
    assertExistingPathIsNotReparse(commandDirectory, 'CryLo command directory');
  } else {
    ensureDirectory(commandDirectory);
    createdCommandDirectory = true;
  }

  let previousWrapper = null;
  if (fs.existsSync(commandPath)) {
    const existing = fs.readFileSync(commandPath);
    const existingText = existing.toString('utf8');
    if (!existingText.includes(CRYLO_LAUNCHER_MARKER)) {
      fail(`Cannot replace existing CryLo command: ${commandPath}`);
    }
    previousWrapper = existing;
  }

  if (!fs.existsSync(regExe)) {
    fail(`Windows reg.exe is unavailable: ${regExe}`);
  }

  const current = queryUserPath(regExe, registrySpawn);
  const entries = current.value
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean);

  const canonicalCommandDirectory = commandDirectory.replace(/[\\/]+$/, '').toLowerCase();
  const registered = entries.some(
    (entry) => entry.replace(/[\\/]+$/, '').toLowerCase() === canonicalCommandDirectory
  );

  const wrapper = [
    '@echo off',
    CRYLO_LAUNCHER_MARKER,
    `call "${launcher}" %*`,
    ''
  ].join('\r\n');

  let wrapperWritten = false;

  try {
    fs.writeFileSync(commandPath, wrapper, 'utf8');
    wrapperWritten = true;

    if (!registered) {
      const updated = entries.length > 0
        ? `${entries.join(';')};${commandDirectory}`
        : commandDirectory;

      registryRun(regExe, [
        'add',
        'HKCU\\Environment',
        '/v',
        'Path',
        '/t',
        current.type,
        '/d',
        updated,
        '/f'
      ], {
        label: 'CryLo per-user PATH registration'
      });
    }
  } catch (error) {
    if (wrapperWritten) {
      try {
        if (previousWrapper !== null) {
          fs.writeFileSync(commandPath, previousWrapper);
        } else {
          fs.rmSync(commandPath, { force: true });
        }
      } catch (_) {
        // Preserve the original registration failure as the primary error.
      }
    }

    if (createdCommandDirectory) {
      try {
        if (fs.existsSync(commandDirectory) && fs.readdirSync(commandDirectory).length === 0) {
          fs.rmdirSync(commandDirectory);
        }
      } catch (_) {
        // Preserve the original registration failure as the primary error.
      }
    }

    throw error;
  }
}

function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    fail(`CryLo Windows installer helper requires win32/x64; got ${process.platform}/${process.arch}.`);
  }

  if (process.argv.length !== 5 || process.argv[2] !== 'install') {
    fail('Usage: windows-installer-runtime.js install <plugin-dir> <runtime-manifest>');
  }

  const pluginDir = path.resolve(process.argv[3]);
  const manifestPath = path.resolve(process.argv[4]);
  const localAppData = process.env.LOCALAPPDATA;
  const userProfile = process.env.USERPROFILE;
  const systemRoot = process.env.SystemRoot || process.env.WINDIR;

  if (!localAppData || !userProfile || !systemRoot) {
    fail('LOCALAPPDATA, USERPROFILE, and SystemRoot/WINDIR are required.');
  }

  const cryloRoot = path.join(localAppData, 'CryLo');
  const runtimeDir = path.join(cryloRoot, 'runtime');
  const tarExe = path.join(systemRoot, 'System32', 'tar.exe');

  if (!fs.existsSync(tarExe)) {
    fail(`Windows tar.exe is unavailable: ${tarExe}`);
  }

  assertExistingPathIsNotReparse(cryloRoot, 'CryLo local application data');
  assertExistingPathIsNotReparse(runtimeDir, 'CryLo runtime directory');

  ensureDirectory(cryloRoot);
  ensureDirectory(runtimeDir);

  if (sha256(process.execPath) !== NODE_EXE_SHA256) {
    fail('Installer helper is not running under the authenticated CryLo Node.js binary.');
  }

  if (process.version !== `v${NODE_VERSION}` || process.arch !== 'x64') {
    fail('Installer helper is running under an unexpected Node.js version or architecture.');
  }

  const nodeArchive = path.join(pluginDir, `${NODE_DIR_NAME}.zip`);
  if (!fs.existsSync(nodeArchive) || sha256(nodeArchive) !== NODE_ARCHIVE_SHA256) {
    fail('Embedded Node.js archive SHA256 verification failed.');
  }

  installNodeRuntime(pluginDir, runtimeDir);
  const gitExe = installGitRuntime(pluginDir, runtimeDir, tarExe);
  const checkout = prepareCryLoCheckout(gitExe, manifestPath, userProfile);
  registerCryLoCommand(checkout, localAppData, systemRoot);

  console.log('CryLo Windows managed runtime installation verified.');
}

module.exports = Object.freeze({
  sha256,
  assertExistingPathIsNotReparse,
  assertTreeHasNoReparse,
  verifyNodeRuntime,
  verifyGitRuntime,
  installNodeRuntime,
  installGitRuntime,
  parseBuildManifest,
  validateExistingCryLoCheckout,
  prepareCryLoCheckout,
  queryUserPath,
  registerCryLoCommand,
  trackedGitSymlinks,
  assertGitCheckoutTreeSafe
});

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`ERROR: ${error && error.message ? error.message : error}`);
    process.exit(1);
  }
}