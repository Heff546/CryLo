'use strict';

let requestId = 0;

async function jsonRpc(
  rpcUrl,
  method,
  params = [],
  timeoutMs = 10000
) {
  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++requestId,
        method,
        params
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(
        `RPC HTTP ${response.status}`
      );
    }

    const payload = await response.json();

    if (payload.error) {
      throw new Error(
        payload.error.message ||
        'RPC returned an error'
      );
    }

    if (payload.result === undefined) {
      throw new Error(
        'RPC response did not contain a result'
      );
    }

    return payload.result;
  } finally {
    clearTimeout(timeout);
  }
}

function parseHexInteger(value, fieldName) {
  if (
    typeof value !== 'string' ||
    !/^0x[0-9a-fA-F]+$/.test(value)
  ) {
    throw new Error(
      `Invalid ${fieldName} returned by RPC`
    );
  }

  const parsed = Number.parseInt(value, 16);

  if (!Number.isSafeInteger(parsed)) {
    throw new Error(
      `${fieldName} exceeds safe integer range`
    );
  }

  return parsed;
}

async function checkRpc(
  rpcUrl,
  expectedChainId
) {
  const [chainIdHex, blockNumberHex] =
    await Promise.all([
      jsonRpc(rpcUrl, 'eth_chainId'),
      jsonRpc(rpcUrl, 'eth_blockNumber')
    ]);

  const chainId =
    parseHexInteger(
      chainIdHex,
      'chain ID'
    );

  const blockNumber =
    parseHexInteger(
      blockNumberHex,
      'block number'
    );

  if (chainId !== expectedChainId) {
    throw new Error(
      `Wrong chain ID: expected ${expectedChainId}, received ${chainId}`
    );
  }

  return {
    chainId,
    blockNumber
  };
}

module.exports = {
  jsonRpc,
  parseHexInteger,
  checkRpc
};
