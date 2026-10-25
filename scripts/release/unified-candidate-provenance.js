'use strict';
// Read-only, deterministic release-candidate provenance audit.
// This is not an official release builder, signer, publisher, or tagger.
const https=require('node:https');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');

const REPOSITORY='Heff546/CryLo';
const CANDIDATES=Object.freeze([
 {platform:'win',architecture:'x64',runId:37553952227,name:'crylo-windows-x64'},
 {platform:'linux',architecture:'x64',runId:37553952227,name:'crylo-linux-x64'},
 {platform:'linux',architecture:'arm64',runId:37553952227,name:'crylo-linux-arm64'},
 {platform:'mac',architecture:'x64',runId:40230632249,name:'crylo-macos-x64-electron-security-validation'},
 {platform:'mac',architecture:'arm64',runId:40230632249,name:'crylo-macos-arm64-electron-security-validation'}
]);

function api(resource,token){
 const accepted=resource==='releases?per_page=100'||
   /^actions\/runs\/\d+$/.test(resource)||
   /^actions\/runs\/\d+\/artifacts\?per_page=100$/.test(resource)||
   /^compare\/[a-f0-9]{40}\.\.\.[a-f0-9]{40}$/.test(resource);
 if(!accepted)throw new Error('GitHub API path failed allowlisted endpoint validation.');
 return new Promise((resolve,reject)=>{
  const request=https.get('https://api.github.com/repos/'+REPOSITORY+'/'+resource,{
   headers:{'Authorization':'Bearer '+token,'User-Agent':'CryLo-Unsigned-Release-Preflight',
    'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},
   timeout:30000
  },response=>{
   let data='';response.setEncoding('utf8');
   response.on('data',part=>{
    data+=part;if(data.length>8*1024*1024)response.destroy(new Error('Oversized GitHub API response.'));
   });
   response.on('end',()=>{
    if(response.statusCode!==200){
     reject(new Error('GitHub metadata HTTP '+response.statusCode+': '+resource));return;
    }
    try{resolve(JSON.parse(data));}catch(error){reject(error);}
   });
   response.on('error',reject);
  });
  request.on('timeout',()=>request.destroy(new Error('GitHub API request timed out.')));
  request.on('error',reject);
 });
}
function analyzeCandidate(definition,run,artifactData,comparison,targetSha){
 const failures=[];
 if(!run||run.id!==definition.runId||run.status!=='completed'||run.conclusion!=='success')
  failures.push('source workflow is not a successful completed run');
 if(!run||!/^[a-f0-9]{40}$/.test(run.head_sha||''))
  failures.push('source workflow SHA is invalid');
 if(!artifactData||!Array.isArray(artifactData.artifacts))
  failures.push('GitHub Actions artifact inventory unavailable');
 const matches=(artifactData&&artifactData.artifacts||[]).filter(a=>a.name===definition.name);
 if(matches.length!==1)failures.push('expected exactly one uniquely named validation artifact');
 const asset=matches[0];
 if(asset&&(asset.expired===true||!(asset.size_in_bytes>0)||
    !Number.isSafeInteger(asset.size_in_bytes)))failures.push('artifact expired or has invalid size');
 if(!comparison||!['ahead','identical'].includes(comparison.status)||
    comparison.behind_by!==0||comparison.too_large===true)
  failures.push('source ancestry comparison did not establish safe fast-forward');
 if(run&&comparison&&(comparison.base_commit||{}).sha!==run.head_sha)
  failures.push('comparison base does not match artifact builder commit');
 if(comparison&&comparison.head_commit&&comparison.head_commit.sha!==targetSha)
  failures.push('comparison target SHA mismatch');
 if(!comparison||!Array.isArray(comparison.files))
  failures.push('source-diff file list unavailable');
 const modified=(comparison&&comparison.files||[]).map(x=>x.filename);
 const affecting=modified.filter(f=>typeof f!=='string'||!f.startsWith('.github/workflows/'));
 if(affecting.length)failures.push('release-affecting source changed after artifact build');
 return {
  target:definition.platform+'/'+definition.architecture,
  sourceRun:definition.runId,
  sourceCommit:run&&run.head_sha||null,
  candidateName:definition.name,
  artifactId:asset&&asset.id||null,
  artifactBytes:asset&&asset.size_in_bytes||null,
  artifactExpiresAt:asset&&asset.expires_at||null,
  sourceChangeCount:modified.length,
  sourceAffectingFiles:affecting,
  reusableAsUnsignedCandidate:failures.length===0,
  failures
 };
}
function reportFor({targetSha,version,releaseList,evaluated}){
 assert.match(targetSha,/^[a-f0-9]{40}$/);
 if(!/^\d+\.\d+\.\d+$/.test(version)||!Array.isArray(releaseList))
  throw new Error('Invalid release version or historical release list.');
 const numbers=releaseList.map(x=>{
  const match=String(x.tag_name||'').match(new RegExp('^v'+version.replace(/\./g,'\\.')+'-testnet\\.(\\d+)$'));
  return match?Number(match[1]):null;
 }).filter(Number.isSafeInteger);
 const last=numbers.length?Math.max(...numbers):null;
 if(last===null)throw new Error('Could not establish signed-channel release-sequence floor.');
 const allReusable=evaluated.length===5&&evaluated.every(x=>x.reusableAsUnsignedCandidate);
 return {
  schema:1,classification:'UNSIGNED_VALIDATION_ONLY',network:'testnet',
  targetCommit:targetSha,version,
  highestPublishedSequenceObserved:last,
  nextSequenceMustBeGreaterThan:last,
  candidates:evaluated,
  allTargetsHaveSourceCompatibleCandidates:allReusable,
  // A source-compatible CI artifact is NOT a Pi1 signed official release.
  exactArtifactSha256AuditComplete:false,
  pi1ReleaseManifestSigned:false,
  eligibleForOfficialPublication:false
 };
}
async function main(){
 const token=process.env.GITHUB_TOKEN||process.env.GH_TOKEN;
 const targetSha=process.env.GITHUB_SHA;
 const file=process.env.CRYLO_RELEASE_PREFLIGHT_REPORT;
 if(!token||!targetSha||!/^[a-f0-9]{40}$/.test(targetSha)||!file||!path.isAbsolute(file))
  throw new Error('Preflight requires GitHub read token, checked-out commit and absolute report path.');
 const version=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../electron/package.json'),'utf8')).version;
 const releases=await api('releases?per_page=100',token);
 if(!Array.isArray(releases)||releases.length===100)
  throw new Error('Published release history is incomplete; refusing to infer sequence floor.');
 const runs=new Map(), inventories=new Map(), comparisons=new Map();
 for(const id of [...new Set(CANDIDATES.map(c=>c.runId))]){
  const run=await api('actions/runs/'+id,token);
  runs.set(id,run);
  inventories.set(id,await api('actions/runs/'+id+'/artifacts?per_page=100',token));
  if(!/^[a-f0-9]{40}$/.test(run.head_sha||''))throw new Error('Invalid provenance SHA from GitHub.');
  comparisons.set(id,await api('compare/'+run.head_sha+'...'+targetSha,token));
 }
 const evaluated=CANDIDATES.map(x=>analyzeCandidate(x,runs.get(x.runId),
   inventories.get(x.runId),comparisons.get(x.runId),targetSha));
 const report=reportFor({targetSha,version,releaseList:releases,evaluated});
 fs.mkdirSync(path.dirname(file),{recursive:true});
 fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 for(const c of evaluated){
  console.log((c.reusableAsUnsignedCandidate?'CANDIDATE':'BLOCKED')+' '+c.target+
   ' from run '+c.sourceRun+' at '+c.sourceCommit+
   (c.failures.length?' | '+c.failures.join('; '):' | provenance compatible'));
 }
 console.log('Next official sequence must exceed '+report.highestPublishedSequenceObserved);
 console.log('OFFICIAL PUBLICATION: BLOCKED. CI does not sign or publish.');
 if(process.argv.includes('--require-publish-ready')&&!report.eligibleForOfficialPublication)
  process.exitCode=2;
}
if(require.main===module)main().catch(e=>{console.error('ERROR:',e.message);process.exitCode=1;});
module.exports=Object.freeze({analyzeCandidate,reportFor,CANDIDATES});
