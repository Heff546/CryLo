#!/usr/bin/env node
'use strict';
// Disposable compatibility trial. Does not change CryLo's canonical lockfile.
// Only override versions affected by GHSA-g3hv-75wg-m249 (minimatch 9/10).
// Older callable minimatch 3/5 is deliberately left to its upstream consumers.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process'),{createRequire}=require('node:module');
const variant=process.argv[2],reportFile=process.argv[3];
if(!['range-parent','range-exact','range-parent-nested'].includes(variant)||!reportFile)
 throw Error('Use range-parent, range-exact or range-parent-nested and evidence path');
const source=path.resolve(__dirname,'../../electron');
const files=['package.json','package-lock.json'];
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const original=files.map(x=>sha(path.join(source,x)));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crylo-minimatch-ranges-'));
const ensure=(ok,message)=>{if(!ok)throw Error(message)};
const report={variant,sourceUnchanged:false,fullAudit:null,productionAudit:null,checks:[],
  candidateSafe:false,executionValid:false,buildPerformed:false,releasePublished:false};
const npmArgs=['--ignore-scripts','--no-fund','--no-audit'];
const invoke=args=>{
 const r=spawnSync('npm',args,{cwd:dir,encoding:'utf8',maxBuffer:12*1024*1024,timeout:180000});
 ensure(r.status===0&&!r.error,'npm '+args.join(' ')+' error: '+String(r.stderr||r.stdout||r.error).slice(-900));
 return r;
};
const audit=args=>{
 const r=spawnSync('npm',['audit','--package-lock-only',...args,'--json'],
  {cwd:dir,encoding:'utf8',maxBuffer:12*1024*1024,timeout:120000});
 let j;
 try{j=JSON.parse(r.stdout)}catch{throw Error('npm audit JSON incomplete: '+String(r.stderr).slice(-200))}
 ensure((r.status===0||r.status===1)&&!j.error&&j.metadata?.vulnerabilities,
  'npm audit registry error: '+JSON.stringify(j.error));
 return {counts:j.metadata.vulnerabilities,findings:Object.entries(j.vulnerabilities||{}).map(([name,v])=>({name,severity:v.severity}))};
};
const test=async(name,fn)=>{
 try{await fn();report.checks.push({name,pass:true})}
 catch(error){report.checks.push({name,pass:false,error:String(error).slice(0,500)})}
};
const file={isFile:()=>true,isDirectory:()=>false,isSymbolicLink:()=>false};
const folder={isFile:()=>false,isDirectory:()=>true,isSymbolicLink:()=>false};
const version=(req,mod)=>req(mod+'/package.json').version;
(async()=>{
 try{
  for(const name of files)fs.copyFileSync(path.join(source,name),path.join(dir,name));
  const pkg=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'));
  ensure(!pkg.overrides,'Unexpected canonical package overrides');
  pkg.overrides=variant==='range-exact'?
   {'minimatch@10.2.6':'11.0.3','minimatch@9.0.9':'11.0.3'}:
   {'minimatch@^10.2.5':'11.0.3','minimatch@^9.0.3':'11.0.3'};
  fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify(pkg,null,2)+'\n');
  const strategy=variant.endsWith('-nested')?['--install-strategy=nested']:[];
  invoke(['install','--package-lock-only',...strategy,...npmArgs]);
  const lock=JSON.parse(fs.readFileSync(path.join(dir,'package-lock.json'),'utf8'));
  report.minimatches=Object.entries(lock.packages||{})
   .filter(([p])=>p==='node_modules/minimatch'||p.endsWith('/node_modules/minimatch'))
   .map(([location,p])=>({location,version:p.version}));
  report.fullAudit=audit([]);
  report.productionAudit=audit(['--omit=dev']);
  invoke(['ci',...strategy,...npmArgs]);
  const req=createRequire(path.join(dir,'package.json'));
  const builderReq=createRequire(req.resolve('electron-builder/package.json'));
  const libReq=createRequire(builderReq.resolve('app-builder-lib/package.json'));
  const asarReq=createRequire(libReq.resolve('@electron/asar/package.json'));
  const globReq=createRequire(asarReq.resolve('glob/package.json'));
  const universalReq=createRequire(libReq.resolve('@electron/universal/package.json'));
  report.installed={
   builder:version(req,'electron-builder'),
   lib:version(builderReq,'app-builder-lib'),
   builderMinimatch:version(libReq,'minimatch'),
   universalMinimatch:version(universalReq,'minimatch'),
   asarMinimatch:version(asarReq,'minimatch'),
   globMinimatch:version(globReq,'minimatch')
  };
  await test('patched minimatch used in app-builder-lib and @electron/universal',()=>{
   ensure(/^11\./.test(report.installed.builderMinimatch),'app-builder-lib not patched');
   ensure(/^11\./.test(report.installed.universalMinimatch),'@electron/universal not patched');
   ensure(typeof libReq('minimatch').Minimatch==='function','Minimatch class API missing');
   ensure(typeof universalReq('minimatch').minimatch==='function','universal named function missing');
  });
  await test('legacy callable ASAR minimatch 3 preserved',()=>{
   ensure(/^3\./.test(report.installed.asarMinimatch),'ASAR lost legacy minmatch 3');
   const mm=asarReq('minimatch');
   ensure(typeof mm==='function'&&mm('test.txt','*.txt'),'ASAR legacy minimatch failed');
  });
  await test('legacy glob7 is callable and discovers real files',()=>{
   ensure(/^3\./.test(report.installed.globMinimatch),'glob7 lost legacy minmatch 3');
   const glob=asarReq('glob');
   const mm=globReq('minimatch');
   ensure(typeof mm==='function'&&mm('test.txt','*.txt'),'glob7 legacy matcher broken');
   const t=fs.mkdtempSync(path.join(os.tmpdir(),'crylo-glob-'));
   try{fs.writeFileSync(path.join(t,'sample.json'),'{}');
    ensure(glob.sync('**/*.json',{cwd:t}).includes('sample.json'),'glob7 file discovery failed');
   }finally{fs.rmSync(t,{recursive:true,force:true})}
  });
  await test('real ASAR createPackage and extractAll round trip',async()=>{
   const asar=libReq('@electron/asar');
   const t=fs.mkdtempSync(path.join(os.tmpdir(),'crylo-asar-'));
   try{fs.mkdirSync(path.join(t,'src'));fs.writeFileSync(path.join(t,'src','sample.json'),'{"crylo":1}');
    await asar.createPackage(path.join(t,'src'),path.join(t,'test.asar'));
    asar.extractAll(path.join(t,'test.asar'),path.join(t,'dst'));
    ensure(fs.readFileSync(path.join(t,'dst','sample.json'),'utf8')==='{"crylo":1}',
      'ASAR archive round-trip wrong data');
   }finally{fs.rmSync(t,{recursive:true,force:true})}
  });
  await test('electron-builder API and CryLo cross-platform packaged files',()=>{
   ensure(typeof req('electron-builder').build==='function','builder API unavailable');
   const {FileMatcher}=libReq('app-builder-lib/out/fileMatcher');
   const cases=[
    {patterns:['main.js','preload.js','security/**/*','src/**/*','assets/**/*'],
     yes:['main.js','preload.js','security/keychain.js','src/nexus/client.js','assets/icon.png'],
     no:['wallet.keys','private.pem']},
    {patterns:['CryLo-daemon.exe','CryLo-wallet-rpc.exe','BINARY-MANIFEST.txt','*.dll'],
     yes:['CryLo-daemon.exe','CryLo-wallet-rpc.exe','BINARY-MANIFEST.txt','libcrypto.dll'],
     no:['wallet.keys','private.pem']},
    {patterns:['CryLo-daemon','CryLo-wallet-rpc','BINARY-MANIFEST.txt'],
     yes:['CryLo-daemon','CryLo-wallet-rpc','BINARY-MANIFEST.txt'],
     no:['CryLo-daemon.exe','private.pem']}
   ];
   for(const c of cases){
    const filter=new FileMatcher('/app','/out',s=>s,c.patterns).createFilter();
    for(const name of c.yes)ensure(filter('/app/'+name,file),'Exclude required file '+name);
    for(const name of c.no)ensure(!filter('/app/'+name,file),'Included forbidden file '+name);
   }
   const globFilter=new FileMatcher('/app','/out',s=>s,['src/**/*.js']).createFilter();
   ensure(globFilter('/app/src',folder)&&globFilter('/app/src/deep',folder)
    &&globFilter('/app/src/deep/main.js',file),'Recursive folder inclusion changed');
  });
  report.executionValid=true;
  report.candidateSafe=report.fullAudit.counts.total===0&&report.productionAudit.counts.total===0
   &&report.checks.every(c=>c.pass);
 }catch(error){report.error=String(error);report.candidateSafe=false}
 finally{
  report.sourceUnchanged=files.every((f,i)=>sha(path.join(source,f))===original[i]);
  if(!report.sourceUnchanged){report.executionValid=false;report.candidateSafe=false}
  fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n');
  fs.rmSync(dir,{recursive:true,force:true});
  console.log(JSON.stringify({variant,full:report.fullAudit?.counts?.total,prod:report.productionAudit?.counts?.total,
   installed:report.installed,checks:report.checks,candidateSafe:report.candidateSafe,
   executionValid:report.executionValid,sourceUnchanged:report.sourceUnchanged,error:report.error}));
 }
})().catch(error=>{console.error(error);process.exitCode=1});
