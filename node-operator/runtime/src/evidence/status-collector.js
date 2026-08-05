'use strict';

function requirePlainObject(value, name) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(
      `${name} must be a plain object`
    );
  }
}

function requireBoolean(value, name) {
  if (typeof value !== 'boolean') {
    throw new TypeError(
      `${name} must be a boolean`
    );
  }

  return value;
}

function requireNonNegativeInteger(
  value,
  name
) {
  if (
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new TypeError(
      `${name} must be a non-negative safe integer`
    );
  }

  return value;
}

function requireAtomicAmount(value, name) {
  if (
    typeof value !== 'string' ||
    !/^(0|[1-9][0-9]*)$/.test(value)
  ) {
    throw new TypeError(
      `${name} must be a canonical non-negative integer string`
    );
  }

  return value;
}

function normalizeTier(value, registered) {
  if (!registered) {
    if (value !== null) {
      throw new TypeError(
        'Unregistered status tier must be null'
      );
    }

    return null;
  }

  if (
    value !== 'Operator' &&
    value !== 'Validator'
  ) {
    throw new TypeError(
      'Registered status tier must be Operator or Validator'
    );
  }

  return value;
}

function normalizeReasonCode(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0
  ) {
    throw new TypeError(
      'Status verification reasonCode must be a non-empty string'
    );
  }

  return value;
}

function deepFreeze(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.isFrozen(value)
  ) {
    return value;
  }

  for (const child of Object.values(value)) {
    deepFreeze(child);
  }

  return Object.freeze(value);
}

function collectStatusEvidence(status) {
  requirePlainObject(
    status,
    'Operator runtime status'
  );

  requirePlainObject(
    status.verification,
    'Operator runtime verification'
  );

  requirePlainObject(
    status.metrics,
    'Operator runtime metrics'
  );

  const registered =
    requireBoolean(
      status.registered,
      'Status registered'
    );

  const evidence = {
    chainId:
      requireNonNegativeInteger(
        status.chainId,
        'Status chainId'
      ),
    connected:
      requireBoolean(
        status.connected,
        'Status connected'
      ),
    rpcHealthy:
      requireBoolean(
        status.rpcHealthy,
        'Status rpcHealthy'
      ),
    walletMatched:
      requireBoolean(
        status.walletMatched,
        'Status walletMatched'
      ),
    registered,
    tier:
      normalizeTier(
        status.tier,
        registered
      ),
    uptimeSeconds:
      requireNonNegativeInteger(
        status.uptimeSeconds,
        'Status uptimeSeconds'
      ),
    rewardEligible:
      requireBoolean(
        status.rewardEligible,
        'Status rewardEligible'
      ),
    verification: {
      connected:
        requireBoolean(
          status.verification.connected,
          'Status verification connected'
        ),
      verified:
        requireBoolean(
          status.verification.verified,
          'Status verification verified'
        ),
      reasonCode:
        normalizeReasonCode(
          status.verification.reasonCode
        )
    },
    metrics: {
      pendingRewardsBaseUnits:
        requireAtomicAmount(
          status.metrics
            .pendingRewardsBaseUnits,
          'Status pendingRewardsBaseUnits'
        )
    }
  };

  if (
    evidence.rewardEligible &&
    !evidence.verification.verified
  ) {
    throw new Error(
      'Reward-eligible status must have verified uptime evidence'
    );
  }

  return deepFreeze(evidence);
}

module.exports = Object.freeze({
  collectStatusEvidence
});
