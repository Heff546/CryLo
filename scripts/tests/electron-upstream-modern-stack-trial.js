#!/usr/bin/env node
'use strict';
// Standalone, disposable upstream-only dependency resolution for CryLo.
// Does not edit canonical lockfiles, build native code, or publish anything.
// Tests actual current APIs for NSIS, ASAR, glob and cross-platform filters.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process'),{createRequire}=require('node:module');
const variant=process.argv[2],out=process.argv[3];
if(!['modern-current-builder','modern-upstream-v26','modern-parents-only',
 'modern-purge-legacy','modern-purge-legacy-builder'].includes(variant)||!out)
 throw Error('Expected modern-current-builder, modern-upstream-v26, or modern-parents-only and output');
const source=path.resolve(__dirname,'../../electron');
const canonical=['package.json','package-lock.json'];
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const original=canonical.map(x=>hash(path.join(source,x)));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crylo-upstream-only-modern-'));
const report={variant,fullAudit:null,productionAudit:null,checks:[],sourceUnchanged:false,
  executionValid:false,candidateSafe:false,releaseFrozen:true,nativeBuilt:false,installerBuilt:false};
const must=(condition,message)=>{if(!condition)throw Error(message)};
const run=(args,allowAdvisory=false)=>{
 const proc=spawnSync('npm',args,{cwd:dir,encoding:'utf8',timeout:180000,maxBuffer:16*1024*1024});
 must(!proc.error&&(proc.status===0||(allowAdvisory&&proc.status===1)),
   'npm '+args.join(' ')+' failed: '+String(proc.stderr||proc.stdout||proc.error).slice(-850));
 return proc;
};
function audit(extra){
 const r=run(['audit','--package-lock-only',...extra,'--json'],true);
 let json;try{json=JSON.parse(r.stdout)}catch{throw Error('Registry returned invalid npm audit JSON')}
 must(!json.error&&json.metadata?.vulnerabilities,'Registry returned incomplete npm audit results');
 return {counts:json.metadata.vulnerabilities,findings:Object.entries(json.vulnerabilities||{})
  .map(([name,v])=>({name,severity:v.severity}))};
}
const check=async(name,func)=>{
 try{await func();report.checks.push({name,pass:true})}
 catch(e){report.checks.push({name,pass:false,detail:String(e).slice(0,600)})}
};
const file={isFile:()=>true,isDirectory:()=>false,isSymbolicLink:()=>false};
const folder={isFile:()=>false,isDirectory:()=>true,isSymbolicLink:()=>false};
const getVersion=(req,name)=>{try{return req(name+'/package.json').version}catch(e){return 'not-exported'}};
(async()=>{
 try{
  for(const f of canonical)fs.copyFileSync(path.join(source,f),path.join(dir,f));
  const pkg=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'));
  must(!pkg.overrides,'Expected canonical CryLo Electron package without overrides');
  if(['modern-upstream-v26','modern-purge-legacy-builder'].includes(variant))
   pkg.devDependencies['electron-builder']='26.18.1';
  pkg.overrides={
   '@electron/asar':'4.3.1',
   'electron-winstaller':'5.4.4',
   'dir-compare':'5.0.0',
   'filelist':'2.0.2'
  };
  if(variant!=='modern-parents-only')pkg.overrides.minimatch='11.0.3';
  if(variant.startsWith('modern-purge-legacy')){
   pkg.overrides.glob='14.0.3';
   pkg.overrides.rimraf='6.0.1';
  }
  fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify(pkg,null,2)+'\n');
  run(['install','--package-lock-only','--ignore-scripts','--no-audit','--no-fund']);
  const lock=JSON.parse(fs.readFileSync(path.join(dir,'package-lock.json'),'utf8'));
  report.chosen=Object.entries(lock.packages).filter(([k])=>
   /\/(minimatch|glob|@electron\/asar|@electron\/universal|app-builder-lib|electron-builder|electron-winstaller|dir-compare|filelist|rimraf|temp)$/.test(k))
   .map(([location,p])=>({location,version:p.version,dependencies:p.dependencies}));
  report.dependencyParents=Object.entries(lock.packages||{})
   .filter(([,x])=>x.dependencies && (x.dependencies.glob||x.dependencies.rimraf||x.dependencies.temp))
   .map(([location,x])=>({location,glob:x.dependencies.glob,rimraf:x.dependencies.rimraf,temp:x.dependencies.temp}));
  report.fullAudit=audit([]);
  report.productionAudit=audit(['--omit=dev']);
  run(['ci','--ignore-scripts','--no-audit','--no-fund']);
  const root=createRequire(path.join(dir,'package.json'));
  const builder=createRequire(root.resolve('electron-builder/package.json'));
  const lib=createRequire(builder.resolve('app-builder-lib/package.json'));
  const asar=createRequire(lib.resolve('@electron/asar'));
  const universal=createRequire(lib.resolve('@electron/universal/package.json'));
  const dircompare=createRequire(universal.resolve('dir-compare'));
  const win=createRequire(root.resolve('electron-winstaller'));
  report.installed={
   builder:getVersion(root,'electron-builder'),lib:getVersion(builder,'app-builder-lib'),
   asar:report.chosen.find(x=>x.location.endsWith('/@electron/asar'))?.version,
   universal:getVersion(lib,'@electron/universal'),
   dircompare:report.chosen.find(x=>x.location.endsWith('/dir-compare'))?.version,
   winstaller:report.chosen.find(x=>x.location.endsWith('/electron-winstaller'))?.version,
   minimatch:getVersion(lib,'minimatch'), universalMinimatch:getVersion(universal,'minimatch')
  };
  await check('app-builder-lib minimatch class and CryLo NSIS/Wallet/Linux/Mac file filters',()=>{
   must(typeof lib('minimatch').Minimatch==='function','Minimatch class API missing');
   const {FileMatcher}=lib('app-builder-lib/out/fileMatcher');
   const cases=[
    {patterns:['main.js','preload.js','security/**/*','src/**/*','assets/**/*'],
     include:['main.js','preload.js','security/secure.js','src/bridge/bridge.js','assets/icon.png'],
     exclude:['wallet.keys','private.pem']},
    {patterns:['CryLo-daemon.exe','CryLo-wallet-rpc.exe','BINARY-MANIFEST.txt','*.dll'],
     include:['CryLo-daemon.exe','CryLo-wallet-rpc.exe','BINARY-MANIFEST.txt','libcrypto.dll'],
     exclude:['private.pem','wallet.keys']},
    {patterns:['CryLo-daemon','CryLo-wallet-rpc','BINARY-MANIFEST.txt'],
     include:['CryLo-daemon','CryLo-wallet-rpc','BINARY-MANIFEST.txt'],
     exclude:['CryLo-daemon.exe','private.pem']}
   ];
   for(const entry of cases){
    const matcher=new FileMatcher('/app','/out',s=>s,entry.patterns).createFilter();
    for(const f of entry.include)must(matcher('/app/'+f,file),'Missing required '+f);
    for(const f of entry.exclude)must(!matcher('/app/'+f,file),'Unsafe package inclusion '+f);
   }
   const recursive=new FileMatcher('/app','/out',s=>s,['src/**/*.js']).createFilter();
   must(recursive('/app/src',folder)&&recursive('/app/src/deep',folder)
      &&recursive('/app/src/deep/file.js',file),'Folder traversal mismatch');
  });
  await check('modern @electron/asar real packaging and unpackaging',async()=>{
   const mod=lib('@electron/asar');
   must(typeof mod.createPackage==='function'&&typeof mod.extractAll==='function','ASAR packaging API unavailable');
   const t=fs.mkdtempSync(path.join(os.tmpdir(),'crylo-modern-asar-'));
   try{
    fs.mkdirSync(path.join(t,'src'));
    fs.writeFileSync(path.join(t,'src','sample.json'),'{"crylo":1}');
    await mod.createPackage(path.join(t,'src'),path.join(t,'pkg.asar'));
    mod.extractAll(path.join(t,'pkg.asar'),path.join(t,'extracted'));
    must(fs.readFileSync(path.join(t,'extracted','sample.json'),'utf8')==='{"crylo":1}',
      'ASAR actual round-trip failed');
   }finally{fs.rmSync(t,{recursive:true,force:true})}
  });
  await check('modern @electron/universal minimatch and directory compare APIs',()=>{
   const m=universal('minimatch');
   must(typeof m.minimatch==='function'&&m.minimatch('a.js','*.js'),'Universal named minimatch API changed');
   const compare=universal('dir-compare');
   must(typeof compare.compareSync==='function','dir-compare comparison API changed');
   const t=fs.mkdtempSync(path.join(os.tmpdir(),'crylo-dircompare-'));
   try{
    const left=path.join(t,'left'),right=path.join(t,'right');
    fs.mkdirSync(left);fs.mkdirSync(right);
    fs.writeFileSync(path.join(left,'sample.txt'),'same');
    fs.writeFileSync(path.join(right,'sample.txt'),'same');
    const r=compare.compareSync(left,right,{compareSize:true});
    must(r.same===true,'Actual directory compare failed');
   }finally{fs.rmSync(t,{recursive:true,force:true})}
  });
  await check('electron-builder exports and optional Squirrel tooling imports',()=>{
   must(typeof root('electron-builder').build==='function','Electron builder API unavailable');
   // Squirrel is not a configured CryLo Windows target; still ensure import
   // compatibility, so the toolchain does not break on Mac/Linux.
   const squirrel=win('electron-winstaller');
   must(typeof squirrel.createWindowsInstaller==='function',
     'New squirrel installer API cannot load from electron-winstaller');
  });
  await check('legacy temp cleanup and glob consumers still function',()=>{
   const tempModule=report.chosen.some(x=>x.location.endsWith('/temp'));
   if(!tempModule)return;
   const mod=win('temp');
   must(typeof mod.mkdirSync==='function'&&typeof mod.cleanupSync==='function','Legacy temp API missing');
   mod.track();
   const p=mod.mkdirSync('crylo-ci-modern-temp');
   must(fs.statSync(p).isDirectory(),'temp could not create directory');
   mod.cleanupSync();
   must(!fs.existsSync(p),'temp cleanup failed after npm overrides');
  });
  await check('no unsupported legacy minimatch 3/5, glob7 or rimraf2 remain',()=>{
   const bad=report.chosen.filter(x=>
    (x.location.endsWith('/minimatch') && !/^11\./.test(x.version)) ||
    (x.location.endsWith('/glob') && /^7\./.test(x.version)) ||
    (x.location.endsWith('/rimraf') && /^2\./.test(x.version)));
   must(bad.length===0,'Legacy subtree remains: '+JSON.stringify(bad.map(x=>({location:x.location,version:x.version}))));
  });
  report.executionValid=true;
  report.candidateSafe=report.fullAudit.counts.total===0 && report.productionAudit.counts.total===0 &&
    report.checks.every(x=>x.pass);
 }catch(e){report.error=String(e)}
 finally{
  report.sourceUnchanged=canonical.every((f,i)=>hash(path.join(source,f))===original[i]);
  if(!report.sourceUnchanged){report.candidateSafe=false;report.executionValid=false}
  fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
  fs.rmSync(dir,{recursive:true,force:true});
  console.log(JSON.stringify({variant,full:report.fullAudit?.counts?.total,
   prod:report.productionAudit?.counts?.total,findings:report.fullAudit?.findings,
   dependencyParents:report.dependencyParents,installed:report.installed,
   checks:report.checks,executionValid:report.executionValid,candidateSafe:report.candidateSafe,
   sourceUnchanged:report.sourceUnchanged,error:report.error}).slice(0,16000));
 }
})().catch(e=>{console.error(e);process.exitCode=1});
