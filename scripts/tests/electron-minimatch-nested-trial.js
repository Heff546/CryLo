#!/usr/bin/env node
'use strict';
// CryLo isolated nested-install compatibility trial. Never modifies electron/* or publishes.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process'),{createRequire}=require('node:module');
const variants=new Set(['scoped-10-nested','scoped-9-10-nested']);
const variant=process.argv[2],out=process.argv[3];
if(!variants.has(variant)||!out)throw Error('Expected nested trial variant and output path');
const source=path.resolve(__dirname,'../../electron'),files=['package.json','package-lock.json'];
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const original=files.map(f=>sha(path.join(source,f)));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crylo-scoped-nested-'));
const report={variant,freeze:true,nativeBuild:false,electronInstallerBuild:false,mayPublish:false,
  packageLockUnchanged:false,fullAudit:null,productionAudit:null,checks:[],candidateSafe:false,executionValid:false};
const ensure=(c,msg)=>{if(!c)throw Error(msg)};
const run=(args)=>spawnSync('npm',args,{cwd:dir,encoding:'utf8',timeout:180000,maxBuffer:14*1024*1024});
const audited=(more)=>{
 const r=run(['audit','--package-lock-only',...more,'--json']);
 let j;try{j=JSON.parse(r.stdout||'')}catch{throw Error('Unparseable audit JSON: '+(r.stderr||'').slice(-300))}
 ensure((r.status===0||r.status===1)&&!j.error&&j.metadata?.vulnerabilities,
  'Incomplete audit from registry');
 return {counts:j.metadata.vulnerabilities,findings:Object.entries(j.vulnerabilities||{}).map(
  ([name,x])=>({name,severity:x.severity}))};
};
const checked=async(name,fn)=>{
 try{await fn();report.checks.push({name,pass:true})}
 catch(e){report.checks.push({name,pass:false,error:String(e).slice(0,450)})}
};
const version=(r,name)=>r(name+'/package.json').version;
const simpleFile={isDirectory:()=>false,isFile:()=>true,isSymbolicLink:()=>false};
const directory={isDirectory:()=>true,isFile:()=>false,isSymbolicLink:()=>false};
(async()=>{
 try {
  for(const f of files)fs.copyFileSync(path.join(source,f),path.join(dir,f));
  const pkg=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'));
  ensure(!pkg.overrides,'Unreviewed original override detected');
  pkg.overrides={'app-builder-lib':{minimatch:'11.0.3'}};
  if(variant==='scoped-9-10-nested')
   pkg.overrides['@electron/universal']={minimatch:'11.0.3'};
  fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify(pkg,null,2)+'\n');
  const resolve=run(['install','--package-lock-only','--install-strategy=nested','--ignore-scripts','--no-audit','--no-fund']);
  ensure(resolve.status===0,'Nested dependency resolution failed: '+String(resolve.stderr||resolve.stdout).slice(-600));
  const lock=JSON.parse(fs.readFileSync(path.join(dir,'package-lock.json'),'utf8'));
  report.resolvedMinimatch=Object.entries(lock.packages||{}).filter(([p])=>p.endsWith('/minimatch'))
    .map(([location,p])=>({location,version:p.version}));
  report.fullAudit=audited([]);
  report.productionAudit=audited(['--omit=dev']);
  const inst=run(['ci','--install-strategy=nested','--ignore-scripts','--no-audit','--no-fund']);
  ensure(inst.status===0,'Nested npm ci failed: '+String(inst.stderr||inst.stdout).slice(-600));
  const root=createRequire(path.join(dir,'package.json'));
  const builderReq=createRequire(root.resolve('electron-builder/package.json'));
  const libReq=createRequire(builderReq.resolve('app-builder-lib/package.json'));
  const asarReq=createRequire(libReq.resolve('@electron/asar/package.json'));
  const globReq=createRequire(asarReq.resolve('glob/package.json'));
  const univReq=createRequire(libReq.resolve('@electron/universal/package.json'));
  report.installed={builder:version(root,'electron-builder'),lib:version(builderReq,'app-builder-lib'),
   builderMinimatch:version(libReq,'minimatch'),universalMinimatch:version(univReq,'minimatch'),
   asarMinimatch:version(asarReq,'minimatch'),globMinimatch:version(globReq,'minimatch')};
  await checked('Scoped app-builder-lib uses patched class API',()=>{
   ensure(report.installed.builderMinimatch==='11.0.3','builder still uses old minimatch');
   ensure(typeof libReq('minimatch').Minimatch==='function','Minimatch class missing');
  });
  await checked('Legacy ASAR remains callable',()=>{
   ensure(typeof asarReq('minimatch')==='function','ASAR legacy matcher no longer callable');
   ensure(asarReq('minimatch')('test.txt','*.txt'),'ASAR matcher unable to match file');
  });
  await checked('Legacy glob7 and minimatch remain callable',()=>{
   const g=asarReq('glob');
   ensure(typeof g.sync==='function','glob7.sync missing');
   const m=globReq('minimatch');
   ensure(typeof m==='function'&&m('test.txt','*.txt'),'glob7 minimatch incompatible');
   const temp=fs.mkdtempSync(path.join(os.tmpdir(),'crylo-glob7-'));
   try{fs.writeFileSync(path.join(temp,'sample.json'),'{}');
    ensure(g.sync('**/*.json',{cwd:temp}).includes('sample.json'),'glob7 matching broken');
   }finally{fs.rmSync(temp,{recursive:true,force:true})}
  });
  await checked('Universal minimatch exported call',()=>{
   const m=univReq('minimatch');
   ensure(typeof m.minimatch==='function','@electron/universal named minimatch export unavailable');
   ensure(m.minimatch('test.json','*.json',{matchBase:true}),'universal matcher changed');
   if(variant==='scoped-9-10-nested')
    ensure(report.installed.universalMinimatch==='11.0.3','universal still uses old minimatch');
  });
  await checked('ASAR archive create and extract',async()=>{
   const asar=libReq('@electron/asar');
   const t=fs.mkdtempSync(path.join(os.tmpdir(),'crylo-asar-'));
   try{fs.mkdirSync(path.join(t,'src'));fs.writeFileSync(path.join(t,'src','sample.json'),'{"crylo":1}');
    await asar.createPackage(path.join(t,'src'),path.join(t,'test.asar'));
    asar.extractAll(path.join(t,'test.asar'),path.join(t,'dst'));
    ensure(fs.readFileSync(path.join(t,'dst','sample.json'),'utf8')==='{"crylo":1}','ASAR round trip failed');
   }finally{fs.rmSync(t,{recursive:true,force:true})}
  });
  await checked('Electron builder API and CryLo Windows/Linux/macOS filters',()=>{
   ensure(typeof root('electron-builder').build==='function','Builder build() unavailable');
   const {FileMatcher}=libReq('app-builder-lib/out/fileMatcher');
   const examples=[
    {pat:['main.js','preload.js','security/**/*','src/**/*','assets/**/*'],
     yes:['main.js','preload.js','security/keychain.js','src/bridge/index.js','assets/icon.png'],
     no:['private.pem','wallet.keys']},
    {pat:['CryLo-daemon.exe','CryLo-wallet-rpc.exe','BINARY-MANIFEST.txt','*.dll'],
     yes:['CryLo-daemon.exe','CryLo-wallet-rpc.exe','BINARY-MANIFEST.txt','libcrypto.dll'],
     no:['wallet.keys','private.pem']},
    {pat:['CryLo-daemon','CryLo-wallet-rpc','BINARY-MANIFEST.txt'],
     yes:['CryLo-daemon','CryLo-wallet-rpc','BINARY-MANIFEST.txt'],
     no:['CryLo-daemon.exe','private.pem']}
   ];
   for(const e of examples){
    const f=new FileMatcher('/app','/out',s=>s,e.pat).createFilter();
    for(const p of e.yes)ensure(f('/app/'+p,simpleFile),'Missing '+p);
    for(const p of e.no)ensure(!f('/app/'+p,simpleFile),'Unexpected '+p);
   }
   const glob=new FileMatcher('/app','/out',s=>s,['src/**/*.js']).createFilter();
   ensure(glob('/app/src',directory)&&glob('/app/src/deep',directory)&&
    glob('/app/src/deep/a.js',simpleFile),'Directory traversal broken');
  });
  report.executionValid=true;
  report.candidateSafe=report.checks.every(x=>x.pass)&&report.fullAudit.counts.total===0&&
    report.productionAudit.counts.total===0;
 }catch(e){report.error=String(e)}
 finally {
  report.packageLockUnchanged=files.every((f,i)=>sha(path.join(source,f))===original[i]);
  if(!report.packageLockUnchanged){report.executionValid=false;report.candidateSafe=false}
  fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
  fs.rmSync(dir,{recursive:true,force:true});
  console.log(JSON.stringify({variant:report.variant,fullAudit:report.fullAudit?.counts?.total,
   prodAudit:report.productionAudit?.counts?.total,installed:report.installed,
   checks:report.checks,executionValid:report.executionValid,
   canonicalUnchanged:report.packageLockUnchanged,candidateSafe:report.candidateSafe,error:report.error}));
 }
 if(!report.executionValid)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});
