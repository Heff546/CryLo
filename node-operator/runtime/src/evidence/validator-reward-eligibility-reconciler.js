'use strict';

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

function createValidatorRewardEligibilityReconciler(
  options
) {
  requirePlainObject(
    options,
    'Validator reward eligibility reconciler options'
  );

  const verificationState =
    requirePlainObject(
      options.verificationState,
      'Validator contract verification state'
    );

  const eligibilityState =
    requirePlainObject(
      options.eligibilityState,
      'Validator reward eligibility state'
    );

  const listVerifications =
    requireFunction(
      verificationState.listVerifications,
      'Validator contract verification listVerifications'
    );

  const getDecision =
    requireFunction(
      eligibilityState.getDecision,
      'Validator reward eligibility getDecision'
    );

  const recordVerification =
    requireFunction(
      eligibilityState.recordVerification,
      'Validator reward eligibility recordVerification'
    );

  async function ensureDecision(
    verification
  ) {
    requirePlainObject(
      verification,
      'Validator contract verification record'
    );

    const existing =
      getDecision(
        verification.authorizationId
      );

    if (existing) {
      return Object.freeze({
        changed:
          false,
        record:
          existing
      });
    }

    const record =
      await recordVerification(
        verification
      );

    return Object.freeze({
      changed:
        true,
      record
    });
  }

  async function reconcile() {
    const verifications =
      listVerifications();

    if (!Array.isArray(verifications)) {
      throw new TypeError(
        'Validator contract verification listVerifications must return an array'
      );
    }

    let createdCount = 0;
    let existingCount = 0;

    for (const verification of verifications) {
      const result =
        await ensureDecision(
          verification
        );

      if (result.changed) {
        createdCount += 1;
      } else {
        existingCount += 1;
      }
    }

    return Object.freeze({
      verificationCount:
        verifications.length,
      createdCount,
      existingCount
    });
  }

  return Object.freeze({
    ensureDecision,
    reconcile
  });
}

module.exports = Object.freeze({
  createValidatorRewardEligibilityReconciler
});
