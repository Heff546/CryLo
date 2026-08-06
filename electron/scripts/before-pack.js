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

module.exports = async function beforePack(context) {
  if (context.electronPlatformName !== 'linux') {
    return;
  }

  const electronDir = path.resolve(__dirname, '..');
  const targetArch =
    ELECTRON_BUILDER_ARCH[context.arch] || String(context.arch);

  for (const script of [
    'scripts/sync-linux-binaries.sh',
    'scripts/verify-linux-binaries.sh'
  ]) {
    const result = spawnSync('bash', [script], {
      cwd: electronDir,
      stdio: 'inherit'
    });

    if (result.status !== 0) {
      throw new Error(`Packaging check failed: ${script}`);
    }
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
};
