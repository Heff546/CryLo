'use strict';

const { execFileSync, spawnSync } = require('child_process');
const path = require('path');

const ELECTRON_BUILDER_ARCH = {
  0: 'ia32',
  1: 'x64',
  2: 'armv7l',
  3: 'arm64',
  4: 'universal'
};

function runChecked(command, args, cwd, label) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit'
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Packaging check failed: ${label}`);
  }
}

module.exports = async function beforePack(context) {
  const electronDir = path.resolve(__dirname, '..');
  const targetArch =
    ELECTRON_BUILDER_ARCH[context.arch] || String(context.arch);

  if (context.electronPlatformName === 'linux') {
    for (const script of [
      'scripts/sync-linux-binaries.sh',
      'scripts/verify-linux-binaries.sh'
    ]) {
      runChecked(
        'bash',
        [script],
        electronDir,
        script
      );
    }

    const daemon = path.join(
      electronDir,
      'bin',
      'linux',
      'CryLo-daemon'
    );

    const binaryArch = execFileSync(
      path.join(
        electronDir,
        'scripts',
        'detect-linux-binary-arch.sh'
      ),
      [daemon],
      { encoding: 'utf8' }
    ).trim();

    if (binaryArch !== targetArch) {
      throw new Error(
        `Electron target ${targetArch} cannot contain ` +
        `${binaryArch} CryLo binaries`
      );
    }

    console.log(
      `Verified Electron target ${targetArch} matches CryLo binaries`
    );
    return;
  }

  const platform =
    context.electronPlatformName === 'win32'
      ? 'win'
      : context.electronPlatformName === 'darwin'
        ? 'mac'
        : null;

  if (!platform) {
    return;
  }

  if (platform === 'win' && targetArch !== 'x64') {
    throw new Error(
      `Unsupported Windows Electron architecture: ${targetArch}`
    );
  }

  if (
    platform === 'mac' &&
    !['x64', 'arm64'].includes(targetArch)
  ) {
    throw new Error(
      `Unsupported macOS Electron architecture: ${targetArch}`
    );
  }

  for (const script of [
    'sync-native-binaries.js',
    'verify-native-binaries.js'
  ]) {
    runChecked(
      process.execPath,
      [
        path.join(electronDir, 'scripts', script),
        platform,
        targetArch
      ],
      electronDir,
      script
    );
  }

  console.log(
    `Verified Electron target ${platform}/${targetArch} ` +
    'matches CryLo binaries'
  );
};
