'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  canonicalHash,
  isCanonicalHash
} = require('./hashing');

const {
  writeJsonAtomic
} = require('../atomic-file');

const DELIVERY_PENDING =
  'PENDING';

const DELIVERY_DELIVERED =
  'DELIVERED';

const SCHEMA_VERSION =
  1;

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

function requireNonEmptyString(
  value,
  name
) {
  if (
    typeof value !== 'string' ||
    value.trim() === ''
  ) {
    throw new TypeError(
      `${name} must be a non-empty string`
    );
  }

  return value;
}

function requirePort(
  value,
  name
) {
  if (
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > 65535
  ) {
    throw new TypeError(
      `${name} must be an integer from 1 through 65535`
    );
  }

  return value;
}

function requireCanonicalTimestamp(
  value,
  name
) {
  requireNonEmptyString(
    value,
    name
  );

  const time =
    Date.parse(value);

  if (
    !Number.isFinite(time) ||
    new Date(time).toISOString() !==
      value
  ) {
    throw new TypeError(
      `${name} must be a canonical ISO timestamp`
    );
  }

  return value;
}

function defaultStatePath() {
  return path.join(
    os.homedir(),
    '.config',
    'crylo-wallet',
    'operator',
    'validator-reward-approval-deliveries.json'
  );
}

function deliveryIdFor({
  approvalHash,
  destinationHost,
  destinationPort,
  destinationRoute
}) {
  return canonicalHash({
    approvalHash,
    destinationHost,
    destinationPort,
    destinationRoute
  });
}

function normalizeRecord(
  record,
  expectedKey = null
) {
  requirePlainObject(
    record,
    'Validator reward approval delivery record'
  );

  if (
    !isCanonicalHash(
      record.approvalHash
    )
  ) {
    throw new TypeError(
      'Validator reward approval delivery approvalHash must be canonical'
    );
  }

  requireNonEmptyString(
    record.destinationHost,
    'Validator reward approval delivery destinationHost'
  );

  requirePort(
    record.destinationPort,
    'Validator reward approval delivery destinationPort'
  );

  requireNonEmptyString(
    record.destinationRoute,
    'Validator reward approval delivery destinationRoute'
  );

  requirePlainObject(
    record.authorization,
    'Validator reward approval delivery authorization'
  );

  requirePlainObject(
    record.approval,
    'Validator reward approval delivery approval'
  );

  if (
    record.approval.approvalHash !==
      record.approvalHash
  ) {
    throw new Error(
      'Validator reward approval delivery approval hash mismatch'
    );
  }

  if (
    record.status !==
      DELIVERY_PENDING &&
    record.status !==
      DELIVERY_DELIVERED
  ) {
    throw new Error(
      'Validator reward approval delivery status is invalid'
    );
  }

  if (
    !Number.isSafeInteger(
      record.attemptCount
    ) ||
    record.attemptCount < 0
  ) {
    throw new TypeError(
      'Validator reward approval delivery attemptCount must be a non-negative safe integer'
    );
  }

  requireCanonicalTimestamp(
    record.createdAt,
    'Validator reward approval delivery createdAt'
  );

  if (
    record.lastAttemptAt !== null
  ) {
    requireCanonicalTimestamp(
      record.lastAttemptAt,
      'Validator reward approval delivery lastAttemptAt'
    );
  }

  if (
    record.deliveredAt !== null
  ) {
    requireCanonicalTimestamp(
      record.deliveredAt,
      'Validator reward approval delivery deliveredAt'
    );
  }

  if (
    record.status ===
      DELIVERY_PENDING &&
    record.deliveredAt !== null
  ) {
    throw new Error(
      'Pending Validator reward approval delivery cannot have deliveredAt'
    );
  }

  if (
    record.status ===
      DELIVERY_DELIVERED &&
    record.deliveredAt === null
  ) {
    throw new Error(
      'Delivered Validator reward approval delivery requires deliveredAt'
    );
  }

  const expectedId =
    deliveryIdFor(record);

  if (
    !isCanonicalHash(
      record.deliveryId
    ) ||
    record.deliveryId !==
      expectedId
  ) {
    throw new Error(
      'Validator reward approval delivery ID mismatch'
    );
  }

  if (
    expectedKey !== null &&
    expectedKey !==
      record.deliveryId
  ) {
    throw new Error(
      'Validator reward approval delivery key mismatch'
    );
  }

  return Object.freeze({
    ...record
  });
}

async function readState(
  statePath
) {
  try {
    const raw =
      await fs.readFile(
        statePath,
        'utf8'
      );

    const parsed =
      JSON.parse(raw);

    requirePlainObject(
      parsed,
      'Validator reward approval delivery state'
    );

    if (
      parsed.schemaVersion !==
      SCHEMA_VERSION
    ) {
      throw new Error(
        'Unsupported Validator reward approval delivery state schema'
      );
    }

    requirePlainObject(
      parsed.deliveries,
      'Validator reward approval deliveries'
    );

    const deliveries = {};

    for (
      const [
        key,
        record
      ] of Object.entries(
        parsed.deliveries
      )
    ) {
      deliveries[key] =
        normalizeRecord(
          record,
          key
        );
    }

    return deliveries;
  } catch (error) {
    if (
      error &&
      error.code ===
        'ENOENT'
    ) {
      return {};
    }

    throw error;
  }
}

async function createValidatorRewardApprovalDeliveryState(
  options = {}
) {
  requirePlainObject(
    options,
    'Validator reward approval delivery state options'
  );

  const statePath =
    options.statePath === undefined
      ? defaultStatePath()
      : requireNonEmptyString(
          options.statePath,
          'Validator reward approval delivery statePath'
        );

  const deliveries =
    await readState(
      statePath
    );

  async function persist() {
    await writeJsonAtomic(
      statePath,
      {
        schemaVersion:
          SCHEMA_VERSION,

        deliveries
      }
    );
  }

  function getDelivery(
    deliveryId
  ) {
    return deliveries[
      deliveryId
    ] || null;
  }

  function listDeliveries() {
    return Object.freeze(
      Object.values(
        deliveries
      )
    );
  }

  function listPending() {
    return Object.freeze(
      Object.values(
        deliveries
      ).filter(
        record =>
          record.status ===
          DELIVERY_PENDING
      )
    );
  }

  async function enqueue({
    authorization,
    approval,
    destinationHost,
    destinationPort,
    destinationRoute =
      '/v1/validator/reward-approvals',
    createdAt =
      new Date().toISOString()
  }) {
    requirePlainObject(
      authorization,
      'Validator reward approval delivery authorization'
    );

    requirePlainObject(
      approval,
      'Validator reward approval delivery approval'
    );

    if (
      !isCanonicalHash(
        approval.approvalHash
      )
    ) {
      throw new TypeError(
        'Validator reward approval delivery approvalHash must be canonical'
      );
    }

    requireNonEmptyString(
      destinationHost,
      'Validator reward approval delivery destinationHost'
    );

    requirePort(
      destinationPort,
      'Validator reward approval delivery destinationPort'
    );

    requireNonEmptyString(
      destinationRoute,
      'Validator reward approval delivery destinationRoute'
    );

    requireCanonicalTimestamp(
      createdAt,
      'Validator reward approval delivery createdAt'
    );

    const deliveryId =
      deliveryIdFor({
        approvalHash:
          approval.approvalHash,

        destinationHost,
        destinationPort,
        destinationRoute
      });

    const existing =
      deliveries[
        deliveryId
      ];

    if (existing) {
      return Object.freeze({
        changed:
          false,

        record:
          existing
      });
    }

    const record =
      normalizeRecord({
        deliveryId,

        approvalHash:
          approval.approvalHash,

        destinationHost,
        destinationPort,
        destinationRoute,

        authorization,
        approval,

        status:
          DELIVERY_PENDING,

        attemptCount:
          0,

        createdAt,

        lastAttemptAt:
          null,

        deliveredAt:
          null
      });

    deliveries[
      deliveryId
    ] =
      record;

    await persist();

    return Object.freeze({
      changed:
        true,

      record
    });
  }

  async function recordAttempt(
    deliveryId,
    attemptedAt =
      new Date().toISOString()
  ) {
    requireCanonicalTimestamp(
      attemptedAt,
      'Validator reward approval delivery attemptedAt'
    );

    const existing =
      deliveries[
        deliveryId
      ];

    if (!existing) {
      throw new Error(
        'Validator reward approval delivery does not exist'
      );
    }

    if (
      existing.status ===
      DELIVERY_DELIVERED
    ) {
      return existing;
    }

    const updated =
      normalizeRecord({
        ...existing,

        attemptCount:
          existing.attemptCount + 1,

        lastAttemptAt:
          attemptedAt
      });

    deliveries[
      deliveryId
    ] =
      updated;

    await persist();

    return updated;
  }

  async function markDelivered(
    deliveryId,
    deliveredAt =
      new Date().toISOString()
  ) {
    requireCanonicalTimestamp(
      deliveredAt,
      'Validator reward approval delivery deliveredAt'
    );

    const existing =
      deliveries[
        deliveryId
      ];

    if (!existing) {
      throw new Error(
        'Validator reward approval delivery does not exist'
      );
    }

    if (
      existing.status ===
      DELIVERY_DELIVERED
    ) {
      return existing;
    }

    const updated =
      normalizeRecord({
        ...existing,

        status:
          DELIVERY_DELIVERED,

        deliveredAt
      });

    deliveries[
      deliveryId
    ] =
      updated;

    await persist();

    return updated;
  }

  return Object.freeze({
    statePath,
    getDelivery,
    listDeliveries,
    listPending,
    enqueue,
    recordAttempt,
    markDelivered
  });
}

module.exports = Object.freeze({
  DELIVERY_PENDING,
  DELIVERY_DELIVERED,
  createValidatorRewardApprovalDeliveryState
});
