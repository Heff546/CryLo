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

function createValidatorRewardAuthorizationReconciler(
  options
) {
  requirePlainObject(
    options,
    'Validator reward authorization reconciler options'
  );

  const consensusState =
    requirePlainObject(
      options.consensusState,
      'Validator consensus state'
    );

  const authorizationState =
    requirePlainObject(
      options.authorizationState,
      'Validator reward authorization state'
    );

  const getWindows =
    requireFunction(
      consensusState.getWindows,
      'Validator consensus getWindows'
    );

  const getRecord =
    requireFunction(
      authorizationState.getRecord,
      'Validator authorization getRecord'
    );

  const recordConsensus =
    requireFunction(
      authorizationState.recordConsensus,
      'Validator authorization recordConsensus'
    );

  async function ensureAuthorization(
    consensusWindow
  ) {
    requirePlainObject(
      consensusWindow,
      'Validator consensus window'
    );

    if (
      consensusWindow.finalized !== true
    ) {
      return Object.freeze({
        changed:
          false,
        record:
          null
      });
    }

    const existing =
      getRecord(
        consensusWindow
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
      await recordConsensus(
        consensusWindow
      );

    return Object.freeze({
      changed:
        true,
      record
    });
  }

  async function reconcile() {
    const windows =
      getWindows();

    if (!Array.isArray(windows)) {
      throw new TypeError(
        'Validator consensus getWindows must return an array'
      );
    }

    let finalizedCount = 0;
    let createdCount = 0;
    let existingCount = 0;

    for (const window of windows) {
      if (window.finalized !== true) {
        continue;
      }

      finalizedCount += 1;

      const result =
        await ensureAuthorization(
          window
        );

      if (result.changed) {
        createdCount += 1;
      } else {
        existingCount += 1;
      }
    }

    return Object.freeze({
      finalizedCount,
      createdCount,
      existingCount
    });
  }

  return Object.freeze({
    ensureAuthorization,
    reconcile
  });
}

module.exports = Object.freeze({
  createValidatorRewardAuthorizationReconciler
});
