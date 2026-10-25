'use strict';

// CryLo launch policy: Apple Developer ID and notarization are optional.
// Authentication is mandatory: only a Pi1 Ed25519-signed release manifest
// and its exact SHA-256/size-bound macOS installer can pass this check.
// This module does not invoke Installer, open an app, alter quarantine,
// disable Gatekeeper, install software, or modify wallet/configuration data.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ARCHITECTURES = Object.freeze({ x64: 'x86_64', arm64: 'arm64' });
const SHA256 = /^[a-f0-9]{64}$/i;
const COMMIT = /^[a-f0-9]{40}$/i;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

function regularUnlinkedFile(file, description) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) {
    throw new Error(description + ' path must be absolute.');
  }
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw new Error(description + ' must be an ordinary unlinked file.');
  }
  return stat;
}

function sha256File(file) {
  const digest = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const bytes = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytes === 0) break;
      digest.update(buffer.subarray(0, bytes));
    }
  } finally {
    fs.closeSync(fd);
  }
  return digest.digest('hex');
}

function authenticatedManifest(manifestPath, signaturePath, publicKeyPath) {
  for (const [file, name] of [
    [manifestPath, 'CryLo release manifest'],
    [signaturePath, 'CryLo manifest signature'],
    [publicKeyPath, 'CryLo trusted public key']
  ]) regularUnlinkedFile(file, name);

  const key = crypto.createPublicKey(fs.readFileSync(publicKeyPath));
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error('CryLo release key must be Ed25519.');
  }
  const signatureText = fs.readFileSync(signaturePath, 'utf8').trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signatureText)) {
    throw new Error('CryLo release signature is not canonical base64.');
  }
  const signature = Buffer.from(signatureText, 'base64');
  if (signature.length !== 64 ||
      signature.toString('base64') !== signatureText) {
    throw new Error('CryLo release signature is invalid or noncanonical.');
  }

  const manifestBytes = fs.readFileSync(manifestPath);
  if (!crypto.verify(null, manifestBytes, key, signature)) {
    throw new Error('CryLo Ed25519 release manifest signature failed.');
  }
  let manifest;
  try { manifest = JSON.parse(manifestBytes.toString('utf8')); }
  catch { throw new Error('CryLo signed release manifest is not valid JSON.'); }
  return {
    manifest,
    signerFingerprint: crypto.createHash('sha256').update(
      key.export({ type: 'spki', format: 'der' })
    ).digest('hex')
  };
}

function requireMacArtifactIdentity(manifest, architecture, network, minimumSequence) {
  if (typeof network !== 'string' || !['testnet', 'mainnet'].includes(network) ||
      !Object.hasOwn(ARCHITECTURES, architecture) ||
      !Number.isSafeInteger(minimumSequence) || minimumSequence < 1 ||
      !manifest || manifest.schema !== 1 ||
      manifest.product !== 'CryLo' || manifest.network !== network ||
      manifest.signatureAlgorithm !== 'Ed25519' ||
      manifest.hashAlgorithm !== 'SHA-256' ||
      typeof manifest.version !== 'string' || !VERSION.test(manifest.version) ||
      !Number.isSafeInteger(manifest.releaseSequence) ||
      manifest.releaseSequence < minimumSequence ||
      typeof manifest.gitCommit !== 'string' || !COMMIT.test(manifest.gitCommit)) {
    throw new Error('Signed CryLo release identity, network, architecture or rollback floor invalid.');
  }

  const expectedTag = network === 'testnet'
    ? 'v' + manifest.version + '-testnet.' + manifest.releaseSequence
    : 'v' + manifest.version;
  if (manifest.releaseTag !== expectedTag ||
      typeof manifest.createdUtc !== 'string' ||
      !Number.isFinite(Date.parse(manifest.createdUtc)) ||
      Date.parse(manifest.createdUtc) > Date.now() + MAX_CLOCK_SKEW_MS) {
    throw new Error('Signed CryLo release tag or timestamp mismatch.');
  }

  const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  const names = new Set();
  for (const item of artifacts) {
    if (!item || typeof item.file !== 'string' ||
        item.file !== path.basename(item.file) || item.file === '.' ||
        item.file === '..' || item.file.includes('\\') || names.has(item.file)) {
      throw new Error('Signed CryLo manifest contains invalid or duplicate filenames.');
    }
    names.add(item.file);
  }

  const matches = artifacts.filter(a =>
    a.platform === 'mac' && a.architecture === architecture);
  if (matches.length !== 1) {
    throw new Error('Signed manifest must contain exactly one matching macOS artifact.');
  }
  const artifact = matches[0];
  // Launch packages intentionally have NO Apple Developer ID signature.
  // Pi1's authenticated manifest is the distribution trust anchor.
  const expected = 'CryLo-' + manifest.version + '-mac-' + architecture + '-unsigned.pkg';
  if (artifact.file !== expected ||
      typeof artifact.sha256 !== 'string' || !SHA256.test(artifact.sha256) ||
      !Number.isSafeInteger(artifact.size) || artifact.size <= 0) {
    throw new Error('Signed CryLo macOS unsigned PKG identity or hash invalid.');
  }
  return artifact;
}

function verifyMacPackage({
  packagePath, manifestPath, signaturePath, publicKeyPath,
  architecture, network, minimumSequence
}) {
  if (process.platform !== 'darwin') {
    throw new Error('CryLo macOS package verification requires a real macOS host.');
  }
  if (architecture !== process.arch) {
    throw new Error('CryLo macOS installer architecture does not match current Node runtime.');
  }
  const { manifest, signerFingerprint } = authenticatedManifest(
    manifestPath, signaturePath, publicKeyPath);
  const artifact = requireMacArtifactIdentity(
    manifest, architecture, network, minimumSequence);

  if (typeof packagePath !== 'string' || !path.isAbsolute(packagePath) ||
      path.basename(packagePath) !== artifact.file) {
    throw new Error('CryLo package path does not match the signed release manifest.');
  }
  const stat = regularUnlinkedFile(packagePath, 'CryLo macOS installer');
  if (stat.size !== artifact.size ||
      sha256File(packagePath).toLowerCase() !== artifact.sha256.toLowerCase()) {
    throw new Error('CryLo PKG size or SHA-256 does not match Pi1 signed manifest.');
  }

  // Do not infer Apple Developer ID, notarization, or Gatekeeper approval.
  // The user must explicitly open the verified PKG and approve installation
  // under their current macOS system-security policy.
  return Object.freeze({
    file: artifact.file,
    sha256: artifact.sha256.toLowerCase(),
    architecture,
    network,
    version: manifest.version,
    releaseTag: manifest.releaseTag,
    releaseSequence: manifest.releaseSequence,
    gitCommit: manifest.gitCommit,
    signerFingerprint,
    installation: 'requires-user-approval',
    appleDeveloperIdRequired: false
  });
}

module.exports = Object.freeze({
  sha256File,
  authenticatedManifest,
  requireMacArtifactIdentity,
  verifyMacPackage
});
