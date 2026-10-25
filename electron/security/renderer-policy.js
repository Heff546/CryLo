'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');

// A single application-owned renderer document is authorized for wallet IPC.
// The URL is derived from the installed application directory, not a hostname
// or a user-configurable path. Hash-only navigation does not grant new access.
const WALLET_DOCUMENT_URL =
  pathToFileURL(path.resolve(__dirname, '..', 'src', 'index.html')).href;

function isWalletDocument(value) {
  if (typeof value !== 'string') return false;
  try {
    const expected = new URL(WALLET_DOCUMENT_URL);
    const candidate = new URL(value);
    return (
      candidate.protocol === 'file:' &&
      candidate.host === expected.host &&
      candidate.pathname === expected.pathname &&
      candidate.search === ''
    );
  } catch {
    return false;
  }
}

function trustedIpcSender(event, window) {
  if (!window || window.isDestroyed() || !event || !event.sender) {
    return false;
  }

  const contents = window.webContents;
  if (!contents || contents.isDestroyed() || event.sender !== contents) {
    return false;
  }

  const frame = event.senderFrame;
  if (!frame || frame !== contents.mainFrame) {
    return false;
  }

  return (
    isWalletDocument(contents.getURL()) &&
    isWalletDocument(frame.url)
  );
}

function safeExternalHttpsUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 ||
      value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    return null;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname ||
        url.username || url.password) {
      return null;
    }

    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost') ||
        host.endsWith('.local') || host === '127.0.0.1' ||
        host.startsWith('127.') || host === '[::1]' || host === '::1') {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
}

module.exports = {
  WALLET_DOCUMENT_URL,
  isWalletDocument,
  trustedIpcSender,
  safeExternalHttpsUrl
};
