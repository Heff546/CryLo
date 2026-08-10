'use strict';

const {
  createHttpJsonServer
} = require('./http-json-server');

const {
  createOperatorEvidenceHandler
} = require('./operator-evidence-handler');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 0;

function requirePlainObject(value, name) {
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

function requireNonEmptyString(value, name) {
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
      'Transport port must be an integer from 0 through 65535'
    );
  }

  return value;
}

async function listen(server, host, port) {
  await new Promise(
    (resolve, reject) => {
      const onError = error => {
        server.off(
          'listening',
          onListening
        );

        reject(error);
      };

      const onListening = () => {
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
      server.close(error => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    }
  );
}

async function createOperatorTransportRuntime(
  options
) {
  requirePlainObject(
    options,
    'Operator transport runtime options'
  );

  const host =
    options.host === undefined
      ? DEFAULT_HOST
      : requireNonEmptyString(
          options.host,
          'Operator transport host'
        );

  const port =
    requirePort(
      options.port === undefined
        ? DEFAULT_PORT
        : options.port
    );

  const evidenceHandler =
    createOperatorEvidenceHandler({
      observationWorker:
        options.observationWorker,

      ...(options.onObservation === undefined
        ? {}
        : {
            onObservation:
              options.onObservation
          })
    });

  const server =
    createHttpJsonServer({
      route:
        '/v1/operator/evidence',

      handler:
        evidenceHandler
          .handleOperatorEvidence,

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

  let started = false;

  async function start() {
    if (started) {
      throw new Error(
        'Operator transport runtime is already started'
      );
    }

    await listen(
      server,
      host,
      port
    );

    started = true;

    const address =
      server.address();

    if (
      !address ||
      typeof address !== 'object'
    ) {
      throw new Error(
        'Operator transport runtime did not receive a listening address'
      );
    }

    return Object.freeze({
      host,
      port:
        address.port,
      route:
        '/v1/operator/evidence'
    });
  }

  async function stop() {
    if (!started) {
      return;
    }

    await close(server);

    started = false;
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
      route:
        '/v1/operator/evidence'
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
  createOperatorTransportRuntime
});
