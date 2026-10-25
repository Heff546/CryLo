'use strict';

// Installed-wallet macOS update preparation. No Git checkout, Apple Developer
// ID, privileged installer, Gatekeeper bypass, or automatic state promotion.
// Only the release key packaged by CryLo authorizes an unsigned PKG.
const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');

const REPO = 'Heff546/CryLo';
const RELEASE_LIST = 'https://api.github.com/repos/' + REPO + '/releases?per_page=50';
const TRUSTED_KEY_FINGERPRINT =
  '86f4b72805393b1bb71a58d982a274b156c8b69e11fcba2739cba598901a7385';
const NET = 'testnet';
const INITIAL_ROLLBACK_FLOOR = 2;
const MAX_METADATA = 4 * 1024 * 1024;
const MAX_PKG = 650 * 1024 * 1024;
const MAX_REDIRECTS = 5;

function safeHttpsUrl(value) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password ||
      (u.port && u.port !== '443') || u.hash) {
    throw new Error('Untrusted CryLo release download URL.');
  }
  const allowed = ['api.github.com', 'github.com',
    'release-assets.githubusercontent.com', 'objects.githubusercontent.com'];
  if (!allowed.includes(u.hostname.toLowerCase())) {
    throw new Error('CryLo release URL redirected outside trusted GitHub hosts.');
  }
  return u;
}

function retrieve(url, maximumBytes, dest = null, redirects = 0) {
  const target = safeHttpsUrl(url);
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 ||
      maximumBytes > MAX_PKG || redirects > MAX_REDIRECTS) {
    throw new Error('CryLo release download exceeded policy bounds.');
  }
  return new Promise((resolve, reject) => {
    const req = https.get(target, {
      headers: { 'User-Agent': 'CryLoWallet-MacReleaseVerifier/1.1',
        Accept: 'application/octet-stream' },
      timeout: 30000
    }, res => {
      const code = res.statusCode;
      if ([301,302,303,307,308].includes(code)) {
        res.resume();
        if (!res.headers.location || redirects === MAX_REDIRECTS) {
          reject(new Error('CryLo release download redirected too many times.'));
          return;
        }
        let next;
        try { next = safeHttpsUrl(new URL(res.headers.location, target).href); }
        catch (error) { reject(error); return; }
        retrieve(next.href,maximumBytes,dest,redirects+1).then(resolve,reject);
        return;
      }
      if (code !== 200) {
        res.resume();
        reject(new Error('CryLo release server returned HTTP ' + code));
        return;
      }
      const announced = Number(res.headers['content-length']);
      if (Number.isFinite(announced) && announced > maximumBytes) {
        res.destroy(new Error('CryLo release exceeded permitted download size.'));
        return;
      }
      const buffers=[];
      let size=0;
      let file=null;
      let completed=false;
      try { if (dest) file=fs.openSync(dest,'wx',0o600); }
      catch(error) { res.destroy(error); return; }
      function close() {
        if (file!==null) { fs.closeSync(file); file=null; }
      }
      res.on('data', chunk => {
        if (completed) return;
        size+=chunk.length;
        if (size>maximumBytes) {
          res.destroy(new Error('CryLo release download exceeded size limit.'));
          return;
        }
        try {
          if (file!==null) fs.writeSync(file,chunk);
          else buffers.push(chunk);
        } catch(error) {res.destroy(error);}
      });
      res.on('end',()=>{
        if(completed)return;
        completed=true;
        try { if(file!==null) fs.fsyncSync(file);close(); }
        catch(error){reject(error);return;}
        resolve(dest ? {bytes:size} : Buffer.concat(buffers));
      });
      res.on('error',error=>{
        if(completed)return;
        completed=true;
        try{close();}catch(_){}
        if(dest){try{fs.rmSync(dest,{force:true});}catch(_){}}
        reject(error);
      });
    });
    req.on('timeout',()=>req.destroy(new Error('CryLo release request timed out.')));
    req.on('error',reject);
  });
}

function expectedGithubAssetUrl(tag, filename) {
  if (!/^v[0-9]+\.[0-9]+\.[0-9]+-testnet\.[1-9][0-9]*$/.test(tag) ||
      !/^[A-Za-z0-9._-]+$/.test(filename)) {
    throw new Error('Invalid CryLo release asset identity.');
  }
  return 'https://github.com/' + REPO + '/releases/download/' +
    encodeURIComponent(tag) + '/' + encodeURIComponent(filename);
}

function officialAsset(release,name) {
  const items=release.assets.filter(item=>item && item.name===name);
  if(items.length!==1)throw new Error('Expected one CryLo official release asset: '+name);
  const asset=items[0];
  if(asset.browser_download_url!==expectedGithubAssetUrl(release.tag_name,name)) {
    throw new Error('CryLo asset source does not match official release URL.');
  }
  return asset.browser_download_url;
}

function inspectState(file,network) {
  if(!fs.existsSync(file))return null;
  const st=fs.lstatSync(file);
  if(!st.isFile() || st.isSymbolicLink() || st.nlink!==1) {
    throw new Error('CryLo release rollback state has an unsafe filesystem type.');
  }
  const v=JSON.parse(fs.readFileSync(file,'utf8'));
  if(!v || v.network!==network ||
     !Number.isSafeInteger(v.highestAcceptedReleaseSequence) ||
     v.highestAcceptedReleaseSequence<1) {
    throw new Error('Installed CryLo release rollback state is invalid.');
  }
  if(v.lastAcceptedGitCommit!==undefined &&
     !/^[a-f0-9]{40}$/i.test(v.lastAcceptedGitCommit)){
    throw new Error('Installed CryLo release identity is invalid.');
  }
  return v;
}

function currentReleaseFloor({userData,home,network}) {
  const paths=[
    path.join(userData,'release-security.json'),
    path.join(home,'.config','crylo-wallet','release-security.json')
  ];
  const states=paths.map(p=>inspectState(p,network)).filter(Boolean);
  if(states.length===2 &&
     states[0].highestAcceptedReleaseSequence===states[1].highestAcceptedReleaseSequence &&
     states[0].lastAcceptedGitCommit && states[1].lastAcceptedGitCommit &&
     states[0].lastAcceptedGitCommit.toLowerCase()!==states[1].lastAcceptedGitCommit.toLowerCase()){
    throw new Error('Conflicting CryLo release rollback identities.');
  }
  return Math.max(INITIAL_ROLLBACK_FLOOR,
    ...states.map(s=>s.highestAcceptedReleaseSequence));
}

function trustFiles(resourcesPath) {
  const base=path.join(resourcesPath,'macos-update');
  const key=path.join(base,'crylo-testnet-release-ed25519-public.pem');
  const verifier=path.join(base,'macos-package-trust.js');
  for(const file of [key,verifier]){
    const st=fs.lstatSync(file);
    if(!st.isFile() || st.isSymbolicLink() || st.nlink!==1)
      throw new Error('Installed CryLo update verifier or public key is missing or unsafe.');
  }
  const publicKey=crypto.createPublicKey(fs.readFileSync(key));
  if(publicKey.asymmetricKeyType!=='ed25519')throw new Error('Invalid release key algorithm.');
  const fp=crypto.createHash('sha256').update(
    publicKey.export({type:'spki',format:'der'})).digest('hex');
  if(fp!==TRUSTED_KEY_FINGERPRINT)
    throw new Error('Installed CryLo release key fingerprint does not match Pi1.');
  return {key, verifier};
}

function candidateIdentity(release) {
  return release && !release.draft && release.prerelease===true &&
    typeof release.tag_name==='string' &&
    /^v[0-9]+\.[0-9]+\.[0-9]+-testnet\.[1-9][0-9]*$/.test(release.tag_name) &&
    Array.isArray(release.assets);
}

async function discoverVerifiedMacRelease(context) {
  if (process.platform!=='darwin' || !['x64','arm64'].includes(process.arch))
    throw new Error('CryLo Mac update discovery requires native macOS.');
  const {resourcesPath,userData,home}=context;
  const {key,verifier}=trustFiles(resourcesPath);
  const {authenticatedManifest,requireMacArtifactIdentity}=require(verifier);
  const floor=currentReleaseFloor({userData,home,network:NET});
  const read=context.read || (url=>retrieve(url,MAX_METADATA));
  const raw=await read(RELEASE_LIST);
  if(!Buffer.isBuffer(raw) || raw.length>MAX_METADATA)
    throw new Error('CryLo release listing is too large or malformed.');
  const releases=JSON.parse(raw.toString('utf8'));
  if(!Array.isArray(releases))throw new Error('CryLo release response is invalid.');
  const candidates=[];
  for(const release of releases.filter(candidateIdentity).slice(0,50)){
    const name='crylo-release-manifest.json',sig=name+'.sig';
    let manifestUrl,signatureUrl;
    try {
      manifestUrl=officialAsset(release,name);
      signatureUrl=officialAsset(release,sig);
    }catch(_){continue;}
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'crylo-mac-release-check-'));
    try{
      fs.chmodSync(tmp,0o700);
      const m=path.join(tmp,name),s=path.join(tmp,sig);
      const [manifestBytes,sigBytes]=await Promise.all([read(manifestUrl),read(signatureUrl)]);
      for(const bytes of [manifestBytes,sigBytes]){
        if(!Buffer.isBuffer(bytes) || bytes.length>MAX_METADATA)
          throw new Error('Invalid CryLo release trust file size.');
      }
      fs.writeFileSync(m,manifestBytes,{flag:'wx',mode:0o600});
      fs.writeFileSync(s,sigBytes,{flag:'wx',mode:0o600});
      const signed=authenticatedManifest(m,s,key).manifest;
      const artifact=requireMacArtifactIdentity(signed,process.arch,NET,floor);
      if(signed.releaseTag!==release.tag_name)continue;
      const url=officialAsset(release,artifact.file);
      candidates.push({version:signed.version,
        tag:signed.releaseTag,commit:signed.gitCommit,
        sequence:signed.releaseSequence,artifact,url});
    }catch(error){
      // A forged GitHub listing or invalid signed candidate cannot be trusted.
      // Continue searching for a valid Pi1-authorized release.
    }finally{fs.rmSync(tmp,{recursive:true,force:true});}
  }
  candidates.sort((a,b)=>b.sequence-a.sequence);
  if(candidates.length===0)return null;
  const winner=candidates[0];
  if(candidates.some(c=>c.sequence===winner.sequence &&
      (c.commit!==winner.commit || c.tag!==winner.tag))){
    throw new Error('Multiple conflicting CryLo releases reuse the same signed sequence.');
  }
  // The currently installed app's accepted sequence is not advanced by staging.
  return Object.freeze({...winner,network:NET,minimumSequence:floor});
}

async function downloadAndStageMacUpdate(context,candidate) {
  if(process.platform!=='darwin' || candidate?.network!==NET ||
     candidate?.minimumSequence<INITIAL_ROLLBACK_FLOOR)
    throw new Error('Invalid authenticated CryLo Mac release selection.');
  const currentFloor=currentReleaseFloor({userData:context.userData,home:context.home,network:NET});
  if(candidate.sequence<currentFloor)
    throw new Error('CryLo release sequence is below the current rollback floor.');
  const {key,verifier}=trustFiles(context.resourcesPath);
  const {stageVerifiedMacPackage}=require(
    path.join(context.resourcesPath,'macos-update','macos-unsigned-update-stage.js'));
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'crylo-mac-download-'));
  try{
    fs.chmodSync(root,0o700);
    const m=path.join(root,'crylo-release-manifest.json');
    const sig=m+'.sig';
    const file=path.join(root,candidate.artifact.file);
    const read=context.read || (url=>retrieve(url,MAX_METADATA));
    const download=context.download || ((url,file,max)=>retrieve(url,max,file));
    const metadata=[
      ['crylo-release-manifest.json',m],
      ['crylo-release-manifest.json.sig',sig]
    ];
    for(const [name,destination] of metadata){
      const bytes=await read(expectedGithubAssetUrl(candidate.tag,name));
      if(!Buffer.isBuffer(bytes)||bytes.length>MAX_METADATA)
        throw new Error('CryLo signed metadata exceeded download limit.');
      fs.writeFileSync(destination,bytes,{flag:'wx',mode:0o600});
    }
    // A re-fetched manifest must retain exactly the same authorized identity.
    const signed=require(verifier).authenticatedManifest(m,sig,key).manifest;
    const a=require(verifier).requireMacArtifactIdentity(signed,
      process.arch,NET,currentFloor);
    if(signed.releaseTag!==candidate.tag || signed.gitCommit!==candidate.commit ||
       signed.releaseSequence!==candidate.sequence ||
       a.file!==candidate.artifact.file || a.sha256!==candidate.artifact.sha256 ||
       a.size!==candidate.artifact.size){
      throw new Error('CryLo release changed between discovery and download.');
    }
    await download(expectedGithubAssetUrl(candidate.tag,a.file),file,Math.min(MAX_PKG,a.size));
    return stageVerifiedMacPackage({
      packagePath:file,manifestPath:m,signaturePath:sig,publicKeyPath:key,
      architecture:process.arch,network:NET,minimumSequence:currentFloor,
      home:context.home
    });
  }finally{
    fs.rmSync(root,{recursive:true,force:true});
  }
}

module.exports=Object.freeze({
  TRUSTED_KEY_FINGERPRINT,
  RELEASE_LIST,
  safeHttpsUrl,
  expectedGithubAssetUrl,
  currentReleaseFloor,
  trustFiles,
  discoverVerifiedMacRelease,
  downloadAndStageMacUpdate
});
