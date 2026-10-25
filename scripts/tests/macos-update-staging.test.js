'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { stageVerifiedMacPackage } = require('../release/macos-unsigned-update-stage');

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(),'crylo-private-stage-test-'));
  const home = path.join(base,'Users','CryLo Person');
  fs.mkdirSync(home, { recursive:true, mode:0o700 });
  const data = path.join(home,'Library','Application Support','CryLo');
  fs.mkdirSync(path.join(data,'wallets'), { recursive:true });
  const sentinel = path.join(data,'wallets','seed-wallet');
  fs.writeFileSync(sentinel,'keep original bytes');
  const input = path.join(base,'inputs');
  fs.mkdirSync(input);
  const pkg=path.join(input,'CryLo-1.1.1-mac-'+process.arch+'-unsigned.pkg');
  const bytes=Buffer.from('UNSIGNED launch installer, test-only bytes\n');
  fs.writeFileSync(pkg,bytes);
  const keys=crypto.generateKeyPairSync('ed25519');
  const key=path.join(input,'local-test-pub.pem');
  fs.writeFileSync(key,keys.publicKey.export({type:'spki',format:'pem'}));
  const manifestPath=path.join(input,'crylo-release-manifest.json');
  const signaturePath=manifestPath+'.sig';
  const manifest={
    schema:1,product:'CryLo',network:'testnet',version:'1.1.1',
    releaseTag:'v1.1.1-testnet.20',releaseSequence:20,
    gitCommit:'f'.repeat(40),createdUtc:'2026-10-25T00:00:00Z',
    signatureAlgorithm:'Ed25519',hashAlgorithm:'SHA-256',
    artifacts:[{platform:'mac',architecture:process.arch,
      file:path.basename(pkg),size:bytes.length,
      sha256:crypto.createHash('sha256').update(bytes).digest('hex')}]
  };
  const signed=Buffer.from(JSON.stringify(manifest)+'\n');
  fs.writeFileSync(manifestPath,signed);
  fs.writeFileSync(signaturePath,
    crypto.sign(null,signed,keys.privateKey).toString('base64')+'\n');
  return {base,home,data,sentinel,pkg,manifestPath,signaturePath,key,
    settings:{home,packagePath:pkg,manifestPath,signaturePath,
      publicKeyPath:key,architecture:process.arch,network:'testnet',
      minimumSequence:20}};
}

function withFixture(callback){
  const x=fixture();
  try{callback(x);}
  finally{fs.rmSync(x.base,{recursive:true,force:true});}
}

test('stages authenticated unsigned Mac PKG only under user-private directory',()=>{
  withFixture(x=>{
    const result=stageVerifiedMacPackage(x.settings);
    assert.equal(result.installation,'user-approval-required');
    assert.equal(result.releaseSecurityStateAdvanced,false);
    assert.equal(result.appleDeveloperIdRequired,false);
    assert.ok(result.stagedPath.startsWith(path.join(x.data,'verified-updates')+path.sep));
    assert.deepEqual(fs.readFileSync(result.stagedPath),fs.readFileSync(x.pkg));
    assert.equal(fs.readFileSync(x.sentinel,'utf8'),'keep original bytes');
    assert.equal(fs.statSync(path.dirname(result.stagedPath)).mode & 0o077,0);
    assert.equal(fs.statSync(path.join(x.data,'verified-updates')).mode & 0o077,0);
    assert.ok(fs.existsSync(path.join(path.dirname(result.stagedPath),'crylo-release-manifest.json.sig')));
  });
});

test('tampered downloads and higher accepted release floor never create staging output',()=>{
  withFixture(x=>{
    fs.appendFileSync(x.pkg,'attack');
    assert.throws(()=>stageVerifiedMacPackage(x.settings),/SHA-256|size/);
    assert.equal(fs.existsSync(path.join(x.data,'verified-updates')),false);
    assert.equal(fs.readFileSync(x.sentinel,'utf8'),'keep original bytes');
  });
  withFixture(x=>{
    assert.throws(()=>stageVerifiedMacPackage({...x.settings,minimumSequence:21}),/rollback floor/);
    assert.equal(fs.existsSync(path.join(x.data,'verified-updates')),false);
  });
});

test('reject redirected update directory without touching its target',()=>{
  withFixture(x=>{
    const redir=path.join(x.base,'untrusted-target');
    fs.mkdirSync(redir);
    const destination=path.join(x.data,'verified-updates');
    fs.symlinkSync(redir,destination);
    assert.throws(()=>stageVerifiedMacPackage(x.settings),/safe and user-owned/);
    assert.deepEqual(fs.readdirSync(redir),[]);
    assert.equal(fs.readFileSync(x.sentinel,'utf8'),'keep original bytes');
  });
});
