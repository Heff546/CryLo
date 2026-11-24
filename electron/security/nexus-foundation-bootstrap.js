'use strict';

// This file and the JSON next to it are packaged in the verified Electron app.
// Ordinary users receive trusted Foundation API configuration by 'crylo update'.
// Never use untrusted RPC responses, an IP address, or DNS guesses as a fallback.
const {
  trustedEndpoint
} = require('./nexus-endpoint-policy');

const TESTNET_CHAIN_ID = 5546;
const TESTNET_BLOCKCHAIN_ID = 'EPA2TKpkcmYRdaa4QKMYdFHkjzy5SWuGHEiBwznNspdTqexrQ';

function validateBundledNexusConfig(config) {
  if (!config || Array.isArray(config) || typeof config !== 'object' ||
      config.schema !== 1 || config.network !== 'testnet' ||
      config.chainId !== TESTNET_CHAIN_ID ||
      config.blockchainId !== TESTNET_BLOCKCHAIN_ID ||
      !Object.hasOwn(config, 'foundationApiOrigin')) {
    throw new Error('Signed wallet Nexus Testnet configuration is invalid.');
  }

  const origin = config.foundationApiOrigin;
  if (origin !== null) {
    if (typeof origin !== 'string' || !origin.trim()) {
      throw new Error('Signed wallet Nexus Foundation endpoint is invalid.');
    }
    // Official release endpoints must be public HTTPS. Only an explicitly
    // configured local test override may use plaintext loopback HTTP.
    const url = trustedEndpoint(origin, 'Signed Nexus Foundation endpoint');
    if (url.protocol !== 'https:') {
      throw new Error('Signed wallet Nexus Foundation endpoint must use HTTPS.');
    }
  }
  return config;
}

function resolveNexusFoundationOrigin(config, environment = process.env) {
  validateBundledNexusConfig(config);

  // Developer/operator overrides remain explicit and subject to the same
  // strict HTTPS/loopback validation as other Nexus Foundation requests.
  if (Object.hasOwn(environment, 'CRYLONEXUS_API_URL')) {
    const override = environment.CRYLONEXUS_API_URL;
    return trustedEndpoint(override, 'CryLoNexus API override').href.replace(/\/+$/, '');
  }

  const bundled = config.foundationApiOrigin;
  if (bundled === null) {
    throw new Error(
      'Nexus Foundation API is not yet enabled in this signed CryLo wallet release. ' +
      'Please use crylo update when an official HTTPS endpoint is available.'
    );
  }
  return trustedEndpoint(bundled, 'Signed Nexus Foundation endpoint').href.replace(/\/+$/, '');
}

function expectedNexusChainId(config) {
  return validateBundledNexusConfig(config).chainId;
}

function expectedNexusBlockchainId(config) {
  return validateBundledNexusConfig(config).blockchainId;
}

module.exports = Object.freeze({
  TESTNET_CHAIN_ID,
  TESTNET_BLOCKCHAIN_ID,
  validateBundledNexusConfig,
  resolveNexusFoundationOrigin,
  expectedNexusChainId,
  expectedNexusBlockchainId
});
