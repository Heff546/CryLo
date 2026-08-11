'use strict';

const http = require('node:http');

const {
  createHttpJsonServer
} = require('./http-json-server');

const DEFAULT_HOST =
  '127.0.0.1';

const DEFAULT_PORT =
  0;

const DEFAULT_ROUTE =
  '/v1/validator/reward-approvals';

const DEFAULT_SEND_TIMEOUT_MS =
  10_000;

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

function requirePort(
  value,
  name
) {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 65535
  ) {
    throw new TypeError(
      `${name} must be an integer from 0 through 65535`
    );
  }

  return value;
}

function requirePositiveInteger(
  value,
  name
) {
  if (
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    throw new TypeError(
      `${name} must be a positive safe integer`
    );
  }

  return value;
}

function validateEnvelope(
  body
) {
  requirePlainObject(
    body,
    'Validator reward approval transport envelope'
  );

  const keys =
    Object.keys(body)
      .sort();

  if (
    keys.length !== 2 ||
    keys[0] !== 'approval' ||
    keys[1] !== 'authorization'
  ) {
    throw new Error(
      'Validator reward approval transport envelope must contain exactly authorization and approval'
    );
  }

  requirePlainObject(
    body.authorization,
    'Validator reward approval transport authorization'
  );

  requirePlainObject(
    body.approval,
    'Validator reward approval transport approval'
  );

  return Object.freeze({
    authorization:
      body.authorization,

    approval:
      body.approval
  });
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

async function close(
  server
) {
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

function createValidatorRewardApprovalTransport(
  options
) {
  requirePlainObject(
    options,
    'Validator reward approval transport options'
  );

  const handleValidatorRewardApproval =
    requireFunction(
      options.handleValidatorRewardApproval,
      'Validator reward approval transport handler'
    );

  const host =
    options.host === undefined
      ? DEFAULT_HOST
      : requireNonEmptyString(
          options.host,
          'Validator reward approval transport host'
        );

  const port =
    requirePort(
      options.port === undefined
        ? DEFAULT_PORT
        : options.port,
      'Validator reward approval transport port'
    );

  const route =
    options.route === undefined
      ? DEFAULT_ROUTE
      : requireNonEmptyString(
          options.route,
          'Validator reward approval transport route'
        );

  const server =
    createHttpJsonServer({
      route,

      async handler(
        body
      ) {
        const envelope =
          validateEnvelope(
            body
          );

        /*
         * Deliberately do not forward a peer-controlled
         * clock. The receiving Validator evaluates
         * authorization expiry using its own local time.
         */
        return await handleValidatorRewardApproval({
          authorization:
            envelope.authorization,

          approval:
            envelope.approval
        });
      },

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
        'Validator reward approval transport is already started'
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
        'Validator reward approval transport did not receive a listening address'
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

async function sendValidatorRewardApproval(
  options
) {
  requirePlainObject(
    options,
    'Validator reward approval sender options'
  );

  const host =
    requireNonEmptyString(
      options.host,
      'Validator reward approval destination host'
    );

  const port =
    requirePort(
      options.port,
      'Validator reward approval destination port'
    );

  const route =
    options.route === undefined
      ? DEFAULT_ROUTE
      : requireNonEmptyString(
          options.route,
          'Validator reward approval destination route'
        );

  const timeoutMs =
    requirePositiveInteger(
      options.timeoutMs === undefined
        ? DEFAULT_SEND_TIMEOUT_MS
        : options.timeoutMs,
      'Validator reward approval sender timeoutMs'
    );

  const envelope =
    validateEnvelope({
      authorization:
        options.authorization,

      approval:
        options.approval
    });

  const payload =
    Buffer.from(
      JSON.stringify(
        envelope
      ),
      'utf8'
    );

  return await new Promise(
    (resolve, reject) => {
      const request =
        http.request(
          {
            host,
            port,

            method:
              'POST',

            path:
              route,

            headers: {
              'content-type':
                'application/json',

              'content-length':
                String(
                  payload.length
                )
            }
          },

          response => {
            const chunks = [];

            response.on(
              'data',
              chunk => {
                chunks.push(
                  chunk
                );
              }
            );

            response.on(
              'end',
              () => {
                const raw =
                  Buffer.concat(
                    chunks
                  ).toString(
                    'utf8'
                  );

                let body =
                  null;

                if (raw) {
                  try {
                    body =
                      JSON.parse(raw);
                  } catch (error) {
                    reject(
                      new Error(
                        'Validator reward approval peer returned invalid JSON',
                        {
                          cause:
                            error
                        }
                      )
                    );

                    return;
                  }
                }

                if (
                  response.statusCode !==
                  200 ||
                  body?.ok !== true
                ) {
                  const error =
                    new Error(
                      'Validator reward approval peer rejected request'
                    );

                  error.code =
                    'VALIDATOR_APPROVAL_REJECTED';

                  error.statusCode =
                    response.statusCode;

                  reject(error);
                  return;
                }

                resolve(
                  Object.freeze({
                    accepted:
                      true,

                    result:
                      body.result
                  })
                );
              }
            );
          }
        );

      request.setTimeout(
        timeoutMs,
        () => {
          request.destroy(
            new Error(
              'Validator reward approval request timed out'
            )
          );
        }
      );

      request.on(
        'error',
        reject
      );

      request.end(
        payload
      );
    }
  );
}

module.exports = Object.freeze({
  DEFAULT_HOST,
  DEFAULT_PORT,
  DEFAULT_ROUTE,
  DEFAULT_SEND_TIMEOUT_MS,
  createValidatorRewardApprovalTransport,
  sendValidatorRewardApproval
});
