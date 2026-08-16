
const fs = require('node:fs/promises');
const path = require('node:path');

const {
  Wallet
} = require('ethers');

const {
  buildSignedValidatorRewardApproval
} = require(
  './signed-validator-reward-approval'
);

const {
  loadValidatorRewardApprovalAuthorization
} = require(
  './validator-reward-approval-authorization'
);

const {
  createValidatorRewardApprovalDeliveryState
} = require(
  './validator-reward-approval-delivery-state'
);

const {
  createValidatorRewardApprovalDeliveryProcessor
} = require(
  './validator-reward-approval-delivery-processor'
);

const {
  sendValidatorRewardApproval
} = require(
  '../transport/validator-reward-approval-transport'
);

const FORBIDDEN_PERMISSION_MASK =
  0o077;

const DEFAULT_ROUTE =
  '/v1/validator/reward-approvals';

const DEFAULT_RETRY_MS =
  30_000;

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

function requiredString(
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

  return value.trim();
}

function parsePort(
  value
) {
  const port =
    Number.parseInt(
      requiredString(
        value,
        'CRYLONEXUS_REWARD_SUBMIT_PORT'
      ),
      10
    );

  if (
    !Number.isSafeInteger(port) ||
    port <= 0 ||
    port > 65535
  ) {
    throw new TypeError(
      'CRYLONEXUS_REWARD_SUBMIT_PORT must be an integer from 1 through 65535'
    );
  }

  return port;
}

function parseRetryMs(
  value
) {
  if (
    value === undefined ||
    value === ''
  ) {
    return DEFAULT_RETRY_MS;
  }

  const retryMs =
    Number.parseInt(
      value,
      10
    );

  if (
    !Number.isSafeInteger(retryMs) ||
    retryMs < 5000
  ) {
    throw new TypeError(
      'CRYLONEXUS_REWARD_VOTE_RETRY_MS must be at least 5000'
    );
  }

  return retryMs;
}

async function loadSessionPrivateKey(
  keyPath
) {
  const resolved =
    path.resolve(
      requiredString(
        keyPath,
        'CRYLONEXUS_VALIDATOR_SESSION_KEY_FILE'
      )
    );

  const stat =
    await fs.stat(resolved);

  if (!stat.isFile()) {
    throw new Error(
      'Validator session key path is not a regular file'
    );
  }

  if (
    process.platform !== 'win32' &&
    stat.mode &
      FORBIDDEN_PERMISSION_MASK
  ) {
    throw new Error(
      'Validator session key permissions must be 600 or stricter'
    );
  }

  if (
    typeof process.getuid ===
      'function' &&
    stat.uid !==
      process.getuid()
  ) {
    throw new Error(
      'Validator session key must be owned by the service user'
    );
  }

  const privateKey =
    (
      await fs.readFile(
        resolved,
        'utf8'
      )
    ).trim();

  const wallet =
    new Wallet(privateKey);

  return Object.freeze({
    keyPath:
      resolved,

    privateKey,

    sessionAddress:
      wallet.address
  });
}

function deterministicApprovalIssuedAt(
  decision,
  authorization
) {
  const windowEnd =
    Date.parse(
      decision.windowEndedAt
    );

  const delegationStart =
    Date.parse(
      authorization.issuedAt
    );

  if (
    !Number.isFinite(windowEnd) ||
    !Number.isFinite(delegationStart)
  ) {
    throw new Error(
      'Reward decision or delegation timestamp is invalid'
    );
  }

  return new Date(
    Math.max(
      windowEnd,
      delegationStart
    )
  ).toISOString();
}

async function createValidatorRewardApprovalRuntime(
  options
) {
  requirePlainObject(
    options,
    'Validator reward approval runtime options'
  );

  const env =
    options.env ||
    process.env;

  const configuredValues = [
    env
      .CRYLONEXUS_VALIDATOR_REWARD_APPROVAL_AUTHORIZATION_FILE,
    env
      .CRYLONEXUS_VALIDATOR_SESSION_KEY_FILE,
    env
      .CRYLONEXUS_REWARD_SUBMIT_HOST,
    env
      .CRYLONEXUS_REWARD_SUBMIT_PORT
  ];

  const configuredCount =
    configuredValues.filter(
      value =>
        typeof value === 'string' &&
        value.trim() !== ''
    ).length;

  /*
   * Entire feature is optional until all required
   * Validator signing/delivery configuration exists.
   */
  if (configuredCount === 0) {
    return null;
  }

  if (
    configuredCount !==
    configuredValues.length
  ) {
    throw new Error(
      'Validator reward approval runtime requires authorization file, session key file, submit host, and submit port together'
    );
  }

  const validatorAddress =
    requiredString(
      options.validatorAddress,
      'Validator address'
    );

  const validatorNodeId =
    requiredString(
      options.validatorNodeId,
      'Validator node ID'
    );

  const dataDirectory =
    path.resolve(
      requiredString(
        options.dataDirectory,
        'Validator data directory'
      )
    );

  const session =
    await loadSessionPrivateKey(
      env
        .CRYLONEXUS_VALIDATOR_SESSION_KEY_FILE
    );

  const authorization =
    await loadValidatorRewardApprovalAuthorization({
      authorizationPath:
        env
          .CRYLONEXUS_VALIDATOR_REWARD_APPROVAL_AUTHORIZATION_FILE,

      expectedValidatorAddress:
        validatorAddress,

      expectedValidatorNodeId:
        validatorNodeId,

      expectedSessionAddress:
        session.sessionAddress,

      ...(options.nowMs === undefined
        ? {}
        : {
            nowMs:
              options.nowMs
          })
    });

  const destinationHost =
    requiredString(
      env
        .CRYLONEXUS_REWARD_SUBMIT_HOST,
      'CRYLONEXUS_REWARD_SUBMIT_HOST'
    );

  const destinationPort =
    parsePort(
      env
        .CRYLONEXUS_REWARD_SUBMIT_PORT
    );

  const destinationRoute =
    (
      env
        .CRYLONEXUS_REWARD_SUBMIT_ROUTE ||
      DEFAULT_ROUTE
    ).trim();

  const retryMs =
    parseRetryMs(
      env
        .CRYLONEXUS_REWARD_VOTE_RETRY_MS
    );

  const deliveryState =
    await createValidatorRewardApprovalDeliveryState({
      statePath:
        path.join(
          dataDirectory,
          'verification',
          'validator-reward-approval-deliveries.json'
        )
    });

  const processor =
    createValidatorRewardApprovalDeliveryProcessor({
      deliveryState,

      sendApproval:
        options.sendApproval ||
        sendValidatorRewardApproval
    });

  async function enqueueDecision(
    decision
  ) {
    requirePlainObject(
      decision,
      'Validator reward eligibility decision'
    );

    const issuedAt =
      deterministicApprovalIssuedAt(
        decision,
        authorization
      );

    if (
      Date.parse(issuedAt) >=
      Date.parse(
        authorization.expiresAt
      )
    ) {
      throw new Error(
        'Validator reward approval authorization does not cover reward decision'
      );
    }

    const approval =
      buildSignedValidatorRewardApproval({
        decision,

        approvingValidatorAddress:
          validatorAddress,

        approvingValidatorNodeId:
          validatorNodeId,

        approvingSessionAddress:
          session.sessionAddress,

        finalizationContract:
          authorization
            .finalizationContract,

        issuedAt,

        privateKey:
          session.privateKey
      });

    return await deliveryState
      .enqueue({
        authorization:
          authorization
            .authorization,

        approval,

        destinationHost,
        destinationPort,
        destinationRoute
      });
  }

  async function enqueueDecisions(
    decisions
  ) {
    if (!Array.isArray(decisions)) {
      throw new TypeError(
        'Validator reward eligibility decisions must be an array'
      );
    }

    let createdCount = 0;
    let existingCount = 0;

    for (const decision of decisions) {
      const result =
        await enqueueDecision(
          decision
        );

      if (result.changed) {
        createdCount += 1;
      } else {
        existingCount += 1;
      }
    }

    return Object.freeze({
      decisionCount:
        decisions.length,

      createdCount,
      existingCount
    });
  }

  let timer =
    null;

  async function processPending() {
    return await processor
      .processPending();
  }

  function start() {
    if (timer !== null) {
      return;
    }

    timer =
      setInterval(
        () => {
          processPending()
            .catch(
              () => {
                /*
                 * Durable state intentionally remains
                 * pending. The operator logger records
                 * the synchronous calls made by main.js;
                 * later retries are non-destructive.
                 */
              }
            );
        },
        retryMs
      );
  }

  function stop() {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  return Object.freeze({
    authorizationPath:
      authorization
        .authorizationPath,

    sessionKeyPath:
      session.keyPath,

    sessionAddress:
      session.sessionAddress,

    finalizationContract:
      authorization
        .finalizationContract,

    deliveryStatePath:
      deliveryState.statePath,

    destinationHost,
    destinationPort,
    destinationRoute,
    retryMs,

    enqueueDecision,
    enqueueDecisions,
    processPending,
    start,
    stop
  });
}

module.exports = Object.freeze({
  DEFAULT_ROUTE,
  DEFAULT_RETRY_MS,
  deterministicApprovalIssuedAt,
  createValidatorRewardApprovalRuntime
});
