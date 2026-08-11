'use strict';

const {
  AUTHORIZATION_AWAITING_CONTRACT_VERIFICATION
} = require(
  './validator-reward-authorization-state'
);

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

function createValidatorContractVerificationProcessor(
  options
) {
  requirePlainObject(
    options,
    'Validator contract verification processor options'
  );

  const authorizationState =
    requirePlainObject(
      options.authorizationState,
      'Validator reward authorization state'
    );

  const verificationState =
    requirePlainObject(
      options.verificationState,
      'Validator contract verification state'
    );

  const verifier =
    requirePlainObject(
      options.verifier,
      'Validator contract verifier'
    );

  const getRecords =
    requireFunction(
      authorizationState.getRecords,
      'Validator authorization getRecords'
    );

  const getVerification =
    requireFunction(
      verificationState.getVerification,
      'Validator contract verification getVerification'
    );

  const verifyAuthorization =
    requireFunction(
      verifier.verifyAuthorization,
      'Validator contract verifier verifyAuthorization'
    );

  async function processPending() {
    const authorizations =
      getRecords();

    if (!Array.isArray(authorizations)) {
      throw new TypeError(
        'Validator authorization getRecords must return an array'
      );
    }

    let awaitingCount = 0;
    let verifiedCount = 0;
    let rejectedCount = 0;
    let existingCount = 0;
    let retryableErrorCount = 0;
    let ignoredCount = 0;

    const retryableErrors = [];

    for (const authorization of authorizations) {
      if (
        authorization.authorizationStatus !==
        AUTHORIZATION_AWAITING_CONTRACT_VERIFICATION
      ) {
        ignoredCount += 1;
        continue;
      }

      awaitingCount += 1;

      const existing =
        getVerification(
          authorization.authorizationId
        );

      if (existing) {
        existingCount += 1;
        continue;
      }

      try {
        const result =
          await verifyAuthorization(
            authorization
          );

        if (
          result.verification.verified === true
        ) {
          verifiedCount += 1;
        } else {
          rejectedCount += 1;
        }
      } catch (error) {
        retryableErrorCount += 1;

        retryableErrors.push(
          Object.freeze({
            authorizationId:
              authorization.authorizationId,

            error:
              error instanceof Error
                ? error.message
                : String(error)
          })
        );
      }
    }

    return Object.freeze({
      authorizationCount:
        authorizations.length,

      awaitingCount,
      verifiedCount,
      rejectedCount,
      existingCount,
      retryableErrorCount,
      ignoredCount,

      retryableErrors:
        Object.freeze(
          retryableErrors
        )
    });
  }

  return Object.freeze({
    processPending
  });
}

module.exports = Object.freeze({
  createValidatorContractVerificationProcessor
});
