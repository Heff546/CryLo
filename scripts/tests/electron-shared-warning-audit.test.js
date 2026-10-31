'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {inspect}=require('./electron-shared-warning-audit');
function fixtures(){
  const pkg={dependencies:{ethers:'^6.17.0'},devDependencies:{electron:'44.9.3','electron-builder':'26.17.0'}};
  const pkgs={'':{devDependencies:{...pkg.devDependencies}}};
  for(const [n,v] of Object.entries({'electron':'44.9.3','electron-builder':'26.17.0',rimraf:'2.6.3',glob:'7.2.3',inflight:'1.0.6',boolean:'3.2.0'}))
    pkgs['node_modules/'+n]={version:v,dev:true};
  pkgs['node_modules/temp']={dev:true,dependencies:{rimraf:'~2.6.2'}};
  pkgs['node_modules/rimraf'].dependencies={glob:'^7.1.3'};
  pkgs['node_modules/glob'].dependencies={inflight:'^1.0.4'};
  pkgs['node_modules/global-agent']={dev:true,dependencies:{boolean:'^3.0.1'}};
  const audit={metadata:{vulnerabilities:{info:0,low:0,moderate:0,high:0,critical:0,total:0}}};
  return {pkg,lock:{lockfileVersion:3,packages:pkgs},audit};
}
test('shared lock provenance and zero advisories pass',()=>{
 const v=fixtures(),r=inspect(v.pkg,v.lock,v.audit,v.audit);
 assert.equal(r.deprecatedTooling.length,4);
 assert.equal(r.mayPublish,false);
 assert.equal(r.sameLockfileForWindowsLinuxAndMac,true);
 assert.equal(r.registryVulnerabilities.total,0);
});
test('production transitive dependency cannot be silently waved away',()=>{
 const v=fixtures();v.lock.packages['node_modules/temp'].dev=false;
 assert.throws(()=>inspect(v.pkg,v.lock,v.audit,v.audit),/non-development dependency parents/);
});
test('security advisory blocks a clean audit',()=>{
 const v=fixtures();v.audit.metadata.vulnerabilities.high=1;v.audit.metadata.vulnerabilities.total=1;
 const r=inspect(v.pkg,v.lock,v.audit,fixtures().audit);
 assert.equal(r.requiresSecurityReview,true);
 assert.equal(r.registryVulnerabilities.high,1);
 assert.equal(r.productionOnlyVulnerabilities.total,0);
});
test('registry errors and missing audit metadata block',()=>{
 const v=fixtures();v.audit={error:{code:'EAI_AGAIN'}};
 assert.throws(()=>inspect(v.pkg,v.lock,v.audit,fixtures().audit),/incomplete/);
});
test('tooling version drift blocks silent package changes',()=>{
 const v=fixtures();v.lock.packages['node_modules/glob'].version='8.0.0';
 assert.throws(()=>inspect(v.pkg,v.lock,v.audit,v.audit),/unexpectedly changed/);
});

test('production-only advisory is recorded and blocks',()=>{
 const v=fixtures(),prod=fixtures().audit;
 prod.metadata.vulnerabilities.critical=1;
 prod.metadata.vulnerabilities.total=1;
 const r=inspect(v.pkg,v.lock,v.audit,prod);
 assert.equal(r.requiresSecurityReview,true);
 assert.equal(r.productionOnlyVulnerabilities.critical,1);
});
