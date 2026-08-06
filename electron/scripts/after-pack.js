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

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') {
    return;
  }

  const stagedDir = path.resolve(__dirname, '..', 'bin', 'linux');
  const packagedDir = path.join(
    context.appOutDir,
    'resources',
    'bin',
    'linux'
  );

  const required = [
    'CryLo-daemon',
    'CryLo-wallet-rpc',
    'BINARY-MANIFEST.txt'
  ];

  for (const name of required) {
    const staged = path.join(stagedDir, name);
    const packaged = path.join(packagedDir, name);

    if (!fs.existsSync(packaged)) {
      throw new Error(`Packaged runtime file is missing: ${packaged}`);
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

    console.log(`Verified packaged runtime: ${name} (${packagedHash})`);
  }

  const forbidden = fs.readdirSync(packagedDir).filter(name =>
    name.endsWith('.log') ||
    name.includes('.old-') ||
    name.startsWith('c64chain')
  );

  if (forbidden.length > 0) {
    throw new Error(
      `Forbidden files entered the package: ${forbidden.join(', ')}`
    );
  }
};
