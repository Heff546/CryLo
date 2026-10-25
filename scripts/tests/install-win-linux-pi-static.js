'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');

function readText(...parts) {
  return fs.readFileSync(
    path.join(root, ...parts),
    'utf8'
  ).replace(/\r\n/g, '\n');
}

const cryloJs = readText('scripts', 'crylo.js');
const linuxLauncher = readText('crylo');
const windowsLauncher = readText('crylo.cmd');
const releaseBuilder = readText('scripts', 'release', 'crylo-release.js');
const fullBuildWorkflow = readText(
  '.github',
  'workflows',
  'full-build-win-linux-pi.yml'
);
const beforePack = readText(
  'electron',
  'scripts',
  'before-pack.js'
);
const installerNsh = readText(
  'electron',
  'build',
  'installer.nsh'
);
const installerRuntime = readText(
  'electron',
  'build',
  'windows-installer-runtime.js'
);
const managedBootstrap = readText('scripts', 'windows-runtime-bootstrap.js');

assert(
  cryloJs.includes(
    "const requiredPackages = [\n    'ca-certificates',\n    'curl',\n    'git',\n    'tar'\n  ];"
  ),
  'Linux crylo install must prepare Git as a runtime dependency.'
);

assert(
  cryloJs.includes(
    "const target = releaseTarget();"
  ),
  'crylo install must select the signed platform target.'
);

assert(
  cryloJs.includes(
    "if (process.platform === 'linux') {\n    ensureLinuxRuntimeDependencies();\n  }"
  ),
  'Linux crylo install must prepare runtime dependencies before update.'
);

assert(
  cryloJs.includes(
    "Installing the current authenticated prebuilt CryLo"
  ),
  'crylo install must use the authenticated prebuilt release path.'
);

const installStart = cryloJs.indexOf('function install() {');
const startStart = cryloJs.indexOf('\nfunction start() {', installStart);

assert(installStart >= 0 && startStart > installStart);

const installBody = cryloJs.slice(
  installStart,
  startStart
);

assert(
  installBody.includes('update();'),
  'crylo install must delegate to the authenticated update engine.'
);

assert(
  !installBody.includes('ensureLinuxBuildDependencies();'),
  'Normal crylo install must not prepare source-build dependencies.'
);

assert(
  !installBody.includes('[releaseScript]'),
  'Normal crylo install must not invoke the source release builder.'
);


assert(
  linuxLauncher.includes('NODE_VERSION=24.21.0') &&
  linuxLauncher.includes('NPM_VERSION=12.1.0') &&
  linuxLauncher.includes('"npm@$NPM_VERSION"'),
  'Linux/Pi launcher must prepare the exact managed Node/npm toolchain.'
);

assert(
  windowsLauncher.includes('set "CRYLO_NODE_VERSION=24.21.0"') &&
  windowsLauncher.includes('set "CRYLO_NPM_VERSION=12.1.0"') &&
  windowsLauncher.includes('set "CRYLO_GIT_BUILD=2.56.0.windows.1"') &&
  windowsLauncher.includes('windows-runtime-bootstrap.js') &&
  windowsLauncher.includes('call :verify_sha256') &&
  windowsLauncher.includes('"%CRYLO_STAGED_NODE%" "%CRYLO_HELPER%" activate') &&
  windowsLauncher.includes('"%CRYLO_NODE_EXE%" "%CRYLO_HELPER%" verify') &&
  windowsLauncher.includes('set "PATH=%CRYLO_NODE_DIRECTORY%;%CRYLO_GIT_DIRECTORY%\\cmd;%PATH%"') &&
  windowsLauncher.includes('set "GIT_TERMINAL_PROMPT=0"') &&
  !/powershell\\.exe|Invoke-WebRequest|\\.ps1\b|-NoProfile/i.test(windowsLauncher),
  'Windows CMD launcher must use exact managed versions and never call PowerShell.'
);

assert(
  windowsLauncher.includes('--proto-redir "=https"') &&
  windowsLauncher.includes('"%CRYLO_CERTUTIL%" -hashfile') &&
  windowsLauncher.includes('"%CRYLO_TAR%" -xf') &&
  windowsLauncher.includes('findstr.exe') &&
  windowsLauncher.indexOf('call :verify_sha256 "%CRYLO_NODE_ARCHIVE%"') <
  windowsLauncher.indexOf('"%CRYLO_TAR%" -xf') &&
  windowsLauncher.indexOf('call :verify_sha256 "%CRYLO_STAGED_NODE%"') <
  windowsLauncher.indexOf('"%CRYLO_STAGED_NODE%" "%CRYLO_HELPER%" activate'),
  'Windows first-run must checksum both archive and runtime before executing staged Node.'
);

assert(
  managedBootstrap.includes('verifyNodeRuntime') &&
  managedBootstrap.includes('verifyGitRuntime') &&
  managedBootstrap.includes('assertTreeHasNoReparse') &&
  managedBootstrap.includes("const NODE_VERSION = '24.21.0';") &&
  managedBootstrap.includes("const NPM_VERSION = '12.1.0';") &&
  managedBootstrap.includes("const GIT_BUILD = '2.56.0.windows.1';") &&
  managedBootstrap.includes('npm@') &&
  managedBootstrap.includes('fs.renameSync(item.final, item.backup)') &&
  managedBootstrap.includes('fs.cpSync(item.source, item.final') &&
  managedBootstrap.includes("shell: false") &&
  !/powershell\\.exe|Invoke-WebRequest|\\.ps1\b/i.test(managedBootstrap),
  'Authenticated Node helper must provide transactional Node/npm/MinGit repair without shell or PowerShell.'
);

assert(
  releaseBuilder.includes("const managedNodeVersion = '24.21.0';") &&
  releaseBuilder.includes("const managedNpmVersion = '12.1.0';") &&
  releaseBuilder.includes('verifyManagedReleaseToolchain(target)'),
  'Release builder must enforce the exact managed CryLo toolchain.'
);

assert(
  beforePack.includes("const WINDOWS_GIT_VERSION = '2.56.0';") &&
  beforePack.includes("const WINDOWS_GIT_BUILD = '2.56.0.windows.1';") &&
  beforePack.includes(
    "'064b440ff870ed5198527e8f3a92cdf5bd2fd0fedf5e718af95e3fdaddeff718'"
  ) &&
  beforePack.includes('stageWindowsGitInstallerResource') &&
  beforePack.includes('await stageWindowsGitInstallerResource('),
  'Windows Electron packaging must stage the authenticated MinGit runtime.'
);

assert(
  installerNsh.includes('windows-installer-runtime.js') &&
  installerNsh.includes('node-v24.21.0-win-x64.zip') &&
  installerNsh.includes('nsExec::ExecToStack') &&
  installerRuntime.includes("const GIT_VERSION = '2.56.0';") &&
  installerRuntime.includes("const GIT_BUILD = '2.56.0.windows.1';") &&
  installerRuntime.includes("const GIT_DIR_NAME = 'mingit-2.56.0.windows.1-x64';") &&
  installerRuntime.includes(
    "const GIT_ARCHIVE_SHA256 = '064b440ff870ed5198527e8f3a92cdf5bd2fd0fedf5e718af95e3fdaddeff718';"
  ) &&
  installerRuntime.includes('function installGitRuntime(') &&
  installerRuntime.includes('verifyGitRuntime(finalGit)') &&
  installerRuntime.includes('fs.renameSync(backup, final)'),
  'Windows NSIS and Node helper must provision authenticated MinGit with transactional rollback.'
);

assert(
  installerRuntime.includes(
    "const CRYLO_REPOSITORY = 'https://github.com/Heff546/CryLo.git';"
  ) &&
  installerRuntime.includes(
    "const CRYLO_MANAGED_BRANCH = 'crylo-managed';"
  ) &&
  installerRuntime.includes("const stage = path.join(userProfile, 'CryLo.pre-crylo-install');") &&
  installerRuntime.includes('manifest.gitCommit') &&
  installerRuntime.includes("['checkout', '-B', CRYLO_MANAGED_BRANCH, commit]") &&
  installerRuntime.includes('assertGitCheckoutTreeSafe('),
  'Windows installer must verify its source commit and checkout tree before installation.'
);

assert(
  installerRuntime.includes(
    "const CRYLO_LAUNCHER_MARKER = ':: CryLo managed launcher';"
  ) &&
  installerRuntime.includes("path.join(localAppData, 'CryLo', 'bin')") &&
  installerRuntime.includes("const regExe = options.regExe || path.join(systemRoot, 'System32', 'reg.exe');") &&
  installerRuntime.includes("'HKCU\\\\Environment'") &&
  installerRuntime.includes("'Path'") &&
  installerRuntime.includes('previousWrapper') &&
  installerRuntime.includes('registryRun(regExe, ['),
  'Windows installer must register its CMD launcher using reg.exe and restore prior state on failure.'
);

assert(
  fullBuildWorkflow.includes('run: sh ./crylo release') &&
  fullBuildWorkflow.includes('run: crylo.cmd release') &&
  !fullBuildWorkflow.includes('run: node scripts/release/crylo-release.js'),
  'Full-build CI must enter through the platform CryLo launchers.'
);
console.log(
  'Windows/Linux/Pi crylo install static checks passed.'
);
