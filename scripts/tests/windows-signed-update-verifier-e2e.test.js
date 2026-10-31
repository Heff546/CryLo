'use strict';

// This gate exercises the exact production release-manifest verifier with
// ephemeral, TEST-ONLY Ed25519 keys. It never changes the trusted CryLo
// public key, publishes a release, downloads a real installer, or updates
// a wallet. The synthetic zip contains test text, not a CryLo executable.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const verifier = path.join(root, 'scripts', 'release', 'verify-release-manifest.js');

function signedFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crylo-win-signed-gate-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const keys = crypto.generateKeyPairSync('ed25519');
  const alternate = crypto.generateKeyPairSync('ed25519');
  const keyFile = path.join(dir, 'ci-ephemeral-public.pem');
  const otherKey = path.join(dir, 'untrusted-public.pem');
  const artifactName = 'CryLo-Release-1.1.1-win-x64.zip';
  const artifactPath = path.join(dir, artifactName);
  const manifestPath = path.join(dir, 'crylo-release-manifest.json');
  const signaturePath = manifestPath + '.sig';

  fs.writeFileSync(keyFile, keys.publicKey.export({ format: 'pem', type: 'spki' }));
  fs.writeFileSync(otherKey, alternate.publicKey.export({ format: 'pem', type: 'spki' }));
  fs.writeFileSync(artifactPath, 'synthetic test fixture - NOT a CryLo installer\n');
  const artifactBytes = fs.readFileSync(artifactPath);

  const base = {
    schema: 1,
    product: 'CryLo',
    network: 'testnet',
    version: '1.1.1',
    releaseTag: 'v1.1.1-testnet.30',
    releaseSequence: 30,
    gitCommit: 'a'.repeat(40),
    signatureAlgorithm: 'Ed25519',
    hashAlgorithm: 'SHA-256',
    createdUtc: new Date().toISOString(),
    artifacts: [{
      platform: 'win',
      architecture: 'x64',
      file: artifactName,
      sha256: crypto.createHash('sha256').update(artifactBytes).digest('hex'),
      size: artifactBytes.length
    }]
  };

  function sign(manifest = base) {
    const data = Buffer.from(JSON.stringify(manifest) + '\n');
    fs.writeFileSync(manifestPath, data);
    const signature = crypto.sign(null, data, keys.privateKey);
    fs.writeFileSync(signaturePath, signature.toString('base64') + '\n');
  }

  function check(overrides = {}) {
    const argv = [
      verifier,
      '--network', overrides.network || 'testnet',
      '--platform', overrides.platform || 'win',
      '--architecture', overrides.arch || 'x64',
      '--minimum-sequence', String(overrides.minimumSequence ?? 30),
      '--manifest', manifestPath,
      '--signature', signaturePath,
      '--public-key', overrides.key || keyFile
    ];
    return spawnSync(process.execPath, argv, {
      cwd: dir,
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
      shell: false,
      env: { ...process.env }
    });
  }

  return { dir, keys, base, sign, check, artifactPath, signaturePath,
    manifestPath, keyFile, otherKey };
}

function accept(result, label) {
  assert.equal(result.error, undefined, label + ': launch failed');
  assert.equal(result.status, 0, label + ': ' + result.stdout + result.stderr);
  assert.match(result.stdout, /Release authenticity\.\.\. VERIFIED/);
  assert.match(result.stdout, /Artifact hashes\.\.\.\.\.\.\.\. VERIFIED/);
  assert.match(result.stdout, /Rollback floor\.+ 30 VERIFIED/);
}

function reject(result, reason) {
  assert.equal(result.error, undefined, reason + ': launch failed');
  assert.notEqual(result.status, 0, 'Unexpectedly accepted: ' + reason);
  assert.match(result.stderr, /CryLo release authenticity verification failed/);
}

test('real Windows verifier accepts exact signed, SHA256/size bound test fixture', t => {
  const f = signedFixture(t);
  f.sign();
  accept(f.check(), 'valid fixture');
});

test('real Windows verifier rejects changed manifest bytes without new signature', t => {
  const f = signedFixture(t);
  f.sign();
  fs.appendFileSync(f.manifestPath, ' ');
  reject(f.check(), 'modified signed manifest');
});

test('real Windows verifier rejects modified artifact bytes after signing', t => {
  const f = signedFixture(t);
  f.sign();
  fs.appendFileSync(f.artifactPath, 'tampered');
  reject(f.check(), 'tampered release bundle');
});

test('real Windows verifier rejects wrong trusted signing key', t => {
  const f = signedFixture(t);
  f.sign();
  reject(f.check({ key: f.otherKey }), 'different Ed25519 signer');
});

test('real Windows verifier rejects unsigned/malformed detached signature', t => {
  const f = signedFixture(t);
  f.sign();
  fs.writeFileSync(f.signaturePath, 'not base64*');
  reject(f.check(), 'invalid Ed25519 signature');
});

test('real Windows verifier rejects replay below accepted release sequence', t => {
  const f = signedFixture(t);
  f.sign();
  reject(f.check({ minimumSequence: 31 }), 'release downgrade');
});

test('real Windows verifier rejects cross-platform and cross-network substitution', t => {
  const f = signedFixture(t);
  f.sign();
  reject(f.check({ arch: 'arm64' }), 'wrong Windows CPU architecture');
  reject(f.check({ platform: 'linux' }), 'wrong platform');
  reject(f.check({ network: 'mainnet' }), 'wrong network');
});

test('real Windows verifier rejects signed false release tag and invalid product', t => {
  const f = signedFixture(t);
  f.sign({ ...f.base, releaseTag: 'v1.1.1-testnet.31' });
  reject(f.check(), 'signed mismatched tag');
  f.sign({ ...f.base, product: 'AnotherCoin' });
  reject(f.check(), 'signed wrong product');
});

test('real Windows verifier rejects signed future release timestamp', t => {
  const f = signedFixture(t);
  f.sign({ ...f.base, createdUtc: new Date(Date.now() + 60 * 60 * 1000).toISOString() });
  reject(f.check(), 'release created implausibly in future');
});

test('real Windows verifier rejects signed artifact path traversal', t => {
  const f = signedFixture(t);
  f.sign({ ...f.base, artifacts: [{ ...f.base.artifacts[0], file: '../wrong.zip' }] });
  reject(f.check(), 'signed artifact traversal');
});

test('real Windows verifier rejects duplicate signed artifact entries', t => {
  const f = signedFixture(t);
  f.sign({ ...f.base, artifacts: [f.base.artifacts[0], { ...f.base.artifacts[0] }] });
  reject(f.check(), 'duplicate signed Windows artifact');
});

test('real Windows verifier rejects valid signed metadata with wrong artifact size/hash', t => {
  const f = signedFixture(t);
  const a = f.base.artifacts[0];
  f.sign({ ...f.base, artifacts: [{ ...a, size: a.size + 1 }] });
  reject(f.check(), 'mismatched signed Windows bundle size');
  f.sign({ ...f.base, artifacts: [{ ...a, sha256: '0'.repeat(64) }] });
  reject(f.check(), 'mismatched signed Windows bundle digest');
});

test('Windows updater still mandates current trust before signed source merge', () => {
  const source = fs.readFileSync(path.join(root, 'scripts', 'crylo.js'), 'utf8');
  const updateStart = source.indexOf('function update() {');
  const updateEnd = source.indexOf('\nfunction probe(', updateStart);
  assert.ok(updateStart >= 0 && updateEnd > updateStart);
  const update = source.slice(updateStart, updateEnd);
  const verify = /authorization\s*=\s*authenticateSignedRelease\(\s*before\s*\)/.exec(update)?.index ?? -1;
  const merge = /git\(\s*\[\s*'merge',\s*'--ff-only'/.exec(update)?.index ?? -1;
  const install = /installAuthorizedReleaseBundle\(\s*authorization\s*\)/.exec(update)?.index ?? -1;
  assert.ok(verify > 0, 'Expected current signed trust check');
  assert.ok(merge > verify, 'Git merge must follow release authentication');
  assert.ok(install > merge, 'Binary install must follow signed release authorization');
  assert.match(update, /CRYLO_AUTHORIZED_COMMIT/);
  assert.match(update, /CRYLO_UPDATE_RESUMED/);
  assert.match(update, /git\(\s*\[\s*'status',\s*'--porcelain'\]/);
  const sourceAuth = source.slice(
    source.indexOf('function fetchAuthenticatedReleaseSource('),
    source.indexOf('function authenticateSignedRelease(')
  );
  assert.match(sourceAuth, /'cat-file', '-t', releaseRef/);
  assert.match(sourceAuth, /'merge-base'/);
  assert.match(sourceAuth, /--is-ancestor/);
});

test('Windows ordinary-user entry remains CMD-only, not PowerShell', () => {
  const cmd = fs.readFileSync(path.join(root, 'crylo.cmd'), 'utf8');
  assert.match(cmd, /setlocal EnableExtensions DisableDelayedExpansion/);
  assert.match(cmd, /scripts\\crylo\.js/);
  const commands = cmd.split(/\r?\n/).filter(line =>
    !/^\s*(?:rem\s|::|echo\s)/i.test(line)
  ).join('\n');
  assert.doesNotMatch(commands, /\bpowershell(?:\.exe)?\b|\bpwsh(?:\.exe)?\b/i);
});
