'use strict';
// Ephemeral CI Ed25519 keys only. This never signs or publishes CryLo releases.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const test=require('node:test');
const {stageVerifiedMacPackage}=require('../release/macos-unsigned-update-stage');
const {completeInstalledMacRelease,receiptSnapshot}=
  require('../release/macos-installed-release-state');
const {currentReleaseFloor}=require('../../electron/security/macos-update-client');
function call(file,args){
 const r=spawnSync(file,args,{encoding:'utf8',shell:false,timeout:180000});
 assert.equal(r.status,0,file+' '+args.join(' ')+'\n'+r.stderr+'\n'+r.stdout);
}
function write(file,bytes){
 fs.mkdirSync(path.dirname(file),{recursive:true});
 fs.writeFileSync(file,bytes);
}
function hash(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
const names=[
 'Applications/CryLo Wallet.app/Contents/MacOS/CryLo Wallet',
 'Applications/CryLo Wallet.app/Contents/Resources/app.asar',
 'Applications/CryLo Wallet.app/Contents/Resources/bin/mac/CryLo-daemon',
 'Applications/CryLo Wallet.app/Contents/Resources/bin/mac/CryLo-wallet-rpc',
 'Applications/CryLo Wallet.app/Contents/Resources/macos-update/macos-update-client.js',
 'Applications/CryLo Wallet.app/Contents/Resources/macos-update/macos-installed-update.js',
 'Applications/CryLo Wallet.app/Contents/Resources/macos-update/macos-package-trust.js',
 'Applications/CryLo Wallet.app/Contents/Resources/macos-update/macos-installed-release-state.js',
 'Applications/CryLo Wallet.app/Contents/Resources/macos-update/crylo-testnet-release-ed25519-public.pem',
 'Applications/CryLo Daemon.app/Contents/Resources/CryLo-daemon',
 'usr/local/bin/crylo'
];
function buildFixture(base,version,sequence,keys){
 const dir=path.join(base,'release-'+sequence),root=path.join(dir,'root');
 const pem=keys.publicKey.export({format:'pem',type:'spki'});
 for(const item of names)write(path.join(root,item),
   item.endsWith('.pem')?pem:('CI v'+version+' seq '+sequence+' '+item+'\n'));
 const input=path.join(dir,'input');fs.mkdirSync(input,{recursive:true});
 const pkg=path.join(input,'CryLo-'+version+'-mac-'+process.arch+'-unsigned.pkg');
 call('/usr/bin/pkgbuild',['--root',root,'--identifier','com.crylo.installer',
   '--version',version,'--install-location','/',pkg]);
 const bytes=fs.readFileSync(pkg);
 const manifest={schema:1,product:'CryLo',network:'testnet',version,
   releaseTag:'v'+version+'-testnet.'+sequence,releaseSequence:sequence,
   createdUtc:'2026-10-25T00:00:00Z',gitCommit:(sequence===20?'a':'b').repeat(40),
   signatureAlgorithm:'Ed25519',hashAlgorithm:'SHA-256',
   artifacts:[{platform:'mac',architecture:process.arch,
     file:path.basename(pkg),size:bytes.length,sha256:hash(bytes)}]};
 const serialized=Buffer.from(JSON.stringify(manifest)+'\n');
 write(path.join(input,'crylo-release-manifest.json'),serialized);
 write(path.join(input,'crylo-release-manifest.json.sig'),
   crypto.sign(null,serialized,keys.privateKey).toString('base64')+'\n');
 return {pkg,input,dir,version,sequence};
}
test('real Installer receipt and payload authenticate a full CI-only v20 -> v21 upgrade',
 {timeout:240000},()=>{
 if(process.platform!=='darwin')return;
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'crylo-two-version-mac-gate-'));
 const keys=crypto.generateKeyPairSync('ed25519');
 const trustedFingerprint=hash(keys.publicKey.export({type:'spki',format:'der'}));
 const home=path.join(base,'home');
 const userData=path.join(home,'Library','Application Support','CryLo Wallet');
 const resourcesPath=path.join(base,'resources');
 const wallet=path.join(home,'Library','Application Support','CryLo','wallets','private-wallet');
 fs.mkdirSync(userData,{recursive:true});
 write(wallet,'keep sensitive wallet untouched');
 write(path.join(resourcesPath,'macos-update','crylo-testnet-release-ed25519-public.pem'),
   keys.publicKey.export({type:'spki',format:'pem'}));
 const key=path.join(resourcesPath,'macos-update','crylo-testnet-release-ed25519-public.pem');
 const first=buildFixture(base,'1.1.1',20,keys);
 const second=buildFixture(base,'1.1.2',21,keys);
 const statePath=path.join(userData,'release-security.json');
 function stage(item,minimumSequence){
   return stageVerifiedMacPackage({packagePath:item.pkg,home,architecture:process.arch,
     manifestPath:path.join(item.input,'crylo-release-manifest.json'),
     signaturePath:path.join(item.input,'crylo-release-manifest.json.sig'),
     publicKeyPath:key,network:'testnet',minimumSequence});
 }
 function complete(item,minimumSequence,receiptBefore){
   return completeInstalledMacRelease({stagedPath:item.stagedPath,home,userData,
     resourcesPath,architecture:process.arch,network:'testnet',minimumSequence,
     receiptBefore,trustedFingerprint});
 }
 try{
   const s20=stage(first,20);
   const oldReceipt=receiptSnapshot();
   assert.throws(()=>complete(s20,20,oldReceipt),/Installer has not completed/);
   assert.equal(fs.existsSync(statePath),false);
   call('/usr/bin/sudo',['/usr/sbin/installer','-pkg',first.pkg,'-target','/']);
   const a20=complete(s20,20,oldReceipt);
   assert.equal(a20.state.highestAcceptedReleaseSequence,20);
   assert.equal(currentReleaseFloor({home,userData,network:'testnet'}),20);
   const s21=stage(second,20);
   const before21=receiptSnapshot();
   assert.throws(()=>complete(s21,20,before21),/Installer has not completed/);
   assert.equal(JSON.parse(fs.readFileSync(statePath)).highestAcceptedReleaseSequence,20);
   call('/bin/sleep',['2']);
   call('/usr/bin/sudo',['/usr/sbin/installer','-pkg',second.pkg,'-target','/']);
   const installed='/Applications/CryLo Wallet.app/Contents/Resources/app.asar';
   call('/usr/bin/sudo',['/bin/sh','-c',
     "printf attack >> '/Applications/CryLo Wallet.app/Contents/Resources/app.asar'"]);
   assert.throws(()=>complete(s21,20,before21),/payload hash mismatch/);
   assert.equal(JSON.parse(fs.readFileSync(statePath)).highestAcceptedReleaseSequence,20);
   call('/usr/bin/sudo',['/bin/cp',
     path.join(second.dir,'root','Applications','CryLo Wallet.app','Contents',
       'Resources','app.asar'),installed]);
   const a21=complete(s21,20,before21);
   assert.equal(a21.state.highestAcceptedReleaseSequence,21);
   assert.equal(currentReleaseFloor({home,userData,network:'testnet'}),21);
   assert.throws(()=>complete(s20,21,oldReceipt),/rollback floor/);
   assert.equal(fs.readFileSync(wallet,'utf8'),'keep sensitive wallet untouched');
   assert.equal(fs.readFileSync(statePath,'utf8'),
     fs.readFileSync(path.join(home,'.config','crylo-wallet','release-security.json'),'utf8'));
   console.log('PASS: CI-only signed v20-v21 upgrade, stale receipt, tampering, rollback and wallet preservation');
 }finally{
   fs.rmSync(base,{recursive:true,force:true});
 }
});
