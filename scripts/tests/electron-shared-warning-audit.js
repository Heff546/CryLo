'use strict';
// Shared Electron lock security triage, regardless of target OS.
// Read-only, fail closed. Does not authorize dependency changes or publication.
const fs=require('node:fs');
const expectedVersions={
  rimraf:'2.6.3',glob:'7.2.3',inflight:'1.0.6',boolean:'3.2.0'
};
function inspect(pkg,lock,audit) {
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
  const report={
    classification:'SHARED_ELECTRON_DEPENDENCY_WARNING_AUDIT_ONLY',
    releaseFrozen:true,mayPublish:false,platformSpecificDependencyChange:false,
    sameLockfileForWindowsLinuxAndMac:true,
    electronVersion:pkg.devDependencies.electron,
    electronBuilderVersion:pkg.devDependencies['electron-builder'],
    deprecatedTooling:provenance,
    registryVulnerabilities:counts,
    allDependenciesIncluded:true,
    deprecationNotEquivalentToVulnerability:true,
    livePackageUpgradeAuthorized:false,
    note:'Warnings remain recorded; no changes to Electron, npm lock, installers, wallets or runtime.'
  };
  if(counts.total>0)
    throw Error('npm audit reported '+counts.total+' vulnerabilities; review before release');
  return report;
}
if(require.main===module){
  const [pkgFile,lockFile,auditFile,outputFile]=process.argv.slice(2);
  if(!pkgFile||!lockFile||!auditFile||!outputFile)
    throw Error('Usage: audit.js <package.json> <package-lock.json> <npm-audit.json> <report.json>');
  const read=x=>JSON.parse(fs.readFileSync(x,'utf8'));
  const result=inspect(read(pkgFile),read(lockFile),read(auditFile));
  fs.writeFileSync(outputFile,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  console.log('PASS: one shared Electron package lock, four dev-only deprecated transitive packages');
  console.log('PASS: full npm registry audit recorded 0 vulnerabilities');
  console.log('NOTICE: deprecation warnings remain, no tooling upgrade or release authorized');
}
module.exports={inspect};
