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
  windowsLauncher.includes('call :ensure_npm') &&
  windowsLauncher.includes(
    'set "PATH=%CRYLO_NODE_DIRECTORY%;%CRYLO_GIT_DIRECTORY%\\cmd;%PATH%"'
  ),
  'Windows launcher must prepare and prefer the exact isolated Node/npm runtime.'
);

assert(
  windowsLauncher.includes(
    "('npm@' + $env:CRYLO_NPM_VERSION)"
  ),
  'Windows launcher must repair npm inside the isolated CryLo runtime.'
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
  installerNsh.includes('MinGit-2.56.0-64-bit.zip') &&
  installerNsh.includes('mingit-2.56.0.windows.1-x64') &&
  installerNsh.includes(
    '064b440ff870ed5198527e8f3a92cdf5bd2fd0fedf5e718af95e3fdaddeff718'
  ) &&
  installerNsh.includes('git version 2.56.0.windows.1'),
  'Windows installer must provision and verify the exact managed MinGit runtime.'
);

assert(
  installerNsh.includes("$$repo='https://github.com/Heff546/CryLo.git'") &&
  installerNsh.includes("$$final=Join-Path $$env:USERPROFILE 'CryLo'") &&
  installerNsh.includes("$$branch='crylo-managed'") &&
  installerNsh.includes('$$manifest.gitCommit') &&
  installerNsh.includes('checkout -B $$branch $$commit'),
  'Windows installer must bootstrap %USERPROFILE%\\CryLo at the packaged release commit.'
);

assert(
  installerNsh.includes("$$marker=':: CryLo managed launcher'") &&
  installerNsh.includes("Join-Path $$env:LOCALAPPDATA 'CryLo\\bin'") &&
  installerNsh.includes("[Environment]::SetEnvironmentVariable('Path',$$updated,'User')"),
  'Windows installer must register the managed per-user CryLo lifecycle command.'
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
