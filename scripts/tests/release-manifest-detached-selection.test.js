'use strict';

// CI-only regression for Testnet.23: an annotated tag on detached HEAD led the
// manifest generator to emit gitBranch:"", which production release selection
// rejected despite a valid signature. No production keys or releases are used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const vm = require('node:vm');
const child = require('node:child_process');

const sourceRoot = path.resolve(__dirname, '../..');
const generatorSource = path.join(sourceRoot, 'scripts/release/create-release-manifest.js');
const signerSource = path.join(sourceRoot, 'scripts/release/sign-release-manifest.js');
const verifierSource = path.join(sourceRoot, 'scripts/release/verify-release-manifest.js');
const updater = fs.readFileSync(path.join(sourceRoot, 'scripts/crylo.js'), 'utf8');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function run(exe, args, cwd, check = true) {
  const r = child.spawnSync(exe, args, {
    cwd, encoding: 'utf8', shell: false, windowsHide: true, timeout: 30000
  });
  if (r.error) throw r.error;
  if (check) assert.equal(r.status, 0, (r.stdout || '') + (r.stderr || ''));
  return r;
}
function fresh(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crylo-branch-metadata-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function manifestTemplate(sequence, commit, branchValue) {
  const zip = Buffer.from('SYNTHETIC DATA, NOT AN INSTALLER\n');
  const m = {
    schema: 1, product: 'CryLo', network: 'testnet', version: '1.1.1',
    releaseTag: 'v1.1.1-testnet.' + sequence, releaseSequence: sequence,
    gitCommit: commit, signatureAlgorithm: 'Ed25519', hashAlgorithm: 'SHA-256',
    createdUtc: new Date().toISOString(),
    artifacts: [{
      platform: 'win', architecture: 'x64', file: 'CryLo-Release-1.1.1-win-x64.zip',
      size: zip.length, sha256: digest(zip)
    }]
  };
  if (branchValue !== undefined) m.gitBranch = branchValue;
  return { m, zip };
}
function signFixture(base, sequence, commit, keys, branch) {
  const dir = path.join(base, 'release-' + sequence);
  fs.mkdirSync(dir);
  const { m, zip } = manifestTemplate(sequence, commit, branch);
  const file = 'CryLo-Release-1.1.1-win-x64.zip';
  fs.writeFileSync(path.join(dir, file), zip);
  const body = Buffer.from(JSON.stringify(m, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'crylo-release-manifest.json'), body);
  fs.writeFileSync(path.join(dir, 'crylo-release-manifest.json.sig'),
    crypto.sign(null, body, keys.privateKey).toString('base64') + '\n');
  const assets = [file, 'crylo-release-manifest.json', 'crylo-release-manifest.json.sig'];
  return {
    id: sequence, draft: false, prerelease: true, tag_name: m.releaseTag,
    assets: assets.map(name => ({
      name, browser_download_url: 'https://fixtures.invalid/' + sequence + '/' + name
    }))
  };
}
function sourceBetween(start, end) {
  const a = updater.indexOf(start), b = updater.indexOf(end, a + start.length);
  assert.ok(a > 0 && b > a, 'Missing production source: ' + start);
  return updater.slice(a, b);
}

test('official manifest generator omits gitBranch for detached annotated tag', t => {
  const dir = fresh(t);
  fs.mkdirSync(path.join(dir, 'scripts/release'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'electron/dist'), { recursive: true });
  fs.copyFileSync(generatorSource, path.join(dir, 'scripts/release/create-release-manifest.js'));
  fs.writeFileSync(path.join(dir, '.gitignore'), 'electron/dist/\n');
  fs.writeFileSync(path.join(dir, 'electron/package.json'), '{"version":"1.1.1"}\n');
  fs.writeFileSync(path.join(dir, 'electron/dist/CryLo-Release-1.1.1-win-x64.zip'), 'SYNTHETIC\n');
  run('git', ['init', '-b', 'main'], dir);
  run('git', ['config', 'user.email', 'ci@invalid.example'], dir);
  run('git', ['config', 'user.name', 'CryLo fixture'], dir);
  run('git', ['add', '.'], dir);
  run('git', ['commit', '-m', 'CI fixture only'], dir);
  const commit = run('git', ['rev-parse', 'HEAD'], dir).stdout.trim();
  run('git', ['tag', '-a', 'v1.1.1-testnet.24', '-m', 'CI only tag'], dir);
  // Verify attached state first, then detach and regenerate from same tag.
  const args = [
    path.join(dir, 'scripts/release/create-release-manifest.js'), '--network', 'testnet',
    '--sequence', '24', '--release-tag', 'v1.1.1-testnet.24',
    '--artifact', 'win:x64:electron/dist/CryLo-Release-1.1.1-win-x64.zip'
  ];
  run(process.execPath, args, dir);
  const dest = path.join(dir, 'electron/dist/crylo-release-manifest.json');
  assert.equal(JSON.parse(fs.readFileSync(dest, 'utf8')).gitBranch, 'main');
  run('git', ['checkout', '--detach', 'v1.1.1-testnet.24'], dir);
  run(process.execPath, args, dir);
  const m = JSON.parse(fs.readFileSync(dest, 'utf8'));
  assert.equal(m.gitCommit, commit);
  assert.equal(m.releaseTag, 'v1.1.1-testnet.24');
  assert.equal(m.releaseSequence, 24);
  assert.equal(Object.hasOwn(m, 'gitBranch'), false,
    'Detached HEAD must omit optional branch instead of emitting an empty string');
});

test('signer and verifier reject signed empty gitBranch; omit is accepted', t => {
  const dir = fresh(t);
  const trust = path.join(dir, 'scripts/release/keys');
  const signing = path.join(dir, 'scripts/release');
  const dist = path.join(dir, 'electron/dist');
  fs.mkdirSync(trust, { recursive: true });
  fs.mkdirSync(dist, { recursive: true });
  fs.copyFileSync(signerSource, path.join(signing, 'sign-release-manifest.js'));
  fs.copyFileSync(verifierSource, path.join(signing, 'verify-release-manifest.js'));
  const keys = crypto.generateKeyPairSync('ed25519');
  const privateFile = path.join(dir, 'test-private.pem');
  const publicFile = path.join(trust, 'crylo-testnet-release-ed25519-public.pem');
  fs.writeFileSync(privateFile, keys.privateKey.export({ format: 'pem', type: 'pkcs8' }));
  fs.writeFileSync(publicFile, keys.publicKey.export({ format: 'pem', type: 'spki' }));
  const { m, zip } = manifestTemplate(24, 'a'.repeat(40));
  const manifestPath = path.join(dist, 'crylo-release-manifest.json');
  const signaturePath = manifestPath + '.sig';
  fs.writeFileSync(path.join(dist, m.artifacts[0].file), zip);
  const verifierArgs = [
    path.join(signing, 'verify-release-manifest.js'),
    '--network', 'testnet', '--platform', 'win', '--architecture', 'x64',
    '--minimum-sequence', '24', '--manifest', manifestPath,
    '--signature', signaturePath, '--public-key', publicFile
  ];
  const signArgs = [path.join(signing, 'sign-release-manifest.js'),
    '--network', 'testnet', '--key', privateFile];
  fs.writeFileSync(manifestPath, JSON.stringify(m) + '\n');
  run(process.execPath, signArgs, dir);
  run(process.execPath, verifierArgs, dir);
  m.gitBranch = '';
  fs.writeFileSync(manifestPath, JSON.stringify(m) + '\n');
  const signFailure = run(process.execPath, signArgs, dir, false);
  assert.notEqual(signFailure.status, 0, 'Signer accepted an empty branch');
  assert.match(signFailure.stderr, /gitBranch must be nonempty/);
  // A pre-signed malformed manifest must also fail independent verification.
  fs.writeFileSync(signaturePath,
    crypto.sign(null, fs.readFileSync(manifestPath), keys.privateKey).toString('base64') + '\n');
  const verifyFailure = run(process.execPath, verifierArgs, dir, false);
  assert.notEqual(verifyFailure.status, 0, 'Verifier accepted a signed empty branch');
  assert.match(verifyFailure.stderr, /gitBranch must be nonempty/);
});

test('actual production selection prefers higher signed release with omitted branch', t => {
  const base = fresh(t);
  const keys = crypto.generateKeyPairSync('ed25519');
  const trust = path.join(base, 'scripts/release/keys');
  fs.mkdirSync(trust, { recursive: true });
  fs.writeFileSync(path.join(trust, 'crylo-testnet-release-ed25519-public.pem'),
    keys.publicKey.export({ type: 'spki', format: 'pem' }));
  const seq21Commit = '1'.repeat(40), seq24Commit = '2'.repeat(40);
  const releases = [
    signFixture(base, 21, seq21Commit, keys, 'feature/old'),
    signFixture(base, 24, seq24Commit, keys)
  ];
  const production = [
    sourceBetween('function verifyManifestWithCurrentTrust(', '\nfunction releaseTarget('),
    sourceBetween('function expectedSignedBundleName(', '\nfunction fetchAuthenticatedReleaseSource('),
    sourceBetween('function authenticateSignedRelease(', '\nfunction resumedReleaseAuthorization(')
  ].join('\n');
  const makeContext = () => {
    const chosen = [];
    const c = {
      fs, path, os, crypto, Buffer, process, console,
      root: base, network: { mode: 'testnet', bootstrapReleaseSequence: 2 },
      releaseRepository: 'Heff546/CryLo', releaseVerifierScript: verifierSource,
      releaseTarget: () => ({ platform: 'win', architecture: 'x64' }),
      readReleaseSecurityState: () => ({
        highestAcceptedReleaseSequence: 21, lastAcceptedGitCommit: seq21Commit,
        lastAcceptedReleaseTag: 'v1.1.1-testnet.21', lastAcceptedVersion: '1.1.1'
      }),
      httpsText: url => {
        assert.equal(url, 'https://api.github.com/repos/Heff546/CryLo/releases?per_page=100');
        return JSON.stringify(releases);
      },
      httpsDownload: (url, destination) => {
        const u = new URL(url);
        const parts = u.pathname.split('/');
        fs.copyFileSync(path.join(base, 'release-' + parts[1], parts[2]), destination);
      },
      fetchAuthenticatedReleaseSource: (m, current) => {
        chosen.push(m.releaseTag);
        assert.equal(current, seq21Commit);
        return m.gitCommit;
      },
      spawnSync: child.spawnSync,
      fail: msg => { throw new Error(String(msg)); }
    };
    const v = vm.createContext(c);
    vm.runInContext(production + '\nthis.getSelectedRelease = authenticateSignedRelease;', v);
    return { v, chosen };
  };
  const good = makeContext();
  const authorized = good.v.getSelectedRelease(seq21Commit);
  assert.equal(authorized.releaseSequence, 24);
  assert.equal(authorized.releaseTag, 'v1.1.1-testnet.24');
  assert.equal(authorized.gitCommit, seq24Commit);
  assert.deepEqual(good.chosen, ['v1.1.1-testnet.24']);
  // The withdrawn release's exact bug: explicitly empty but signed branch.
  const mFile = path.join(base, 'release-24/crylo-release-manifest.json');
  const m = JSON.parse(fs.readFileSync(mFile, 'utf8'));
  m.gitBranch = '';
  const bytes = Buffer.from(JSON.stringify(m) + '\n');
  fs.writeFileSync(mFile, bytes);
  fs.writeFileSync(mFile + '.sig',
    crypto.sign(null, bytes, keys.privateKey).toString('base64') + '\n');
  const bad = makeContext();
  const fallback = bad.v.getSelectedRelease(seq21Commit);
  assert.equal(fallback.releaseSequence, 21);
  assert.deepEqual(bad.chosen, ['v1.1.1-testnet.21']);
});
