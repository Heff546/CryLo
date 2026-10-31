'use strict';
// Evidence-only reachability snapshot for GHSA-g3hv-75wg-m249.
// This is NOT an exception, an installer compatibility approval or a release gate pass.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const root=path.resolve('electron'),out=process.argv[2];
if(!out)throw Error('Output JSON path required');
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const lockPath=path.join(root,'package-lock.json'),pkgPath=path.join(root,'package.json');
const before=[hash(pkgPath),hash(lockPath)];
const report={advisory:'GHSA-g3hv-75wg-m249',releaseApproved:false,exceptionApproved:false,
  nativeBuild:false,installerBuild:false,sourceEvidence:[],callSiteSignals:[],audits:{},errors:[]};
const ensure=(v,msg)=>{if(!v)throw Error(msg)};
const installed=name=>path.join(root,name);
const scan=(rel)=>{
 const dir=installed(rel),versions=['src/index.ts','dist/commonjs/index.js',
  'dist/cjs/index.js','minimatch.js'];
 const found=versions.find(p=>fs.existsSync(path.join(dir,p)));
 ensure(found,'Missing inspectable installed minimatch source at '+rel);
 const source=fs.readFileSync(path.join(dir,found),'utf8');
 const meta=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'));
 const hasPhase=source.includes('firstPhasePreProcess')&&
                source.includes('secondPhasePreProcess');
 const hasClone=source.includes('globParts.push(other)');
 return {location:rel,version:meta.version,source:found,hasPhase,hasClone};
};
const audit=omit=>{
 const r=spawnSync('npm',['audit','--package-lock-only',...omit,'--json'],
  {cwd:root,encoding:'utf8',timeout:150000,maxBuffer:12000000});
 let j;try{j=JSON.parse(r.stdout)}catch{throw Error('npm audit JSON missing or invalid')};
 ensure((r.status===0||r.status===1)&&!j.error&&j.metadata?.vulnerabilities,
  'npm registry audit failed or incomplete');
 return {counts:j.metadata.vulnerabilities,
  packageFindings:Object.entries(j.vulnerabilities||{}).map(([name,v])=>(
    {name,severity:v.severity,via:(v.via||[]).filter(t=>typeof t==='object')
      .map(t=>({title:t.title,url:t.url,range:t.range}))}))};
};
function callSites(rel){
 const base=installed(rel);let scanned=0;const matches=[];
 function visit(folder,depth){
  if(depth>5||scanned>500||!fs.existsSync(folder))return;
  for(const item of fs.readdirSync(folder,{withFileTypes:true})){
   if(item.name==='node_modules'||item.name==='test'||item.name==='tests')continue;
   const p=path.join(folder,item.name);
   if(item.isDirectory()){visit(p,depth+1);continue;}
   if(!item.isFile()||!/\.(?:js|cjs|mjs)$/.test(item.name))continue;
   if(fs.statSync(p).size>1200000)continue;
   scanned++;
   const s=fs.readFileSync(p,'utf8');
   const terms=[...s.matchAll(/optimizationLevel/g)].slice(0,8);
   if(terms.length)matches.push({file:path.relative(base,p),
     mentions:terms.length,nearby:terms.map(m=>s.slice(Math.max(0,m.index-60),
       Math.min(s.length,m.index+100)))});
  }
 }
 visit(base,0);
 return {package:rel,filesScanned:scanned,optimizationLevelReferences:matches.slice(0,15)};
}
try{
 const pkg=JSON.parse(fs.readFileSync(pkgPath,'utf8'));
 ensure(pkg.devDependencies?.['electron-builder']==='26.17.0',
  'Frozen Electron builder version differs; review before using evidence');
 const lock=JSON.parse(fs.readFileSync(lockPath,'utf8'));
 const expected=[
  ['node_modules/minimatch','10.2.6'],
  ['node_modules/@electron/universal/node_modules/minimatch','9.0.9'],
  ['node_modules/@electron/asar/node_modules/minimatch','3.1.5'],
  ['node_modules/glob/node_modules/minimatch','3.1.5'],
  ['node_modules/dir-compare/node_modules/minimatch','3.1.5'],
  ['node_modules/filelist/node_modules/minimatch','5.1.9']
 ];
 for(const [rel,ver] of expected){
  ensure(lock.packages[rel]?.version===ver,'Unexpected locked minimatch version: '+rel);
  const item=scan(rel);
  ensure(item.version===ver,'Installed minimatch version differs: '+rel);
  report.sourceEvidence.push(item);
 }
 const old=report.sourceEvidence.filter(x=>/^(3|5)\./.test(x.version));
 const modern=report.sourceEvidence.filter(x=>/^(9|10)\./.test(x.version));
 ensure(old.every(x=>!x.hasPhase&&!x.hasClone),
   'New-advisory preprocessing found in previously older code; re-review');
 ensure(modern.every(x=>x.hasPhase&&x.hasClone),
   'Expected modern advisory code path not found; re-review');
 for(const p of ['node_modules/app-builder-lib','node_modules/@electron/universal',
  'node_modules/@electron/asar','node_modules/glob','node_modules/dir-compare',
  'node_modules/filelist']){
  report.callSiteSignals.push(callSites(p));
 }
 report.audits.full=audit([]);
 report.audits.production=audit(['--omit=dev']);
 report.evidenceComplete=true;
} catch(e){report.errors.push(String(e));report.evidenceComplete=false;}
finally {
 report.canonicalFilesUnchanged=before[0]===hash(pkgPath)&&before[1]===hash(lockPath);
 if(!report.canonicalFilesUnchanged)report.evidenceComplete=false;
 fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({evidenceComplete:report.evidenceComplete,
  full:report.audits.full?.counts?.total,production:report.audits.production?.counts?.total,
  sourceEvidence:report.sourceEvidence,callSiteSignals:report.callSiteSignals,
  canonicalFilesUnchanged:report.canonicalFilesUnchanged,errors:report.errors,
  releaseApproved:false}).slice(0,14000));
}
if(!report.evidenceComplete)process.exitCode=1;
