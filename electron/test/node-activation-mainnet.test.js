'use strict';

// Mainnet-only interface regression. Does not start Electron, open a
// wallet, sign a transaction, read RPC, or mutate the release artifacts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(base,p),'utf8');

test('private V3 reverse bridge retains commitment-only burn ABI', () => {
  const artifact = JSON.parse(read('src/abis/BridgeManager.private-v3.json'));
  const abi = artifact.abi || artifact;
  const burn = abi.find(x=>x.type==='function'&&x.name==='burnForCryLo');
  assert.deepEqual(burn.inputs.map(x=>x.type),['bytes32','bytes32','uint256']);
  const main = read('main.js');
  assert.match(main,/bridgePrivacyVersion !== 'private-v3'/);
  assert.match(main,/nexusApiUrl\('\/bridge\/outbound-intent'\)/);
  assert.match(main,/bridge\.burnForCryLo\(\s*burnId,\s*destinationCommitment,\s*amount,/);
});
test('on-chain reward activation is distinct from 72-hour session delegation',()=>{
  const main=read('main.js'),preload=read('preload.js');
  assert.match(main,/secureIpcHandle\('nexus-activate-node'/);
  assert.match(main,/NODE_REWARD_ACTIVATION_ABI/);
  assert.match(main,/function activateNode\(\)/);
  assert.match(main,/function getNodeActivationAt\(address,uint64\)/);
  assert.match(main,/function isNodeRewardActiveAt\(address,uint64\)/);
  assert.match(main,/loadBoundNexusWallet\(walletName, cryloAddress\)/);
  assert.match(main,/activation\.activateNode\.staticCall\(\)/);
  assert.match(main,/receipt\.status !== 1/);
  assert.match(main,/expiresAt <= BigInt\(block\.timestamp\)/);
  assert.match(preload,/nexusActivateNode:[\s\S]*?'nexus-activate-node'/);
  // No automatic activation when registering or authorizing a node.
  const afterOperator=main.split("secureIpcHandle('nexus-register-operator'")[1]
    .split("secureIpcHandle('nexus-register-validator'")[0];
  const afterValidator=main.split("secureIpcHandle('nexus-register-validator'")[1]
    .split("secureIpcHandle('nexus-unregister-node'")[0];
  assert.doesNotMatch(afterOperator,/activateNode\(/);
  assert.doesNotMatch(afterValidator,/activateNode\(/);
});
test('user-controlled renewal is exposed with independently verified on-chain expiry',()=>{
  const html=read('src/index.html'),app=read('src/app.js'),main=read('main.js');
  assert.match(html,/id="nexus-activate-node-btn"/);
  assert.match(html,/onclick="App\.activateNexusNode\(\)"/);
  assert.match(html,/id="nexus-node-activation-expiry"/);
  assert.match(html,/separate from the Node Service/);
  assert.match(app,/async function activateNexusNode\(\)/);
  assert.match(app,/nexusActivateNode\(/);
  assert.match(app,/activateNexusNode,\s*claimNexusNodeRewards/);
  assert.match(app,/onChainActivation\.supported === true/);
  assert.match(app,/onChainActivation\.active === true/);
  assert.match(app,/Renew On-chain Activation/);
  assert.match(main,/activation\.getNodeActivationAt\(/);
});

test('node service and signed heartbeat authorization use verified network identity, never a testnet literal',()=>{
  const main=read('main.js');
  assert.match(main,/network: CRYLO_NETWORK_MODE === 'mainnet'/);
  assert.match(main,/chainId: Number\(chainId\)/);
  assert.match(main,/network\.chainId !== BigInt\(runtime\.chainId\)/);
  assert.match(main,/chainId: runtime\.chainId,/);
  assert.match(main,/authorization\.delegation\?\.chainId === expectedChainId/);
  assert.match(main,/Saved Node Service config does not match verified Nexus network/);
  assert.match(main,/Saved NodeStaking address differs from verified Nexus network/);
  assert.doesNotMatch(main,/chainId: 5546/);
  assert.doesNotMatch(main,/chainId !== 5546n/);
});
test('wallet never calls a node locally eligible while on-chain activation is unverified',()=>{
  const app=read('src/app.js');
  assert.match(app,/On-chain Activation Required/);
  assert.match(app,/The node cannot earn rewards until its 72-hour on-chain activation/);
});
test('bundled operator runtime rejects mismatched signed delegation chain',()=>{
  const loader=read('../node-operator/runtime/src/evidence/authorization-loader.js');
  const runtime=read('../node-operator/runtime/src/main.js');
  const pipeline=read('../node-operator/runtime/src/evidence/local-heartbeat-runtime.js');
  const schema=JSON.parse(read('../node-operator/protocol/schemas/operator-config.schema.json'));
  assert.match(loader,/delegation\.chainId !== expectedChainId/);
  assert.match(loader,/Expected authorization chain ID/);
  assert.doesNotMatch(loader,/delegation\.chainId !== 5546/);
  assert.match(pipeline,/expectedChainId:\s*options\.expectedChainId/);
  assert.match(runtime,/expectedChainId:\s*config\.chainId/);
  assert.ok(schema.properties.network.enum.includes('CryLoNexus Mainnet'));
});
test('bundled Validator reward EIP-712 and remote evidence use verified Nexus chain',()=>{
  const main=read('../node-operator/runtime/src/main.js');
  const observation=read('../node-operator/runtime/src/evidence/node-observation-worker.js');
  const signed=read('../node-operator/runtime/src/evidence/signed-validator-reward-approval.js');
  const typed=read('../node-operator/runtime/src/evidence/validator-reward-approval-signature-eip712.js');
  const auth=read('../node-operator/runtime/src/evidence/validator-reward-approval-authorization.js');
  const delegation=read('../node-operator/runtime/src/evidence/validator-reward-approval-eip712.js');
  assert.match(main,/expectedChainId:\s*config\.chainId/);
  assert.match(main,/chainId:\s*config\.chainId,\s*validatorAddress:/);
  assert.match(observation,/expectedChainId:\s*options\.expectedChainId/);
  assert.match(signed,/chainId:\s*unsignedInput\.chainId/);
  assert.match(typed,/chainId:\s*approval\.chainId/);
  assert.match(auth,/expectedChainId:\s*options\.expectedChainId/);
  assert.match(delegation,/delegation\.chainId !==\s*expectedChainId/);
});

