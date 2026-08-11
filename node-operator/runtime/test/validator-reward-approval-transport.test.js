'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const http = require('node:http');

const {
  createValidatorRewardApprovalTransport,
  sendValidatorRewardApproval
} = require(
  '../src/transport/validator-reward-approval-transport'
);

function envelope() {
  return {
    authorization: {
      version: 1
    },

    approval: {
      approvalHash:
        '0x' + '11'.repeat(32)
    }
  };
}

async function postJson(
  port,
  body,
  route =
    '/v1/validator/reward-approvals'
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
                chunks.push(chunk);
              }
            );

            response.on(
              'end',
              () => {
                resolve({
                  statusCode:
                    response.statusCode,

                  body:
                    JSON.parse(
                      Buffer.concat(
                        chunks
                      ).toString(
                        'utf8'
                      )
                    )
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
  'starts on loopback and accepts Validator reward approval',
  async () => {
    let received =
      null;

    const transport =
      createValidatorRewardApprovalTransport({
        async handleValidatorRewardApproval(
          value
        ) {
          received =
            value;

          return {
            accepted:
              true,

            quorumStatus:
              'PENDING'
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
        '/v1/validator/reward-approvals'
      );

      const value =
        envelope();

      const response =
        await postJson(
          listening.port,
          value
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
        value
      );
    } finally {
      await transport.stop();
    }
  }
);

test(
  'outbound sender delivers exact approval envelope',
  async () => {
    let received =
      null;

    const transport =
      createValidatorRewardApprovalTransport({
        async handleValidatorRewardApproval(
          value
        ) {
          received =
            value;

          return {
            accepted:
              true
          };
        }
      });

    try {
      const listening =
        await transport.start();

      const value =
        envelope();

      const result =
        await sendValidatorRewardApproval({
          host:
            '127.0.0.1',

          port:
            listening.port,

          authorization:
            value.authorization,

          approval:
            value.approval
        });

      assert.equal(
        result.accepted,
        true
      );

      assert.deepEqual(
        received,
        value
      );
    } finally {
      await transport.stop();
    }
  }
);

test(
  'remote peer cannot inject nowMs',
  async () => {
    let called =
      false;

    const transport =
      createValidatorRewardApprovalTransport({
        async handleValidatorRewardApproval() {
          called =
            true;

          return {
            accepted: true
          };
        }
      });

    try {
      const listening =
        await transport.start();

      const response =
        await postJson(
          listening.port,
          {
            ...envelope(),

            nowMs:
              1
          }
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
        called,
        false
      );
    } finally {
      await transport.stop();
    }
  }
);

test(
  'rejects wrong route',
  async () => {
    const transport =
      createValidatorRewardApprovalTransport({
        async handleValidatorRewardApproval() {
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
          envelope(),
          '/v1/validator/reports'
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
  'returns opaque rejection for invalid approval',
  async () => {
    const transport =
      createValidatorRewardApprovalTransport({
        async handleValidatorRewardApproval() {
          throw new Error(
            'APPROVING_VALIDATOR_STAKE_INSUFFICIENT'
          );
        }
      });

    try {
      const listening =
        await transport.start();

      const response =
        await postJson(
          listening.port,
          envelope()
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
          'STAKE_INSUFFICIENT'
        ),
        false
      );
    } finally {
      await transport.stop();
    }
  }
);

test(
  'outbound sender surfaces peer rejection',
  async () => {
    const transport =
      createValidatorRewardApprovalTransport({
        async handleValidatorRewardApproval() {
          throw new Error(
            'approval rejected'
          );
        }
      });

    try {
      const listening =
        await transport.start();

      const value =
        envelope();

      await assert.rejects(
        sendValidatorRewardApproval({
          host:
            '127.0.0.1',

          port:
            listening.port,

          authorization:
            value.authorization,

          approval:
            value.approval
        }),
        error =>
          error.code ===
          'VALIDATOR_APPROVAL_REJECTED'
      );
    } finally {
      await transport.stop();
    }
  }
);

test(
  'reports lifecycle status and rejects duplicate start',
  async () => {
    const transport =
      createValidatorRewardApprovalTransport({
        async handleValidatorRewardApproval() {
          return {
            accepted: true
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

    await assert.rejects(
      transport.start(),
      /already started/
    );

    await transport.stop();

    assert.equal(
      transport.status().started,
      false
    );

    await transport.stop();
  }
);

test(
  'rejects malformed transport dependencies',
  () => {
    assert.throws(
      () =>
        createValidatorRewardApprovalTransport(
          null
        ),
      /plain object/
    );

    assert.throws(
      () =>
        createValidatorRewardApprovalTransport({
          handleValidatorRewardApproval:
            null
        }),
      /must be a function/
    );
  }
);
