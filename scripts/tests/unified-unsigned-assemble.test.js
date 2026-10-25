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

