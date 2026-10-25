'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {analyzeCandidate,reportFor,CANDIDATES}=require('../release/unified-candidate-provenance');
const SHA='a'.repeat(40), HEAD='b'.repeat(40);
const def=CANDIDATES[3];
function fixture(){
 return {
  run:{id:def.runId,head_sha:SHA,status:'completed',conclusion:'success'},
  artifacts:{artifacts:[{name:def.name,id:1,size_in_bytes:55000,expired:false,expires_at:'2026-11-01T00:00:00Z'}]},
  compare:{status:'ahead',ahead_by:2,behind_by:0,base_commit:{sha:SHA},head_commit:{sha:HEAD},
   files:[{filename:'.github/workflows/release-audit.yml'}]}
 };
}
test('only ancestor candidates with workflow-only differences remain eligible as unsigned candidates',()=>{
 const f=fixture(),x=analyzeCandidate(def,f.run,f.artifacts,f.compare,HEAD);
 assert.equal(x.reusableAsUnsignedCandidate,true);
 assert.deepEqual(x.sourceAffectingFiles,[]);
 assert.equal(x.artifactBytes,55000);
});
test('native, Electron, dependency or security changes block reuse',()=>{
 for(const filename of ['src/wallet/wallet2.cpp','electron/main.js',
   'electron/package.json','scripts/crylo.js','node-operator/runtime/package-lock.json']){
  const f=fixture();f.compare.files=[{filename}];
  const x=analyzeCandidate(def,f.run,f.artifacts,f.compare,HEAD);
  assert.equal(x.reusableAsUnsignedCandidate,false,filename);
  assert.deepEqual(x.sourceAffectingFiles,[filename]);
 }
});
test('only exact non-shipped provenance audit files are exempt from rebuild',()=>{
 const f=fixture();
 f.compare.files=[
  {filename:'scripts/release/unified-candidate-provenance.js'},
  {filename:'scripts/tests/unified-candidate-provenance.test.js'},
  {filename:'.github/workflows/unified-release-candidate-provenance.yml'}
 ];
 assert.equal(analyzeCandidate(def,f.run,f.artifacts,f.compare,HEAD).reusableAsUnsignedCandidate,true);
 f.compare.files.push({filename:'scripts/release/create-release-manifest.js'});
 assert.equal(analyzeCandidate(def,f.run,f.artifacts,f.compare,HEAD).reusableAsUnsignedCandidate,false);
});
test('Mac reuse accepts only reviewed non-shipped Linux packaging and LF attribute changes',()=>{
 const f=fixture();
 f.compare.files=[
  {filename:'electron/scripts/release-linux.sh'},
  {filename:'.gitattributes'},
  {filename:'scripts/release/unified-unsigned-assemble.js'},
  {filename:'scripts/tests/unified-unsigned-assemble.test.js'}
 ];
 assert.equal(analyzeCandidate(def,f.run,f.artifacts,f.compare,HEAD).reusableAsUnsignedCandidate,true);
 const win=CANDIDATES[0];
 const winFixture=fixture();
 winFixture.run.id=win.runId;
 winFixture.artifacts.artifacts[0].name=win.name;
 winFixture.compare.files=[{filename:'electron/scripts/release-linux.sh'}];
 assert.equal(analyzeCandidate(win,winFixture.run,winFixture.artifacts,winFixture.compare,HEAD).reusableAsUnsignedCandidate,false);
 f.compare.files=[{filename:'electron/scripts/release-native.js'}];
 assert.equal(analyzeCandidate(def,f.run,f.artifacts,f.compare,HEAD).reusableAsUnsignedCandidate,false);
});
test('expiration, missing artifacts, incorrect ancestry and failed CI are fail-closed',()=>{
 const mutations=[
  f=>{f.artifacts.artifacts[0].expired=true;},
  f=>{f.artifacts.artifacts=[];},
  f=>{f.compare.behind_by=1;f.compare.status='diverged';},
  f=>{f.compare.too_large=true;},
  f=>{f.run.conclusion='failure';},
  f=>{f.compare.base_commit.sha=HEAD;}
 ];
 for(const change of mutations){
  const f=fixture();change(f);
  assert.equal(analyzeCandidate(def,f.run,f.artifacts,f.compare,HEAD).reusableAsUnsignedCandidate,false);
 }
});
test('a green metadata inventory can never authorize official signing or publication',()=>{
 const f=fixture();const x=analyzeCandidate(def,f.run,f.artifacts,f.compare,HEAD);
 const report=reportFor({targetSha:HEAD,version:'1.1.1',
  releaseList:[{tag_name:'v1.1.1-testnet.20'},{tag_name:'v1.1.1-testnet.21'}],
  evaluated:[x,x,x,x,x]});
 assert.equal(report.highestPublishedSequenceObserved,21);
 assert.equal(report.eligibleForOfficialPublication,false);
 assert.equal(report.pi1ReleaseManifestSigned,false);
 assert.equal(report.exactArtifactSha256AuditComplete,false);
 assert.equal(report.classification,'UNSIGNED_VALIDATION_ONLY');
});

