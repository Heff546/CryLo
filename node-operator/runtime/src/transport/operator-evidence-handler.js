'use strict';

function requirePlainObject(value, name) {
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

function requireExactEnvelopeFields(
  envelope
) {
  const expected =
    new Set([
      'heartbeat',
      'authorization',
      'status'
    ]);

  for (
    const field of Object.keys(envelope)
  ) {
    if (!expected.has(field)) {
      throw new Error(
        `Unexpected Operator evidence field: ${field}`
      );
    }
  }

  for (const field of expected) {
    if (
      !Object.prototype
        .hasOwnProperty.call(
          envelope,
          field
        )
    ) {
      throw new Error(
        `Missing Operator evidence field: ${field}`
      );
    }
  }
}

function createOperatorEvidenceHandler(
  options
) {
  requirePlainObject(
    options,
    'Operator evidence handler options'
  );

  const observationWorker =
    requirePlainObject(
      options.observationWorker,
      'Operator evidence observation worker'
    );

  if (
    typeof observationWorker.observe !==
    'function'
  ) {
    throw new TypeError(
      'Operator evidence observation worker must provide observe()'
    );
  }

  const onObservation =
    options.onObservation === undefined
      ? null
      : options.onObservation;

  if (
    onObservation !== null &&
    typeof onObservation !== 'function'
  ) {
    throw new TypeError(
      'Operator evidence onObservation must be a function'
    );
  }

  async function handleOperatorEvidence(
    envelope
  ) {
    requirePlainObject(
      envelope,
      'Operator evidence envelope'
    );

    requireExactEnvelopeFields(
      envelope
    );

    const heartbeat =
      requirePlainObject(
        envelope.heartbeat,
        'Operator evidence heartbeat'
      );

    const authorization =
      requirePlainObject(
        envelope.authorization,
        'Operator evidence authorization'
      );

    const status =
      requirePlainObject(
        envelope.status,
        'Operator evidence status'
      );

    const observation =
      await observationWorker.observe({
        heartbeat,
        authorization,
        status
      });

    requirePlainObject(
      observation,
      'Operator evidence observation result'
    );

    if (onObservation) {
      await onObservation(
        observation
      );
    }

    /*
     * Return only the bounded acknowledgement fields that
     * the sending peer needs. Do not return registration
     * internals or other local verification diagnostics.
     */
    return Object.freeze({
      accepted: true,
      observationHash:
        observation.observationHash ||
        null,
      observedOperatorAddress:
        observation
          .observedOperatorAddress,
      observedNodeId:
        observation.observedNodeId,
      result:
        observation.result,
      reasonCode:
        observation.reasonCode
    });
  }

  return Object.freeze({
    handleOperatorEvidence
  });
}

module.exports = Object.freeze({
  createOperatorEvidenceHandler
});
