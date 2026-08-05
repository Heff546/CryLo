'use strict';

const { ethers } = require('ethers');

function normalizeExpectedChainId(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  try {
    return BigInt(value);
  } catch {
    throw new Error(`Invalid expected chain ID: ${value}`);
  }
}

function createProvider(rpcUrl, options = {}) {
  if (typeof rpcUrl !== 'string' || rpcUrl.trim() === '') {
    throw new TypeError('RPC URL must be a non-empty string');
  }

  let parsed;

  try {
    parsed = new URL(rpcUrl);
  } catch {
    throw new Error(`Invalid RPC URL: ${rpcUrl}`);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(
      `Unsupported RPC protocol: ${parsed.protocol}`
    );
  }

  const timeout = Number(options.timeout ?? 15_000);

  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error(`Invalid RPC timeout: ${options.timeout}`);
  }

  const request = new ethers.FetchRequest(parsed.toString());
  request.timeout = timeout;

  return new ethers.JsonRpcProvider(
    request,
    undefined,
    {
      staticNetwork: options.staticNetwork ?? false
    }
  );
}

async function verifyProvider(provider, options = {}) {
  if (!provider || typeof provider.getNetwork !== 'function') {
    throw new TypeError('A valid ethers provider is required');
  }

  const expectedChainId =
    normalizeExpectedChainId(options.expectedChainId);

  const [network, blockNumber] = await Promise.all([
    provider.getNetwork(),
    provider.getBlockNumber()
  ]);

  const chainId = BigInt(network.chainId);

  if (
    expectedChainId !== null &&
    chainId !== expectedChainId
  ) {
    throw new Error(
      `Unexpected chain ID: expected ${expectedChainId}, received ${chainId}`
    );
  }

  return {
    connected: true,
    chainId: chainId.toString(),
    blockNumber: Number(blockNumber)
  };
}

module.exports = {
  createProvider,
  normalizeExpectedChainId,
  verifyProvider
};
