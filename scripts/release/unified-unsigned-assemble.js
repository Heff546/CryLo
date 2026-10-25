'use strict';
// Strict unsigned CI staging, never a Pi1 release signer or publisher.
// The official release manifest must be generated, signed and published on Pi1.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const cp=require('node:child_process');

const PINS=Object.freeze({
  mac:{run:40230632249,source:'48fe46e64e94c4c599ef61a7306cef30c88ee55a'},
  win:{run:40235096809,source:'bf049390517b97af382e3426099addcff1e59c55a'},
  linux:{run:40235385178,source:'801abc7abbad9718f9ab92b63ce473a102603623'}
});
const VERSION='1.1.1';
const SHA=/^[a-f0-9]{64}$/;
const COMMIT=/^[a-f0-9]{40}$/;

function fail(message){throw new Error(message);}
function hash(file){
 const h=crypto.createHash('sha256'),fd=fs.openSync(file,'r');
 const b=Buffer.allocUnsafe(1024*1024);
 try{for(;;){const n=fs.readSync(fd,b,0,b.length,null);if(!n)break;h.update(b.subarray(0,n));}}
 finally{fs.closeSync(fd);}
 return h.digest('hex');
}
function listFiles(dir){
 if(!fs.existsSync(dir)||!fs.lstatSync(dir).isDirectory())fail('Missing unsigned input directory');
 const files=[],walk=(dir)=>{
  for(const name of fs.readdirSync(dir)){
   const file=path.join(dir,name),st=fs.lstatSync(file);
   if(st.isSymbolicLink())fail('Symlink in unsigned artifact download: '+name);
   if(st.isDirectory())walk(file);
   else if(st.isFile())files.push(file);
   else fail('Unexpected artifact filesystem entry');
  }
 };
 walk(dir);return files;
}
function exact(files,name){
 const matches=files.filter(f=>path.basename(f)===name);
 if(matches.length!==1)fail('Expected exactly one artifact member: '+name+' found '+matches.length);
 return matches[0];
}
function expectHash(file,expected){
 if(!SHA.test(expected)||hash(file)!==expected)fail('SHA-256 differs from pinned source record: '+path.basename(file));
}
function machine(file,format){
 const buf=Buffer.alloc(512),fd=fs.openSync(file,'r');let n;
 try{n=fs.readSync(fd,buf,0,buf.length,0);}finally{fs.closeSync(fd);}
 if(format==='win'){
  if(n<64||buf.toString('ascii',0,2)!=='MZ')fail('Not a Windows PE binary: '+path.basename(file));
  const off=buf.readUInt32LE(0x3c);
  if(off+6>n||buf.toString('ascii',off,off+4)!=='PE\u0000\u0000')fail('Invalid PE header');
  return buf.readUInt16LE(off+4);
 }
 if(n<64||buf[0]!==127||buf.toString('ascii',1,4)!=='ELF'||buf[4]!==2||buf[5]!==1)
  fail('Not a little-endian ELF64 binary');
 return buf.readUInt16LE(18);
}
function safeCopy(src,dst){
 if(fs.existsSync(dst))fail('Duplicate staging output '+path.basename(dst));
 fs.copyFileSync(src,dst,fs.constants.COPYFILE_EXCL);
 fs.chmodSync(dst,0o644);
}
function readJSON(file){return JSON.parse(fs.readFileSync(file,'utf8'));}
function verifyCheckLine(contents,file){
 const line=contents.trim().split(/\r?\n/).find(x=>x.trim().endsWith(' '+path.basename(file)));
 if(!line)fail('Artifact does not appear in CI checksum manifest: '+path.basename(file));
 const m=line.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
 if(!m||path.basename(m[2])!==path.basename(file))fail('Malformed checksum line');
 expectHash(file,m[1].toLowerCase());
}
function shaFromCertutil(contents){
 const matches=contents.match(/[a-fA-F0-9]{64}/g)||[];
 if(matches.length!==1)fail('Malformed native Windows certutil digest');
 return matches[0].toLowerCase();
}
function validateProvenance({run,compare,target,allowedExtra=[],repoFiles}){
 if(run?.status!=='completed'||run?.conclusion!=='success'||!COMMIT.test(run.head_sha||''))
  fail('GitHub build run did not pass: '+run?.id);
 if(compare?.status!=='identical'&&compare?.status!=='ahead')
  fail('Candidate does not descend from a validated commit');
 if(compare.behind_by!==0||compare.base_commit?.sha!==run.head_sha||
    compare.head_commit?.sha!==target||!Array.isArray(compare.files)||compare.files.length>=300)
  fail('Incomplete build provenance ancestry comparison');
 const allowed=new Set(['scripts/release/unified-candidate-provenance.js',
  'scripts/tests/unified-candidate-provenance.test.js',
  'scripts/release/unified-unsigned-assemble.js',
  'scripts/tests/unified-unsigned-assemble.test.js',
  '.gitattributes',...allowedExtra]);
 for(const f of compare.files){
  if(typeof f.filename!=='string')fail('Malformed changed source filename');
  if(f.filename.startsWith('.github/workflows/'))continue;
  if(!allowed.has(f.filename))fail('Release-affecting source drift since candidate: '+f.filename);
 }
 if(compare.files.some(f=>f.filename==='.gitattributes')){
  const attrs=fs.readFileSync(path.join(repoFiles,'.gitattributes'),'utf8');
  if(attrs.trim().split(/\r?\n/).filter(line=>!line.startsWith('#')&&line.trim()).join('\n')!==
     '/contrib/depends/patches/openssl/openssl-3.5.9-build-cleanup.patch text eol=lf')
     fail('Unexpected Git checkout attributes added after candidate build');
 }
 if(compare.files.some(f=>f.filename==='electron/scripts/release-linux.sh')){
  const obj=cp.execFileSync('git',['hash-object','electron/scripts/release-linux.sh'],{cwd:repoFiles,encoding:'utf8'}).trim();
  if(obj!=='28206b146f3ad1998e5ee27e419a666c2acebbd0')
   fail('Review required: unexpected Linux-only packaging source change');
 }
}
function verifyRun(name,base,meta,target,root,extras=[]){
 const run=readJSON(path.join(meta,name+'-run.json'));
 const comparison=readJSON(path.join(meta,name+'-compare.json'));
 if(run.id!==PINS[name].run||run.head_sha!==PINS[name].source)
  fail('Unexpected signed-channel candidate source run for '+name);
 validateProvenance({run,compare,target,repoFiles:root,allowedExtra:extras});
 return run;
}
function winPackage(input,output,run,version){
 const files=listFiles(input);
 const manifest=readJSON(exact(files,'WINDOWS-BUILD-RUNTIME-MANIFEST.json'));
 if(manifest.product!=='CryLo'||manifest.architecture!=='x64'||
  manifest.network!=='testnet'||manifest.gitCommit!==run.head_sha)
  fail('Windows runtime manifest source identity mismatch');
 const roots=['CryLo-daemon.exe','CryLo-wallet.exe','CryLo-wallet-rpc.exe'];
 if(!Array.isArray(manifest.roots)||manifest.roots.length!==3||
  JSON.stringify(manifest.roots.map(x=>x.file).sort())!==JSON.stringify(roots.slice().sort()))
  fail('Incomplete Windows native root set');
 if(!Array.isArray(manifest.runtime)||manifest.runtime.length===0)fail('Missing Windows DLL runtime closure');
 for(const entry of [...manifest.roots,...manifest.runtime]){
  if(!/^[A-Za-z0-9_.+-]+$/.test(entry.file)||!Number.isSafeInteger(entry.size)||entry.size<=0)
   fail('Unsafe Windows runtime member');
  const src=exact(files,entry.file);
  if(fs.statSync(src).size!==entry.size)fail('Windows manifest size mismatch: '+entry.file);
  expectHash(src,entry.sha256);
  if(machine(src,'win')!==0x8664)fail('Wrong Windows native architecture: '+entry.file);
  safeCopy(src,path.join(output,entry.file));
 }
 const rt=exact(files,'WINDOWS-BUILD-RUNTIME-MANIFEST.json');
 const binary=exact(files,'BINARY-MANIFEST.txt');
 const binaryText=fs.readFileSync(binary,'utf8');
 if(!binaryText.includes('Runtime-Manifest-SHA256: '+hash(rt)))
  fail('Windows BINARY-MANIFEST does not bind runtime manifest');
 safeCopy(rt,path.join(output,path.basename(rt)));
 safeCopy(binary,path.join(output,path.basename(binary)));
 for(const name of roots){
  const digestName=name==='CryLo-daemon.exe'?'DAEMON-SHA256.txt':
    name==='CryLo-wallet.exe'?'WALLET-SHA256.txt':'RPC-SHA256.txt';
  expectHash(exact(files,name),shaFromCertutil(fs.readFileSync(exact(files,digestName),'utf8')));
 }
 const source=fs.readFileSync(exact(files,'SOURCE-COMMIT.txt'),'utf8').trim();
 if(source!==run.head_sha)fail('Windows source metadata mismatch');
 const installer=exact(files,'CryLo Wallet Setup '+version+'.exe');
 safeCopy(installer,path.join(output,'CryLo-Wallet-Setup-'+version+'-x64.exe'));
 return {runtimeDLLs:manifest.runtime.length};
}
function linuxPackage(input,output,run,arch,version){
 const files=listFiles(input);
 if(fs.readFileSync(exact(files,'SOURCE-COMMIT.txt'),'utf8').trim()!==run.head_sha)
  fail('Linux native source metadata mismatch');
 const sums=fs.readFileSync(exact(files,'NATIVE-SHA256SUMS.txt'),'utf8');
 for(const name of ['CryLo-daemon','CryLo-wallet','CryLo-wallet-rpc']){
  const file=exact(files,name);
  if(machine(file,'elf')!==(arch==='x64'?0x3e:0xb7))
   fail('Wrong Linux native architecture: '+name);
  const digest=sums.trim().split(/\r?\n/).find(line=>line.trim().endsWith('/'+name));
  if(!digest||!/^[a-f0-9]{64}\s+/.test(digest))fail('Missing CI native digest for '+name);
  expectHash(file,digest.slice(0,64));
  safeCopy(file,path.join(output,name));
 }
 const electronName=arch==='x64'?'CryLo Wallet-'+version+'.AppImage':
   'CryLo Wallet-'+version+'-arm64.AppImage';
 const app=exact(files,electronName);
 if(machine(app,'elf')!==(arch==='x64'?0x3e:0xb7))
  fail('Wrong Linux Electron AppImage machine: '+electronName);
 safeCopy(app,path.join(output,'CryLo-Wallet-'+version+'-'+arch+'.AppImage'));
 for(const name of fs.readdirSync(output))fs.chmodSync(path.join(output,name),0o755);
}
function packageTar(dir,out){
 const names=fs.readdirSync(dir).sort();
 const cmd=cp.spawnSync('tar',['--sort=name','--format=ustar','--owner=0','--group=0',
  '--numeric-owner','--mtime=1970-01-01T00:00:00Z','-cf',out,...names],
  {cwd:dir,encoding:'utf8',shell:false});
 if(cmd.status!==0||cmd.error)fail('Reproducible Linux TAR failed: '+(cmd.stderr||cmd.error?.message));
}
function packageZip(dir,out){
 // No arbitrary host metadata paths inside the Windows release ZIP.
 const names=fs.readdirSync(dir).sort();
 const cmd=cp.spawnSync('zip',['-q','-X','-0',out,...names],{cwd:dir,encoding:'utf8',shell:false});
 if(cmd.status!==0||cmd.error)fail('Canonical Windows ZIP creation failed: '+(cmd.stderr||cmd.error?.message));
}
function stageMac(input,out,arch){
 const files=listFiles(input),name='CryLo-'+VERSION+'-mac-'+arch+'-unsigned.pkg';
 const pkg=exact(files,name);
 verifyCheckLine(fs.readFileSync(exact(files,'SHA256SUMS-CI-ONLY.txt'),'utf8'),pkg);
 safeCopy(pkg,path.join(out,name));
}
function main(){
 const base=process.env.CRYLO_UNSIGNED_INPUT_DIR,
  out=process.env.CRYLO_UNSIGNED_OUTPUT_DIR,
  meta=process.env.CRYLO_UNSIGNED_META_DIR,
  repo=process.env.GITHUB_WORKSPACE,
  target=process.env.GITHUB_SHA;
 for(const d of [base,out,meta,repo])if(!d||!path.isAbsolute(d))fail('Require absolute CI input/output paths');
 if(!COMMIT.test(target||''))fail('Missing exact source commit');
 if(fs.readdirSync(out).length)fail('Unsigned output must start empty');
 const sourceRuns={};
 for(const family of ['win','linux','mac'])
  sourceRuns[family]=verifyRun(family,base,meta,target,repo,
    family==='mac'||family==='win'?['electron/scripts/release-linux.sh']:[]);
 const work=fs.mkdtempSync(path.join(os.tmpdir(),'crylo-unified-unsigned-'));
 const candidates=[];
 try{
  const winDir=path.join(work,'windows'),linuxX=path.join(work,'linux-x64'),linuxA=path.join(work,'linux-arm64');
  for(const d of [winDir,linuxX,linuxA])fs.mkdirSync(d);
  const winDetails=winPackage(path.join(base,'win-x64'),winDir,sourceRuns.win,VERSION);
  let name='CryLo-Release-'+VERSION+'-win-x64.zip';
  packageZip(winDir,path.join(out,name));
  candidates.push({platform:'win',architecture:'x64',file:name,run:sourceRuns.win.id,
   gitCommit:sourceRuns.win.head_sha,sha256:hash(path.join(out,name)),
   size:fs.statSync(path.join(out,name)).size,runtimeDLLs:winDetails.runtimeDLLs});
  for(const [arch,dir] of [['x64',linuxX],['arm64',linuxA]]){
   linuxPackage(path.join(base,'linux-'+arch),dir,sourceRuns.linux,arch,VERSION);
   name='CryLo-Release-'+VERSION+'-linux-'+arch+'.tar';
   packageTar(dir,path.join(out,name));
   candidates.push({platform:'linux',architecture:arch,file:name,run:sourceRuns.linux.id,
    gitCommit:sourceRuns.linux.head_sha,sha256:hash(path.join(out,name)),
    size:fs.statSync(path.join(out,name)).size});
  }
  for(const arch of ['x64','arm64']){
   stageMac(path.join(base,'mac-'+arch),out,arch);
   name='CryLo-'+VERSION+'-mac-'+arch+'-unsigned.pkg';
   candidates.push({platform:'mac',architecture:arch,file:name,run:sourceRuns.mac.id,
    gitCommit:sourceRuns.mac.head_sha,sha256:hash(path.join(out,name)),
    size:fs.statSync(path.join(out,name)).size});
  }
 }finally{fs.rmSync(work,{recursive:true,force:true});}
 if(candidates.length!==5)fail('Refusing incomplete five-platform release input');
 const result={schema:1,product:'CryLo',network:'testnet',version:VERSION,
  kind:'UNSIGNED_VALIDATION_ONLY',stagingCommit:target,releaseSigningAuthority:'Pi1',
  officialManifestSigned:false,officialReleasePublished:false,candidates};
 fs.writeFileSync(path.join(out,'UNSIGNED-CI-STAGING-ONLY.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
 fs.writeFileSync(path.join(out,'SHA256SUMS-CI-ONLY.txt'),
  candidates.map(c=>c.sha256+'  '+c.file).join('\n')+'\n',{flag:'wx',mode:0o600});
 for(const c of candidates)console.log('STAGED UNSIGNED '+c.platform+'/'+c.architecture+
  ' '+c.file+' '+c.sha256);
 console.log('PASS: all five source-provenance-compatible candidates validated. No Pi1 signature or publication.');
}
if(require.main===module){try{main();}catch(e){console.error('FAIL CLOSED: '+e.message);process.exitCode=1;}}
module.exports=Object.freeze({machine,validateProvenance,shaFromCertutil,exact,verifyCheckLine,PINS});

