'use strict';

const REDACTED_KEYS = new Set([
  'privatekey',
  'mnemonic',
  'seed',
  'seedphrase',
  'password',
  'walletpassword',
  'walletfile',
  'secret',
  'token',
  'apikey',
  'authorization'
]);

function normalizeKey(value) {
  return String(value)
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

function redact(value, seen = new WeakSet()) {
  if (
    value === null ||
    typeof value !== 'object'
  ) {
    return value;
  }

  if (seen.has(value)) {
    return '[Circular]';
  }

  seen.add(value);

  if (Array.isArray(value)) {
    return value.map(item => redact(item, seen));
  }

  const output = {};

  for (const [key, child] of Object.entries(value)) {
    output[key] = REDACTED_KEYS.has(normalizeKey(key))
      ? '[REDACTED]'
      : redact(child, seen);
  }

  return output;
}

function log(level, event, details = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...redact(details)
  };

  process.stdout.write(
    `${JSON.stringify(entry)}\n`
  );
}

module.exports = {
  log,
  redact
};
