'use strict';
// Disposable dependency audit: no canonical files modified, no native CryLo build.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process'),{createRequire}=require('node:module');
const candidate=process.argv[2],output=process.argv[3];
if(!['baseline','override','builder','builder-override','scoped-10','scoped-9-10'].includes(candidate)||!output)throw Error('candidate and report required');
const source=path.resolve(__dirname,'../../electron');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crylo-electron-'));
const report={candidate,releaseFrozen:true,mayPublish:false,nativeBuild:false,installerBuild:false};
const run=(args)=>spawnSync('npm',args,{cwd:dir,encoding:'utf8',timeout:150000,maxBuffer:8*1024*1024});
const scan=(extra)=>{
 const r=run(['audit','--package-lock-only',...extra,'--json']);
 let j;try{j=JSON.parse(r.stdout||'')}catch(e){return {valid:false,error:(r.stderr||'invalid json').slice(-300)}}
 if(j.error||!j.metadata?.vulnerabilities)return {valid:false,error:JSON.stringify(j.error||'invalid metadata')};
 return {valid:true,counts:j.metadata.vulnerabilities,advisories:Object.entries(j.vulnerabilities||{}).map(([name,x])=>({name,severity:x.severity}))};
};
async function smoke(){
 const req=createRequire(path.join(dir,'package.json')),test=[];
 const check=async(label,fn)=>{try{await fn();test.push({label,pass:true})}catch(e){test.push({label,pass:false,error:String(e).slice(0,400)})}};
 const t=fs.mkdtempSync(path.join(os.tmpdir(),'crylo-test-'));
 try{
  fs.mkdirSync(path.join(t,'input'));fs.writeFileSync(path.join(t,'input','sample.json'),'{"crylo":1}');
  await check('glob7-sync',()=>{
   const a=req('glob').sync('**/*.json',{cwd:path.join(t,'input')});
   if(!a.includes('sample.json'))throw Error('glob failed');
  });
  await check('asar-pack-extract',async()=>{
   const asar=req('@electron/asar'),file=path.join(t,'app.asar');
   await asar.createPackage(path.join(t,'input'),file);
   asar.extractAll(file,path.join(t,'extracted'));
   if(fs.readFileSync(path.join(t,'extracted','sample.json'),'utf8')!=='{"crylo":1}')throw Error('archive changed');
  });
  await check('electron-builder-import',()=>{
   if(typeof req('electron-builder').build!=='function')throw Error('missing builder API');
  });
  await check('legacy-glob-minimatch-API',()=>{
   const mm=createRequire(req.resolve('glob/package.json'))('minimatch');
   if(typeof mm!=='function'||!mm('sample.json','*.json'))throw Error('glob7 expects callable minimatch');
  });
 }finally{fs.rmSync(t,{recursive:true,force:true})}
 return test;
}
(async()=>{
 try{
  for(const f of ['package.json','package-lock.json'])fs.copyFileSync(path.join(source,f),path.join(dir,f));
  const pkg=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'));
  if(candidate.includes('override'))pkg.overrides={...(pkg.overrides||{}),minimatch:'11.0.1'};
  if(candidate==='scoped-10'||candidate==='scoped-9-10'){
    pkg.overrides={'app-builder-lib':{minimatch:'11.0.1'}};
    if(candidate==='scoped-9-10')pkg.overrides['@electron/universal']={minimatch:'11.0.1'};
  }
  if(candidate.includes('builder'))pkg.devDependencies['electron-builder']='26.18.1';
  fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify(pkg,null,2)+'\n');
  if(candidate!=='baseline'){
   const r=run(['install','--package-lock-only','--ignore-scripts','--no-audit','--no-fund']);
   report.resolution={ok:r.status===0,error:r.status===0?null:(r.stderr||r.stdout).slice(-500)};
   if(r.status!==0)throw Error('Isolated npm resolution unsuccessful');
  }
  const lock=JSON.parse(fs.readFileSync(path.join(dir,'package-lock.json'),'utf8'));
  report.minimatch=Object.entries(lock.packages).filter(([k])=>k==='node_modules/minimatch'||k.endsWith('/node_modules/minimatch')).map(([k,v])=>({path:k,version:v.version}));
  report.fullAudit=scan([]);report.productionAudit=scan(['--omit=dev']);
  if(!report.fullAudit.valid||!report.productionAudit.valid)throw Error('Registry audit failed');
  const install=run(['ci','--ignore-scripts','--no-audit','--no-fund']);
  report.npmCi={ok:install.status===0,error:install.status===0?null:(install.stderr||install.stdout).slice(-500)};
  if(install.status!==0)throw Error('Isolated npm ci failed');
  report.apiTests=await smoke();
  report.candidateSafe=report.fullAudit.counts.total===0&&report.productionAudit.counts.total===0&&report.apiTests.every(x=>x.pass);
 }catch(e){report.error=String(e);report.candidateSafe=false}
 finally{fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');fs.rmSync(dir,{recursive:true,force:true})}
 console.log(JSON.stringify({candidate,full:report.fullAudit?.counts?.total,production:report.productionAudit?.counts?.total,
  apiTests:report.apiTests,candidateSafe:report.candidateSafe,error:report.error}));
})().catch(e=>{console.error(e);process.exitCode=1});
