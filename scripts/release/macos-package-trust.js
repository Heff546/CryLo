'use strict';

// Security boundary for future authorized macOS installation.
// Caller MUST independently verify the Ed25519-signed CryLo manifest and
// sequence floor before calling this function. This module never installs,
// deletes, modifies application bundles, or updates security state.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ARCHITECTURES = Object.freeze({ x64: 'x86_64', arm64: 'arm64' });

function requireMacArtifactIdentity(manifest, architecture) {
  if (!manifest || manifest.product !== 'CryLo' ||
      !['testnet', 'mainnet'].includes(manifest.network) ||
      !Number.isSafeInteger(manifest.releaseSequence) ||
      manifest.releaseSequence < 1 ||
      typeof manifest.version !== 'string' ||
      !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(manifest.version) ||
      !Object.hasOwn(ARCHITECTURES, architecture)) {
    throw new Error('Invalid signed manifest identity or macOS architecture.');
  }
  const matches = (Array.isArray(manifest.artifacts) ? manifest.artifacts : [])
    .filter(a => a && a.platform === 'mac' && a.architecture === architecture);
  if (matches.length !== 1) {
    throw new Error('Signed manifest must select exactly one macOS architecture artifact.');
  }
  const artifact = matches[0];
  const expected = 'CryLo-' + manifest.version + '-mac-' + architecture + '.pkg';
  if (artifact.file !== expected ||
      typeof artifact.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(artifact.sha256) ||
      !Number.isSafeInteger(artifact.size) || artifact.size <= 0) {
    throw new Error('Unsigned or malformed macOS PKG artifact identity.');
  }
  return artifact;
}

function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const n = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (n === 0) break;
      hash.update(buffer.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function assertRegularNoLink(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw new Error('macOS release artifact must be an ordinary unlinked file.');
  }
  return stat;
}

function execute(file, args, options = {}) {
  const result = spawnSync(file, args, {
    encoding: 'utf8',
    shell: false,
    timeout: 60000,
    maxBuffer: 1024 * 1024,
    ...options
  });
  if (result.error || result.status !== 0 || result.signal) {
    throw new Error('macOS installer trust check failed: ' +
      path.basename(file) + ' ' + args[0]);
  }
  return String(result.stdout || '') + '\n' + String(result.stderr || '');
}

function verifyMacPackage({ packagePath, manifest, architecture, trustedTeamId, run = execute }) {
  if (process.platform !== 'darwin') {
    throw new Error('macOS installer trust verification requires a real macOS host.');
  }
  // The Team ID must come from currently installed trusted CryLo configuration,
  // never from the downloaded manifest, package output, or an environment override.
  if (typeof trustedTeamId !== 'string' ||
      !/^[A-Z0-9]{10}$/.test(trustedTeamId)) {
    throw new Error('Trusted CryLo Apple Developer Team ID is not configured.');
  }
  const artifact = requireMacArtifactIdentity(manifest, architecture);
  if (typeof packagePath !== 'string' ||
      path.basename(packagePath) !== artifact.file ||
      !path.isAbsolute(packagePath)) {
    throw new Error('macOS PKG path does not match signed manifest identity.');
  }
  const stat = assertRegularNoLink(packagePath);
  if (stat.size !== artifact.size ||
      sha256File(packagePath).toLowerCase() !== artifact.sha256.toLowerCase()) {
    throw new Error('Signed CryLo macOS package size or SHA-256 mismatch.');
  }

  const pkgutil = run('/usr/sbin/pkgutil', ['--check-signature', packagePath]);
  if (!pkgutil.includes('Signed with a trusted timestamp') ||
      !pkgutil.includes('Developer ID Installer:') ||
      !pkgutil.includes('(' + trustedTeamId + ')') ||
      /Status:\s+no signature/i.test(pkgutil)) {
    throw new Error('macOS PKG is not signed by the trusted Developer ID Installer team.');
  }

  // The notary ticket MUST be stapled: offline users must be able to verify it.
  run('/usr/bin/xcrun', ['stapler', 'validate', packagePath]);
  // Gatekeeper must accept the package as an installer under current policy.
  const assessment = run('/usr/sbin/spctl',
    ['--assess', '--type', 'install', '--verbose=2', packagePath]);
  if (!/accepted/i.test(assessment)) {
    throw new Error('macOS Gatekeeper did not explicitly accept the installer.');
  }

  return Object.freeze({
    architecture,
    file: artifact.file,
    sha256: artifact.sha256.toLowerCase(),
    version: manifest.version,
    releaseSequence: manifest.releaseSequence
  });
}

module.exports = Object.freeze({
  requireMacArtifactIdentity,
  sha256File,
  verifyMacPackage
});
