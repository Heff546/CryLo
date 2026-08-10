'use strict';

const http = require('node:http');

const DEFAULT_MAX_BODY_BYTES = 256 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

function requirePlainObject(value, name) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(
      `${name} must be a plain object`
    );
  }

  return value;
}

function writeJson(
  response,
  statusCode,
  body
) {
  const payload =
    Buffer.from(
      JSON.stringify(body),
      'utf8'
    );

  response.writeHead(
    statusCode,
    {
      'content-type':
        'application/json; charset=utf-8',
      'content-length':
        String(payload.length),
      'cache-control':
        'no-store'
    }
  );

  response.end(payload);
}

function contentTypeIsJson(request) {
  const value =
    request.headers['content-type'];

  if (typeof value !== 'string') {
    return false;
  }

  return (
    value
      .split(';', 1)[0]
      .trim()
      .toLowerCase() ===
    'application/json'
  );
}

async function readJsonBody(
  request,
  maxBodyBytes
) {
  const chunks = [];
  let received = 0;

  for await (const chunk of request) {
    received += chunk.length;

    if (received > maxBodyBytes) {
      const error =
        new Error(
          'Request body exceeds maximum size'
        );

      error.code = 'BODY_TOO_LARGE';
      throw error;
    }

    chunks.push(chunk);
  }

  if (received === 0) {
    const error =
      new Error('Request body is required');

    error.code = 'EMPTY_BODY';
    throw error;
  }

  let parsed;

  try {
    parsed =
      JSON.parse(
        Buffer.concat(chunks)
          .toString('utf8')
      );
  } catch {
    const error =
      new Error('Request body is not valid JSON');

    error.code = 'INVALID_JSON';
    throw error;
  }

  return requirePlainObject(
    parsed,
    'Request body'
  );
}

function createHttpJsonServer(options) {
  requirePlainObject(
    options,
    'HTTP JSON server options'
  );

  if (typeof options.handler !== 'function') {
    throw new TypeError(
      'HTTP JSON server handler must be a function'
    );
  }

  const route =
    options.route || '/v1/operator/evidence';

  if (
    typeof route !== 'string' ||
    !route.startsWith('/')
  ) {
    throw new TypeError(
      'HTTP JSON server route must be an absolute path'
    );
  }

  const maxBodyBytes =
    options.maxBodyBytes === undefined
      ? DEFAULT_MAX_BODY_BYTES
      : options.maxBodyBytes;

  if (
    !Number.isSafeInteger(maxBodyBytes) ||
    maxBodyBytes <= 0
  ) {
    throw new TypeError(
      'HTTP JSON server maxBodyBytes must be a positive safe integer'
    );
  }

  const requestTimeoutMs =
    options.requestTimeoutMs === undefined
      ? DEFAULT_REQUEST_TIMEOUT_MS
      : options.requestTimeoutMs;

  if (
    !Number.isSafeInteger(
      requestTimeoutMs
    ) ||
    requestTimeoutMs <= 0
  ) {
    throw new TypeError(
      'HTTP JSON server requestTimeoutMs must be a positive safe integer'
    );
  }

  const server =
    http.createServer(
      async (request, response) => {
        try {
          const url =
            new URL(
              request.url || '/',
              'http://localhost'
            );

          if (url.pathname !== route) {
            writeJson(
              response,
              404,
              {
                ok: false,
                error: 'NOT_FOUND'
              }
            );

            return;
          }

          if (request.method !== 'POST') {
            response.setHeader(
              'allow',
              'POST'
            );

            writeJson(
              response,
              405,
              {
                ok: false,
                error: 'METHOD_NOT_ALLOWED'
              }
            );

            return;
          }

          if (!contentTypeIsJson(request)) {
            writeJson(
              response,
              415,
              {
                ok: false,
                error:
                  'UNSUPPORTED_MEDIA_TYPE'
              }
            );

            return;
          }

          const body =
            await readJsonBody(
              request,
              maxBodyBytes
            );

          const result =
            await options.handler(body);

          writeJson(
            response,
            200,
            {
              ok: true,
              result
            }
          );
        } catch (error) {
          if (
            error &&
            error.code ===
              'BODY_TOO_LARGE'
          ) {
            writeJson(
              response,
              413,
              {
                ok: false,
                error: 'BODY_TOO_LARGE'
              }
            );

            return;
          }

          if (
            error &&
            (
              error.code ===
                'INVALID_JSON' ||
              error.code ===
                'EMPTY_BODY'
            )
          ) {
            writeJson(
              response,
              400,
              {
                ok: false,
                error: error.code
              }
            );

            return;
          }

          /*
           * Evidence-validation failures are deliberately
           * opaque to remote peers. Detailed validation
           * errors must remain local.
           */
          writeJson(
            response,
            422,
            {
              ok: false,
              error:
                'EVIDENCE_REJECTED'
            }
          );
        }
      }
    );

  server.requestTimeout =
    requestTimeoutMs;

  server.headersTimeout =
    requestTimeoutMs;

  return server;
}

module.exports = Object.freeze({
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_REQUEST_TIMEOUT_MS,
  createHttpJsonServer
});
