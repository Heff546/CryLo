
const path = require('node:path');

const packageJson =
  require('../package.json');

const {
  DEFAULT_INTERVAL_MS
} = require('./constants');

const {
  defaultOperatorDirectory,
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
  createLocalHeartbeatRuntime,
  createNodeObservationWorker,
  createObservationReplayState,
  createOperatorPeerTracker,
  createValidatorReportReplayState,
  createValidatorUptimeReportHandler,
  createValidatorIntakeLifecycle,
  createValidatorConsensusState,
  parseValidatorConsensusMinimumReports,
  createValidatorRewardAuthorizationState,
  createValidatorRewardAuthorizationReconciler,
  createValidatorContractVerificationState,
  createValidatorContractVerifier,
  createValidatorContractVerificationProcessor,
  createValidatorRewardEligibilityState,
  createValidatorRewardEligibilityReconciler
} = require('./evidence');

const {
  createOperatorTransportRuntime,
  createValidatorReportTransport
} = require('./transport');

const {
  createLocalQualificationTracker
} = require('./evidence/local-qualification');

const {
  createValidatorRewardApprovalRuntime
} = require(
  './evidence/validator-reward-approval-runtime'
);

let stopping = false;
let timer = null;
let operatorTransportRuntime = null;
let validatorIntakeLifecycle = null;
let validatorRewardApprovalRuntime = null;

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
      defaultOperatorDirectory(),
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

  const distributedTransportSetting =
    process.env
      .CRYLONEXUS_DISTRIBUTED_TRANSPORT;

  if (
    distributedTransportSetting !== undefined &&
    distributedTransportSetting !== '' &&
    distributedTransportSetting !== '0' &&
    distributedTransportSetting !== '1'
  ) {
    throw new Error(
      'CRYLONEXUS_DISTRIBUTED_TRANSPORT must be 0 or 1'
    );
  }

  if (
    distributedTransportSetting === '1' &&
    localHeartbeatSetting !== '1'
  ) {
    throw new Error(
      'Distributed transport requires CRYLONEXUS_LOCAL_HEARTBEATS=1'
    );
  }

  if (
    config.tier === 'Validator' &&
    localHeartbeatSetting === '1'
  ) {
    throw new Error(
      'CRYLONEXUS_LOCAL_HEARTBEATS is Operator-only'
    );
  }

  if (
    config.tier === 'Validator' &&
    distributedTransportSetting === '1'
  ) {
    throw new Error(
      'CRYLONEXUS_DISTRIBUTED_TRANSPORT is Operator-only'
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
      localHeartbeatRuntime !== null,
    distributedTransportEnabled:
      distributedTransportSetting === '1'
  });

  let contractClient = null;

  const validatorMinimumReports =
    config.tier === 'Validator'
      ? parseValidatorConsensusMinimumReports(
          process.env
            .CRYLONEXUS_VALIDATOR_MINIMUM_REPORTS
        )
      : null;

  if (config.tier === 'Validator') {
    const validatorVerificationDirectory =
      path.join(
        config.service.dataDirectory,
        'verification'
      );

    validatorIntakeLifecycle =
      createValidatorIntakeLifecycle({
        async createRuntime() {
          const replayState =
            await createValidatorReportReplayState({
              statePath:
                path.join(
                  validatorVerificationDirectory,
                  'validator-report-replay-state.json'
                )
            });

          const consensusState =
            await createValidatorConsensusState({
              minimumReports:
                validatorMinimumReports,
              statePath:
                path.join(
                  validatorVerificationDirectory,
                  'validator-consensus-state.json'
                )
            });

          const rewardAuthorizationState =
            await createValidatorRewardAuthorizationState({
              statePath:
                path.join(
                  validatorVerificationDirectory,
                  'validator-reward-authorization-state.json'
                )
            });

          const rewardAuthorizationReconciler =
            createValidatorRewardAuthorizationReconciler({
              consensusState,
              authorizationState:
                rewardAuthorizationState
            });

          const reconciliation =
            await rewardAuthorizationReconciler
              .reconcile();

          log(
            'info',
            'validator-reward-authorization-reconciled',
            {
              finalizedCount:
                reconciliation.finalizedCount,
              createdCount:
                reconciliation.createdCount,
              existingCount:
                reconciliation.existingCount
            }
          );

          const contractVerificationState =
            await createValidatorContractVerificationState({
              statePath:
                path.join(
                  validatorVerificationDirectory,
                  'validator-contract-verification-state.json'
                )
            });

          const rewardEligibilityState =
            await createValidatorRewardEligibilityState({
              statePath:
                path.join(
                  validatorVerificationDirectory,
                  'validator-reward-eligibility-state.json'
                )
            });

          const rewardEligibilityReconciler =
            createValidatorRewardEligibilityReconciler({
              verificationState:
                contractVerificationState,
              eligibilityState:
                rewardEligibilityState
            });

          const contractVerifier =
            createValidatorContractVerifier({
              async readNode(
                walletAddress
              ) {
                if (!contractClient) {
                  contractClient =
                    await createReadOnlyContractClient(
                      config
                    );
                } else {
                  await contractClient
                    .verifyConnection();
                }

                return contractClient.readNode(
                  walletAddress
                );
              },

              verificationState:
                contractVerificationState
            });

          const contractVerificationProcessor =
            createValidatorContractVerificationProcessor({
              authorizationState:
                rewardAuthorizationState,
              verificationState:
                contractVerificationState,
              verifier:
                contractVerifier
            });

          const initialContractVerification =
            await contractVerificationProcessor
              .processPending();

          const initialRewardEligibility =
            await rewardEligibilityReconciler
              .reconcile();

          if (validatorRewardApprovalRuntime) {
            validatorRewardApprovalRuntime
              .stop();

            validatorRewardApprovalRuntime =
              null;
          }

          validatorRewardApprovalRuntime =
            await createValidatorRewardApprovalRuntime({
              validatorAddress:
                config.operatorAddress,

              validatorNodeId:
                nodeId,

              dataDirectory:
                config.service.dataDirectory
            });

          if (validatorRewardApprovalRuntime) {
            const startupApprovalQueue =
              await validatorRewardApprovalRuntime
                .enqueueDecisions(
                  rewardEligibilityState
                    .listDecisions()
                );

            const startupApprovalDelivery =
              await validatorRewardApprovalRuntime
                .processPending();

            validatorRewardApprovalRuntime
              .start();

            log(
              'info',
              'validator-reward-approval-runtime-enabled',
              {
                finalizationContract:
                  validatorRewardApprovalRuntime
                    .finalizationContract,

                sessionAddress:
                  validatorRewardApprovalRuntime
                    .sessionAddress,

                deliveryStatePath:
                  validatorRewardApprovalRuntime
                    .deliveryStatePath,

                destinationHost:
                  validatorRewardApprovalRuntime
                    .destinationHost,

                destinationPort:
                  validatorRewardApprovalRuntime
                    .destinationPort,

                destinationRoute:
                  validatorRewardApprovalRuntime
                    .destinationRoute,

                queuedCreatedCount:
                  startupApprovalQueue
                    .createdCount,

                queuedExistingCount:
                  startupApprovalQueue
                    .existingCount,

                deliveredCount:
                  startupApprovalDelivery
                    .deliveredCount,

                retryableErrorCount:
                  startupApprovalDelivery
                    .retryableErrorCount
              }
            );
          } else {
            log(
              'info',
              'validator-reward-approval-runtime-disabled'
            );
          }

          log(
            'info',
            'validator-reward-eligibility-reconciled',
            {
              phase:
                'startup',
              verificationCount:
                initialRewardEligibility
                  .verificationCount,
              createdCount:
                initialRewardEligibility
                  .createdCount,
              existingCount:
                initialRewardEligibility
                  .existingCount
            }
          );

          log(
            'info',
            'validator-contract-verification-processed',
            {
              phase:
                'startup',
              authorizationCount:
                initialContractVerification
                  .authorizationCount,
              awaitingCount:
                initialContractVerification
                  .awaitingCount,
              verifiedCount:
                initialContractVerification
                  .verifiedCount,
              rejectedCount:
                initialContractVerification
                  .rejectedCount,
              existingCount:
                initialContractVerification
                  .existingCount,
              retryableErrorCount:
                initialContractVerification
                  .retryableErrorCount,
              ignoredCount:
                initialContractVerification
                  .ignoredCount
            }
          );

          const reportHandler =
            createValidatorUptimeReportHandler({
              async readNode(
                walletAddress
              ) {
                if (!contractClient) {
                  contractClient =
                    await createReadOnlyContractClient(
                      config
                    );
                } else {
                  await contractClient
                    .verifyConnection();
                }

                return contractClient.readNode(
                  walletAddress
                );
              },

              replayState,

              async onAcceptedReport({
                accepted,
                reporterNode
              }) {
                const consensus =
                  await consensusState
                    .acceptReport(
                      accepted
                    );

                const authorization =
                  await rewardAuthorizationReconciler
                    .ensureAuthorization(
                      consensus
                    );

                const contractVerification =
                  await contractVerificationProcessor
                    .processPending();

                const rewardEligibility =
                  await rewardEligibilityReconciler
                    .reconcile();

                let rewardApprovalDelivery =
                  null;

                if (
                  validatorRewardApprovalRuntime
                ) {
                  const queuedApprovals =
                    await validatorRewardApprovalRuntime
                      .enqueueDecisions(
                        rewardEligibilityState
                          .listDecisions()
                      );

                  const deliveredApprovals =
                    await validatorRewardApprovalRuntime
                      .processPending();

                  rewardApprovalDelivery = {
                    queuedCreatedCount:
                      queuedApprovals
                        .createdCount,

                    queuedExistingCount:
                      queuedApprovals
                        .existingCount,

                    deliveredCount:
                      deliveredApprovals
                        .deliveredCount,

                    retryableErrorCount:
                      deliveredApprovals
                        .retryableErrorCount
                  };
                }

                log(
                  'info',
                  'validator-report-accepted',
                  {
                    reportHash:
                      accepted.reportHash,
                    reportingOperatorAddress:
                      accepted
                        .reportingOperatorAddress,
                    reportingNodeId:
                      accepted
                        .reportingNodeId,
                    observedOperatorAddress:
                      accepted
                        .observedOperatorAddress,
                    observedNodeId:
                      accepted
                        .observedNodeId,
                    windowStartedAt:
                      accepted
                        .windowStartedAt,
                    windowEndedAt:
                      accepted
                        .windowEndedAt,
                    locallyQualified:
                      accepted
                        .locallyQualified,
                    reporterStakeAtomic:
                      reporterNode
                        .stakeAtomic,
                    consensus:
                      consensus.consensus,
                    consensusFinalized:
                      consensus.finalized,
                    consensusReportCount:
                      consensus.reportCount,
                    consensusQualifiedCount:
                      consensus.qualifiedCount,
                    consensusUnqualifiedCount:
                      consensus.unqualifiedCount,
                    rewardAuthorizationChanged:
                      authorization.changed,
                    rewardAuthorizationId:
                      authorization.record
                        ? authorization.record
                            .authorizationId
                        : null,
                    rewardAuthorizationStatus:
                      authorization.record
                        ? authorization.record
                            .authorizationStatus
                        : null,
                    contractVerifiedCount:
                      contractVerification
                        .verifiedCount,
                    contractRejectedCount:
                      contractVerification
                        .rejectedCount,
                    contractRetryableErrorCount:
                      contractVerification
                        .retryableErrorCount,
                    rewardEligibilityCreatedCount:
                      rewardEligibility
                        .createdCount,
                    rewardEligibilityExistingCount:
                      rewardEligibility
                        .existingCount,

                    rewardApprovalDelivery
                  }
                );
              }
            });

          return createValidatorReportTransport({
            host:
              '127.0.0.1',
            port:
              0,
            handleValidatorUptimeReport:
              reportHandler
                .handleValidatorUptimeReport
          });
        }
      });

    log(
      'info',
      'validator-intake-configured',
      {
        operatorAddress:
          config.operatorAddress,
        replayStatePath:
          path.join(
            validatorVerificationDirectory,
            'validator-report-replay-state.json'
          ),
        consensusStatePath:
          path.join(
            validatorVerificationDirectory,
            'validator-consensus-state.json'
          ),
        rewardAuthorizationStatePath:
          path.join(
            validatorVerificationDirectory,
            'validator-reward-authorization-state.json'
          ),
        contractVerificationStatePath:
          path.join(
            validatorVerificationDirectory,
            'validator-contract-verification-state.json'
          ),
        rewardEligibilityStatePath:
          path.join(
            validatorVerificationDirectory,
            'validator-reward-eligibility-state.json'
          ),
        minimumReports:
          validatorMinimumReports
      }
    );
  }

  if (distributedTransportSetting === '1') {
    const verificationDirectory =
      path.join(
        config.service.dataDirectory,
        'verification'
      );

    const replayState =
      await createObservationReplayState({
        statePath:
          path.join(
            verificationDirectory,
            'observation-replay-state.json'
          )
      });

    const observationWorker =
      createNodeObservationWorker({
        localOperatorAddress:
          config.operatorAddress,
        localNodeId:
          nodeId,
        replayState,

        async readRemoteNodeStatus(
          walletAddress
        ) {
          if (!contractClient) {
            contractClient =
              await createReadOnlyContractClient(
                config
              );
          } else {
            await contractClient
              .verifyConnection();
          }

          return contractClient.readNode(
            walletAddress
          );
        }
      });

    const peerTracker =
      await createOperatorPeerTracker({
        reportingOperatorAddress:
          config.operatorAddress,
        reportingNodeId:
          nodeId,
        reportingSessionAddress:
          localHeartbeatRuntime
            .sessionAddress,
        signUptimeReport:
          localHeartbeatRuntime
            .signUptimeReport,
        statePath:
          path.join(
            verificationDirectory,
            'operator-peer-windows.json'
          )
      });

    operatorTransportRuntime =
      await createOperatorTransportRuntime({
        host:
          '127.0.0.1',
        port:
          0,
        observationWorker,

        async onObservation(
          observation
        ) {
          const signedObservation =
            localHeartbeatRuntime
              .signObservation(
                observation
              );

          await peerTracker
            .recordObservation(
              signedObservation
            );

          log(
            'info',
            'distributed-observation-recorded',
            {
              observedOperatorAddress:
                signedObservation
                  .observedOperatorAddress,
              observedNodeId:
                signedObservation
                  .observedNodeId,
              result:
                signedObservation.result,
              reasonCode:
                signedObservation
                  .reasonCode,
              observationHash:
                signedObservation
                  .observationHash
            }
          );
        }
      });

    const transport =
      await operatorTransportRuntime
        .start();

    log(
      'info',
      'distributed-transport-enabled',
      {
        host:
          transport.host,
        port:
          transport.port,
        route:
          transport.route,
        replayStatePath:
          path.join(
            verificationDirectory,
            'observation-replay-state.json'
          ),
        peerTrackerStatePath:
          path.join(
            verificationDirectory,
            'operator-peer-windows.json'
          )
      }
    );
  } else {
    log(
      'info',
      'distributed-transport-disabled'
    );
  }

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
    let validatorRegistrationVerified = false;

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

        validatorRegistrationVerified =
          config.tier === 'Validator' &&
          registrationVerified &&
          status.rpcHealthy === true;

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

    if (validatorIntakeLifecycle) {
      try {
        if (validatorRegistrationVerified) {
          const result =
            await validatorIntakeLifecycle
              .enable();

          if (result.changed) {
            log(
              'info',
              'validator-intake-enabled',
              {
                host:
                  result.transport.host,
                port:
                  result.transport.port,
                route:
                  result.transport.route
              }
            );
          }
        } else {
          const result =
            await validatorIntakeLifecycle
              .disable();

          if (
            validatorRewardApprovalRuntime
          ) {
            validatorRewardApprovalRuntime
              .stop();

            validatorRewardApprovalRuntime =
              null;
          }

          if (result.changed) {
            log(
              'warn',
              'validator-intake-disabled',
              {
                reason:
                  status.rpcHealthy
                    ? 'VALIDATOR_REGISTRATION_NOT_VERIFIED'
                    : 'RPC_UNAVAILABLE'
              }
            );
          }
        }
      } catch (error) {
        log(
          'error',
          'validator-intake-lifecycle-failed',
          {
            action:
              validatorRegistrationVerified
                ? 'enable'
                : 'disable',
            error:
              error.message
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

  if (operatorTransportRuntime) {
    try {
      await operatorTransportRuntime
        .stop();

      operatorTransportRuntime = null;
    } catch (error) {
      log(
        'error',
        'distributed-transport-stop-failed',
        {
          error:
            error.message
        }
      );
    }
  }

  if (validatorRewardApprovalRuntime) {
    validatorRewardApprovalRuntime
      .stop();

    validatorRewardApprovalRuntime =
      null;
  }

  if (validatorIntakeLifecycle) {
    try {
      await validatorIntakeLifecycle
        .disable();

      validatorIntakeLifecycle = null;
    } catch (error) {
      log(
        'error',
        'validator-intake-stop-failed',
        {
          error:
            error.message
        }
      );
    }
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
