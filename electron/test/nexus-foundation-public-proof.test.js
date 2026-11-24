'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyPublicFoundationEndpoint } =
  require('../security/nexus-foundation-public-proof');
const signed = require('../security/nexus-foundation-endpoints.json');

const id = signed.blockchainId;
const origin = 'https://api.example.test/crylonexus-api';
const rpc = 'https://rpc.example.test/ext/bc/' + id + '/rpc';

const contracts = {};
for (const name of [
  'wCryLo', 'BridgeManager', 'BridgeLedger', 'BridgeReserveVault',
  'WalletRegistry', 'GasManager', 'GasTreasuryVault', 'RewardManager',
  'RewardVault', 'Staking', 'NodeStaking', 'RevenueRouter', 'RevenuePolicy'
]) {
  contracts[name] = '0x' + 'a'.repeat(40);
}

function makeFixture(overrides = {}) {
  const calls = [];
  const options = {
    health: {ok: true},
    config: {ok: true, chainId: signed.chainId, blockchainId: id,
      cryloL1Network: signed.network, rpc, contracts},
    chain: {jsonrpc: '2.0', result: '0x15aa', id: 1},
    statusCode: 404,
    ...overrides
  };
  const fetchImpl = async (url, init) => {
    assert.equal(init.redirect, 'error');
    calls.push({url, method: init.method, headers: init.headers, body: init.body});
    const result = url === origin + '/health'
      ? {status: 200, data: options.health}
      : url === origin + '/nexus/bridge-config'
      ? {status: 200, data: options.config}
      : url === rpc || url === options.config.rpc
      ? {status: 200, data: options.chain}
      : url === origin + '/bridge/status'
      ? {status: options.statusCode, data: {error: 'Not found'}}
      : {status: 404, data: {error: 'Unexpected route'}};
    return {status: result.status, text: async () => JSON.stringify(result.data)};
  };
  return {calls, fetchImpl};
}

test('read-only HTTPS preflight accepts matching testnet and never sends real secrets', async () => {
  const f = makeFixture();
  const result = await verifyPublicFoundationEndpoint(origin, signed, f.fetchImpl);
  assert.equal(result.foundationOrigin, origin);
  assert.equal(result.chainId, 5546);
  assert.equal(result.blockchainId, id);
  assert.equal(result.contractsChecked, 13);
  assert.equal(result.statusEndpointRejectsUnknownCapability, true);
  assert.deepEqual(f.calls.map(c => c.method), ['GET', 'GET', 'POST', 'POST']);
  const probe = f.calls[3];
  assert.equal(probe.headers['X-Bridge-Status-Token'], '0'.repeat(64));
  assert.deepEqual(JSON.parse(probe.body), {paymentId: '0000000000000000'});
  assert.deepEqual(JSON.parse(f.calls[2].body), {
    jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1
  });
  assert.equal(f.calls.every(c => c.url.startsWith('https://')), true);
});

test('reject public plaintext, bad credentials, and wrong signed network identity', async () => {
  for (const bad of ['http://api.example.test/crylonexus-api',
    'http://127.0.0.1:8088', 'https://u:p@api.example.test',
    'https://api.example.test/?token=not-safe']) {
    await assert.rejects(
      verifyPublicFoundationEndpoint(bad, signed, makeFixture().fetchImpl)
    );
  }
  for (const config of [
    { ...signed, network: 'mainnet' },
    { ...signed, chainId: 546 },
    { ...signed, blockchainId: 'bad' }
  ]) {
    await assert.rejects(
      verifyPublicFoundationEndpoint(origin, config, makeFixture().fetchImpl)
    );
  }
});

test('fail closed for mismatched Foundation metadata, wrong RPC, and exposed status', async () => {
  for (const extra of [
    {config: {...makeFixture().fetchImpl.config, ok: true, chainId: 546,
      blockchainId: id, cryloL1Network: 'testnet', rpc, contracts}},
    {config: {ok: true, chainId: 5546, blockchainId: 'wrong',
      cryloL1Network: 'testnet', rpc, contracts}},
    {config: {ok: true, chainId: 5546, blockchainId: id,
      cryloL1Network: 'mainnet', rpc, contracts}},
    {config: {ok: true, chainId: 5546, blockchainId: id,
      cryloL1Network: 'testnet', rpc: 'http://rpc.example.test/rpc', contracts}},
    {config: {ok: true, chainId: 5546, blockchainId: id,
      cryloL1Network: 'testnet', rpc, contracts: {...contracts, WalletRegistry: '0x' + '0'.repeat(40)}}},
    {chain: {jsonrpc: '2.0', result: '0x222', id: 1}},
    {statusCode: 200}
  ]) {
    await assert.rejects(
      verifyPublicFoundationEndpoint(origin, signed, makeFixture(extra).fetchImpl)
    );
  }
});

test('reject unavailable health, redirecting endpoints and unexpected JSON', async () => {
  await assert.rejects(
    verifyPublicFoundationEndpoint(origin, signed, makeFixture({health:{ok:false}}).fetchImpl)
  );
  const redirect = async (_url, init) => {
    assert.equal(init.redirect, 'error');
    throw new Error('redirect denied');
  };
  await assert.rejects(verifyPublicFoundationEndpoint(origin,signed,redirect),
    /redirect denied/);
});
