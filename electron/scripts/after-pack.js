'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function sha256(file) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(file))
    .digest('hex');
}

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
        'BINARY-MANIFEST.txt'
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

  const stagedDir = path.resolve(
    __dirname,
    '..',
    'bin',
    definition.dir
  );

  const packagedDir = path.join(
    context.appOutDir,
    'resources',
    'bin',
    definition.dir
  );

  for (const name of definition.required) {
    const staged = path.join(stagedDir, name);
    const packaged = path.join(packagedDir, name);

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

    console.log(
      `Verified packaged runtime: ${name} (${packagedHash})`
    );
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
