'use strict';

// Verified macOS release preparation only: stage privately for Finder use.
// No PKG execution, privilege escalation, Gatekeeper bypass, source merge,
// automatic release-sequence advance, or mutation of wallet/config directories.
const fs = require('node:fs');
const path = require('node:path');
const { verifyMacPackage, sha256File } = require('./macos-package-trust');

function safeOwnedDirectory(directory, create) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) {
    throw new Error('Mac release staging requires an absolute user-owned directory.');
  }
  if (create && !fs.existsSync(directory)) {
    fs.mkdirSync(directory, { mode: 0o700 });
  }
  const info = fs.lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink() ||
      info.uid !== process.getuid()) {
    throw new Error('Mac release staging directory is not safe and user-owned.');
  }
  return info;
}

function prepareStagingRoot(home) {
  if (process.platform !== 'darwin') {
    throw new Error('Mac unsigned installer staging requires macOS.');
  }
  if (typeof home !== 'string' || !path.isAbsolute(home)) {
    throw new Error('Mac installer preparation requires an absolute HOME.');
  }
  safeOwnedDirectory(home, false);
  let current = home;
  for (const part of ['Library', 'Application Support', 'CryLo', 'verified-updates']) {
    current = path.join(current, part);
    safeOwnedDirectory(current, true);
  }
  // A private directory prevents other accounts from replacing the staged
  // authenticated installer. Existing CryLo, wallet and config dirs stay intact.
  fs.chmodSync(current, 0o700);
  return current;
}

function stageVerifiedMacPackage({
  packagePath, manifestPath, signaturePath, publicKeyPath,
  architecture, network, minimumSequence, home
}) {
  const settings = {
    packagePath, manifestPath, signaturePath, publicKeyPath,
    architecture, network, minimumSequence
  };
  // Signature, correct target, rollback floor, and PKG bytes must all be
  // authenticated before any staging output is created.
  const authorization = verifyMacPackage(settings);
  const root = prepareStagingRoot(home);
  const stage = fs.mkdtempSync(path.join(root, '.verified-release-'));
  try {
    fs.chmodSync(stage, 0o700);
    const destination = path.join(stage, authorization.file);
    fs.copyFileSync(packagePath, destination, fs.constants.COPYFILE_EXCL);
    for (const [source, target] of [
      [manifestPath, 'crylo-release-manifest.json'],
      [signaturePath, 'crylo-release-manifest.json.sig']
    ]) {
      fs.copyFileSync(source, path.join(stage, target), fs.constants.COPYFILE_EXCL);
    }
    const checked = verifyMacPackage({
      packagePath: destination,
      manifestPath: path.join(stage, 'crylo-release-manifest.json'),
      signaturePath: path.join(stage, 'crylo-release-manifest.json.sig'),
      publicKeyPath, architecture, network, minimumSequence
    });
    if (sha256File(destination) !== checked.sha256) {
      throw new Error('Mac staged release installer changed during authenticated copy.');
    }
    fs.chmodSync(destination, 0o600);
    return Object.freeze({
      ...checked,
      stagedPath: destination,
      installation: 'user-approval-required',
      releaseSecurityStateAdvanced: false
    });
  } catch (error) {
    // This is a newly-created, mode-0700 staging directory only.
    fs.rmSync(stage, { recursive: true, force: true });
    throw error;
  }
}

module.exports = Object.freeze({
  prepareStagingRoot,
  stageVerifiedMacPackage
});
