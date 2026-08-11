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

function createValidatorRewardApprovalDeliveryProcessor(
  options
) {
  requirePlainObject(
    options,
    'Validator reward approval delivery processor options'
  );

  const deliveryState =
    requirePlainObject(
      options.deliveryState,
      'Validator reward approval delivery state'
    );

  const sendApproval =
    requireFunction(
      options.sendApproval,
      'Validator reward approval delivery sendApproval'
    );

  const listPending =
    requireFunction(
      deliveryState.listPending,
      'Validator reward approval delivery listPending'
    );

  const recordAttempt =
    requireFunction(
      deliveryState.recordAttempt,
      'Validator reward approval delivery recordAttempt'
    );

  const markDelivered =
    requireFunction(
      deliveryState.markDelivered,
      'Validator reward approval delivery markDelivered'
    );

  async function processPending() {
    const pending =
      listPending();

    if (!Array.isArray(pending)) {
      throw new TypeError(
        'Validator reward approval delivery listPending must return an array'
      );
    }

    let attemptedCount = 0;
    let deliveredCount = 0;
    let retryableErrorCount = 0;

    const retryableErrors = [];

    for (const record of pending) {
      attemptedCount += 1;

      await recordAttempt(
        record.deliveryId
      );

      try {
        await sendApproval({
          host:
            record.destinationHost,

          port:
            record.destinationPort,

          route:
            record.destinationRoute,

          authorization:
            record.authorization,

          approval:
            record.approval
        });

        await markDelivered(
          record.deliveryId
        );

        deliveredCount += 1;
      } catch (error) {
        retryableErrorCount += 1;

        retryableErrors.push(
          Object.freeze({
            deliveryId:
              record.deliveryId,

            error:
              error instanceof Error
                ? error.message
                : String(error)
          })
        );
      }
    }

    return Object.freeze({
      pendingCount:
        pending.length,

      attemptedCount,
      deliveredCount,
      retryableErrorCount,

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
  createValidatorRewardApprovalDeliveryProcessor
});
