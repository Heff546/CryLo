'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  WALLET_DOCUMENT_URL,
  isWalletDocument,
  trustedIpcSender,
  safeExternalHttpsUrl
} = require('../security/renderer-policy');

test('only the installed wallet document is trusted', () => {
  assert.equal(isWalletDocument(WALLET_DOCUMENT_URL), true);
  assert.equal(isWalletDocument(WALLET_DOCUMENT_URL + '#settings'), true);
  assert.equal(isWalletDocument(WALLET_DOCUMENT_URL + '?operator=1'), false);
  assert.equal(isWalletDocument('file:///tmp/index.html'), false);
  assert.equal(isWalletDocument('https://crylo.com/'), false);
  assert.equal(isWalletDocument('javascript:alert(1)'), false);
  assert.equal(isWalletDocument(''), false);
});

test('wallet IPC rejects foreign contents, subframes and navigations', () => {
  const top = { url: WALLET_DOCUMENT_URL };
  const contents = {
    mainFrame: top,
    isDestroyed: () => false,
    getURL: () => WALLET_DOCUMENT_URL
  };
  const window = { webContents: contents, isDestroyed: () => false };
  assert.equal(trustedIpcSender({ sender: contents, senderFrame: top }, window), true);
  assert.equal(trustedIpcSender({ sender: {}, senderFrame: top }, window), false);
  assert.equal(trustedIpcSender({ sender: contents, senderFrame: { url: WALLET_DOCUMENT_URL } }, window), false);
  assert.equal(trustedIpcSender({ sender: contents }, window), false);
  top.url = 'https://attacker.example/';
  assert.equal(trustedIpcSender({ sender: contents, senderFrame: top }, window), false);
  top.url = WALLET_DOCUMENT_URL;
  contents.getURL = () => 'https://attacker.example/';
  assert.equal(trustedIpcSender({ sender: contents, senderFrame: top }, window), false);
  contents.getURL = () => WALLET_DOCUMENT_URL;
  window.isDestroyed = () => true;
  assert.equal(trustedIpcSender({ sender: contents, senderFrame: top }, window), false);
});

test('external URLs are HTTPS-only without local, credential or dangerous schemes', () => {
  assert.equal(safeExternalHttpsUrl('https://crylo.com/docs'), 'https://crylo.com/docs');
  for (const url of [
    'http://crylo.com/',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,hi',
    'mailto:hello@example.com',
    'https://name:password@crylo.com/',
    'https://localhost/',
    'https://127.0.0.1/',
    'https://[::1]/',
    'https://foo.local/',
    'https://crylo.com/\n',
    '\thttps://crylo.com/',
    'not-a-url',
    null
  ]) {
    assert.equal(safeExternalHttpsUrl(url), null, String(url));
  }
});
