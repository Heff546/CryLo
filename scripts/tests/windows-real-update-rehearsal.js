'use strict';

// CI only: production dispatcher and updater run unchanged in a VM. Only
// HTTPS transport and subprocess re-entry are redirected to this local fixture.
// The NSIS executable is real; failure is injected only in the negative case.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const child = require('node:child_process');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const assert = require('node:assert/strict');
const originalSpawn = child.spawnSync;
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const json = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const write = (p, value) => fs.writeFileSync(p, JSON.stringify(value, null, 2) + '\n');
function run(exe, args, options = {}) {
  const r = originalSpawn(exe, args, { encoding: 'utf8', shell: false, timeout: 360000, maxBuffer: 16 * 1024 * 1024, ...options });
  if (r.error || r.status !== 0) throw new Error(`${exe}: ${r.error?.message || r.stderr || r.stdout || r.status}`);
  return String(r.stdout || '').trim();
}
function find(dir, name) {
  const found = [];
  function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name === name) found.push(p); } }
  walk(dir); assert.equal(found.length, 1, `Expected exactly one ${name}: ${found}`); return found[0];
}
function executeFixture(configPath) {
  const c = json(configPath);
  assert.equal(process.platform, 'win32'); assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.ok(!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN, 'User update must have no GitHub token');
  const script = path.join(c.client, 'scripts/crylo.js');
  const source = fs.readFileSync(script, 'utf8');
  const split = source.indexOf('const args = process.argv.slice(2);');
  assert.ok(split > 0);
  child.spawnSync = function(exe, args = [], options = {}) {
    assert.doesNotMatch(path.basename(exe), /^(?:powershell|pwsh)(?:\.exe)?$/i, 'Updater attempted PowerShell');
    assert.equal(options.shell === true, false, 'Unexpected command shell');
    fs.appendFileSync(c.calls, JSON.stringify({ exe, args }) + '\n');
    if (exe === process.execPath && args[0] === script && args[1] === 'update') {
      return originalSpawn(exe, [__filename, 'execute', configPath], { ...options, timeout: 360000 });
    }
    if (path.basename(exe) === 'CryLo-Wallet-Setup-1.1.1-x64.exe') {
      assert.equal(fs.existsSync(c.state), false, 'Release state advanced before installer success');
      if (c.failInstaller) return { status: 42 };
    }
    return originalSpawn(exe, args, { timeout: 360000, ...options });
  };
  const localRequire = createRequire(script);
  const context = vm.createContext({ require: localRequire, __dirname: path.dirname(script), __filename: script,
    process: Object.assign(Object.create(process), { argv: [process.execPath, script, 'update'] }),
    console, Buffer, URL, setTimeout, clearTimeout });
  vm.runInContext(source.slice(0, split), context, { filename: script });
  // Keep signature verification, exact-tag Git fetch, artifact hashing and
  // installation intact. Substitute only the release transport with files.
  context.fixtureText = url => {
    if (url === 'https://api.github.com/repos/Heff546/CryLo/releases?per_page=100') return JSON.stringify([c.release]);
    if (url === 'https://api.github.com/repos/Heff546/CryLo/releases/tags/' + c.release.tag_name) return JSON.stringify(c.release);
    throw new Error('Unexpected fixture URL: ' + url);
  };
  context.fixtureDownload = (url, dest) => {
    const asset = c.release.assets.find(a => a.browser_download_url === url);
    assert.ok(asset, 'Unknown fixture asset');
    fs.copyFileSync(path.join(c.assets, asset.name), dest);
  };
  vm.runInContext('httpsText = fixtureText; httpsDownload = fixtureDownload;', context);
  vm.runInContext(source.slice(split), context, { filename: script });
}

function prepareAndRun() {
  assert.equal(process.platform, 'win32'); assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.ok(!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN);
  const repo = path.resolve(__dirname, '../..'), temp = process.env.RUNNER_TEMP;
  const base = path.join(temp, 'crylo-real-update-rehearsal');
  assert.ok(!fs.existsSync(base)); fs.mkdirSync(base);
  const report = { classification: 'CI_LOCAL_TRANSPORT_REAL_NSIS_UPDATE_REHEARSAL', productionCommit: process.env.GITHUB_SHA,
    nativeRebuilt: false, productionSigningUsed: false, published: false, liveHttpsValidated: false,
    versionUpgradeValidated: false, daemonRestartValidated: false, tests: {} };
  const reportPath = path.join(temp, 'crylo-real-update-report.json');
  try {
    const artifact = path.join(temp, 'crylo-corrected-installer');
    const setup = find(artifact, 'CryLo Wallet Setup 1.1.1.exe');
    const receipt = json(find(artifact, 'crylo-electron-only-audit.json'));
    assert.equal(sha(setup), receipt.setupSha256);
    assert.equal(receipt.electronPackagingCommit, '99cb41d4ec0f4dc520dfe5638817ed123462ca76');
    assert.equal(receipt.nativeSourceCommit, '5120debcc2a75fa0c7198ee0137f142dd0a5f6a8');
    assert.equal(receipt.originalRuntimeDllsPreserved, 55);
    assert.equal(json(find(artifact, 'crylo-electron-zero-audit.json')).metadata.vulnerabilities.total, 0);
    const nativeArtifact = path.join(temp, 'crylo-verified-native');
    const manifestPath = find(nativeArtifact, 'WINDOWS-BUILD-RUNTIME-MANIFEST.json');
    const originalManifest = json(manifestPath);
    assert.equal(originalManifest.gitCommit, receipt.nativeSourceCommit);
    assert.equal(originalManifest.roots.length, 3); assert.equal(originalManifest.runtime.length, 55);
    const originals = new Map();
    for (const e of [...originalManifest.roots, ...originalManifest.runtime]) {
      const p = find(nativeArtifact, e.file); assert.equal(sha(p), e.sha256); originals.set(e.file, p);
    }
    // Seed real user-data locations before the initial NSIS install.
    const markers = [path.join(process.env.LOCALAPPDATA, 'CryLo/wallets/rehearsal-wallet'),
      path.join(process.env.APPDATA, 'crylo-wallet/wallets/rehearsal-wallet'),
      path.join(process.env.APPDATA, 'CryLo/CryLo.conf')];
    for (const p of markers) { assert.ok(!fs.existsSync(p)); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, crypto.randomBytes(96)); }
    const markerHashes = markers.map(sha);
    const preserve = () => markers.forEach((p, i) => assert.equal(sha(p), markerHashes[i], 'User data changed: ' + p));
    const install = path.join(base, 'installed-wallet');
    run(setup, ['/S', '/D=' + install]);
    assert.ok(fs.existsSync(path.join(install, 'CryLo Wallet.exe'))); preserve();
    const bootstrap = path.join(process.env.LOCALAPPDATA, 'CryLo/installer-bootstrap.log');
    assert.match(fs.readFileSync(bootstrap, 'utf8'), /RESULT=READY/);
    report.tests.initialInstall = true;
    const managed = path.join(process.env.LOCALAPPDATA, 'CryLo/runtime');
    const gitExe = path.join(managed, 'mingit-2.56.0.windows.1-x64/cmd/git.exe');
    const author = path.join(base, 'author'), client = path.join(base, 'client');
    const git = (cwd, ...args) => run(gitExe, args, { cwd });
    git(base, 'clone', '--no-hardlinks', repo, author);
    git(author, 'config', 'user.name', 'CryLo ephemeral CI fixture');
    git(author, 'config', 'user.email', 'ci@invalid.example');
    const keys = crypto.generateKeyPairSync('ed25519');
    fs.writeFileSync(path.join(author, 'scripts/release/keys/crylo-testnet-release-ed25519-public.pem'), keys.publicKey.export({ type: 'spki', format: 'pem' }));
    git(author, 'add', 'scripts/release/keys/crylo-testnet-release-ed25519-public.pem');
    git(author, 'commit', '-m', 'CI ONLY ephemeral trust anchor');
    const before = git(author, 'rev-parse', 'HEAD');
    git(base, 'clone', '--no-hardlinks', author, client);
    fs.writeFileSync(path.join(author, 'ci-release-fixture.txt'), 'CI ONLY source update marker\n');
    git(author, 'add', 'ci-release-fixture.txt'); git(author, 'commit', '-m', 'CI ONLY release fixture');
    const after = git(author, 'rev-parse', 'HEAD'), tag = 'v1.1.1-testnet.9001';
    git(author, 'tag', '-a', tag, '-m', 'CI ONLY ephemeral release');
    assert.equal(sha(path.join(client, 'scripts/crylo.js')), sha(path.join(repo, 'scripts/crylo.js')));
    const bin = path.join(client, 'build/win-x64/bin'); fs.mkdirSync(bin, { recursive: true });
    for (const [name, file] of originals) fs.copyFileSync(file, path.join(bin, name));
    fs.copyFileSync(manifestPath, path.join(bin, path.basename(manifestPath)));
    fs.writeFileSync(path.join(bin, 'BINARY-MANIFEST.txt'), 'prior fixture metadata\n');
    const prior = fs.readdirSync(bin).map(name => [name, sha(path.join(bin, name))]);
    const assets = path.join(base, 'assets'), stage = path.join(base, 'bundle');
    fs.mkdirSync(assets); fs.mkdirSync(stage);
    for (const [name, file] of originals) fs.copyFileSync(file, path.join(stage, name));
    // Test-only release metadata binds the local fixture commit while retaining
    // original compiler provenance separately. No binary bytes are modified.
    const runtime = { ...originalManifest, gitCommit: after, nativeSourceCommit: receipt.nativeSourceCommit, ciOnly: true };
    const rm = path.join(stage, 'WINDOWS-BUILD-RUNTIME-MANIFEST.json'); write(rm, runtime);
    fs.writeFileSync(path.join(stage, 'BINARY-MANIFEST.txt'), ['Platform: win', 'Architecture: x64', 'Network: testnet',
      'Runtime-Manifest: WINDOWS-BUILD-RUNTIME-MANIFEST.json', 'Runtime-Manifest-SHA256: ' + sha(rm), 'Windows-Runtime-DLL-Count: 55'].join('\n') + '\n');
    fs.copyFileSync(setup, path.join(stage, 'CryLo-Wallet-Setup-1.1.1-x64.exe'));
    const bundle = path.join(assets, 'CryLo-Release-1.1.1-win-x64.zip');
    run(path.join(process.env.SystemRoot, 'System32/tar.exe'), ['-a', '-cf', bundle, ...fs.readdirSync(stage)], { cwd: stage });
    const manifest = { schema: 1, product: 'CryLo', network: 'testnet', version: '1.1.1', releaseTag: tag,
      releaseSequence: 9001, gitCommit: after, signatureAlgorithm: 'Ed25519', hashAlgorithm: 'SHA-256', createdUtc: new Date().toISOString(),
      artifacts: [{ platform: 'win', architecture: 'x64', file: path.basename(bundle), size: fs.statSync(bundle).size, sha256: sha(bundle) }] };
    const mf = path.join(assets, 'crylo-release-manifest.json'); write(mf, manifest);
    const signature = crypto.sign(null, fs.readFileSync(mf), keys.privateKey).toString('base64') + '\n';
    const sf = mf + '.sig'; fs.writeFileSync(sf, signature);
    const release = { id: 9001, draft: false, prerelease: true, tag_name: tag,
      assets: fs.readdirSync(assets).map(name => ({ name, browser_download_url: 'https://fixture.invalid/' + name })) };
    const state = path.join(process.env.APPDATA, 'crylo-wallet/release-security.json'); assert.ok(!fs.existsSync(state));
    const config = { client, assets, release, state, calls: path.join(base, 'calls.jsonl'), failInstaller: false };
    const configPath = path.join(base, 'fixture.json');
    const env = { ...process.env, CRYLO_GIT_RUNTIME: path.dirname(path.dirname(gitExe)), GIT_TERMINAL_PROMPT: '0' };
    for (const name of ['CRYLO_UPDATE_RESUMED','CRYLO_AUTHORIZED_COMMIT','CRYLO_AUTHORIZED_SEQUENCE','CRYLO_AUTHORIZED_TAG','CRYLO_AUTHORIZED_VERSION']) delete env[name];
    const attempt = name => {
      write(configPath, config);
      const r = originalSpawn(process.execPath, [__filename, 'execute', configPath], { env, encoding: 'utf8', timeout: 600000, maxBuffer: 32 * 1024 * 1024 });
      fs.writeFileSync(path.join(base, name + '.log'), String(r.stdout || '') + String(r.stderr || ''));
      console.log(name + ': exit=' + r.status);
      if (r.error) throw r.error;
      return r;
    };
    // Negative authorization: no merge, installer, or state changes permitted.
    fs.writeFileSync(sf, Buffer.alloc(64).toString('base64') + '\n');
    assert.notEqual(attempt('tampered-signature').status, 0);
    assert.equal(git(client, 'rev-parse', 'HEAD'), before); assert.ok(!fs.existsSync(state)); preserve();
    fs.writeFileSync(sf, signature); report.tests.tamperedSignatureRejected = true;
    // A failed installer must restore the prior native/metadata files and not
    // advance release-security state. Source advancement is intentionally retained.
    config.failInstaller = true;
    const failed = attempt('installer-failure'); assert.notEqual(failed.status, 0);
    assert.match(failed.stdout + failed.stderr, /installer exited with code 42/);
    assert.equal(git(client, 'rev-parse', 'HEAD'), after); assert.ok(!fs.existsSync(state));
    for (const [name, hash] of prior) assert.equal(sha(path.join(bin, name)), hash, 'Rollback mismatch: ' + name);
    preserve(); report.tests.nativeRollbackAndStatePreserved = true;
    config.failInstaller = false;
    fs.rmSync(bootstrap); // Require a fresh NSIS success receipt.
    const success = attempt('real-nsis-update');
    assert.equal(success.status, 0, success.stdout + success.stderr);
    assert.match(success.stdout, /CryLo update completed successfully/);
    assert.match(fs.readFileSync(bootstrap, 'utf8'), /RESULT=READY/);
    assert.equal(json(state).highestAcceptedReleaseSequence, 9001);
    assert.equal(json(state).lastAcceptedGitCommit, after);
    preserve();
    for (const [name, file] of originals) assert.equal(sha(path.join(bin, name)), sha(file));
    assert.ok(fs.existsSync(path.join(install, 'CryLo Wallet.exe')));
    const calls = fs.readFileSync(config.calls, 'utf8').trim().split('\n').map(JSON.parse);
    assert.ok(calls.some(x => path.basename(x.exe) === 'CryLo-Wallet-Setup-1.1.1-x64.exe'));
    assert.ok(calls.some(x => path.basename(x.exe).toLowerCase() === 'tar.exe'));
    assert.ok(calls.some(x => path.basename(x.exe).toLowerCase() === 'cscript.exe'));
    report.tests.realNsisUpdate = true; report.tests.walletAndConfigPreserved = true;
    report.tests.nativeHashesPreserved = 3; report.tests.runtimeDllHashesPreserved = 55;
    report.tests.stateAdvancedAfterSuccess = true;
    report.tests.noPowerShellRequestedByUpdater = true;
    console.log('PASS: production updater + temporary signed fixture + real NSIS + preservation + failure rollback');
  } finally { write(reportPath, report); }
}
if (process.argv[2] === 'execute') executeFixture(process.argv[3]); else prepareAndRun();
