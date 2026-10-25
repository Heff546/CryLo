'use strict';
// Installed CryLo CLI. One update command; explicit macOS installation approval.
const os=require('node:os');
const path=require('node:path');
const readline=require('node:readline/promises');
const {spawnSync}=require('node:child_process');
const updater=require('./macos-update-client');
const {receiptSnapshot,completeInstalledMacRelease}=require('./macos-installed-release-state');
async function main(){
 if(process.platform!=='darwin'||!['x64','arm64'].includes(process.arch))
   throw new Error('CryLo update requires Intel or Apple Silicon macOS.');
 const home=os.homedir();
 const context={resourcesPath:path.resolve(__dirname,'..'),
   userData:path.join(home,'Library','Application Support','CryLo Wallet'),home};
 console.log('===== CRYLO UPDATE =====');
 console.log('Architecture: mac/'+process.arch);
 console.log('Authenticating available releases with Pi1...');
 const candidate=await updater.discoverVerifiedMacRelease(context);
 if(!candidate){console.log('No eligible Pi1-authorized Mac update is available.');return;}
 console.log('Available: '+candidate.tag+' ('+candidate.artifact.file+')');
 if(!process.stdin.isTTY||!process.stdout.isTTY)
   throw new Error('Interactive Terminal approval is required.');
 const prompt=readline.createInterface({input:process.stdin,output:process.stdout});
 try{
   const answer=await prompt.question('Download and authenticate this installer? [y/N] ');
   if(!/^(y|yes)$/i.test(answer.trim())){
     console.log('Cancelled. Accepted release sequence unchanged.');return;
   }
   const staged=await updater.downloadAndStageMacUpdate(context,candidate);
   console.log('Pi1-verified: '+staged.releaseTag);
   console.log('SHA-256: '+staged.sha256);
   console.log('Installer: '+staged.stagedPath);
   const receiptBefore=receiptSnapshot();
   const opened=spawnSync('/usr/bin/open',['-a','Installer',staged.stagedPath],
     {stdio:'inherit',shell:false});
   if(opened.error||opened.status!==0)
     throw new Error('Could not open Installer; verified PKG remains staged.');
   console.log('Finish installation with macOS Installer. Leave this Terminal open.');
   const result=await prompt.question(
     'After Installer reports SUCCESS press Enter to verify (or type cancel): ');
   if(result.trim()){console.log('Installation verification cancelled.');return;}
   const accepted=completeInstalledMacRelease({
     stagedPath:staged.stagedPath,home,userData:context.userData,
     resourcesPath:context.resourcesPath,architecture:process.arch,
     network:staged.network,minimumSequence:staged.minimumSequence,receiptBefore
   });
   console.log('VERIFIED: fresh Installer receipt and '+accepted.verifiedFiles+
     ' installed package files match the Pi1-authenticated PKG.');
   console.log('Accepted release sequence: '+accepted.state.highestAcceptedReleaseSequence);
   console.log('CryLo update completed successfully. Wallet data preserved.');
 }finally{prompt.close();}
}
main().catch(error=>{
 console.error('ERROR: '+String(error?.message||error));
 console.error('No failed or unverified installer may advance the accepted release sequence.');
 process.exitCode=1;
});
