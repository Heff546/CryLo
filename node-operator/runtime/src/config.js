
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

function defaultOperatorDirectory() {
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA ||
        path.join(
          os.homedir(),
          'AppData',
          'Roaming'
        ),
      'crylo-wallet',
      'operator'
    );
  }

  if (process.platform === 'darwin') {
    return path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'crylo-wallet',
      'operator'
    );
  }

  return path.join(
    os.homedir(),
    '.config',
    'crylo-wallet',
    'operator'
  );
}

function defaultConfigPath() {
  return path.join(
    defaultOperatorDirectory(),
    'operator.json'
  );
}

function requireAbsoluteNormalizedPath(
  value,
  fieldName
) {
  if (
    typeof value !== 'string' ||
    value.trim() === ''
  ) {
    throw new Error(
      `${fieldName} must be a non-empty path`
    );
  }

  if (!path.isAbsolute(value)) {
    throw new Error(
      `${fieldName} must be an absolute path`
    );
  }

  const resolved = path.resolve(value);

  if (resolved !== value) {
    throw new Error(
      `${fieldName} must be normalized`
    );
  }

  return resolved;
}

function validateServicePaths(
  config,
  operatorDirectory =
    defaultOperatorDirectory()
) {
  if (
    !config ||
    typeof config !== 'object' ||
    Array.isArray(config)
  ) {
    throw new TypeError(
      'Operator configuration must be an object'
    );
  }

  const service = config.service;

  if (
    !service ||
    typeof service !== 'object' ||
    Array.isArray(service)
  ) {
    throw new Error(
      'Operator configuration service section is required'
    );
  }

  const root =
    requireAbsoluteNormalizedPath(
      path.resolve(operatorDirectory),
      'Operator directory'
    );

  const expected = {
    statusPath:
      path.join(root, 'status.json'),
    dataDirectory:
      path.join(root, 'data'),
    logDirectory:
      path.join(root, 'logs')
  };

  for (const [
    fieldName,
    expectedPath
  ] of Object.entries(expected)) {
    const actualPath =
      requireAbsoluteNormalizedPath(
        service[fieldName],
        `service.${fieldName}`
      );

    if (actualPath !== expectedPath) {
      throw new Error(
        `service.${fieldName} must equal ${expectedPath}`
      );
    }
  }

  if (
    path.extname(service.statusPath) !==
    '.json'
  ) {
    throw new Error(
      'service.statusPath must be a JSON file path'
    );
  }

  if (
    service.dataDirectory ===
      service.logDirectory ||
    service.dataDirectory ===
      service.statusPath ||
    service.logDirectory ===
      service.statusPath
  ) {
    throw new Error(
      'Operator service paths must be distinct'
    );
  }

  return Object.freeze({
    operatorDirectory: root,
    statusPath: expected.statusPath,
    dataDirectory: expected.dataDirectory,
    logDirectory: expected.logDirectory
  });
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

  validateServicePaths(config);

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
  defaultOperatorDirectory,
  defaultConfigPath,
  requireAbsoluteNormalizedPath,
  validateServicePaths,
  loadConfig
};
