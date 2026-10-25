'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  TRUSTED_KEY_FINGERPRINT,
  safeHttpsUrl,
  expectedGithubAssetUrl,
  trustFiles,
  currentReleaseFloor,
  discoverVerifiedMacRelease,
  downloadAndStageMacUpdate
} = require('../security/macos-update-client');

const repoRoot = path.resolve(__dirname, '..', '..');
const updateFiles = {
  key:'scripts/release/keys/crylo-testnet-release-ed25519-public.pem',
  verifier:'scripts/release/macos-package-trust.js',
  stage:'scripts/release/macos-unsigned-update-stage.js'
};

function fixture() {
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'crylo-mac-installed-test-'));
  const resourcesPath=path.join(base,'Contents','Resources');
  const appData=path.join(base,'User data with spaces','crylo-wallet');
  const home=path.join(base,'Home with spaces');
  fs.mkdirSync(path.join(resourcesPath,'macos-update'),{recursive:true});
  fs.mkdirSync(appData,{recursive:true});
  fs.mkdirSync(home,{recursive:true});
  for(const [name,src] of Object.entries(updateFiles)){
    const destination=name==='key'?'crylo-testnet-release-ed25519-public.pem':
      name==='verifier'?'macos-package-trust.js':'macos-unsigned-update-stage.js';
    fs.copyFileSync(path.join(repoRoot,src),
      path.join(resourcesPath,'macos-update',destination));
  }
  const sentinel=path.join(appData,'wallet-private-sentinel');
  fs.writeFileSync(sentinel,'never touch private wallet');
  return {base,resourcesPath,userData:appData,home,sentinel};
}

function withFixture(fn) {
  const x=fixture();
  try { return fn(x); }
  finally { fs.rmSync(x.base,{recursive:true,force:true}); }
}

test('installed resources contain the genuine pinned Pi1 release key',()=>{
  withFixture(x=>{
    assert.match(TRUSTED_KEY_FINGERPRINT,/^[a-f0-9]{64}$/);
    assert.ok(trustFiles(x.resourcesPath).key.endsWith('crylo-testnet-release-ed25519-public.pem'));
    const key=path.join(x.resourcesPath,'macos-update','crylo-testnet-release-ed25519-public.pem');
    fs.writeFileSync(key,'IMPOSTOR KEY');
    assert.throws(()=>trustFiles(x.resourcesPath),/key|PEM|decode|unsupported/i);
    assert.equal(fs.readFileSync(x.sentinel,'utf8'),'never touch private wallet');
  });
});

test('only exact HTTPS GitHub release paths and redirect hosts are allowed',()=>{
  assert.equal(safeHttpsUrl('https://api.github.com/repos/Heff546/CryLo/releases').hostname,'api.github.com');
  assert.equal(safeHttpsUrl('https://release-assets.githubusercontent.com/asset').hostname,
    'release-assets.githubusercontent.com');
  for(const url of ['http://github.com/a','https://user:pass@github.com/a',
    'https://github.com.evil.tld/a','file:///tmp/a','https://127.0.0.1/a',
    'https://github.com:444/a','https://github.com/a#fragment',
    'https://external.example/assets']){
    assert.throws(()=>safeHttpsUrl(url),undefined,url);
  }
  assert.equal(expectedGithubAssetUrl('v1.1.1-testnet.20',
    'CryLo-1.1.1-mac-arm64-unsigned.pkg'),
    'https://github.com/Heff546/CryLo/releases/download/v1.1.1-testnet.20/CryLo-1.1.1-mac-arm64-unsigned.pkg');
  assert.throws(()=>expectedGithubAssetUrl('dev','../unsafe.pkg'));
});

test('rollback floor respects existing GUI and legacy CryLo states',()=>{
  withFixture(x=>{
    assert.equal(currentReleaseFloor({...x,network:'testnet'}),2);
    fs.writeFileSync(path.join(x.userData,'release-security.json'),JSON.stringify({
      network:'testnet',highestAcceptedReleaseSequence:18,
      lastAcceptedGitCommit:'a'.repeat(40)
    }));
    assert.equal(currentReleaseFloor({...x,network:'testnet'}),18);
    const legacy=path.join(x.home,'.config','crylo-wallet');
    fs.mkdirSync(legacy,{recursive:true});
    fs.writeFileSync(path.join(legacy,'release-security.json'),JSON.stringify({
      network:'testnet',highestAcceptedReleaseSequence:20,
      lastAcceptedGitCommit:'b'.repeat(40)
    }));
    assert.equal(currentReleaseFloor({...x,network:'testnet'}),20);
    assert.equal(fs.readFileSync(x.sentinel,'utf8'),'never touch private wallet');
  });
});

test('malformed signed-release metadata cannot create a prepared installer',async()=>{
  const x=fixture();
  try {
    if(process.platform!=='darwin'){
      await assert.rejects(()=>discoverVerifiedMacRelease(x),/macOS/);
      return;
    }
    const response=Buffer.from(JSON.stringify([{
      draft:false,prerelease:true,tag_name:'v1.1.1-testnet.20',
      assets:[
        {name:'crylo-release-manifest.json',
          browser_download_url:expectedGithubAssetUrl('v1.1.1-testnet.20','crylo-release-manifest.json')},
        {name:'crylo-release-manifest.json.sig',
          browser_download_url:expectedGithubAssetUrl('v1.1.1-testnet.20','crylo-release-manifest.json.sig')}
      ]
    }]));
    const selection=await discoverVerifiedMacRelease({
      ...x,
      read:async url=>url.includes('per_page=50')?response:Buffer.from('forged unsigned payload')
    });
    assert.equal(selection,null);
    assert.equal(fs.readFileSync(x.sentinel,'utf8'),'never touch private wallet');
    assert.equal(fs.existsSync(path.join(x.home,'Library','Application Support','CryLo','verified-updates')),false);
  } finally {fs.rmSync(x.base,{recursive:true,force:true});}
});

test('installer cannot be prepared from an unauthenticated or obsolete candidate',async()=>{
  const x=fixture();
  try{
    await assert.rejects(()=>downloadAndStageMacUpdate(x,null),/Invalid authenticated/);
    if(process.platform==='darwin'){
      await assert.rejects(()=>downloadAndStageMacUpdate(x,{
        network:'testnet',minimumSequence:2,sequence:2,
        tag:'not-official',artifact:{file:'fake.pkg'}
      }),/asset identity/);
    }
    assert.equal(fs.readFileSync(x.sentinel,'utf8'),'never touch private wallet');
  } finally {fs.rmSync(x.base,{recursive:true,force:true});}
});

test('Mac packaged wallet offers explicit menu consent and never auto-opens the PKG',()=>{
  const main=fs.readFileSync(path.join(repoRoot,'electron','main.js'),'utf8');
  const pkg=JSON.parse(fs.readFileSync(path.join(repoRoot,'electron','package.json'),'utf8'));
  const after=fs.readFileSync(path.join(repoRoot,'electron','scripts','after-pack.js'),'utf8');
  assert.match(main,/Check for Verified Updates/);
  assert.match(main,/discoverVerifiedMacRelease\(context\)/);
  assert.match(main,/Download Verified Installer/);
  assert.match(main,/downloadAndStageMacUpdate\(context, candidate\)/);
  assert.match(main,/shell\.showItemInFolder\(staged\.stagedPath\)/);
  assert.doesNotMatch(main,/shell\.openPath\(staged\.stagedPath\)/);
  assert.match(after,/Verified packaged Pi1 Mac update resource/);
  assert.ok(pkg.build.files.includes('security/**/*'));
  const resources=pkg.build.mac.extraResources.map(x=>x.to);
  for(const name of Object.keys(updateFiles).map(x=>x==='key'
    ?'macos-update/crylo-testnet-release-ed25519-public.pem'
    : x==='verifier'?'macos-update/macos-package-trust.js'
    :'macos-update/macos-unsigned-update-stage.js')){
    assert.ok(resources.includes(name),name);
  }
});
