'use strict';
// Never advance CryLo release state on download, staging, or Installer launch.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {verifyMacPackage,sha256File}=require('./macos-package-trust');
const PINNED='86f4b72805393b1bb71a58d982a274b156c8b69e11fcba2739cba598901a7385';
const REQUIRED=[
 'Applications/CryLo Wallet.app/Contents/MacOS/CryLo Wallet',
 'Applications/CryLo Wallet.app/Contents/Resources/app.asar',
 'Applications/CryLo Wallet.app/Contents/Resources/bin/mac/CryLo-daemon',
 'Applications/CryLo Wallet.app/Contents/Resources/bin/mac/CryLo-wallet-rpc',
 'Applications/CryLo Wallet.app/Contents/Resources/macos-update/macos-update-client.js',
 'Applications/CryLo Wallet.app/Contents/Resources/macos-update/macos-installed-update.js',
 'Applications/CryLo Wallet.app/Contents/Resources/macos-update/macos-installed-release-state.js',
 'Applications/CryLo Wallet.app/Contents/Resources/macos-update/macos-package-trust.js',
 'Applications/CryLo Wallet.app/Contents/Resources/macos-update/crylo-testnet-release-ed25519-public.pem',
 'Applications/CryLo Daemon.app/Contents/Resources/CryLo-daemon',
 'usr/local/bin/crylo'
];
function checked(file,args){
 const p=spawnSync(file,args,{encoding:'utf8',shell:false,timeout:180000});
 if(p.error||p.status!==0)throw new Error('macOS package proof failed: '+file+': '+
   String(p.stderr||p.error?.message||p.status));
 return p.stdout;
}
function receiptSnapshot(){
 const p=spawnSync('/usr/sbin/pkgutil',['--pkg-info','com.crylo.installer'],
   {encoding:'utf8',shell:false,timeout:30000});
 if(p.error)throw p.error;
 if(p.status!==0)return null;
 const values={};
 for(const line of p.stdout.split(/\r?\n/)){
   const m=line.match(/^([a-z-]+):\s*(.+)$/);if(m)values[m[1]]=m[2];
 }
 const installTime=Number(values['install-time']);
 if(!/^\d+$/.test(values['install-time']||'')||
    !Number.isSafeInteger(installTime)||
    !/^\d+\.\d+\.\d+$/.test(values.version||''))
   throw new Error('Malformed CryLo Installer receipt.');
 return {version:values.version,installTime};
}
function compareInstalled(pkg,installationRoot='/'){
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'crylo-install-proof-'));
 try{
   fs.chmodSync(temporary,0o700);
   const expanded=path.join(temporary,'expanded'),payload=path.join(temporary,'files');
   fs.mkdirSync(payload);
   checked('/usr/sbin/pkgutil',['--expand',pkg,expanded]);
   const sources=fs.readdirSync(expanded,{withFileTypes:true})
     .filter(d=>d.isDirectory()).map(d=>path.join(expanded,d.name,'Payload'))
     .filter(f=>fs.existsSync(f));
   if(sources.length!==1)throw new Error('Unrecognized macOS CryLo package payload.');
   checked('/usr/bin/ditto',['-x',sources[0],payload]);
   for(const name of REQUIRED)
     if(!fs.lstatSync(path.join(payload,name)).isFile())
       throw new Error('Missing required installed CryLo file: '+name);
   let count=0;
   function compare(name){
     const a=fs.lstatSync(path.join(payload,name));
     const b=fs.lstatSync(path.join(installationRoot,name));
     if(a.isDirectory()!==b.isDirectory()||
        a.isFile()!==b.isFile()||
        a.isSymbolicLink()!==b.isSymbolicLink())
       throw new Error('Installed CryLo filesystem type mismatch: '+name);
     if(a.isDirectory()){
       for(const child of fs.readdirSync(path.join(payload,name)))
         compare(path.join(name,child));
     }else if(a.isSymbolicLink()){
       if(fs.readlinkSync(path.join(payload,name))!==fs.readlinkSync(path.join(installationRoot,name)))
         throw new Error('Installed CryLo symlink mismatch: '+name);
     }else if(a.isFile()){
       if(a.size!==b.size||
         sha256File(path.join(payload,name))!==sha256File(path.join(installationRoot,name)))
         throw new Error('Installed CryLo payload hash mismatch: '+name);
       count++;
     }else throw new Error('Unsupported CryLo installation payload member.');
   }
   for(const name of ['Applications/CryLo Wallet.app','Applications/CryLo Daemon.app',
      'usr/local/bin/crylo'])compare(name);
   return count;
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
}
function safeDir(dir,create=false){
 if(typeof dir!=='string'||!path.isAbsolute(dir))throw new Error('Invalid CryLo state directory.');
 if(create&&!fs.existsSync(dir))fs.mkdirSync(dir,{mode:0o700});
 const s=fs.lstatSync(dir);
 if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid())
   throw new Error('Unsafe/non-user-owned CryLo release state directory.');
}
function stateFiles(home,userData){
 safeDir(home);safeDir(userData,true);
 const conf=path.join(home,'.config');
 safeDir(conf,true);
 const legacy=path.join(conf,'crylo-wallet');
 safeDir(legacy,true);
 return [path.join(legacy,'release-security.json'),
         path.join(userData,'release-security.json')];
}
function readState(file,network){
 if(!fs.existsSync(file))return null;
 const s=fs.lstatSync(file);
 if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.uid!==process.getuid())
   throw new Error('Unsafe CryLo release-security file.');
 const state=JSON.parse(fs.readFileSync(file,'utf8'));
 if(!state||state.network!==network||
    !Number.isSafeInteger(state.highestAcceptedReleaseSequence)||
    state.highestAcceptedReleaseSequence<1||
    (state.lastAcceptedGitCommit!==undefined&&
     !/^[0-9a-f]{40}$/i.test(state.lastAcceptedGitCommit)))
   throw new Error('Invalid existing CryLo rollback security state.');
 return state;
}
function allow(state,auth){
 if(!state)return;
 if(state.highestAcceptedReleaseSequence>auth.releaseSequence)
   throw new Error('CryLo rollback floor cannot decrease.');
 if(state.highestAcceptedReleaseSequence===auth.releaseSequence&&
    ((state.lastAcceptedGitCommit&&state.lastAcceptedGitCommit.toLowerCase()!==auth.gitCommit.toLowerCase())||
     (state.lastAcceptedReleaseTag&&state.lastAcceptedReleaseTag!==auth.releaseTag)||
     (state.lastAcceptedVersion&&state.lastAcceptedVersion!==auth.version)))
   throw new Error('Conflicting accepted CryLo release identity.');
}
function writeAtomic(file,data){
 const temporary=path.join(path.dirname(file),'.crylo-rollback-'+crypto.randomBytes(12).toString('hex'));
 let fd=null;
 try{
   fd=fs.openSync(temporary,'wx',0o600);
   fs.writeFileSync(fd,data);fs.fsyncSync(fd);fs.closeSync(fd);fd=null;
   fs.renameSync(temporary,file);fs.chmodSync(file,0o600);
 }finally{if(fd!==null)fs.closeSync(fd);fs.rmSync(temporary,{force:true});}
}
function completeInstalledMacRelease({
 stagedPath,home,userData,resourcesPath,architecture,network='testnet',
 minimumSequence,receiptBefore,installationRoot='/',trustedFingerprint=PINNED
}){
 if(process.platform!=='darwin')throw new Error('Mac release verification requires macOS.');
 for(const s of [stagedPath,home,userData,resourcesPath,installationRoot])
   if(typeof s!=='string'||!path.isAbsolute(s))throw new Error('Invalid verification path.');
 const key=path.join(resourcesPath,'macos-update','crylo-testnet-release-ed25519-public.pem');
 const spki=crypto.createPublicKey(fs.readFileSync(key)).export({type:'spki',format:'der'});
 if(crypto.createHash('sha256').update(spki).digest('hex')!==trustedFingerprint)
   throw new Error('Pi1 trusted key mismatch.');
 const dir=path.dirname(stagedPath);
 const args={packagePath:stagedPath,
   manifestPath:path.join(dir,'crylo-release-manifest.json'),
   signaturePath:path.join(dir,'crylo-release-manifest.json.sig'),
   publicKeyPath:key,architecture,network,minimumSequence};
 const auth=verifyMacPackage(args);
 const receipt=receiptSnapshot();
 if(!receipt||receipt.version!==auth.version||
    (receiptBefore&&receipt.installTime<=receiptBefore.installTime)||
    receipt.installTime<Math.floor(fs.statSync(stagedPath).mtimeMs/1000))
   throw new Error('macOS Installer has not completed the verified update.');
 const verifiedFiles=compareInstalled(stagedPath,installationRoot);
 verifyMacPackage(args);
 const files=stateFiles(home,userData);
 for(const file of files)allow(readState(file,network),auth);
 const state={network,highestAcceptedReleaseSequence:auth.releaseSequence,
   lastAcceptedVersion:auth.version,lastAcceptedReleaseTag:auth.releaseTag,
   lastAcceptedGitCommit:auth.gitCommit};
 for(const file of files){
   allow(readState(file,network),auth);
   writeAtomic(file,JSON.stringify(state,null,2)+'\n');
 }
 return Object.freeze({state,receipt,verifiedFiles});
}
module.exports=Object.freeze({receiptSnapshot,completeInstalledMacRelease});
