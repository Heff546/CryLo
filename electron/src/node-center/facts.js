'use strict';

(function exposeNodeCenterFacts(root, factory) {
  const api = factory();

  if (
    typeof module === 'object' &&
    module.exports
  ) {
    module.exports = api;
  }

  if (root) {
    root.CryLoNodeCenterFacts = api;
  }
})(
  typeof globalThis !== 'undefined'
    ? globalThis
    : this,
  function createNodeCenterFactsModule() {
    function isObject(value) {
      return (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value)
      );
    }

    function asObject(value) {
      return isObject(value)
        ? value
        : {};
    }

    function asText(value, fallback = null) {
      return (
        typeof value === 'string' &&
        value.trim() !== ''
      )
        ? value.trim()
        : fallback;
    }

    function asFiniteNumber(value) {
      const number = Number(value);

      return Number.isFinite(number)
        ? number
        : null;
    }

    function tierLabel(value) {
      const tier = String(value ?? '0');

      if (tier === '2') {
        return 'Validator';
      }

      if (tier === '1') {
        return 'Operator';
      }

      return 'Not Registered';
    }

    function addressesMatch(
      configuredAddress,
      linkedAddress
    ) {
      if (
        typeof configuredAddress !== 'string' ||
        typeof linkedAddress !== 'string'
      ) {
        return false;
      }

      return (
        configuredAddress.toLowerCase() ===
        linkedAddress.toLowerCase()
      );
    }

    function resolveConfiguredAddress(
      configuration
    ) {
      const data =
        asObject(configuration.data);

      return (
        asText(data.operatorAddress) ||
        asText(data.nexusAddress) ||
        asText(data.walletAddress)
      );
    }

    function buildNodeCenterFacts({
      linkedAddress = null,
      dashboardResult = null,
      installationResult = null
    } = {}) {
      const linked =
        typeof linkedAddress === 'string' &&
        linkedAddress.trim() !== '';

      const dashboard =
        asObject(dashboardResult);

      const registration =
        asObject(dashboard.registration);

      const authorization =
        asObject(dashboard.authorization);

      const configuration =
        asObject(dashboard.configuration);

      const service =
        asObject(dashboard.service);

      const runtime =
        asObject(dashboard.runtime);

      const verification =
        asObject(
          dashboard.rewardVerification
        );

      const installation =
        asObject(installationResult);

      const configuredAddress =
        resolveConfiguredAddress(
          configuration
        );

      const registered =
        registration.registered === true;

      const registrationTier =
        tierLabel(registration.tier);

      const installationHealthy =
        installation.healthy === true;

      const serviceRunning =
        service.running === true ||
        service.active === true ||
        service.status === 'active' ||
        service.state === 'active' ||
        service.activeState === 'active';

      return Object.freeze({
        wallet: Object.freeze({
          linked,
          address:
            linked
              ? linkedAddress.trim()
              : null
        }),

        registration: Object.freeze({
          available:
            registration.available !== false,
          registered,
          tier:
            registrationTier,
          stake:
            asText(
              registration.stake,
              '0'
            ),
          operatorRequirement:
            asText(
              registration.operatorStake,
              '300'
            ),
          validatorRequirement:
            asText(
              registration.validatorStake,
              '750'
            ),
          error:
            asText(registration.error)
        }),

        installation: Object.freeze({
          supported:
            installation.supported !== false,
          installed:
            installationHealthy,
          healthy:
            installationHealthy,
          repairRequired:
            installation.repairRequired === true,
          updateAvailable:
            installation.updateAvailable === true,
          installedVersion:
            asText(
              installation.installedVersion
            ),
          availableVersion:
            asText(
              installation.bundledVersion
            ),
          error:
            asText(installation.error)
        }),

        authorization: Object.freeze({
          valid:
            authorization.valid === true,
          expired:
            authorization.expired === true,
          expiresAt:
            asText(
              authorization.expiresAt
            ),
          remainingSeconds:
            asFiniteNumber(
              authorization.remainingSeconds
            ),
          error:
            asText(authorization.error)
        }),

        service: Object.freeze({
          running:
            installationHealthy &&
            serviceRunning,
          activeState:
            asText(
              service.activeState,
              'unknown'
            ),
          subState:
            asText(
              service.subState,
              'unknown'
            ),
          statusFresh:
            runtime.stale !== true &&
            runtime.statusError == null,
          statusAgeSeconds:
            asFiniteNumber(
              runtime.ageSeconds
            ),
          error:
            asText(service.error) ||
            asText(service.message)
        }),

        configuration: Object.freeze({
          loaded:
            configuration.loaded === true,
          exists:
            configuration.exists === true,
          configuredAddress,
          walletMatched:
            addressesMatch(
              configuredAddress,
              linkedAddress
            ),
          error:
            asText(configuration.error)
        }),

        verification: Object.freeze({
          connected:
            verification.connected === true,
          verified:
            verification.verified === true,
          rewardEligible:
            verification.rewardEligible === true,
          status:
            asText(
              verification.status,
              'Not Connected'
            ),
          message:
            asText(verification.message),
          error:
            asText(verification.error)
        }),

        rewards: Object.freeze({
          pending:
            asText(
              registration.pending,
              '0'
            )
        }),

        diagnostics: Object.freeze({
          nodeId:
            asText(runtime.nodeId),
          updatedAt:
            asText(runtime.updatedAt),
          workers:
            Array.isArray(dashboard.workers)
              ? dashboard.workers
              : [],
          metrics:
            isObject(dashboard.metrics)
              ? dashboard.metrics
              : {}
        })
      });
    }

    return Object.freeze({
      tierLabel,
      addressesMatch,
      resolveConfiguredAddress,
      buildNodeCenterFacts
    });
  }
);
