'use strict';

const fs = require('fs');
const path = require('path');
const {
  WINDOWS_BUILD_RUNTIME_MANIFEST,
  sha256,
  readWindowsBuildRuntimeManifest
} = require('./windows-runtime-dlls');

function platformDefinition(electronPlatformName) {
  if (electronPlatformName === 'linux') {
    return {
      dir: 'linux',
      required: [
        'CryLo-daemon',
        'CryLo-wallet-rpc',
        'BINARY-MANIFEST.txt'
      ]
    };
  }

  if (electronPlatformName === 'win32') {
    return {
      dir: 'win',
      required: [
        'CryLo-daemon.exe',
        'CryLo-wallet-rpc.exe',
        'BINARY-MANIFEST.txt',
        WINDOWS_BUILD_RUNTIME_MANIFEST
      ]
    };
  }

  if (electronPlatformName === 'darwin') {
    return {
      dir: 'mac',
      required: [
        'CryLo-daemon',
        'CryLo-wallet-rpc',
        'BINARY-MANIFEST.txt'
      ]
    };
  }

  return null;
}

module.exports = async function afterPack(context) {
  const definition =
    platformDefinition(context.electronPlatformName);

  if (!definition) {
    return;
  }

  const electronDir = path.resolve(__dirname, '..');
  const root = path.resolve(electronDir, '..');

  const stagedDir =
    context.electronPlatformName === 'win32'
      ? path.join(root, 'build', 'electron-runtime', definition.dir)
      : path.join(electronDir, 'bin', definition.dir);

  const packagedDir = path.join(
    context.appOutDir,
    'resources',
    'bin',
    definition.dir
  );

  let required = [...definition.required];
  let runtimeManifest = null;

  if (context.electronPlatformName === 'win32') {
    runtimeManifest = readWindowsBuildRuntimeManifest(
      path.join(stagedDir, WINDOWS_BUILD_RUNTIME_MANIFEST),
      { architecture: 'x64' }
    );

    required.push(
      ...runtimeManifest.runtime.map((runtime) => runtime.file)
    );
  }

  for (const name of required) {
    const staged = path.join(stagedDir, name);
    const packaged = path.join(packagedDir, name);

    if (!fs.existsSync(staged)) {
      throw new Error(`Staged runtime file is missing: ${staged}`);
    }

    if (!fs.existsSync(packaged)) {
      throw new Error(
        `Packaged runtime file is missing: ${packaged}`
      );
    }

    const stagedHash = sha256(staged);
    const packagedHash = sha256(packaged);

    if (stagedHash !== packagedHash) {
      throw new Error(
        `Packaged ${name} does not match staging:\n` +
        `staging:  ${stagedHash}\n` +
        `packaged: ${packagedHash}`
      );
    }

    if (runtimeManifest) {
      const runtime = runtimeManifest.runtime.find(
        (entry) => entry.file === name
      );

      if (
        runtime &&
        (
          fs.statSync(packaged).size !== runtime.size ||
          packagedHash !== runtime.sha256
        )
      ) {
        throw new Error(
          `Packaged Windows runtime DLL mismatch: ${name}`
        );
      }
    }

    console.log(
      `Verified packaged runtime: ${name} (${packagedHash})`
    );
  }

  if (runtimeManifest) {
    const expectedDlls = new Set(
      runtimeManifest.runtime.map(
        (entry) => entry.file.toLowerCase()
      )
    );

    const packagedDlls = fs.readdirSync(packagedDir)
      .filter((name) => name.toLowerCase().endsWith('.dll'));

    for (const name of packagedDlls) {
      if (!expectedDlls.has(name.toLowerCase())) {
        throw new Error(
          `Unexpected Windows runtime DLL entered package: ${name}`
        );
      }
    }

    if (packagedDlls.length !== expectedDlls.size) {
      throw new Error(
        `Packaged Windows runtime DLL count mismatch: ` +
        `packaged=${packagedDlls.length}, manifest=${expectedDlls.size}`
      );
    }
  }

  const forbidden = fs.readdirSync(packagedDir).filter(name =>
    name.endsWith('.log') ||
    name.includes('.old-') ||
    name.includes('.before-') ||
    name.endsWith('.bak')
  );

  if (forbidden.length > 0) {
    throw new Error(
      `Forbidden files entered the package: ${forbidden.join(', ')}`
    );
  }
};
