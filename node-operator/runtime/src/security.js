'use strict';

const FORBIDDEN_KEYS = new Set([
  'privatekey',
  'mnemonic',
  'seed',
  'seedphrase',
  'password',
  'walletpassword',
  'walletfile',
  'secret',
  'signingkey',
  'releasesigningprivatekey',
  'apikey',
  'authorization'
]);

function normalizeKey(value) {
  return String(value)
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

function findForbiddenField(
  value,
  location = '$',
  seen = new WeakSet()
) {
  if (
    value === null ||
    typeof value !== 'object'
  ) {
    return null;
  }

  if (seen.has(value)) {
    return null;
  }

  seen.add(value);

  for (const [key, child] of Object.entries(value)) {
    const childLocation = `${location}.${key}`;

    if (FORBIDDEN_KEYS.has(normalizeKey(key))) {
      return childLocation;
    }

    const nested =
      findForbiddenField(
        child,
        childLocation,
        seen
      );

    if (nested) {
      return nested;
    }
  }

  return null;
}

module.exports = {
  findForbiddenField
};
