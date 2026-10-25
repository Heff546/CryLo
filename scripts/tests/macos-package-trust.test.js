'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { authenticatedManifest, requireMacArtifactIdentity, verifyMacPackage } =
  require('../release/macos-package-trust');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crylo-mac-auth-'));
  const arch = process.arch;
  const name = 'CryLo-1.1.1-mac-' + arch + '-unsigned.pkg';
  const pkg = path.join(dir, name);
  const bytes = Buffer.from('unsigned synthetic installer, never install\n');
  fs.writeFileSync(pkg, bytes, { mode: 0o600 });
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const key = path.join(dir, 'crylo-test-ephemeral-public.pem');
  const manifestPath = path.join(dir, 'crylo-release-manifest.json');
  const signaturePath = manifestPath + '.sig';
  fs.writeFileSync(key, publicKey.export({ type:'spki', format:'pem' }), { mode:0o600 });
  const manifest = {
    schema:1, product:'CryLo', network:'testnet', version:'1.1.1',
    signatureAlgorithm:'Ed25519',hashAlgorithm:'SHA-256',
    releaseSequence:20, releaseTag:'v1.1.1-testnet.20',
    gitCommit:'a'.repeat(40), createdUtc:'2026-10-25T00:00:00.000Z',
    artifacts:[{
      platform:'mac',architecture:arch,file:name,
      size:bytes.length,
      sha256:crypto.createHash('sha256').update(bytes).digest('hex')
    }]
  };
  const resign=()=>{
    const source=Buffer.from(JSON.stringify(manifest)+'\n');
    fs.writeFileSync(manifestPath,source);
    fs.writeFileSync(signaturePath,crypto.sign(null,source,privateKey).toString('base64')+'\n');
  };
  resign();
  const options={
    packagePath:pkg,manifestPath,signaturePath,publicKeyPath:key,
    architecture:arch,network:'testnet',minimumSequence:20
  };
  return {dir,pkg,manifest,key,options,resign};
}

function withFixture(task){
  const x=fixture();
  try{return task(x);}
  finally{fs.rmSync(x.dir,{recursive:true,force:true});}
}

test('Pi1-style Ed25519 signature authenticates an UNSIGNED Mac PKG without an Apple ID',()=>{
  withFixture(x=>{
    const r=verifyMacPackage(x.options);
    assert.equal(r.file,path.basename(x.pkg));
    assert.equal(r.architecture,process.arch);
    assert.equal(r.installation,'requires-user-approval');
    assert.equal(r.appleDeveloperIdRequired,false);
    assert.equal(r.releaseSequence,20);
    assert.match(r.signerFingerprint,/^[a-f0-9]{64}$/);
    assert.equal(authenticatedManifest(
      x.options.manifestPath,x.options.signaturePath,x.options.publicKeyPath
    ).manifest.releaseTag,r.releaseTag);
  });
});

test('reject changed manifest without valid Pi1 signature and wrong signer',()=>{
  withFixture(x=>{
    fs.appendFileSync(x.options.manifestPath,' ');
    assert.throws(()=>verifyMacPackage(x.options),/Ed25519/);
    x.resign();
    const impostor=crypto.generateKeyPairSync('ed25519');
    fs.writeFileSync(x.key,impostor.publicKey.export({type:'spki',format:'pem'}));
    assert.throws(()=>verifyMacPackage(x.options),/Ed25519/);
  });
});

test('rollback, wrong network, wrong native architecture and duplicate artifacts fail closed',()=>{
  withFixture(x=>{
    assert.throws(()=>verifyMacPackage({...x.options,minimumSequence:21}),/rollback floor/);
    assert.throws(()=>verifyMacPackage({...x.options,network:'mainnet'}),/network/);
    const opposite=process.arch==='arm64'?'x64':'arm64';
    assert.throws(()=>verifyMacPackage({...x.options,architecture:opposite}),/architecture/);
    x.manifest.artifacts.push({...x.manifest.artifacts[0]});
    x.resign();
    assert.throws(()=>verifyMacPackage(x.options),/duplicate filenames/);
  });
});

test('signed manifest cannot authorize a tampered PKG or substituted file',()=>{
  withFixture(x=>{
    fs.appendFileSync(x.pkg,'modified');
    assert.throws(()=>verifyMacPackage(x.options),/size or SHA-256/);
  });
  withFixture(x=>{
    const original=path.join(x.dir,'real-package.pkg');
    fs.renameSync(x.pkg,original);
    fs.symlinkSync(original,x.pkg);
    assert.throws(()=>verifyMacPackage(x.options),/ordinary unlinked file/);
  });
  withFixture(x=>{
    const other=path.join(x.dir,'impostor.pkg');
    fs.copyFileSync(x.pkg,other);
    assert.throws(()=>verifyMacPackage({...x.options,packagePath:other}),/path/);
  });
});

test('future release timestamps, invalid versions and noncanonical signatures reject',()=>{
  withFixture(x=>{
    x.manifest.createdUtc='2099-01-01T00:00:00Z';x.resign();
    assert.throws(()=>verifyMacPackage(x.options),/timestamp/);
    x.manifest.createdUtc='2026-10-25T00:00:00Z';
    x.manifest.version='../1.1.1';x.resign();
    assert.throws(()=>verifyMacPackage(x.options),/identity/);
    x.manifest.version='1.1.1';x.resign();
    fs.writeFileSync(x.options.signaturePath,'not base64!!!');
    assert.throws(()=>verifyMacPackage(x.options),/base64/);
  });
});

test('installer policy never changes macOS quarantine, Gatekeeper or user data',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','release','macos-package-trust.js'),'utf8');
  for(const forbidden of [
    'spawnSync(', 'xattr -d', 'xattr -dr', 'spctl --master-disable',
    "'/usr/sbin/installer'", "'/usr/bin/open'", 'pkgbuild --sign'
  ]){
    assert.equal(source.includes(forbidden),false,forbidden);
  }
  assert.match(source,/installation: 'requires-user-approval'/);
});

test('same exact artifact naming rule applies to both macOS target architectures',()=>{
  withFixture(x=>{
    assert.equal(requireMacArtifactIdentity(x.manifest,process.arch,'testnet',20).file,
      'CryLo-1.1.1-mac-'+process.arch+'-unsigned.pkg');
    const name=x.manifest.artifacts[0].file;
    x.manifest.artifacts[0].file=name.replace('-unsigned.pkg','.pkg');
    assert.throws(()=>requireMacArtifactIdentity(x.manifest,process.arch,'testnet',20),
      /unsigned PKG/);
  });
});
