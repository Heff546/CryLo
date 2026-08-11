'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AUTHORIZATION_AWAITING_CONTRACT_VERIFICATION,
  AUTHORIZATION_DENIED_BY_CONSENSUS
} = require(
  '../src/evidence/validator-reward-authorization-state'
);

const {
  createValidatorContractVerificationProcessor
} = require(
  '../src/evidence/validator-contract-verification-processor'
);

function authorization({
  id,
  status =
    AUTHORIZATION_AWAITING_CONTRACT_VERIFICATION
}) {
  return {
    authorizationId:
      id,

    authorizationStatus:
      status
  };
}

function makeProcessor({
  authorizations = [],
  existing = new Map(),
  verifyAuthorization
}) {
  return createValidatorContractVerificationProcessor({
    authorizationState: {
      getRecords() {
        return authorizations;
      }
    },

    verificationState: {
      getVerification(
        authorizationId
      ) {
        return (
          existing.get(
            authorizationId
          ) || null
        );
      }
    },

    verifier: {
      verifyAuthorization
    }
  });
}

test(
  'processes awaiting authorization',
  async () => {
    const auth =
      authorization({
        id:
          'auth-1'
      });

    const processor =
      makeProcessor({
        authorizations:
          [auth],

        async verifyAuthorization(
          value
        ) {
          assert.equal(
            value,
            auth
          );

          return {
            verification: {
              verified:
                true
            }
          };
        }
      });

    const result =
      await processor
        .processPending();

    assert.equal(
      result.awaitingCount,
      1
    );

    assert.equal(
      result.verifiedCount,
      1
    );

    assert.equal(
      result.retryableErrorCount,
      0
    );
  }
);

test(
  'counts persistent rejection separately',
  async () => {
    const processor =
      makeProcessor({
        authorizations: [
          authorization({
            id:
              'auth-1'
          })
        ],

        async verifyAuthorization() {
          return {
            verification: {
              verified:
                false
            }
          };
        }
      });

    const result =
      await processor
        .processPending();

    assert.equal(
      result.rejectedCount,
      1
    );

    assert.equal(
      result.verifiedCount,
      0
    );
  }
);

test(
  'RPC failure remains retryable and does not stop other records',
  async () => {
    const first =
      authorization({
        id:
          'auth-1'
      });

    const second =
      authorization({
        id:
          'auth-2'
      });

    const processor =
      makeProcessor({
        authorizations: [
          first,
          second
        ],

        async verifyAuthorization(
          value
        ) {
          if (
            value.authorizationId ===
            first.authorizationId
          ) {
            throw new Error(
              'RPC unavailable'
            );
          }

          return {
            verification: {
              verified:
                true
            }
          };
        }
      });

    const result =
      await processor
        .processPending();

    assert.equal(
      result.retryableErrorCount,
      1
    );

    assert.equal(
      result.verifiedCount,
      1
    );

    assert.equal(
      result.retryableErrors[0]
        .authorizationId,
      'auth-1'
    );

    assert.match(
      result.retryableErrors[0]
        .error,
      /RPC unavailable/
    );
  }
);

test(
  'skips authorization already contract verified',
  async () => {
    let calls = 0;

    const existing =
      new Map([
        [
          'auth-1',
          {
            verificationId:
              'verification-1'
          }
        ]
      ]);

    const processor =
      makeProcessor({
        authorizations: [
          authorization({
            id:
              'auth-1'
          })
        ],

        existing,

        async verifyAuthorization() {
          calls += 1;

          return {
            verification: {
              verified:
                true
            }
          };
        }
      });

    const result =
      await processor
        .processPending();

    assert.equal(
      calls,
      0
    );

    assert.equal(
      result.existingCount,
      1
    );
  }
);

test(
  'ignores authorization denied by consensus',
  async () => {
    let calls = 0;

    const processor =
      makeProcessor({
        authorizations: [
          authorization({
            id:
              'auth-1',

            status:
              AUTHORIZATION_DENIED_BY_CONSENSUS
          })
        ],

        async verifyAuthorization() {
          calls += 1;
        }
      });

    const result =
      await processor
        .processPending();

    assert.equal(
      calls,
      0
    );

    assert.equal(
      result.awaitingCount,
      0
    );

    assert.equal(
      result.ignoredCount,
      1
    );
  }
);

test(
  'processes multiple pending records independently',
  async () => {
    const authorizations = [
      authorization({
        id:
          'auth-1'
      }),

      authorization({
        id:
          'auth-2'
      }),

      authorization({
        id:
          'auth-3'
      })
    ];

    const processor =
      makeProcessor({
        authorizations,

        async verifyAuthorization(
          value
        ) {
          return {
            verification: {
              verified:
                value.authorizationId !==
                'auth-3'
            }
          };
        }
      });

    const result =
      await processor
        .processPending();

    assert.equal(
      result.awaitingCount,
      3
    );

    assert.equal(
      result.verifiedCount,
      2
    );

    assert.equal(
      result.rejectedCount,
      1
    );
  }
);

test(
  'rejects malformed processor dependencies',
  () => {
    assert.throws(
      () =>
        createValidatorContractVerificationProcessor(
          null
        ),
      /must be a plain object/
    );

    assert.throws(
      () =>
        createValidatorContractVerificationProcessor({
          authorizationState: {
            getRecords:
              'invalid'
          },

          verificationState: {
            getVerification() {}
          },

          verifier: {
            verifyAuthorization() {}
          }
        }),
      /must be a function/
    );
  }
);
