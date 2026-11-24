'use strict';

// Read-only production launch preflight for the separate Nexus Foundation API.
// Never request a bridge deposit, access wallet-RPC, use a signing key, or send
// a real payment ID/status bearer capability. Network calls are made only to
// an explicitly named public HTTPS origin and its HTTPS RPC from signed config.
const { trustedEndpoint, nexusApiUrl, verifyNexusRpcUrl } =
  require('./nexus-endpoint-policy');
const {
  validateBundledNexusConfig,
  expectedNexusChainId,
  expectedNexusBlockchainId
} = require('./nexus-foundation-bootstrap');

const MAX_JSON_BYTES = 128 * 1024;
const REQUIRED_CONTRACTS = [
  'wCryLo', 'BridgeManager', 'BridgeLedger', 'BridgeReserveVault',
  'WalletRegistry', 'GasManager', 'GasTreasuryVault', 'RewardManager',
  'RewardVault', 'Staking', 'NodeStaking', 'RevenueRouter', 'RevenuePolicy'
];
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const INVALID_CAPABILITY = '0'.repeat(64);
const DUMMY_PAYMENT_ID = '0000000000000000';

async function requestResponse(fetchImpl, url, init) {
  const response = await fetchImpl(url, {
    ...init,
    redirect: 'error',
    signal: AbortSignal.timeout(10000)
  });
  if (!response || !Number.isInteger(response.status)) {
    throw new Error('Nexus Foundation response was invalid.');
  }
  return response;
}

async function readJson(fetchImpl, url, init) {
  const response = await requestResponse(fetchImpl, url, init);
  const body = await response.text();
  if (Buffer.byteLength(body, 'utf8') > MAX_JSON_BYTES) {
    throw new Error('Nexus Foundation response exceeded the safe JSON size.');
  }
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error('Nexus Foundation returned non-JSON response.');
  }
  if (response.status !== 200) {
    throw new Error('Nexus Foundation public API is not ready: HTTP ' + response.status);
  }
  return data;
}

async function verifyPublicFoundationEndpoint(origin, signedConfig, fetchImpl = fetch) {
  validateBundledNexusConfig(signedConfig);
  const endpoint = trustedEndpoint(origin, 'Nexus Foundation public origin');
  if (endpoint.protocol !== 'https:') {
    throw new Error('Public Nexus Foundation preflight requires verified HTTPS.');
  }
  const base = endpoint.href.replace(/\/+$/, '');

  const health = await readJson(fetchImpl, nexusApiUrl(base, '/health'), {
    method: 'GET',
    headers: { Accept: 'application/json' }
  });
  if (health?.ok !== true) {
    throw new Error('Nexus Foundation /health is not ready.');
  }

  const data = await readJson(fetchImpl, nexusApiUrl(base, '/nexus/bridge-config'), {
    method: 'GET',
    headers: { Accept: 'application/json' }
  });

  const blockchainId = expectedNexusBlockchainId(signedConfig);
  const chainId = expectedNexusChainId(signedConfig);
  if (data?.ok !== true || data.chainId !== chainId ||
      data.blockchainId !== blockchainId ||
      data.cryloL1Network !== signedConfig.network) {
    throw new Error('Nexus Foundation API reports the wrong signed network identity.');
  }

  for (const name of REQUIRED_CONTRACTS) {
    const address = data.contracts?.[name];
    if (typeof address !== 'string' || !EVM_ADDRESS.test(address) ||
        /^0x0{40}$/i.test(address)) {
      throw new Error('Nexus Foundation is missing a valid deployed ' + name + ' address.');
    }
  }

  const rpcUrl = trustedEndpoint(
    verifyNexusRpcUrl(data.rpc), 'Nexus Foundation public RPC'
  );
  if (rpcUrl.protocol !== 'https:' ||
      !rpcUrl.pathname.includes('/ext/bc/' + blockchainId + '/rpc')) {
    throw new Error('Nexus Foundation public RPC must use HTTPS and the signed blockchain ID.');
  }

  const rpc = await readJson(fetchImpl, rpcUrl.href, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1
    })
  });
  if (rpc?.jsonrpc !== '2.0' ||
      rpc.result?.toLowerCase?.() !== '0x' + chainId.toString(16)) {
    throw new Error('Nexus public RPC chain ID does not match the signed wallet.');
  }

  // Probe only that the private status route rejects an unauthenticated
  // placeholder; never send or receive any actual wallet/payment identity.
  const denied = await requestResponse(
    fetchImpl, nexusApiUrl(base, '/bridge/status'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Bridge-Status-Token': INVALID_CAPABILITY
      },
      body: JSON.stringify({ paymentId: DUMMY_PAYMENT_ID })
    }
  );
  if (denied.status !== 404) {
    throw new Error('Nexus private bridge status must reject an unauthorized probe with HTTP 404.');
  }

  return Object.freeze({
    foundationOrigin: base,
    rpcOrigin: rpcUrl.origin,
    cryloL1Network: signedConfig.network,
    chainId,
    blockchainId,
    contractsChecked: REQUIRED_CONTRACTS.length,
    statusEndpointRejectsUnknownCapability: true,
    readOnly: true
  });
}

module.exports = Object.freeze({ verifyPublicFoundationEndpoint });
