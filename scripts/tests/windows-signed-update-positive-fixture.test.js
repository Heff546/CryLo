'use strict';

// A Windows-only integration harness for the UNMODIFIED production update()
// orchestration, signed tag ancestry and release-security-state logic.
//
// Only a throwaway local Git origin, throwaway Ed25519 keys and a synthetic
// tiny artifact are used. Network discovery and native bundle installation
// are explicitly substituted. This does NOT claim to test a real release
// download, Electron/NSIS install, daemon restart or public signing.
// No production trust key or release is ever created or modified.
const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const child = require('node:child_process');

const root = path.resolve(__dirname, '..', '..');
const source = fs.readFileSync(path.join(root, 'scripts', 'crylo.js'), 'utf8');
const releaseVerifier = path.join(root, 'scripts', 'release', 'verify-release-manifest.js');

function between(start, end) {
  const i = source.indexOf(start);
  const j = source.indexOf(end, i + start.length);
  assert.ok(i >= 0 && j > i, 'Missing original production function: ' + start);
  return source.slice(i, j);
}

const production = [
  between('function cryloConfigRoot() {', '\nfunction sha256File('),
  between('function fetchAuthenticatedReleaseSource(', '\nfunction authenticateSignedRelease('),
  between('function resumedReleaseAuthorization(', '\nfunction downloadAuthorizedReleaseBundle('),
  between('function update() {', '\nfunction probe(')
].join('\n');

class ExitCode extends Error {
  constructor(code) {
    super('Test harness intercepted process.exit(' + code + ')');
    this.exitCode = code;
  }
}

function command(cwd, ...args) {
  const response = child.spawnSync('git', args, {
    cwd, encoding: 'utf8', shell: false, windowsHide: true, timeout: 20000
  });
  assert.equal(response.error, undefined, 'Git execution error: ' + args.join(' '));
  assert.equal(response.status, 0, 'Git ' + args.join(' ') + ': ' + response.stderr);
  return String(response.stdout || '').trim();
}

function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'crylo-win-signed-positive-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const bare = path.join(base, 'bare.git');
  const author = path.join(base, 'author');
  const client = path.join(base, 'client');
  fs.mkdirSync(author);
  command(base, 'init', '--bare', bare);
  command(author, 'init', '-b', 'main');
  command(author, 'config', 'user.email', 'ci-positive-test@invalid.example');
  command(author, 'config', 'user.name', 'CryLo Local CI Fixture');
  fs.writeFileSync(path.join(author, 'fixture.txt'), 'before-released-source\n');
  command(author, 'add', 'fixture.txt');
  command(author, 'commit', '-m', 'local test base');
  const before = command(author, 'rev-parse', 'HEAD');
  command(author, 'remote', 'add', 'origin', bare);
  command(author, 'push', '-u', 'origin', 'main');
  command(bare, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  fs.writeFileSync(path.join(author, 'fixture.txt'), 'after-signed-release\n');
  command(author, 'add', 'fixture.txt');
  command(author, 'commit', '-m', 'local signed test release');
  const after = command(author, 'rev-parse', 'HEAD');
  const releaseTag = 'v1.1.1-testnet.30';
  command(author, 'tag', '-a', releaseTag, '-m', 'local ephemeral annotated CI test tag');
  command(author, 'push', 'origin', 'main', releaseTag);
  command(base, 'clone', bare, client);
  command(client, 'reset', '--hard', before);
  assert.equal(command(client, 'rev-parse', 'HEAD'), before);

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const trustPath = path.join(base, 'ephemeral-ci-public.pem');
  const manifestPath = path.join(base, 'crylo-release-manifest.json');
  const signaturePath = manifestPath + '.sig';
  const artifactPath = path.join(base, 'CryLo-Release-1.1.1-win-x64.zip');
  const synthetic = Buffer.from('SYNTHETIC CI UPDATE ARTIFACT - NOT EXECUTABLE\n');
  fs.writeFileSync(artifactPath, synthetic);
  fs.writeFileSync(trustPath, publicKey.export({ type: 'spki', format: 'pem' }));
  const manifest = {
    schema: 1,
    product: 'CryLo',
    network: 'testnet',
    version: '1.1.1',
    releaseTag,
    releaseSequence: 30,
    gitCommit: after,
    signatureAlgorithm: 'Ed25519',
    hashAlgorithm: 'SHA-256',
    createdUtc: new Date().toISOString(),
    artifacts: [{
      platform: 'win',
      architecture: 'x64',
      file: path.basename(artifactPath),
      size: synthetic.length,
      sha256: crypto.createHash('sha256').update(synthetic).digest('hex')
    }]
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest) + '\n');
  fs.writeFileSync(manifestPath, manifestBytes);
  fs.writeFileSync(signaturePath, crypto.sign(null, manifestBytes, privateKey).toString('base64') + '\n');

  const appDir = path.join(base, 'isolated-application');
  const configDir = path.join(base, 'isolated-user-config');
  fs.mkdirSync(appDir);
  fs.mkdirSync(configDir);
  const wallet = path.join(configDir, 'never-replace-wallet.fixture');
  const configuration = path.join(configDir, 'never-replace-config.fixture');
  fs.writeFileSync(wallet, 'EXISTING WALLET TEST BYTES\n');
  fs.writeFileSync(configuration, 'EXISTING CONFIG TEST BYTES\n');
  const walletHash = hash(wallet), configurationHash = hash(configuration);

  return { base, bare, author, client, before, after, releaseTag, trustPath,
    manifestPath, signaturePath, artifactPath, manifest, appDir, configDir,
    wallet, configuration, walletHash, configurationHash };
}

function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function checkSignedFixture(f, minimumSequence) {
  const result = child.spawnSync(process.execPath, [
    releaseVerifier, '--network', 'testnet',
    '--platform', 'win', '--architecture', 'x64',
    '--minimum-sequence', String(minimumSequence),
    '--manifest', f.manifestPath, '--signature', f.signaturePath,
    '--public-key', f.trustPath
  ], { cwd: f.base, encoding: 'utf8', windowsHide: true, timeout: 20000 });
  if (result.error || result.status !== 0) {
    throw new Error('Production verifier refused local fixture: ' + (result.stderr || String(result.error)));
  }
}

function orchestrator(f, opts = {}) {
  const log = [];
  const env = {
    ...process.env,
    USERPROFILE: f.configDir,
    HOME: f.configDir,
    APPDATA: f.configDir,
    CRYLO_UPDATE_RESUMED: '',
    CRYLO_AUTHORIZED_COMMIT: '',
    CRYLO_AUTHORIZED_SEQUENCE: '',
    CRYLO_AUTHORIZED_TAG: '',
    CRYLO_AUTHORIZED_VERSION: ''
  };
  const p = {
    platform: 'win32', arch: 'x64', execPath: '__ci_node__',
    env, pid: process.pid,
    exit(code) { throw new ExitCode(code); }
  };
  const context = {
    console: { log(...x) { log.push(x.join(' ')); }, warn(...x) { log.push(x.join(' ')); } },
    process: p, fs, path,
    root: f.client,
    network: { mode: 'testnet', bootstrapReleaseSequence: 2 },
    generatedElectronInputs: [],
    __filename: '__ci_crylo_script__',
    fail(message) { throw new Error(String(message)); },
    gitExecutable() { return 'git'; },
    git(args) {
      log.push('git:' + args.join(' '));
      return command(f.client, ...args);
    },
    releaseTarget() { return { platform: 'win', architecture: 'x64' }; },
    ensureLinuxBuildDependencies() { throw new Error('Native build forbidden in Windows fixture'); },
    ensureLinuxRuntimeDependencies() { throw new Error('Linux dependency path forbidden'); },
    deployInfrastructureRelease() { log.push('deployed-fixture'); },
    installUserCommand() { log.push('updated-fixture-cli'); },
    installLinuxDesktopLaunchers() {},
    installWindowsDesktopLaunchers() { log.push('desktop-fixture'); },
    prepareAuthorizedMacUpdate() { throw new Error('macOS updater path forbidden'); },
    installAuthorizedReleaseBundle(authorization) {
      log.push('install-fixture-' + authorization.releaseTag);
      assert.equal(command(f.client, 'rev-parse', 'HEAD'), f.after);
      checkSignedFixture(f, 30);
      if (opts.failInstall) throw new Error('injected fixture install failure');
      fs.copyFileSync(f.artifactPath, path.join(f.appDir, 'installed-synthetic-artifact'));
    },
    spawnSync(executable, args, options) {
      if (executable === '__ci_node__' && args.join(' ') === '__ci_crylo_script__ update') {
        log.push('resume-fixture-child');
        const previous = p.env;
        p.env = { ...options.env };
        try {
          context.runUpdate();
          return { status: 0 };
        } catch (error) {
          if (error instanceof ExitCode) return { status: error.exitCode };
          log.push('resumed error: ' + error.message);
          return { status: 1 };
        } finally {
          p.env = previous;
        }
      }
      if (executable === 'git') {
        const result = child.spawnSync('git', args, {
          cwd: options.cwd, env: options.env,
          encoding: options.encoding || 'utf8',
          shell: false, windowsHide: true, timeout: 20000
        });
        return result;
      }
      throw new Error('Unexpected child process attempted: ' + executable);
    }
  };
  const vmContext = vm.createContext(context);
  vm.runInContext(production + '\nthis.runUpdate=update;this.fetchTag=fetchAuthenticatedReleaseSource;', vmContext, { filename: 'crylo-production-update.js' });
  context.authenticateSignedRelease = function (currentCommit, options = {}) {
    log.push('verify-production-signed-fixture');
    if (opts.tamperManifest) {
      fs.appendFileSync(f.manifestPath, 'TAMPER');
    }
    checkSignedFixture(f, 30);
    const commit = context.fetchTag(f.manifest, currentCommit);
    if (options.requireCommit && options.requireCommit !== commit) {
      throw new Error('Required signed commit mismatch');
    }
    return { releaseSequence: 30, releaseTag: f.releaseTag,
      version: '1.1.1', gitCommit: commit };
  };
  // IMPORTANT: vm global bindings are the context object. Provide the
  // test-only auth function before invoking production update().
  function call() {
    try { context.runUpdate(); return { code: 0 }; }
    catch (error) {
      if (error instanceof ExitCode) return { code: error.exitCode };
      return { code: 1, error };
    }
  }
  return { call, log };
}

function assertWalletUntouched(f) {
  assert.equal(hash(f.wallet), f.walletHash, 'Wallet fixture changed');
  assert.equal(hash(f.configuration), f.configurationHash, 'User config fixture changed');
}

test('real production Windows update() authorizes an ephemeral signed fast-forward, resumes and advances state', t => {
  const f = fixture(t);
  const sim = orchestrator(f);
  const result = sim.call();
  assert.equal(result.error, undefined, result.error?.stack);
  assert.equal(result.code, 0, 'Orchestrator failed: ' + sim.log.join('\n'));
  assert.equal(command(f.client, 'rev-parse', 'HEAD'), f.after);
  assert.equal(command(f.client, 'status', '--porcelain'), '');
  assert.equal(fs.readFileSync(path.join(f.client, 'fixture.txt'), 'utf8').replace(/\r\n/g, '\n'), 'after-signed-release\n');
  assert.equal(fs.readFileSync(path.join(f.appDir, 'installed-synthetic-artifact'), 'utf8'),
    fs.readFileSync(f.artifactPath, 'utf8'));
  const releaseState = JSON.parse(fs.readFileSync(path.join(f.configDir, 'crylo-wallet', 'release-security.json'), 'utf8'));
  assert.equal(releaseState.highestAcceptedReleaseSequence, 30);
  assert.equal(releaseState.lastAcceptedGitCommit, f.after);
  assert.equal(releaseState.lastAcceptedReleaseTag, f.releaseTag);
  assert.ok(sim.log.indexOf('verify-production-signed-fixture') <
    sim.log.findIndex(x => x.startsWith('git:merge --ff-only ')), 'Source merged before authentication');
  assert.ok(sim.log.includes('resume-fixture-child'), 'Updater did not resume');
  assert.ok(sim.log.includes('deployed-fixture'), 'Updater skipped deployment stage');
  assertWalletUntouched(f);
});

test('real production Windows update() rejects changed signed data before changing local Git HEAD or wallets', t => {
  const f = fixture(t);
  const sim = orchestrator(f, { tamperManifest: true });
  const result = sim.call();
  assert.notEqual(result.code, 0, 'Tampered signed manifest was accepted');
  assert.match(result.error?.message || '', /Production verifier refused local fixture/);
  assert.equal(command(f.client, 'rev-parse', 'HEAD'), f.before);
  assert.equal(command(f.client, 'status', '--porcelain'), '');
  assert.equal(fs.existsSync(path.join(f.appDir, 'installed-synthetic-artifact')), false);
  assert.equal(fs.existsSync(path.join(f.configDir, 'crylo-wallet', 'release-security.json')), false);
  assertWalletUntouched(f);
});
