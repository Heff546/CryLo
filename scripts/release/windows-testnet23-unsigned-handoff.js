'use strict';

// CI-only unsigned Testnet.23 release handoff. No signing or publication.
// Source must match the exact commit used to package the NSIS installer.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const PACKAGED_COMMIT = '25ff0f466647761d30fcab532b89f729f3e68df2';
const COMPILED_COMMIT = '5120debcc2a75fa0c7198ee0137f142dd0a5f6a8';
const INSTALLER_SHA = '8107804a6239f4fad57db23829aea029f8687452ff7e94c0e8b3669a39bc43df';
const BUNDLE_NAME = 'CryLo-Release-1.1.1-win-x64.zip';
const INSTALLER_NAME = 'CryLo-Wallet-Setup-1.1.1-x64.exe';
const RUNTIME_NAME = 'WINDOWS-BUILD-RUNTIME-MANIFEST.json';
const BINARY_NAME = 'BINARY-MANIFEST.txt';
const NATIVE_NAMES = ['CryLo-daemon.exe', 'CryLo-wallet.exe', 'CryLo-wallet-rpc.exe'];
const DLL_COUNT = 55;

function fail(msg) { throw new Error(msg); }
function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); }
function hash(file) {
  const fd = fs.openSync(file, 'r');
  const h = crypto.createHash('sha256');
  const buf = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (!n) break;
      h.update(buf.subarray(0, n));
    }
  } finally { fs.closeSync(fd); }
  return h.digest('hex');
}
function regular(p) {
  const st = fs.lstatSync(p);
  if (!st.isFile() || st.isSymbolicLink()) fail('Non-regular release input: ' + p);
  return st;
}
function walkFiles(root) {
  const paths = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const st = fs.lstatSync(full);
      if (st.isSymbolicLink()) fail('Symlink in audited CI source: ' + full);
      if (st.isDirectory()) walk(full);
      else if (st.isFile()) paths.push(full);
      else fail('Unexpected file kind in audited CI source: ' + full);
    }
  }
  walk(root);
  return paths;
}
function exactlyOne(files, name) {
  const candidates = files.filter(p => path.basename(p) === name);
  if (candidates.length !== 1) {
    fail('Expected exactly one ' + name + '; found ' + candidates.length);
  }
  regular(candidates[0]);
  return candidates[0];
}
function checkContent(file, expectedSha, expectedSize) {
  const st = regular(file);
  if (st.size !== expectedSize || hash(file) !== expectedSha) {
    fail('Size/SHA256 changed: ' + path.basename(file));
  }
}
function checkedRun(exe, args, cwd) {
  const r = cp.spawnSync(exe, args, {
    cwd, encoding: 'utf8', shell: false, windowsHide: true,
    timeout: 180000, maxBuffer: 8 * 1024 * 1024
  });
  if (r.error || r.status !== 0) {
    fail('Archive tool failed: ' + String(r.error?.message || r.stderr || r.stdout || r.status));
  }
  return String(r.stdout || '');
}
function sameManifestFile(a, b, field, file) {
  if (a.file !== file || b.file !== file || a.sha256 !== b.sha256 ||
      a.size !== b.size || a.architecture !== 'x64' || b.architecture !== 'x64') {
    fail('Compiled native file differs from packaged native file: ' + file);
  }
  if (field === 'runtime' && (a.package !== b.package ||
      a.packageVersion !== b.packageVersion)) {
    fail('Runtime DLL dependency package/version drift: ' + file);
  }
}
function compareEntries(original, packaged, field, count) {
  const prior = original[field];
  const next = packaged[field];
  if (!Array.isArray(prior) || !Array.isArray(next) ||
      prior.length !== count || next.length !== count) {
    fail('Native manifest root/runtime count changed: ' + field);
  }
  const names = new Set();
  const byName = new Map(prior.map(x => [x.file, x]));
  if (byName.size !== count) fail('Duplicate native file in original manifest');
  for (const entry of next) {
    if (names.has(entry.file)) fail('Duplicate native file in packaged manifest');
    names.add(entry.file);
    const before = byName.get(entry.file);
    if (!before) fail('Unrecognized native component: ' + entry.file);
    sameManifestFile(before, entry, field, entry.file);
  }
  return next;
}
function main() {
  if (process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true') {
    fail('Unsigned handoff assembly is restricted to GitHub Windows CI.');
  }
  const base = process.env.RUNNER_TEMP;
  const originalDir = path.join(base, 'crylo-testnet23-native');
  const artifactDir = path.join(base, 'crylo-testnet23-installer');
  const installedDir = path.join(base, 'crylo-testnet23-verified-install');
  const outputDir = path.join(base, 'crylo-testnet23-handoff');
  for (const p of [originalDir, artifactDir, installedDir]) {
    if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) fail('Missing input: ' + p);
  }
  if (fs.existsSync(outputDir)) fail('Handoff destination already exists: ' + outputDir);

  const files = walkFiles(originalDir);
  const originals = readJson(exactlyOne(files, RUNTIME_NAME));
  if (originals.product !== 'CryLo' ||
      originals.gitCommit !== COMPILED_COMMIT ||
      originals.network !== 'testnet' || originals.architecture !== 'x64') {
    fail('Compiled native provenance is not the exact CryLo Testnet Windows input.');
  }

  const downloaded = walkFiles(artifactDir);
  const receipt = readJson(exactlyOne(downloaded, 'crylo-testnet23-package-audit.json'));
  const suppliedInstaller = exactlyOne(downloaded, 'CryLo Wallet Setup 1.1.1.exe');
  if (receipt.kind !== 'CRYLO_TESTNET23_UNSIGNED_CI_PACKAGING_CANDIDATE' ||
      receipt.gitCommit !== PACKAGED_COMMIT ||
      receipt.nativeSourceCommit !== COMPILED_COMMIT ||
      receipt.nativeRebuilt !== false || receipt.signed !== false ||
      receipt.published !== false || receipt.eligibleForPublication !== false ||
      receipt.network !== 'testnet' || receipt.nativeRoots !== 3 ||
      receipt.nativeDlls !== DLL_COUNT || receipt.installer?.sha256 !== INSTALLER_SHA) {
    fail('Unsigned Electron/NSIS package audit does not match reviewed inputs.');
  }
  checkContent(suppliedInstaller, INSTALLER_SHA, receipt.installer.size);

  const packagedRoot = path.join(installedDir, 'resources', 'bin', 'win');
  const installedManifest = path.join(packagedRoot, RUNTIME_NAME);
  const installedBinaryManifest = path.join(packagedRoot, BINARY_NAME);
  const packaged = readJson(installedManifest);
  if (packaged.product !== 'CryLo' ||
      packaged.gitCommit !== PACKAGED_COMMIT ||
      packaged.network !== 'testnet' || packaged.architecture !== 'x64') {
    fail('Real NSIS packaged manifest does not identify exact release source.');
  }
  const originalNative = compareEntries(originals, packaged, 'roots', 3);
  const runtime = compareEntries(originals, packaged, 'runtime', DLL_COUNT);
  const manifestText = fs.readFileSync(installedBinaryManifest, 'utf8');
  if (!manifestText.includes('Runtime-Manifest-SHA256: ' + hash(installedManifest)) ||
      !manifestText.includes('Windows-Runtime-DLL-Count: 55') ||
      !manifestText.includes('Network: testnet')) {
    fail('Packaged BINARY-MANIFEST.txt does not authenticate runtime and network.');
  }
  for (const n of NATIVE_NAMES) {
    if (!originalNative.some(e => e.file === n)) fail('Missing official native root ' + n);
  }

  const stage = fs.mkdtempSync(path.join(base, 'crylo-testnet23-bundle-stage-'));
  const extract = fs.mkdtempSync(path.join(base, 'crylo-testnet23-bundle-extract-'));
  try {
    const all = [];
    for (const entry of originalNative) {
      const source = exactlyOne(files, entry.file);
      checkContent(source, entry.sha256, entry.size);
      const target = path.join(stage, entry.file);
      fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
      checkContent(target, entry.sha256, entry.size);
      all.push(entry.file);
    }
    for (const entry of runtime) {
      const source = path.join(packagedRoot, entry.file);
      checkContent(source, entry.sha256, entry.size);
      const target = path.join(stage, entry.file);
      fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
      checkContent(target, entry.sha256, entry.size);
      all.push(entry.file);
    }
    for (const name of [RUNTIME_NAME, BINARY_NAME]) {
      fs.copyFileSync(path.join(packagedRoot, name), path.join(stage, name), fs.constants.COPYFILE_EXCL);
      if (hash(path.join(packagedRoot, name)) !== hash(path.join(stage, name))) fail('Manifest copy drift');
      all.push(name);
    }
    fs.copyFileSync(suppliedInstaller, path.join(stage, INSTALLER_NAME), fs.constants.COPYFILE_EXCL);
    checkContent(path.join(stage, INSTALLER_NAME), INSTALLER_SHA, receipt.installer.size);
    all.push(INSTALLER_NAME);
    if (all.length !== 61 || new Set(all.map(x => x.toLowerCase())).size !== 61) {
      fail('Release bundle must have exactly 61 unique Windows files.');
    }

    fs.mkdirSync(outputDir);
    const bundle = path.join(outputDir, BUNDLE_NAME);
    const tar = path.join(process.env.SystemRoot, 'System32', 'tar.exe');
    checkedRun(tar, ['-a', '-cf', bundle, ...all.sort()], stage);
    const listed = checkedRun(tar, ['-tf', bundle], stage).trim().split(/\r?\n/)
      .map(x => x.replace(/^\.\//, '').replace(/\/$/, ''));
    if (listed.length !== 61 || new Set(listed.map(x => x.toLowerCase())).size !== 61 ||
        all.some(name => !listed.includes(name)) || listed.some(name => !all.includes(name))) {
      fail('ZIP archive contents differ from the exact verified 61 files.');
    }
    checkedRun(tar, ['-xf', bundle, '-C', extract], stage);
    const extracted = walkFiles(extract);
    if (extracted.length !== 61) fail('ZIP roundtrip file count differs.');
    for (const name of all) {
      if (hash(path.join(stage, name)) !== hash(path.join(extract, name))) {
        fail('ZIP roundtrip changed bytes of ' + name);
      }
    }
    const audit = {
      kind: 'CRYLO_TESTNET23_UNSIGNED_WINDOWS_RELEASE_HANDOFF',
      releaseTagRequested: 'v1.1.1-testnet.23', sourceGitCommit: PACKAGED_COMMIT,
      originalNativeSourceCommit: COMPILED_COMMIT,
      nativeExecutables: 3, runtimeDlls: 55,
      archiveFileCount: 61, artifactName: BUNDLE_NAME,
      bundleSha256: hash(bundle), bundleSize: regular(bundle).size,
      installerSha256: INSTALLER_SHA,
      packagedRuntimeManifestSha256: hash(installedManifest),
      originalArtifactRun: 41244508425, electronArtifactRun: 41372650525,
      compiledNativeHashesPreserved: true, zipRoundtripVerified: true,
      signingKeysUsed: false, signed: false, uploadedToRelease: false, mayPublish: false
    };
    fs.writeFileSync(path.join(outputDir, 'crylo-testnet23-unsigned-handoff-audit.json'),
      JSON.stringify(audit, null, 2) + '\n');
    console.log('PASS: exact signable Windows ZIP assembled, no native rebuild or signing');
    console.log(JSON.stringify(audit, null, 2));
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
    fs.rmSync(extract, { recursive: true, force: true });
  }
}
try { main(); } catch (error) { console.error('FAIL: ' + error.stack); process.exitCode = 1; }
