'use strict';

// The Electron main process is the only place that may contact the bridge
// Foundation API with wallet metadata or private status bearer capabilities.
// Remote endpoints require TLS; plaintext is permitted only to loopback for
// local Testnet development (for example via an operator-controlled tunnel).
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

function trustedEndpoint(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(label + ' is not configured. Set CRYLONEXUS_API_URL to a verified HTTPS endpoint or loopback for local testing.');
  }
  let url;
  try { url = new URL(value); } catch (_) {
    throw new Error(label + ' is not a valid URL.');
  }
  if ((url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && LOOPBACK.has(url.hostname))) ||
      url.username || url.password || url.hash || url.search ||
      !url.hostname) {
    throw new Error(label + ' must use HTTPS (or loopback HTTP), without credentials, query or fragment.');
  }
  return url;
}

function nexusApiUrl(configuredOrigin, pathname) {
  const origin = trustedEndpoint(configuredOrigin, 'CryLoNexus API');
  // Only static slash-prefixed paths produced by the main process.
  if (typeof pathname !== 'string' || !/^\/[A-Za-z0-9_/%.-]+$/.test(pathname) ||
      pathname.startsWith('//') || pathname.includes('..') ||
      pathname.includes('\\')) {
    throw new Error('Invalid CryLoNexus API route.');
  }
  return origin.href.replace(/\/+$/, '') + pathname;
}

function verifyNexusRpcUrl(configuredRpc) {
  const origin = trustedEndpoint(configuredRpc, 'CryLoNexus RPC');
  return origin.href;
}

module.exports = { nexusApiUrl, verifyNexusRpcUrl };
