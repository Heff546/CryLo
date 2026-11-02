'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
assert.equal(process.platform,'win32'); assert.equal(process.env.GITHUB_ACTIONS,'true');
assert.ok(!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN);
const root=path.resolve(__dirname,'../..');
const setup=path.join(root,'electron/dist/CryLo Wallet Setup 1.1.1.exe');
const install=path.join(process.env.RUNNER_TEMP,'CryLoReconciledInstaller');
const local=path.join(process.env.LOCALAPPDATA,'CryLo');
const marker=path.join(local,'wallets/ancestry-wallet-fixture');
const config=path.join(process.env.APPDATA,'crylo-wallet/ancestry-config-fixture');
const launcher=path.join(local,'bin-v2/crylo.cmd');
const log=path.join(local,'installer-bootstrap.log');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
for(const p of [marker,config,install]) assert.ok(!fs.existsSync(p),'Unexpected existing fixture: '+p);
for(const p of [marker,config]) { fs.mkdirSync(path.dirname(p),{recursive:true}); fs.writeFileSync(p,crypto.randomBytes(128)); }
const original=[hash(marker),hash(config)];
function run(exe,args) {
 const r=spawnSync(exe,args,{encoding:'utf8',shell:false,windowsHide:true,timeout:360000});
 if(r.error)throw r.error; assert.equal(r.status,0,String(r.stdout)+String(r.stderr)); return String(r.stdout||'');
}
for(const stage of ['fresh install','reinstall']) {
 if(fs.existsSync(log))fs.rmSync(log);
 const previous=fs.existsSync(launcher)?hash(launcher):null;
 run(setup,['/S','/D='+install]);
 assert.match(fs.readFileSync(log,'utf8'),/RESULT=READY/);
 assert.equal(hash(marker),original[0]);assert.equal(hash(config),original[1]);
 assert.ok(fs.existsSync(path.join(install,'CryLo Wallet.exe')));
 if(previous)assert.equal(hash(launcher),previous,'Immutable launcher was changed');
 const cmd=path.join(process.env.SystemRoot,'System32/cmd.exe');
 assert.match(run(cmd,['/D','/C',launcher,'help']),/crylo update/);
 const git=path.join(local,'runtime/mingit-2.56.0.windows.1-x64/cmd/git.exe');
 assert.equal(run(git,['-C',path.join(process.env.USERPROFILE,'CryLo'),'rev-parse','HEAD']).trim(),process.env.GITHUB_SHA);
 console.log('PASS: '+stage+', READY log, immutable CMD launcher, exact source and wallet/config preservation');
}
