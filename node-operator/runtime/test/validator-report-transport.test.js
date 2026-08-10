'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  createValidatorReportTransport
} = require(
  '../src/transport/validator-report-transport'
);

async function postJson(
  port,
  body,
  path = '/v1/validator/reports'
) {
  return await new Promise(
    (resolve, reject) => {
      const payload =
        Buffer.from(
          JSON.stringify(body),
          'utf8'
        );

      const request =
        http.request(
          {
            host:
              '127.0.0.1',
            port,
            method:
              'POST',
            path,
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
                  body:
                    raw
                      ? JSON.parse(raw)
                      : null
                });
              }
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

test(
  'starts on loopback and accepts Validator reports',
  async () => {
    let received = null;

    const transport =
      createValidatorReportTransport({
        async handleValidatorUptimeReport(
          report
        ) {
          received = report;

          return {
            accepted: true,
            reportHash:
              report.reportHash
          };
        }
      });

    try {
      const listening =
        await transport.start();

      assert.equal(
        listening.host,
        '127.0.0.1'
      );

      assert.equal(
        listening.route,
        '/v1/validator/reports'
      );

      assert.equal(
        listening.port > 0,
        true
      );

      const report = {
        reportHash:
          `0x${'11'.repeat(32)}`
      };

      const response =
        await postJson(
          listening.port,
          report
        );

      assert.equal(
        response.statusCode,
        200
      );

      assert.equal(
        response.body.ok,
        true
      );

      assert.deepEqual(
        received,
        report
      );
    } finally {
      await transport.stop();
    }
  }
);

test(
  'reports lifecycle status',
  async () => {
    const transport =
      createValidatorReportTransport({
        async handleValidatorUptimeReport() {
          return {
            accepted:
              true
          };
        }
      });

    assert.equal(
      transport.status().started,
      false
    );

    const listening =
      await transport.start();

    assert.equal(
      transport.status().started,
      true
    );

    assert.equal(
      transport.status().port,
      listening.port
    );

    await transport.stop();

    assert.equal(
      transport.status().started,
      false
    );

    assert.equal(
      transport.status().port,
      null
    );
  }
);

test(
  'rejects duplicate start',
  async () => {
    const transport =
      createValidatorReportTransport({
        async handleValidatorUptimeReport() {
          return {
            accepted:
              true
          };
        }
      });

    try {
      await transport.start();

      await assert.rejects(
        transport.start(),
        /already started/
      );
    } finally {
      await transport.stop();
    }
  }
);

test(
  'stop is safe before start and after stop',
  async () => {
    const transport =
      createValidatorReportTransport({
        async handleValidatorUptimeReport() {
          return {
            accepted:
              true
          };
        }
      });

    await transport.stop();

    await transport.start();

    await transport.stop();

    await transport.stop();

    assert.equal(
      transport.status().started,
      false
    );
  }
);

test(
  'rejects wrong route',
  async () => {
    const transport =
      createValidatorReportTransport({
        async handleValidatorUptimeReport() {
          throw new Error(
            'must not run'
          );
        }
      });

    try {
      const listening =
        await transport.start();

      const response =
        await postJson(
          listening.port,
          {},
          '/v1/operator/evidence'
        );

      assert.equal(
        response.statusCode,
        404
      );

      assert.equal(
        response.body.error,
        'NOT_FOUND'
      );
    } finally {
      await transport.stop();
    }
  }
);

test(
  'returns opaque rejection for invalid report',
  async () => {
    const transport =
      createValidatorReportTransport({
        async handleValidatorUptimeReport() {
          throw new Error(
            'REPORTER_STAKE_INSUFFICIENT'
          );
        }
      });

    try {
      const listening =
        await transport.start();

      const response =
        await postJson(
          listening.port,
          {}
        );

      assert.equal(
        response.statusCode,
        422
      );

      assert.equal(
        response.body.error,
        'EVIDENCE_REJECTED'
      );

      assert.equal(
        JSON.stringify(
          response.body
        ).includes(
          'REPORTER_STAKE_INSUFFICIENT'
        ),
        false
      );
    } finally {
      await transport.stop();
    }
  }
);
