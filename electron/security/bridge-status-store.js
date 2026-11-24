'use strict';

// Bridge status bearer capabilities are never sent to the renderer, placed in
// URLs, or logged. Keep only the minimum payment-ID -> token association
// under a separate owner-only directory, across Electron restarts.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PAYMENT_ID = /^[0-9a-f]{16}$/i;
const TOKEN = /^[0-9a-f]{64}$/i;
const DIRECTORY = 'bridge-private';
const FILE = 'status-capabilities.json';

function assertPrivateEntry(stat, kind) {
  if (stat.isSymbolicLink() ||
      (kind === 'directory' ? !stat.isDirectory() : !stat.isFile())) {
    throw new Error('Bridge capability storage has an unsafe file type.');
  }
  if (process.platform !== 'win32') {
    if ((stat.mode & 0o077) !== 0 ||
        (typeof process.getuid === 'function' && stat.uid !== process.getuid())) {
      throw new Error('Bridge capability storage must be owner-only.');
    }
  }
}

function storageDirectory(userDataPath) {
  if (typeof userDataPath !== 'string' || !path.isAbsolute(userDataPath)) {
    throw new Error('Bridge capability storage requires an absolute app-data path.');
  }
  const directory = path.join(userDataPath, DIRECTORY);
  try {
    fs.mkdirSync(directory, { mode: 0o700 });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
  assertPrivateEntry(fs.lstatSync(directory), 'directory');
  return directory;
}

function readCapabilities(directory) {
  const filename = path.join(directory, FILE);
  let stat;
  try {
    stat = fs.lstatSync(filename);
  } catch (err) {
    if (err.code === 'ENOENT') return Object.create(null);
    throw err;
  }
  assertPrivateEntry(stat, 'file');
  if (stat.size > 1024 * 1024) {
    throw new Error('Bridge capability storage exceeds the size limit.');
  }
  const raw = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (!raw || Array.isArray(raw) || typeof raw !== 'object') {
    throw new Error('Invalid bridge capability storage.');
  }
  const capabilities = Object.create(null);
  for (const [id, token] of Object.entries(raw)) {
    if (!PAYMENT_ID.test(id) || typeof token !== 'string' || !TOKEN.test(token)) {
      throw new Error('Invalid bridge capability entry.');
    }
    capabilities[id.toLowerCase()] = token.toLowerCase();
  }
  return capabilities;
}

function saveCapabilities(directory, capabilities) {
  const filename = path.join(directory, FILE);
  const temporary = path.join(
    directory, '.status-' + crypto.randomBytes(16).toString('hex')
  );
  let handle;
  try {
    handle = fs.openSync(
      temporary,
      fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY |
        (fs.constants.O_NOFOLLOW || 0),
      0o600
    );
    fs.writeFileSync(handle, JSON.stringify(capabilities), 'utf8');
    fs.fsyncSync(handle);
    fs.closeSync(handle);
    handle = undefined;
    fs.renameSync(temporary, filename);
  } finally {
    if (handle !== undefined) fs.closeSync(handle);
    try { fs.unlinkSync(temporary); } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
}

function saveBridgeStatusCapability(userDataPath, paymentId, statusToken) {
  if (typeof paymentId !== 'string' || !PAYMENT_ID.test(paymentId) ||
      typeof statusToken !== 'string' || !TOKEN.test(statusToken)) {
    throw new Error('Bridge API did not return a valid private status capability.');
  }
  const directory = storageDirectory(userDataPath);
  const existing = readCapabilities(directory);
  const id = paymentId.toLowerCase();
  const token = statusToken.toLowerCase();
  if (existing[id] && existing[id] !== token) {
    throw new Error('Bridge payment ID collision: refusing to overwrite capability.');
  }
  existing[id] = token;
  saveCapabilities(directory, existing);
}

function getBridgeStatusCapability(userDataPath, paymentId) {
  if (typeof paymentId !== 'string' || !PAYMENT_ID.test(paymentId)) {
    throw new Error('Invalid bridge payment ID.');
  }
  const directory = storageDirectory(userDataPath);
  return readCapabilities(directory)[paymentId.toLowerCase()] || null;
}

module.exports = { saveBridgeStatusCapability, getBridgeStatusCapability };
