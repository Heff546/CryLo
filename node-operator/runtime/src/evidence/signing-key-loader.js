
const fs = require('node:fs/promises');
const path = require('node:path');

const {
  Wallet,
  getAddress
} = require('ethers');

const {
  assertPrivateKey
} = require('./detached-signing');

const {
  defaultOperatorDirectory
} = require('../config');

const FORBIDDEN_PERMISSION_MASK = 0o077;

function defaultSigningKeyPath() {
  return path.join(
    defaultOperatorDirectory(),
    'signing-key'
  );
}

function requireNonEmptyString(
  value,
  name
) {
  if (
    typeof value !== 'string' ||
    value.trim() === ''
  ) {
    throw new TypeError(
      `${name} must be a non-empty string`
    );
  }

  return value;
}

function normalizeExpectedAddress(value) {
  requireNonEmptyString(
    value,
    'Expected operator address'
  );

  try {
    return getAddress(value);
  } catch (error) {
    throw new TypeError(
      'Expected operator address must be a valid Ethereum address',
      {
        cause: error
      }
    );
  }
}

function assertSecureKeyFile(
  stat,
  keyPath
) {
  if (!stat.isFile()) {
    throw new Error(
      `Operator signing key path is not a regular file: ${keyPath}`
    );
  }

  if (process.platform !== 'win32') {
    const permissions =
      stat.mode & 0o777;

    if (
      permissions &
      FORBIDDEN_PERMISSION_MASK
    ) {
      throw new Error(
        `Operator signing key file permissions are unsafe: ` +
        `${permissions.toString(8).padStart(3, '0')}; expected 600 or stricter`
      );
    }
  }

  if (
    typeof process.getuid === 'function' &&
    stat.uid !== process.getuid()
  ) {
    throw new Error(
      'Operator signing key file must be owned by the runtime user'
    );
  }
}

async function loadSigningKey(options) {
  if (
    options === null ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    Object.getPrototypeOf(options) !==
      Object.prototype
  ) {
    throw new TypeError(
      'Signing key loader options must be a plain object'
    );
  }

  const expectedSignerAddress =
    normalizeExpectedAddress(
      options.expectedSignerAddress === undefined
        ? options.expectedOperatorAddress
        : options.expectedSignerAddress
    );

  const configuredPath =
    options.keyPath === undefined
      ? (
          process.env
            .CRYLONEXUS_OPERATOR_SIGNING_KEY_FILE ||
          defaultSigningKeyPath()
        )
      : requireNonEmptyString(
          options.keyPath,
          'Operator signing key path'
        );

  const keyPath =
    path.resolve(configuredPath);

  let stat;

  try {
    stat = await fs.stat(keyPath);
  } catch (error) {
    if (
      error &&
      error.code === 'ENOENT'
    ) {
      throw new Error(
        `Operator signing key file does not exist: ${keyPath}`,
        {
          cause: error
        }
      );
    }

    throw error;
  }

  assertSecureKeyFile(
    stat,
    keyPath
  );

  const serialized =
    await fs.readFile(
      keyPath,
      'utf8'
    );

  const privateKey =
    serialized.trim();

  if (
    serialized
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .length !== 1
  ) {
    throw new Error(
      'Operator signing key file contains unexpected surrounding content'
    );
  }

  assertPrivateKey(
    privateKey
  );

  const wallet =
    new Wallet(privateKey);

  if (
    wallet.address !==
    expectedSignerAddress
  ) {
    throw new Error(
      `Operator signing key address mismatch: expected ` +
      `${expectedSignerAddress}, derived ${wallet.address}`
    );
  }

  return Object.freeze({
    keyPath,
    privateKey
  });
}

module.exports = Object.freeze({
  FORBIDDEN_PERMISSION_MASK,
  defaultSigningKeyPath,
  loadSigningKey
});
