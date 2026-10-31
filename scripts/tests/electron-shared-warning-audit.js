'use strict';
// Shared Electron lock security triage, regardless of target OS.
// Read-only, fail closed. Does not authorize dependency changes or publication.
const fs=require('node:fs');
const expectedVersions={
  rimraf:'2.6.3',glob:'7.2.3',inflight:'1.0.6',boolean:'3.2.0'
};
function inspect(pkg,lock,audit,productionAudit) {
  if(lock.lockfileVersion!==3 || !lock.packages || !lock.packages[''])
    throw Error('Electron package-lock v3 structure is absent');
  if(!audit || audit.error || !audit.metadata || !audit.metadata.vulnerabilities)
    throw Error('Full-registry npm advisory report is incomplete or unavailable');
  const root=lock.packages[''];
  for(const name of ['electron','electron-builder']) {
    const version=pkg.devDependencies?.[name];
    if(!version || root.devDependencies?.[name]!==version ||
       lock.packages['node_modules/'+name]?.version!==version)
       throw Error('Electron tooling lock mismatch for '+name);
  }
  const provenance=[];
  for(const [name,version] of Object.entries(expectedVersions)) {
    const entry=lock.packages['node_modules/'+name];
    if(!entry || entry.version!==version || entry.dev!==true)
      throw Error('Deprecated tooling unexpectedly changed version/scope: '+name);
    if(Object.prototype.hasOwnProperty.call(pkg.dependencies||{},name))
      throw Error('Deprecated tooling became a direct production dependency: '+name);
    const parents=Object.entries(lock.packages).filter(([path,info])=>
      path && (info.dependencies?.[name] || info.optionalDependencies?.[name]));
    if(!parents.length || parents.some(([path,info])=>info.dev!==true))
      throw Error('Deprecated tooling has missing/non-development dependency parents: '+name);
    provenance.push({name,version,scope:'development',parents:parents.map(([p])=>p).sort()});
  }
  const counts=audit.metadata.vulnerabilities;
  const severities=['info','low','moderate','high','critical'];
  for(const k of severities)if(!Number.isInteger(counts[k]) || counts[k]<0)
    throw Error('Registry advisory severity count missing: '+k);
  if(!Number.isInteger(counts.total) || counts.total<0)
    throw Error('Registry advisory total missing');
  const sum=severities.reduce((a,k)=>a+counts[k],0);
  if(sum!==counts.total)
    throw Error('Registry severity totals inconsistent');
  if(!productionAudit || productionAudit.error || !productionAudit.metadata?.vulnerabilities)
    throw Error('Production-only npm advisory report is unavailable');
  const prod=productionAudit.metadata.vulnerabilities;
  if(!Number.isInteger(prod.total) || prod.total<0)
    throw Error('Production-only registry advisory totals unavailable');
  const issues=Object.entries(audit.vulnerabilities||{}).map(([name,info])=>{
    const paths=Object.keys(lock.packages).filter(path=>
      path.endsWith('/node_modules/'+name)||path==='node_modules/'+name);
    const devOnly=paths.length>0 && paths.every(path=>lock.packages[path].dev===true);
    return {name,severity:info.severity||'unknown',direct:info.isDirect===true,
      devOnlyInLockfile:devOnly,
      installedPaths:paths,
      via:(info.via||[]).map(v=>typeof v==='string'?v:{
        title:v.title||'',url:v.url||'',severity:v.severity||'',range:v.range||''
      }),
      fixAvailable:info.fixAvailable||false};
  }).sort((a,b)=>a.name.localeCompare(b.name));
  const report={
    classification:'SHARED_ELECTRON_DEPENDENCY_WARNING_AUDIT_ONLY',
    releaseFrozen:true,mayPublish:false,platformSpecificDependencyChange:false,
    sameLockfileForWindowsLinuxAndMac:true,
    electronVersion:pkg.devDependencies.electron,
    electronBuilderVersion:pkg.devDependencies['electron-builder'],
    deprecatedTooling:provenance,
    registryVulnerabilities:counts,
    productionOnlyVulnerabilities:prod,
    advisoryPackages:issues,
    requiresSecurityReview:counts.total>0 || prod.total>0,
    allDependenciesIncluded:true,
    deprecationNotEquivalentToVulnerability:true,
    livePackageUpgradeAuthorized:false,
    note:'Warnings remain recorded; no changes to Electron, npm lock, installers, wallets or runtime.'
  };
  return report;
}
if(require.main===module){
  const [pkgFile,lockFile,auditFile,prodFile,outputFile]=process.argv.slice(2);
  if(!pkgFile||!lockFile||!auditFile||!prodFile||!outputFile)
    throw Error('Usage: audit.js <package.json> <package-lock.json> <full-npm-audit.json> <prod-npm-audit.json> <report.json>');
  const read=x=>JSON.parse(fs.readFileSync(x,'utf8'));
  const result=inspect(read(pkgFile),read(lockFile),read(auditFile),read(prodFile));
  fs.writeFileSync(outputFile,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  console.log('PASS: one shared Electron package lock; four dev-only deprecated transitive packages');
  console.log('Full dependency vulnerabilities:',JSON.stringify(result.registryVulnerabilities));
  console.log('Production dependency vulnerabilities:',JSON.stringify(result.productionOnlyVulnerabilities));
  for(const item of result.advisoryPackages)
    console.log('ADVISORY:',item.name,'severity='+item.severity,
      'devOnlyInLockfile='+item.devOnlyInLockfile,'isDirect='+item.direct,
      'via='+item.via.map(v=>typeof v==='string'?v:v.title).join('; '));
  console.log('NOTICE: no package upgrade or release authorized');
  if(result.requiresSecurityReview){
    console.error('BLOCK: npm registry advisories require explicit assessment before release.');
    process.exitCode=1;
  }
}
module.exports={inspect};
