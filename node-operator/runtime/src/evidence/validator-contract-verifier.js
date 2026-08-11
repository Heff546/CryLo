'use strict';

const {
  AUTHORIZATION_AWAITING_CONTRACT_VERIFICATION
} = require(
  './validator-reward-authorization-state'
);

const {
  evaluateValidatorContractVerification
} = require(
  './validator-contract-verification'
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

function createValidatorContractVerifier(
  options
) {
  requirePlainObject(
    options,
    'Validator contract verifier options'
  );

  const readNode =
    requireFunction(
      options.readNode,
      'Validator contract verifier readNode'
    );

  const verificationState =
    requirePlainObject(
      options.verificationState,
      'Validator contract verification state'
    );

  const recordVerification =
    requireFunction(
      verificationState.recordVerification,
      'Validator contract verification recordVerification'
    );

  async function verifyAuthorization(
    authorization
  ) {
    requirePlainObject(
      authorization,
      'Validator reward authorization'
    );

    if (
      authorization.authorizationStatus !==
      AUTHORIZATION_AWAITING_CONTRACT_VERIFICATION
    ) {
      throw new Error(
        'Validator reward authorization is not awaiting contract verification'
      );
    }

    const observedOperatorAddress =
      authorization.observedOperatorAddress;

    if (
      typeof observedOperatorAddress !== 'string' ||
      observedOperatorAddress.trim() === ''
    ) {
      throw new TypeError(
        'Validator reward authorization observed Operator address is required'
      );
    }

    if (
      typeof authorization.observedNodeId !== 'string' ||
      authorization.observedNodeId.trim() === ''
    ) {
      throw new TypeError(
        'Validator reward authorization observed node ID is required'
      );
    }

    /*
     * Important:
     * Any provider/RPC/contract read failure escapes here.
     * No verification state is written, so the authorization
     * remains retryable.
     */
    const node =
      await readNode(
        observedOperatorAddress
      );

    const verification =
      evaluateValidatorContractVerification(
        node
      );

    const record =
      await recordVerification(
        authorization,
        verification
      );

    return Object.freeze({
      node,
      verification,
      record
    });
  }

  return Object.freeze({
    verifyAuthorization
  });
}

module.exports = Object.freeze({
  createValidatorContractVerifier
});
