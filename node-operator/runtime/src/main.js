'use strict';

const os = require('node:os');
const path = require('node:path');

const packageJson =
  require('../package.json');

const {
  CHAIN_ID,
  DEFAULT_INTERVAL_MS
} = require('./constants');

const {
  loadConfig
} = require('./config');

const {
  checkRpc
} = require('./rpc');

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

  const status = createInitialStatus({
    serviceVersion: packageJson.version,
    operatorAddress:
      config.operatorAddress,
    nodeId: resolveNodeId(config),
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

  log('info', 'operator-started', {
    version: packageJson.version,
    configPath,
    operatorAddress:
      config.operatorAddress,
    tier: config.tier,
    intervalMs
  });

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

    try {
      const rpc = await checkRpc(
        config.rpcUrl,
        CHAIN_ID
      );

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
        chainId: rpc.chainId,
        blockNumber: rpc.blockNumber
      });
    } catch (error) {
      status.connected = false;
      status.rpcHealthy = false;
      status.registered = false;
      status.tier = null;
      status.rewardEligible = false;
      status.metrics.failedChecks += 1;

      markWorkerFailure(
        status,
        'rpc-health',
        timestamp,
        'RPC_CHECK_FAILED'
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

    /*
     * Registration and rewards deliberately remain
     * unverified until the deployed contract ABI and
     * authoritative view functions are inspected.
     */
    status.registered = false;
    status.tier = null;
    status.rewardEligible = false;

    status.verification = {
      connected: status.connected,
      verified: false,
      verifiedAt: null,
      reasonCode:
        status.connected
          ? 'CONTRACT_VERIFICATION_PENDING'
          : 'RPC_UNAVAILABLE'
    };

    markWorkerFailure(
      status,
      'registration',
      timestamp,
      'CONTRACT_VERIFICATION_PENDING'
    );

    markWorkerFailure(
      status,
      'reward-eligibility',
      timestamp,
      'CONTRACT_VERIFICATION_PENDING'
    );

    status.warnings.push(
      statusMessage(
        'CONTRACT_VERIFICATION_PENDING',
        'Registration and reward eligibility are not asserted until the deployed contract ABI is connected.',
        timestamp
      )
    );

    try {
      markWorkerSuccess(
        status,
        'status-writer',
        timestamp,
        'STATUS_WRITE_PENDING'
      );

      await writeValidatedStatus(
        status,
        primaryStatusPath,
        electronStatusPath
      );

      markWorkerSuccess(
        status,
        'status-writer',
        timestamp,
        'STATUS_WRITTEN'
      );

      await writeValidatedStatus(
        status,
        primaryStatusPath,
        electronStatusPath
      );
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
  }

  await heartbeat();

  timer = setInterval(() => {
    heartbeat().catch(error => {
      log('error', 'heartbeat-failed', {
        error: error.message
      });
    });
  }, intervalMs);

  timer.unref();
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
