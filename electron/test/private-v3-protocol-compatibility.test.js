'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const main=fs.readFileSync(path.join(root,'main.js'),'utf8');
const renderer=fs.readFileSync(path.join(root,'src/app.js'),'utf8');
const abi=JSON.parse(fs.readFileSync(path.join(root,'src/abis/BridgeManager.json'),'utf8')).abi;
const profile=JSON.parse(fs.readFileSync(path.join(root,'security/nexus-network-profile.json'),'utf8'));

function method(name){return abi.find(x=>x.type==='function'&&x.name===name)}
function event(name){return abi.find(x=>x.type==='event'&&x.name===name)}

test('Private V3 reverse bridge never burns to plaintext L1 destination',()=>{
 assert.deepEqual(method('burnForCryLo').inputs.map(x=>x.type),
   ['bytes32','bytes32','uint256']);
 assert.match(main,/privateReleaseCommitment\(fields\)/);
 assert.match(main,/wallet\.signMessage\(ethers\.getBytes\(commitment\)\)/);
 const start=main.indexOf("secureIpcHandle('nexus-burn-for-crylo'");
 const end=main.indexOf("secureIpcHandle('bridge-request'",start);
 const section=main.slice(start,end);
 const intent=section.indexOf("/bridge/outbound-intent");
 const burn=section.indexOf("bridge.burnForCryLo(");
 assert.ok(intent>=0&&burn>intent,'private intent must exist before burn');
 assert.match(section,/intentResult|privateIntent/);
 assert.match(section,/destinationCommitment/);
 assert.match(section,/bridge\.burnForCryLo\(burnId, commitment, amount/);
 assert.doesNotMatch(section,/bridge\.burnForCryLo\(burnId, cryloAddress/);
});

test('inbound private status is authenticated by a main-process-only capability',()=>{
 const start=main.indexOf("secureIpcHandle('bridge-request'");
 const end=main.indexOf("secureIpcHandle('nexus-wcrylo-balance'",start);
 const section=main.slice(start,end);
 assert.match(section,/rememberBridgeStatusCapability/);
 assert.match(section,/bridgeStatusCapability/);
 assert.match(section,/X-Bridge-Status-Token/);
 assert.match(section,/method: 'POST'/);
 assert.match(section,/bridge\/status/);
 assert.doesNotMatch(section,/bridge\/status\/\$\{encodeURIComponent\(paymentId\)\}/);
 assert.match(renderer,/res\.status === 'minted'/);
 assert.doesNotMatch(section,/return \{ ok: true, \.\.\.data \}/);
});

test('node and normal-user rewards use the deployed RewardVault',()=>{
 const start=main.indexOf("secureIpcHandle('nexus-pending-rewards'");
 const end=main.indexOf("secureIpcHandle('nexus-stake-wcrylo'",start);
 const section=main.slice(start,end);
 assert.match(section,/runtime\.contracts\.RewardVault/);
 assert.match(section,/vault\.pendingRewards/);
 assert.match(section,/vault\.claim\(\)/);
 assert.doesNotMatch(section,/staking\.claimRewards/);
});

test('Private V3 history matches privacy-safe bridge, gas and node events',()=>{
 assert.deepEqual(event('BurnedForCryLo').inputs.map(x=>x.type),
  ['bytes32','address','bytes32','uint256']);
 assert.deepEqual(event('CryLoReleaseCompleted').inputs.map(x=>x.type),
  ['bytes32','address','uint256','bytes32']);
 for(const e of ['GasClaimed','GasPurchased','RewardClaimed','NodeRegistered',
    'NodeUnregistered','NodeActivationRenewed','CryLoReleaseCompleted']) {
   assert.ok(main.includes("'"+e+"'"),'history must query '+e);
 }
 assert.doesNotMatch(main,/event BurnedForCryLo\(address indexed from,string/);
 assert.doesNotMatch(main,/event DailyGasClaimed\(/);
});

test('Electron Private V3 pins the original Nexus 5546 genesis and keeps the bridge disabled pending migration',()=>{
 assert.equal(profile.network,'testnet');
 assert.equal(profile.l1Network,'testnet');
 assert.equal(profile.bridgePrivacyVersion,'private-v3');
 assert.equal(profile.chainId,5546);
 assert.equal(profile.genesisHash,'0x16c03e3e40a1c648e85df92d3ddc8ffae9b584d69d204a37933a46fc68f3f175');
 assert.equal(profile.bridgeApiUrl,'');
 assert.match(main,/assertPinnedTestnetNexusProfile\(\)/);
 assert.match(main,/NEXUS_PROFILE\.chainId !== 5546/);
 assert.match(main,/genesis\.hash\.toLowerCase\(\)/);
 assert.match(main,/data\.bridgePrivacyVersion !== 'private-v3'/);
 assert.match(main,/data\.cryloL1Network !== NEXUS_PROFILE\.l1Network/);
 assert.doesNotMatch(main,/http:\/\/34\.19\.201\.107\/crylonexus-api/);
});
