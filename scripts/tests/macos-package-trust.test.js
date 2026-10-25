'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  requireMacArtifactIdentity,
  verifyMacPackage
} = require('../release/macos-package-trust');

const ARCH = process.arch;
const TEAM = 'AB12CD34EF';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crylo-mac-trust-test-'));
  const bytes = Buffer.from('CI fake PKG: must never install\n');
  const filename = 'CryLo-1.1.1-mac-' + ARCH + '.pkg';
  const file = path.join(dir, filename);
  fs.writeFileSync(file, bytes, { mode: 0o600 });
  const manifest = {
    product: 'CryLo', network: 'testnet', version: '1.1.1',
    releaseSequence: 20,
    artifacts: [{
      platform: 'mac', architecture: ARCH, file: filename,
      size: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex')
    }]
  };
  return { dir, file, manifest };
}

test('reject mismatched, ambiguous or unsafe signed-artifact selection', () => {
  const {dir,file,manifest} = fixture();
  try {
    assert.equal(requireMacArtifactIdentity(manifest, ARCH).file, path.basename(file));
    assert.throws(() => requireMacArtifactIdentity(manifest, 'ia32'), /architecture/);
    assert.throws(() => requireMacArtifactIdentity({...manifest, artifacts: []}, ARCH), /exactly one/);
    assert.throws(() => requireMacArtifactIdentity({...manifest, artifacts: [manifest.artifacts[0], manifest.artifacts[0]]}, ARCH), /exactly one/);
    assert.throws(() => requireMacArtifactIdentity({...manifest, version: '../1.1.1'}, ARCH), /identity/);
    assert.throws(() => requireMacArtifactIdentity({
      ...manifest, artifacts: [{...manifest.artifacts[0], file: '../evil.pkg'}]
    }, ARCH), /identity/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('valid trusted team, timestamp, notarization and Gatekeeper all required', () => {
  const {dir,file,manifest} = fixture();
  const invoked=[];
  const run = (exe,args) => {
    invoked.push([exe,...args]);
    if (exe.endsWith('/pkgutil')) return 'Status: signed by a developer certificate issued by Apple for distribution\nSigned with a trusted timestamp\n1. Developer ID Installer: Example Company (AB12CD34EF)';
    if (exe.endsWith('/xcrun')) return 'The validate action worked!';
    if (exe.endsWith('/spctl')) return file + ': accepted\nsource=Notarized Developer ID';
    throw Error('Unexpected executable');
  };
  try {
    const result=verifyMacPackage({packagePath:file,manifest,architecture:ARCH,trustedTeamId:TEAM,run});
    assert.equal(result.file,path.basename(file));
    assert.deepEqual(invoked.map(x=>x[0]),['/usr/sbin/pkgutil','/usr/bin/xcrun','/usr/sbin/spctl']);
    assert.equal(invoked[1][1],'stapler');
    assert.equal(invoked[1][2],'validate');
    assert.equal(invoked[2][2],'--type');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('wrong Team ID, unsigned package, absent stapled ticket or denied Gatekeeper never pass', () => {
  const {dir,file,manifest} = fixture();
  const opts={packagePath:file,manifest,architecture:ARCH,trustedTeamId:TEAM};
  try {
    assert.throws(() => verifyMacPackage({...opts,trustedTeamId:''}), /Team ID/);
    assert.throws(() => verifyMacPackage({...opts,trustedTeamId:'INVALID'}), /Team ID/);
    assert.throws(() => verifyMacPackage({...opts,run:()=> 'Status: no signature'}), /Developer ID Installer/);
    assert.throws(() => verifyMacPackage({...opts,run:()=> '1. Developer ID Installer: Other (ZZ99ZZ99ZZ)\nSigned with a trusted timestamp'}), /trusted/);
    const ok='Signed with a trusted timestamp\n1. Developer ID Installer: Example (AB12CD34EF)';
    assert.throws(() => verifyMacPackage({...opts,run:(e)=> {
      if(e.endsWith('/pkgutil')) return ok;
      if(e.endsWith('/xcrun')) throw Error('not notarized');
      return file+': accepted';
    }}),/not notarized/);
    assert.throws(() => verifyMacPackage({...opts,run:(e)=> e.endsWith('/pkgutil') ? ok : 'rejected'}),/Gatekeeper/);
    fs.appendFileSync(file,'tamper');
    assert.throws(() => verifyMacPackage({...opts,run:()=> ok}), /SHA-256|size/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('symlinks rejected before invoking macOS signature tools', () => {
  const {dir,file,manifest} = fixture();
  const replacement=path.join(dir,'original.pkg');
  fs.renameSync(file,replacement);
  fs.symlinkSync(replacement,file);
  try {
    assert.throws(() => verifyMacPackage({packagePath:file,manifest,architecture:ARCH,trustedTeamId:TEAM,
      run:()=>{throw Error('signature tool must never run');}}),/ordinary unlinked file/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
