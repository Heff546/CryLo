'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  createHttpJsonServer
} = require(
  '../src/transport/http-json-server'
);

async function startServer(
  options = {}
) {
  const server =
    createHttpJsonServer({
      route:
        '/v1/operator/evidence',

      handler:
        async body => ({
          received: body
        }),

      ...options
    });

  await new Promise(
    (resolve, reject) => {
      server.once(
        'error',
        reject
      );

      server.listen(
        0,
        '127.0.0.1',
        resolve
      );
    }
  );

  const address =
    server.address();

  return {
    server,
    port:
      address.port
  };
}

async function stopServer(server) {
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

async function request({
  port,
  method = 'POST',
  path =
    '/v1/operator/evidence',
  headers = {},
  body = null
}) {
  return await new Promise(
    (resolve, reject) => {
      const req =
        http.request(
          {
            host:
              '127.0.0.1',
            port,
            method,
            path,
            headers
          },
          response => {
            const chunks = [];

            response.on(
              'data',
              chunk => {
                chunks.push(chunk);
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

                resolve({
                  statusCode:
                    response.statusCode,
                  headers:
                    response.headers,
                  raw,
                  json:
                    raw
                      ? JSON.parse(raw)
                      : null
                });
              }
            );
          }
        );

      req.on(
        'error',
        reject
      );

      if (body !== null) {
        req.write(body);
      }

      req.end();
    }
  );
}

test(
  'accepts valid JSON POST on exact route',
  async () => {
    const {
      server,
      port
    } =
      await startServer();

    try {
      const payload = {
        heartbeat: {},
        authorization: {},
        status: {}
      };

      const response =
        await request({
          port,
          headers: {
            'content-type':
              'application/json'
          },
          body:
            JSON.stringify(
              payload
            )
        });

      assert.equal(
        response.statusCode,
        200
      );

      assert.equal(
        response.json.ok,
        true
      );

      assert.deepEqual(
        response.json.result
          .received,
        payload
      );

      assert.equal(
        response.headers[
          'cache-control'
        ],
        'no-store'
      );
    } finally {
      await stopServer(
        server
      );
    }
  }
);

test(
  'rejects unknown route',
  async () => {
    const {
      server,
      port
    } =
      await startServer();

    try {
      const response =
        await request({
          port,
          path:
            '/v1/unknown',
          headers: {
            'content-type':
              'application/json'
          },
          body: '{}'
        });

      assert.equal(
        response.statusCode,
        404
      );

      assert.equal(
        response.json.error,
        'NOT_FOUND'
      );
    } finally {
      await stopServer(
        server
      );
    }
  }
);

test(
  'rejects non-POST method',
  async () => {
    const {
      server,
      port
    } =
      await startServer();

    try {
      const response =
        await request({
          port,
          method: 'GET'
        });

      assert.equal(
        response.statusCode,
        405
      );

      assert.equal(
        response.json.error,
        'METHOD_NOT_ALLOWED'
      );

      assert.equal(
        response.headers.allow,
        'POST'
      );
    } finally {
      await stopServer(
        server
      );
    }
  }
);

test(
  'rejects non-JSON content type',
  async () => {
    const {
      server,
      port
    } =
      await startServer();

    try {
      const response =
        await request({
          port,
          headers: {
            'content-type':
              'text/plain'
          },
          body: '{}'
        });

      assert.equal(
        response.statusCode,
        415
      );

      assert.equal(
        response.json.error,
        'UNSUPPORTED_MEDIA_TYPE'
      );
    } finally {
      await stopServer(
        server
      );
    }
  }
);

test(
  'rejects malformed JSON',
  async () => {
    const {
      server,
      port
    } =
      await startServer();

    try {
      const response =
        await request({
          port,
          headers: {
            'content-type':
              'application/json'
          },
          body:
            '{"broken":'
        });

      assert.equal(
        response.statusCode,
        400
      );

      assert.equal(
        response.json.error,
        'INVALID_JSON'
      );
    } finally {
      await stopServer(
        server
      );
    }
  }
);

test(
  'rejects empty request body',
  async () => {
    const {
      server,
      port
    } =
      await startServer();

    try {
      const response =
        await request({
          port,
          headers: {
            'content-type':
              'application/json'
          }
        });

      assert.equal(
        response.statusCode,
        400
      );

      assert.equal(
        response.json.error,
        'EMPTY_BODY'
      );
    } finally {
      await stopServer(
        server
      );
    }
  }
);

test(
  'rejects non-object JSON body',
  async () => {
    const {
      server,
      port
    } =
      await startServer();

    try {
      const response =
        await request({
          port,
          headers: {
            'content-type':
              'application/json'
          },
          body:
            '[]'
        });

      assert.equal(
        response.statusCode,
        422
      );

      assert.equal(
        response.json.error,
        'EVIDENCE_REJECTED'
      );
    } finally {
      await stopServer(
        server
      );
    }
  }
);

test(
  'rejects request body over configured limit',
  async () => {
    const {
      server,
      port
    } =
      await startServer({
        maxBodyBytes:
          32
      });

    try {
      const response =
        await request({
          port,
          headers: {
            'content-type':
              'application/json'
          },
          body:
            JSON.stringify({
              value:
                'x'.repeat(128)
            })
        });

      assert.equal(
        response.statusCode,
        413
      );

      assert.equal(
        response.json.error,
        'BODY_TOO_LARGE'
      );
    } finally {
      await stopServer(
        server
      );
    }
  }
);

test(
  'returns opaque rejection for handler validation failure',
  async () => {
    const {
      server,
      port
    } =
      await startServer({
        handler:
          async () => {
            throw new Error(
              'Observed heartbeat sequence replay detected'
            );
          }
      });

    try {
      const response =
        await request({
          port,
          headers: {
            'content-type':
              'application/json'
          },
          body: '{}'
        });

      assert.equal(
        response.statusCode,
        422
      );

      assert.equal(
        response.json.error,
        'EVIDENCE_REJECTED'
      );

      assert.equal(
        response.raw.includes(
          'sequence replay'
        ),
        false
      );
    } finally {
      await stopServer(
        server
      );
    }
  }
);
