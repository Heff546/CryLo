'use strict';

const os = require('node:os');
const path = require('node:path');

const packageJson =
  require('../package.json');

const {
  DEFAULT_INTERVAL_MS
} = require('./constants');

const {
  loadConfig
} = require('./config');

const {
  createReadOnlyContractClient
} = require('./contracts');

const {
  evaluateRegistration
} = require('./contracts/verification');

const {
  writeJsonAtomic
} = require('./atomic-file');

const {
  validateStatus,
  formatValidationErrors
} = require('./schema');

const {
  createInitialStatus,
  markWorkerSuccess,
  markWorkerFailure,
  statusMessage
} = require('./status');

const {
  log
} = require('./logger');

const {
  createLocalHeartbeatRuntime
} = require('./evidence');

const {
  createLocalQualificationTracker
} = require('./evidence/local-qualification');

let stopping = false;
let timer = null;

function nowIso() {
  return new Date().toISOString();
}

function resolveNodeId(config) {
  return (
    config.nodeIdentity?.publicId ||
    `operator-${config.operatorAddress.slice(2)}`
  );
}

function resolveElectronStatusPath() {
  return (
    process.env.CRYLONEXUS_ELECTRON_STATUS_PATH ||
    path.join(
      os.homedir(),
      '.config',
      'crylo-wallet',
      'operator',
      'status.json'
    )
  );
}

async function writeValidatedStatus(
  status,
  primaryPath,
  mirrorPath
) {
  if (!validateStatus(status)) {
    throw new Error(
      `Generated status failed schema validation: ` +
      formatValidationErrors(
        validateStatus.errors
      )
    );
  }

  await writeJsonAtomic(
    primaryPath,
    status
  );

  if (
    mirrorPath &&
    path.resolve(mirrorPath) !==
      path.resolve(primaryPath)
  ) {
    try {
      await writeJsonAtomic(
        mirrorPath,
        status
      );
    } catch (error) {
      log(
        'warn',
        'status-mirror-write-failed',
        {
          path: mirrorPath,
          error: error.message
        }
      );
    }
  }
}

async function run() {
  const {
    config,
    configPath
  } = await loadConfig();

  const startedAt = nowIso();

  const nodeId =
    resolveNodeId(config);

  const status = createInitialStatus({
    serviceVersion: packageJson.version,
    operatorAddress:
      config.operatorAddress,
    nodeId,
    startedAt
  });

  markWorkerSuccess(
    status,
    'configuration',
    startedAt,
    'CONFIG_VALID'
  );

  const primaryStatusPath =
    config.service.statusPath;

  const electronStatusPath =
    resolveElectronStatusPath();

  const linkedAddress =
    process.env.CRYLONEXUS_LINKED_ADDRESS ||
    null;

  if (linkedAddress) {
    status.walletMatched =
      linkedAddress.toLowerCase() ===
      config.operatorAddress.toLowerCase();
  } else {
    status.warnings.push(
      statusMessage(
        'WALLET_MATCH_UNAVAILABLE',
        'Linked wallet address was not supplied to the operator service.',
        startedAt
      )
    );
  }

  const intervalMs =
    Number.parseInt(
      process.env.CRYLONEXUS_CHECK_INTERVAL_MS ||
      String(DEFAULT_INTERVAL_MS),
      10
    );

  if (
    !Number.isInteger(intervalMs) ||
    intervalMs < 5000
  ) {
    throw new Error(
      'CRYLONEXUS_CHECK_INTERVAL_MS must be an integer of at least 5000'
    );
  }

  const localHeartbeatSetting =
    process.env
      .CRYLONEXUS_LOCAL_HEARTBEATS;

  if (
    localHeartbeatSetting !== undefined &&
    localHeartbeatSetting !== '' &&
    localHeartbeatSetting !== '0' &&
    localHeartbeatSetting !== '1'
  ) {
    throw new Error(
      'CRYLONEXUS_LOCAL_HEARTBEATS must be 0 or 1'
    );
  }

  let localHeartbeatRuntime = null;
  let localQualificationTracker = null;

  if (localHeartbeatSetting === '1') {
    localHeartbeatRuntime =
      await createLocalHeartbeatRuntime({
        operatorAddress:
          config.operatorAddress,
        nodeId
      });

    localQualificationTracker =
      await createLocalQualificationTracker({
        operatorAddress:
          config.operatorAddress,
        nodeId
      });

    log(
      'info',
      'local-heartbeat-runtime-enabled',
      {
        keyPath:
          localHeartbeatRuntime.keyPath,
        outputPath:
          localHeartbeatRuntime.outputPath,
        sequenceStatePath:
          localHeartbeatRuntime
            .sequenceStatePath
      }
    );
  } else {
    log(
      'info',
      'local-heartbeat-runtime-disabled'
    );
  }

  log('info', 'operator-started', {
    version: packageJson.version,
    configPath,
    operatorAddress:
      config.operatorAddress,
    tier: config.tier,
    intervalMs,
    localHeartbeatsEnabled:
      localHeartbeatRuntime !== null
  });

  let contractClient = null;

  async function heartbeat() {
    if (stopping) return;

    const timestamp = nowIso();

    status.updatedAt = timestamp;
    status.lastHeartbeatAt = timestamp;
    status.uptimeSeconds =
      Math.max(
        0,
        Math.floor(
          (
            Date.now() -
            Date.parse(startedAt)
          ) / 1000
        )
      );

    status.metrics.heartbeatCount += 1;
    status.warnings =
      status.warnings.filter(
        warning =>
          warning.code ===
          'WALLET_MATCH_UNAVAILABLE'
      );
    status.errors = [];

    let connection = null;
    let localObservationSuccessful = false;

    try {
      if (!contractClient) {
        contractClient =
          await createReadOnlyContractClient(
            config
          );

        connection =
          contractClient.initialConnection;

        log(
          'info',
          'contract-client-created',
          {
            addresses:
              contractClient.addresses
          }
        );
      } else {
        connection =
          await contractClient.verifyConnection();
      }

      status.connected = true;
      status.rpcHealthy = true;
      status.metrics.successfulChecks += 1;

      markWorkerSuccess(
        status,
        'rpc-health',
        timestamp,
        'RPC_HEALTHY'
      );

      log('info', 'rpc-check-succeeded', {
        chainId: connection.chainId,
        blockNumber:
          connection.blockNumber
      });
    } catch (error) {
      contractClient = null;

      status.connected = false;
      status.rpcHealthy = false;
      status.registered = false;
      status.tier = null;
      status.rewardEligible = false;
      status.metrics.pendingRewardsBaseUnits =
        '0';
      status.metrics.failedChecks += 1;

      status.verification = {
        connected: false,
        verified: false,
        verifiedAt: null,
        reasonCode: 'RPC_UNAVAILABLE'
      };

      markWorkerFailure(
        status,
        'rpc-health',
        timestamp,
        'RPC_CHECK_FAILED'
      );

      markWorkerFailure(
        status,
        'registration',
        timestamp,
        'RPC_UNAVAILABLE'
      );

      markWorkerFailure(
        status,
        'reward-eligibility',
        timestamp,
        'RPC_UNAVAILABLE'
      );

      status.errors.push(
        statusMessage(
          'RPC_CHECK_FAILED',
          error.message,
          timestamp
        )
      );

      log('error', 'rpc-check-failed', {
        error: error.message
      });
    }

    if (status.rpcHealthy && contractClient) {
      try {
        const snapshot =
          await contractClient.readOperator(
            config.operatorAddress
          );

        status.registered =
          snapshot.node.registered;

        status.tier =
          snapshot.node.registered
            ? snapshot.node.tierLabel
            : null;

        status.metrics.pendingRewardsBaseUnits =
          snapshot.rewards.pendingRewardsAtomic;

        const registration =
          evaluateRegistration(
            snapshot.node,
            config.tier
          );

        const registrationVerified =
          registration.verified;

        localObservationSuccessful =
          registrationVerified &&
          status.rpcHealthy === true;

        if (registrationVerified) {
          markWorkerSuccess(
            status,
            'registration',
            timestamp,
            registration.messageCode
          );
        } else {
          markWorkerFailure(
            status,
            'registration',
            timestamp,
            registration.messageCode
          );
        }

        /*
         * Contract registration is now authoritative.
         * Reward eligibility remains false until the
         * separate uptime-verification protocol exists.
         */
        status.rewardEligible = false;

        status.verification = {
          connected: true,
          verified: false,
          verifiedAt: null,
          reasonCode:
            registrationVerified
              ? 'UPTIME_VERIFICATION_PENDING'
              : snapshot.node.registered
                ? 'REGISTRATION_MISMATCH'
                : 'NOT_REGISTERED'
        };

        if (registrationVerified) {
          markWorkerSuccess(
            status,
            'reward-eligibility',
            timestamp,
            'DISTRIBUTED_VERIFICATION_PENDING'
          );

          status.warnings.push(
            statusMessage(
              'UPTIME_VERIFICATION_PENDING',
              'Contract registration is verified. Local uptime evidence is active; distributed verification and reward authorization remain pending.',
              timestamp
            )
          );
        } else {
          markWorkerFailure(
            status,
            'reward-eligibility',
            timestamp,
            snapshot.node.registered
              ? 'REGISTRATION_MISMATCH'
              : 'NOT_REGISTERED'
          );

          status.warnings.push(
            statusMessage(
              snapshot.node.registered
                ? 'REGISTRATION_MISMATCH'
                : 'NOT_REGISTERED',
              snapshot.node.registered
                ? 'On-chain registration does not match the configured tier, node-wallet membership, or required stake.'
                : 'The configured operator wallet is not registered in NodeStaking.',
              timestamp
            )
          );
        }

        log(
          'info',
          'contract-verification-succeeded',
          {
            registered:
              snapshot.node.registered,
            tier:
              snapshot.node.tierLabel,
            isNodeWallet:
              snapshot.node.isNodeWallet,
            stakeAtomic:
              snapshot.node.stakeAtomic,
            pendingRewardsAtomic:
              snapshot.rewards
                .pendingRewardsAtomic,
            registrationVerified
          }
        );
      } catch (error) {
        status.registered = false;
        status.tier = null;
        status.rewardEligible = false;
        status.metrics.pendingRewardsBaseUnits =
          '0';

        status.verification = {
          connected: true,
          verified: false,
          verifiedAt: null,
          reasonCode:
            'CONTRACT_READ_FAILED'
        };

        markWorkerFailure(
          status,
          'registration',
          timestamp,
          'CONTRACT_READ_FAILED'
        );

        markWorkerFailure(
          status,
          'reward-eligibility',
          timestamp,
          'CONTRACT_READ_FAILED'
        );

        status.errors.push(
          statusMessage(
            'CONTRACT_READ_FAILED',
            error.message,
            timestamp
          )
        );

        log(
          'error',
          'contract-verification-failed',
          {
            error: error.message
          }
        );
      }
    }

    try {
      const statusWriter =
        status.workers.find(
          worker =>
            worker.name === 'status-writer'
        );

      if (!statusWriter) {
        throw new Error(
          'Status writer worker is missing'
        );
      }

      statusWriter.healthy = true;
      statusWriter.lastRunAt = timestamp;
      statusWriter.messageCode =
        'STATUS_WRITTEN';

      await writeValidatedStatus(
        status,
        primaryStatusPath,
        electronStatusPath
      );

      statusWriter.successes += 1;
    } catch (error) {
      markWorkerFailure(
        status,
        'status-writer',
        timestamp,
        'STATUS_WRITE_FAILED'
      );

      log('error', 'status-write-failed', {
        error: error.message,
        primaryStatusPath,
        electronStatusPath
      });
    }

    if (localHeartbeatRuntime) {
      try {
        const signedHeartbeat =
          await localHeartbeatRuntime
            .writeHeartbeat(status);

        let localQualification = null;

        if (localQualificationTracker) {
          localQualification =
            await localQualificationTracker
              .recordObservation({
                issuedAt:
                  signedHeartbeat.issuedAt,
                sequence:
                  signedHeartbeat.sequence,
                successful:
                  localObservationSuccessful
              });
        }

        log(
          'info',
          'local-heartbeat-written',
          {
            outputPath:
              localHeartbeatRuntime
                .outputPath,
            sequence:
              signedHeartbeat.sequence,
            issuedAt:
              signedHeartbeat.issuedAt,
            expiresAt:
              signedHeartbeat.expiresAt,
            payloadHash:
              signedHeartbeat.payloadHash,
            localQualification:
              localQualification
                ? {
                    receivedHeartbeats:
                      localQualification.receivedHeartbeats,
                    successfulObservations:
                      localQualification.successfulObservations,
                    thresholdMet:
                      localQualification.thresholdMet,
                    windowComplete:
                      localQualification.windowComplete,
                    locallyQualified:
                      localQualification.locallyQualified,
                    reasonCode:
                      localQualification.reasonCode
                  }
                : null
          }
        );
      } catch (error) {
        log(
          'error',
          'local-heartbeat-write-failed',
          {
            error: error.message,
            outputPath:
              localHeartbeatRuntime
                .outputPath
          }
        );
      }
    }
  }

  await heartbeat();

  timer = setInterval(() => {
    heartbeat().catch(error => {
      log('error', 'heartbeat-failed', {
        error: error.message
      });
    });
  }, intervalMs);

  /*
   * Keep this timer referenced. It is the persistent lifecycle
   * handle for the operator daemon. Calling unref() here allows
   * Node.js to exit immediately after the initial heartbeat.
   */
}

async function shutdown(signal) {
  if (stopping) return;

  stopping = true;

  if (timer) {
    clearInterval(timer);
  }

  log('info', 'operator-stopping', {
    signal
  });
}

process.on('SIGTERM', () => {
  shutdown('SIGTERM')
    .finally(() => process.exit(0));
});

process.on('SIGINT', () => {
  shutdown('SIGINT')
    .finally(() => process.exit(0));
});

process.on('unhandledRejection', error => {
  log('error', 'unhandled-rejection', {
    error:
      error instanceof Error
        ? error.message
        : String(error)
  });

  process.exitCode = 1;
});

run().catch(error => {
  log('error', 'operator-start-failed', {
    error: error.message
  });

  process.exitCode = 1;
});
