'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  validateConfig,
  formatValidationErrors
} = require('./schema');

const {
  findForbiddenField
} = require('./security');

function defaultConfigPath() {
  return path.join(
    os.homedir(),
    '.config',
    'crylo-wallet',
    'operator',
    'operator.json'
  );
}

async function loadConfig(
  configPath =
    process.env.CRYLONEXUS_OPERATOR_CONFIG ||
    defaultConfigPath()
) {
  const raw = await fs.readFile(
    configPath,
    'utf8'
  );

  const config = JSON.parse(raw);

  const forbiddenLocation =
    findForbiddenField(config);

  if (forbiddenLocation) {
    throw new Error(
      `Forbidden secret field at ${forbiddenLocation}`
    );
  }

  if (!validateConfig(config)) {
    throw new Error(
      `Invalid operator configuration: ` +
      formatValidationErrors(
        validateConfig.errors
      )
    );
  }

  const generatedAt =
    Date.parse(config.generatedAt);

  if (
    !Number.isFinite(generatedAt) ||
    generatedAt > Date.now() + 300000
  ) {
    throw new Error(
      'Configuration generatedAt is invalid or in the future'
    );
  }

  if (config.expiresAt) {
    const expiresAt =
      Date.parse(config.expiresAt);

    if (
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now()
    ) {
      throw new Error(
        'Operator configuration has expired'
      );
    }
  }

  return {
    config,
    configPath
  };
}

module.exports = {
  defaultConfigPath,
  loadConfig
};
