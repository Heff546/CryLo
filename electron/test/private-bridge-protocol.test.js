'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {ethers}=require('ethers');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const { privateReleaseCommitment,requireBridgeApiUrl }=require('../security/private-bridge');
const { rememberBridgeStatusCapability,bridgeStatusCapability,readStatusCapabilities }=require('../security/bridge-status-capabilities');

test('private commitment binds chain, contract, recipient, 11-decimal amount, and secret salt',async()=>{
 const wallet=ethers.Wallet.createRandom();
 const original={chainId:5547,bridgeManager:'0x'+'a'.repeat(40),
   burnId:'0x'+'b'.repeat(64),nexusAddress:wallet.address,
   amountAtomic:'100000000000',cryloAddress:'CRYLO-PRIVATE-NATIVE-RECIPIENT',
   salt:'0x'+'c'.repeat(64)};
 const commitment=privateReleaseCommitment(original);
 assert.match(commitment,/^0x[0-9a-f]{64}$/);
 const sig=await wallet.signMessage(ethers.getBytes(commitment));
 assert.equal(ethers.verifyMessage(ethers.getBytes(commitment),sig),wallet.address);
 for(const changes of [{chainId:5546},{bridgeManager:'0x'+'d'.repeat(40)},
  {burnId:'0x'+'d'.repeat(64)},{nexusAddress:'0x'+'e'.repeat(40)},
  {amountAtomic:'200000000000'},{cryloAddress:'DIFFERENT'},
  {salt:'0x'+'d'.repeat(64)}]) {
  assert.notEqual(privateReleaseCommitment({...original,...changes}),commitment);
 }
 for(const invalid of [{burnId:ethers.ZeroHash},{salt:ethers.ZeroHash},{amountAtomic:'1e11'},{cryloAddress:''}])
  assert.throws(()=>privateReleaseCommitment({...original,...invalid}));
});
test('private status tokens persist without exposing them to the renderer',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'crylo-bridge-capabilities-'));
 try{
  const pid='1234567890abcdef',token='b'.repeat(64);
  rememberBridgeStatusCapability(temp,pid,token);
  assert.equal(bridgeStatusCapability(temp,pid),token);
  assert.equal(readStatusCapabilities(temp)[pid],token);
  assert.equal(fs.statSync(path.join(temp,'bridge-status-capabilities.json')).mode&0o077,0);
  assert.throws(()=>rememberBridgeStatusCapability(temp,pid,'c'.repeat(64)));
  assert.throws(()=>bridgeStatusCapability(temp,'fedcba0987654321'));
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
test('remote bridge API must be HTTPS; loopback HTTP is allowed only for tests',()=>{
 assert.equal(requireBridgeApiUrl('https://rpc.example.org/bridge'), 'https://rpc.example.org/bridge');
 assert.equal(requireBridgeApiUrl('http://127.0.0.1:8088'), 'http://127.0.0.1:8088');
 for(const bad of ['', 'http://34.19.201.107/crylonexus-api','file:///etc/passwd',
  'https://user:password@example.org','http://example.org','https://localhost',
  'https://example.org/?secret=x']) assert.throws(()=>requireBridgeApiUrl(bad));
});
