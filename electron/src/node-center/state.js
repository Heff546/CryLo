'use strict';

(function exposeNodeCenterState(root, factory) {
  const api = factory();

  if (
    typeof module === 'object' &&
    module.exports
  ) {
    module.exports = api;
  }

  if (root) {
    root.CryLoNodeCenterState = api;
  }
})(
  typeof globalThis !== 'undefined'
    ? globalThis
    : this,
  function createNodeCenterStateModule() {
    const ACTIONS = Object.freeze({
      LINK_WALLET: 'LINK_WALLET',
      REGISTER: 'REGISTER',
      REPAIR: 'REPAIR',
      INSTALL: 'INSTALL',
      UPDATE: 'UPDATE',
      AUTHORIZE: 'AUTHORIZE',
      START: 'START',
      VERIFY: 'VERIFY',
      OPERATE: 'OPERATE',
      ERROR: 'ERROR'
    });

    const STAGES = Object.freeze({
      REGISTER: 'register',
      INSTALL: 'install',
      CONNECT: 'connect',
      VERIFY: 'verify',
      OPERATE: 'operate'
    });

    function isObject(value) {
      return (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value)
      );
    }

    function asBoolean(value) {
      return value === true;
    }

    function asText(value, fallback = null) {
      return (
        typeof value === 'string' &&
        value.trim() !== ''
      )
        ? value.trim()
        : fallback;
    }

    function normalizeNodeCenterFacts(input = {}) {
      if (!isObject(input)) {
        throw new TypeError(
          'Node Center facts must be a plain object'
        );
      }

      const wallet =
        isObject(input.wallet)
          ? input.wallet
          : {};

      const registration =
        isObject(input.registration)
          ? input.registration
          : {};

      const installation =
        isObject(input.installation)
          ? input.installation
          : {};

      const authorization =
        isObject(input.authorization)
          ? input.authorization
          : {};

      const service =
        isObject(input.service)
          ? input.service
          : {};

      const verification =
        isObject(input.verification)
          ? input.verification
          : {};

      const rewards =
        isObject(input.rewards)
          ? input.rewards
          : {};

      const diagnostics =
        isObject(input.diagnostics)
          ? input.diagnostics
          : {};

      return Object.freeze({
        wallet: Object.freeze({
          linked: asBoolean(wallet.linked),
          address: asText(wallet.address)
        }),

        registration: Object.freeze({
          available:
            registration.available !== false,
          registered:
            asBoolean(registration.registered),
          tier:
            asText(
              registration.tier,
              'Not Registered'
            ),
          stake:
            asText(registration.stake, '0'),
          operatorRequirement:
            asText(
              registration.operatorRequirement,
              '300'
            ),
          validatorRequirement:
            asText(
              registration.validatorRequirement,
              '750'
            ),
          error:
            asText(registration.error)
        }),

        installation: Object.freeze({
          supported:
            installation.supported !== false,
          installed:
            asBoolean(installation.installed),
          healthy:
            asBoolean(installation.healthy),
          repairRequired:
            asBoolean(
              installation.repairRequired
            ),
          updateAvailable:
            asBoolean(
              installation.updateAvailable
            ),
          installedVersion:
            asText(
              installation.installedVersion
            ),
          availableVersion:
            asText(
              installation.availableVersion
            ),
          error:
            asText(installation.error)
        }),

        authorization: Object.freeze({
          valid:
            asBoolean(authorization.valid),
          expired:
            asBoolean(authorization.expired),
          expiresAt:
            asText(authorization.expiresAt),
          remainingSeconds:
            Number.isFinite(
              authorization.remainingSeconds
            )
              ? Math.max(
                  0,
                  Math.floor(
                    authorization.remainingSeconds
                  )
                )
              : null,
          error:
            asText(authorization.error)
        }),

        service: Object.freeze({
          running:
            asBoolean(service.running),
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
            asBoolean(service.statusFresh),
          statusAgeSeconds:
            Number.isFinite(
              service.statusAgeSeconds
            )
              ? Math.max(
                  0,
                  Math.floor(
                    service.statusAgeSeconds
                  )
                )
              : null,
          error:
            asText(service.error)
        }),

        verification: Object.freeze({
          connected:
            asBoolean(verification.connected),
          verified:
            asBoolean(verification.verified),
          rewardEligible:
            asBoolean(
              verification.rewardEligible
            ),
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
            asText(rewards.pending, '0')
        }),

        diagnostics: Object.freeze({
          nodeId:
            asText(diagnostics.nodeId),
          updatedAt:
            asText(diagnostics.updatedAt),
          workers:
            Array.isArray(diagnostics.workers)
              ? diagnostics.workers
              : [],
          metrics:
            isObject(diagnostics.metrics)
              ? diagnostics.metrics
              : {}
        })
      });
    }

    function selectNodeCenterAction(facts) {
      if (!facts.wallet.linked) {
        return ACTIONS.LINK_WALLET;
      }

      if (
        facts.registration.error ||
        !facts.registration.available
      ) {
        return ACTIONS.ERROR;
      }

      if (!facts.registration.registered) {
        return ACTIONS.REGISTER;
      }

      if (
        facts.installation.repairRequired
      ) {
        return ACTIONS.REPAIR;
      }

      if (!facts.installation.installed) {
        return ACTIONS.INSTALL;
      }

      if (
        facts.installation.updateAvailable
      ) {
        return ACTIONS.UPDATE;
      }

      if (!facts.authorization.valid) {
        return ACTIONS.AUTHORIZE;
      }

      if (!facts.service.running) {
        return ACTIONS.START;
      }

      if (
        !facts.verification.connected ||
        !facts.verification.verified
      ) {
        return ACTIONS.VERIFY;
      }

      return ACTIONS.OPERATE;
    }

    function describeAction(action, facts) {
      const tier =
        facts.registration.tier ===
        'Validator'
          ? 'Validator'
          : 'Operator';

      const descriptions = {
        [ACTIONS.LINK_WALLET]: {
          stage: STAGES.REGISTER,
          completed: [],
          eyebrow: 'Wallet required',
          title: 'Link a Nexus wallet',
          message:
            'Create or load the Nexus wallet permanently bound to this CryLo wallet.',
          currentStep: 'Link Nexus Wallet'
        },

        [ACTIONS.REGISTER]: {
          stage: STAGES.REGISTER,
          completed: [],
          eyebrow: 'Setup ready',
          title: 'Register your node',
          message:
            'Register as an Operator with 300 wCryLo. Validator remains an upgrade from Operator.',
          currentStep: 'Register Your Node'
        },

        [ACTIONS.REPAIR]: {
          stage: STAGES.INSTALL,
          completed: [
            STAGES.REGISTER
          ],
          eyebrow: 'Repair required',
          title: 'Repair the operator node',
          message:
            'Required operator runtime files are missing or incomplete. Repair the installation before continuing.',
          currentStep: 'Repair Node'
        },

        [ACTIONS.INSTALL]: {
          stage: STAGES.INSTALL,
          completed: [
            STAGES.REGISTER
          ],
          eyebrow: 'Setup in progress',
          title: 'Install the operator node',
          message:
            `Your ${tier} registration is active. Install the persistent background operator service.`,
          currentStep: 'Install Node'
        },

        [ACTIONS.UPDATE]: {
          stage: STAGES.INSTALL,
          completed: [
            STAGES.REGISTER
          ],
          eyebrow: 'Update available',
          title: 'Update the operator node',
          message:
            `Operator ${
              facts.installation.installedVersion ||
              'runtime'
            } is installed. Version ${
              facts.installation.availableVersion ||
              'the latest release'
            } is ready.`,
          currentStep: 'Update Node'
        },

        [ACTIONS.AUTHORIZE]: {
          stage: STAGES.CONNECT,
          completed: [
            STAGES.REGISTER,
            STAGES.INSTALL
          ],
          eyebrow: 'Authorization required',
          title: 'Authorize the operator node',
          message:
            'Create the protected temporary session credential used to sign operator heartbeats.',
          currentStep: 'Authorize Node'
        },

        [ACTIONS.START]: {
          stage: STAGES.CONNECT,
          completed: [
            STAGES.REGISTER,
            STAGES.INSTALL
          ],
          eyebrow: 'Setup in progress',
          title: 'Start the operator node',
          message:
            'The runtime is installed, current, configured, and authorized. Start the background service.',
          currentStep: 'Start Node'
        },

        [ACTIONS.VERIFY]: {
          stage: STAGES.VERIFY,
          completed: [
            STAGES.REGISTER,
            STAGES.INSTALL,
            STAGES.CONNECT
          ],
          eyebrow: 'Almost ready',
          title: 'Verify node uptime',
          message:
            'The operator service is running. Complete uptime and reward verification.',
          currentStep: 'Verify Uptime'
        },

        [ACTIONS.OPERATE]: {
          stage: STAGES.OPERATE,
          completed: [
            STAGES.REGISTER,
            STAGES.INSTALL,
            STAGES.CONNECT,
            STAGES.VERIFY
          ],
          eyebrow: 'Node online',
          title:
            `${tier} node is operational`,
          message:
            'Keep the operator service online to maintain verification and reward eligibility.',
          currentStep: 'Earn Rewards'
        },

        [ACTIONS.ERROR]: {
          stage: STAGES.REGISTER,
          completed: [],
          eyebrow: 'Connection error',
          title:
            'Node Center status unavailable',
          message:
            facts.registration.error ||
            facts.installation.error ||
            facts.service.error ||
            'The current node state could not be verified.',
          currentStep: 'Refresh Node Center'
        }
      };

      return Object.freeze(
        descriptions[action] ||
        descriptions[ACTIONS.ERROR]
      );
    }

    function buildNodeCenterState(input) {
      const facts =
        normalizeNodeCenterFacts(input);

      const action =
        selectNodeCenterAction(facts);

      const view =
        describeAction(action, facts);

      return Object.freeze({
        generatedAt:
          new Date().toISOString(),
        action,
        stage: view.stage,
        completedStages:
          Object.freeze([
            ...view.completed
          ]),
        view,
        facts
      });
    }

    function equalNodeCenterState(
      previous,
      next
    ) {
      if (!previous || !next) {
        return false;
      }

      return JSON.stringify({
        action: previous.action,
        stage: previous.stage,
        completedStages:
          previous.completedStages,
        facts: previous.facts
      }) === JSON.stringify({
        action: next.action,
        stage: next.stage,
        completedStages:
          next.completedStages,
        facts: next.facts
      });
    }

    return Object.freeze({
      ACTIONS,
      STAGES,
      normalizeNodeCenterFacts,
      selectNodeCenterAction,
      buildNodeCenterState,
      equalNodeCenterState
    });
  }
);
