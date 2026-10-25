'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {machine,validateProvenance,shaFromCertutil,exact}=require('../release/unified-unsigned-assemble');
const sha='a'.repeat(40),head='b'.repeat(40);
const run={id:123,head_sha:sha,status:'completed',conclusion:'success'};
const compare={status:'ahead',behind_by:0,base_commit:{sha},head_commit:{sha:head},files:[]};
test('source drift beyond explicitly unshipped release metadata blocks staging',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crylo-assemble-test-'));
 try{
  fs.writeFileSync(path.join(dir,'.gitattributes'),
   '/contrib/depends/patches/openssl/openssl-3.5.9-build-cleanup.patch text eol=lf\n');
  validateProvenance({run,compare,target:head,repoFiles:dir});
  assert.throws(()=>validateProvenance({run,compare:{...compare,files:[{filename:'src/wallet/wallet2.cpp'}]},target:head,repoFiles:dir}));
  assert.throws(()=>validateProvenance({run:{...run,conclusion:'failure'},compare,target:head,repoFiles:dir}));
  assert.throws(()=>validateProvenance({run,compare:{...compare,behind_by:1},target:head,repoFiles:dir}));
  validateProvenance({run,compare:{...compare,files:[{filename:'.gitattributes'}]},target:head,repoFiles:dir});
  fs.writeFileSync(path.join(dir,'.gitattributes'),'* text=auto\n');
  assert.throws(()=>validateProvenance({run,compare:{...compare,files:[{filename:'.gitattributes'}]},target:head,repoFiles:dir}));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('Windows certutil digest must have exactly one SHA256',()=>{
 assert.equal(shaFromCertutil('SHA256 hash of thing:\n'+('a'.repeat(64))+'\nCertUtil: completed'), 'a'.repeat(64));
 assert.throws(()=>shaFromCertutil('bad'));
 assert.throws(()=>shaFromCertutil('a'.repeat(64)+' '+('b'.repeat(64))));
});
test('refuse ambiguous unsigned artifact member names',()=>{
 assert.throws(()=>exact(['/tmp/a.bin','/tmp/a.bin'],'a.bin'));
 assert.equal(exact(['/tmp/a.bin'],'a.bin'),'/tmp/a.bin');
});
test('native architecture guards reject non-ELF and non-PE files',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crylo-native-machine-'));
 try{
  const elf=Buffer.alloc(512);elf[0]=127;elf.write('ELF',1);elf[4]=2;elf[5]=1;elf.writeUInt16LE(0xb7,18);
  const f=path.join(dir,'native');fs.writeFileSync(f,elf);
  assert.equal(machine(f,'elf'),0xb7);
  assert.throws(()=>machine(f,'win'));
  const pe=Buffer.alloc(512);pe.write('MZ',0);pe.writeUInt32LE(128,0x3c);pe.write('PE\u0000\u0000',128);pe.writeUInt16LE(0x8664,132);fs.writeFileSync(f,pe);
  assert.equal(machine(f,'win'),0x8664);
  assert.throws(()=>machine(f,'elf'));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});


test('deterministic Windows ZIP staging normalizes timestamps and file order',()=>{
 const {safeCopy,packageZip}=require('../release/unified-unsigned-assemble');
 const cp=require('node:child_process');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crylo-zip-deterministic-'));
 try{
  const original=path.join(dir,'original'),one=path.join(dir,'one'),
   two=path.join(dir,'two');
  for(const p of [original,one,two])fs.mkdirSync(p);
  for(const n of ['z.dll','a.exe'])fs.writeFileSync(path.join(original,n),'static '+n);
  for(const target of [one,two]){
   for(const n of ['z.dll','a.exe'])safeCopy(path.join(original,n),path.join(target,n));
   for(const n of ['z.dll','a.exe']){
    assert.equal(fs.statSync(path.join(target,n)).mtime.toISOString().slice(0,10),'1980-01-01');
   }
  }
  const z1=path.join(dir,'1.zip'),z2=path.join(dir,'2.zip');
  packageZip(one,z1);packageZip(two,z2);
  assert.deepEqual(fs.readFileSync(z1),fs.readFileSync(z2));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('simulated five-target release assembly validates hashes and rejects tampering',()=>{
 const crypto=require('node:crypto');
 const {winPackage,linuxPackage,stageMac,packageTar,packageZip}=require('../release/unified-unsigned-assemble');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'crylo-unsigned-integration-'));
 const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
 const write=(name,content)=>{fs.mkdirSync(path.dirname(name),{recursive:true});fs.writeFileSync(name,content);return name;};
 const pe=()=>{
  const b=Buffer.alloc(384);b.write('MZ',0);b.writeUInt32LE(128,0x3c);
  b.write('PE\u0000\u0000',128);b.writeUInt16LE(0x8664,132);return b;
 };
 const elf=arch=>{
  const b=Buffer.alloc(128);b[0]=127;b.write('ELF',1);b[4]=2;b[5]=1;b.writeUInt16LE(arch==='x64'?0x3e:0xb7,18);return b;
 };
 const run={id:123,head_sha:'a'.repeat(40)};
 try{
  const wd=path.join(root,'win'),wo=path.join(root,'winout');
  fs.mkdirSync(wd);fs.mkdirSync(wo);
  const names=['CryLo-daemon.exe','CryLo-wallet.exe','CryLo-wallet-rpc.exe'];
  const roots=names.map(name=>{const bytes=pe();write(path.join(wd,name),bytes);return {file:name,size:bytes.length,sha256:sha(bytes)};});
  const dllbytes=pe();
  write(path.join(wd,'libtest.dll'),dllbytes);
  const manifest={schema:1,product:'CryLo',network:'testnet',gitCommit:run.head_sha,
   architecture:'x64',roots,runtime:[{file:'libtest.dll',size:dllbytes.length,sha256:sha(dllbytes)}]};
  const metadata=Buffer.from(JSON.stringify(manifest));
  write(path.join(wd,'WINDOWS-BUILD-RUNTIME-MANIFEST.json'),metadata);
  write(path.join(wd,'BINARY-MANIFEST.txt'),'Runtime-Manifest-SHA256: '+sha(metadata)+'\n');
  write(path.join(wd,'SOURCE-COMMIT.txt'),run.head_sha+'\n');
  for(const [i,label] of ['DAEMON','WALLET','RPC'].entries())
   write(path.join(wd,label+'-SHA256.txt'),'SHA256 hash\n'+roots[i].sha+'\nCertUtil: completed');
  write(path.join(wd,'CryLo Wallet Setup 1.1.1.exe'),pe());
  assert.equal(winPackage(wd,wo,run,'1.1.1').runtimeDLLs,1);
  const winZip=path.join(root,'Windows.zip');packageZip(wo,winZip);assert.ok(fs.statSync(winZip).size>0);
  fs.appendFileSync(path.join(wd,'libtest.dll'),Buffer.from('tamper'));
  assert.throws(()=>winPackage(wd,path.join(root,'winfail'),run,'1.1.1'));
  for(const arch of ['x64','arm64']){
   const d=path.join(root,'linux-'+arch),o=path.join(root,'out-'+arch);
   fs.mkdirSync(d);fs.mkdirSync(o);
   const binaries=['CryLo-daemon','CryLo-wallet','CryLo-wallet-rpc'];
   const lines=[];
   for(const name of binaries){
    const content=elf(arch);write(path.join(d,name),content);
    lines.push(sha(content)+'  build/linux-'+arch+'/bin/'+name);
   }
   write(path.join(d,'SOURCE-COMMIT.txt'),run.head_sha+'\n');
   write(path.join(d,'NATIVE-SHA256SUMS.txt'),lines.join('\n')+'\n');
   const app=arch==='x64'?'CryLo Wallet-1.1.1.AppImage':'CryLo Wallet-1.1.1-arm64.AppImage';
   write(path.join(d,app),elf(arch));
   linuxPackage(d,o,run,arch,'1.1.1');
   const tarFile=path.join(root,arch+'.tar');packageTar(o,tarFile);assert.ok(fs.statSync(tarFile).size>0);
   fs.appendFileSync(path.join(d,'CryLo-daemon'),Buffer.from('modified'));
   assert.throws(()=>linuxPackage(d,path.join(root,'broken-'+arch),run,arch,'1.1.1'));
  }
  for(const arch of ['x64','arm64']){
   const d=path.join(root,'mac-'+arch),o=path.join(root,'mac-out-'+arch);fs.mkdirSync(d);fs.mkdirSync(o);
   const name='CryLo-1.1.1-mac-'+arch+'-unsigned.pkg';
   const data=Buffer.from('CI-only fake PKG; NEVER publish');
   write(path.join(d,name),data);write(path.join(d,'SHA256SUMS-CI-ONLY.txt'),sha(data)+'  '+name+'\n');
   stageMac(d,o,arch);
   assert.equal(sha(fs.readFileSync(path.join(o,name))),sha(data));
   fs.appendFileSync(path.join(d,name),'changed');
   assert.throws(()=>stageMac(d,path.join(root,'badmac-'+arch),arch));
  }
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
