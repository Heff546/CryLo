'use strict';

// Offline-only chain-binding tests with ephemeral signing identities.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {Wallet}=require('ethers');
const {validateConfig}=require('../src/schema');
const {loadAuthorization}=require('../src/evidence/authorization-loader');

function config(network,chainId){
  const a='0x1111111111111111111111111111111111111111';
  return {
    schemaVersion:1,protocolVersion:1,network,chainId,
    operatorAddress:a,tier:'Operator',
    rpcUrl:'https://nexus.example.invalid/ext/bc/approved/rpc',
    contracts:{wrappedCryLo:a,nodeStaking:a,rewardManager:a},
    service:{
      serviceName:'crylo-nexus-operator.service',
      statusPath:'/tmp/crylo-operator/status.json',
      dataDirectory:'/tmp/crylo-operator/data',
      logDirectory:'/tmp/crylo-operator/logs'
    },
    generatedAt:'2026-11-15T00:00:00.000Z'
  };
}
test('mainnet schema accepts explicit positive chain ID and preserves testnet lock',()=>{
  assert.equal(validateConfig(config('CryLoNexus Mainnet',6546)),true,
    JSON.stringify(validateConfig.errors));
  assert.equal(validateConfig(config('CryLoNexus Testnet',5546)),true,
    JSON.stringify(validateConfig.errors));
  assert.equal(validateConfig(config('CryLoNexus Testnet',6546)),false);
  for(const id of [0,-1,1.5,Number.MAX_SAFE_INTEGER+1]){
    assert.equal(validateConfig(config('CryLoNexus Mainnet',id)),false);
  }
  assert.equal(validateConfig(config('Unknown Nexus',6546)),false);
});

test('signed operator delegation must match verified chain, never fallback to 5546',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'crylo-chain-binding-'));
  t.after(async()=>fs.rm(dir,{recursive:true,force:true}));
  const owner=Wallet.createRandom(),session=Wallet.createRandom();
  const delegation={
    version:1,purpose:'operator-heartbeat',chainId:6546,
    operatorAddress:owner.address,nodeId:'operator-node-001',
    sessionAddress:session.address,
    issuedAt:'2026-11-15T00:00:00.000Z',
    expiresAt:'2030-11-15T00:00:00.000Z'
  };
  const body={
    version:1,delegation,
    delegationSignature:await owner.signMessage(JSON.stringify(delegation))
  };
  const authorizationPath=path.join(dir,'authorization.json');
  await fs.writeFile(authorizationPath,JSON.stringify(body));
  const read=expectedChainId=>loadAuthorization({
    authorizationPath,expectedChainId,
    expectedOperatorAddress:owner.address,expectedNodeId:'operator-node-001'
  });
  assert.equal((await read(6546)).delegation.chainId,6546);
  await assert.rejects(read(5546),/Unexpected authorization chain ID/);
  for(const invalid of [undefined,0,1.5,-10]){
    await assert.rejects(read(invalid),/Expected authorization chain ID/);
  }
});
