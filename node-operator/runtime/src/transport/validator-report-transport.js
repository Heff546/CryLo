'use strict';

const {
  createHttpJsonServer
} = require('./http-json-server');

const DEFAULT_HOST =
  '127.0.0.1';

const DEFAULT_PORT =
  0;

const DEFAULT_ROUTE =
  '/v1/validator/reports';

function requirePlainObject(
  value,
  name
) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !==
      Object.prototype
  ) {
    throw new TypeError(
      `${name} must be a plain object`
    );
  }

  return value;
}

function requireFunction(
  value,
  name
) {
  if (typeof value !== 'function') {
    throw new TypeError(
      `${name} must be a function`
    );
  }

  return value;
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

function requirePort(value) {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 65535
  ) {
    throw new TypeError(
      'Validator report transport port must be an integer from 0 through 65535'
    );
  }

  return value;
}

async function listen(
  server,
  host,
  port
) {
  await new Promise(
    (resolve, reject) => {
      const onError =
        error => {
          server.off(
            'listening',
            onListening
          );

          reject(error);
        };

      const onListening =
        () => {
          server.off(
            'error',
            onError
          );

          resolve();
        };

      server.once(
        'error',
        onError
      );

      server.once(
        'listening',
        onListening
      );

      server.listen(
        port,
        host
      );
    }
  );
}

async function close(server) {
  if (!server.listening) {
    return;
  }

  await new Promise(
    (resolve, reject) => {
      server.close(
        error => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        }
      );
    }
  );
}

function createValidatorReportTransport(
  options
) {
  requirePlainObject(
    options,
    'Validator report transport options'
  );

  const handleValidatorUptimeReport =
    requireFunction(
      options.handleValidatorUptimeReport,
      'Validator uptime report handler'
    );

  const host =
    options.host === undefined
      ? DEFAULT_HOST
      : requireNonEmptyString(
          options.host,
          'Validator report transport host'
        );

  const port =
    requirePort(
      options.port === undefined
        ? DEFAULT_PORT
        : options.port
    );

  const route =
    options.route === undefined
      ? DEFAULT_ROUTE
      : requireNonEmptyString(
          options.route,
          'Validator report transport route'
        );

  const server =
    createHttpJsonServer({
      route,

      handler:
        handleValidatorUptimeReport,

      ...(options.maxBodyBytes === undefined
        ? {}
        : {
            maxBodyBytes:
              options.maxBodyBytes
          }),

      ...(options.requestTimeoutMs === undefined
        ? {}
        : {
            requestTimeoutMs:
              options.requestTimeoutMs
          })
    });

  let started =
    false;

  async function start() {
    if (started) {
      throw new Error(
        'Validator report transport is already started'
      );
    }

    await listen(
      server,
      host,
      port
    );

    started =
      true;

    const address =
      server.address();

    if (
      !address ||
      typeof address !== 'object'
    ) {
      throw new Error(
        'Validator report transport did not receive a listening address'
      );
    }

    return Object.freeze({
      host,
      port:
        address.port,
      route
    });
  }

  async function stop() {
    if (!started) {
      return;
    }

    await close(
      server
    );

    started =
      false;
  }

  function status() {
    const address =
      server.listening
        ? server.address()
        : null;

    return Object.freeze({
      started,
      host,
      configuredPort:
        port,
      port:
        address &&
        typeof address === 'object'
          ? address.port
          : null,
      route
    });
  }

  return Object.freeze({
    start,
    stop,
    status
  });
}

module.exports = Object.freeze({
  DEFAULT_HOST,
  DEFAULT_PORT,
  DEFAULT_ROUTE,
  createValidatorReportTransport
});
