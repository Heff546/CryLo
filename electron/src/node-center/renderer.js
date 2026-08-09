'use strict';

(function exposeNodeCenterRenderer(root, factory) {
  const api = factory();

  if (
    typeof module === 'object' &&
    module.exports
  ) {
    module.exports = api;
  }

  if (root) {
    root.CryLoNodeCenterRenderer = api;
  }
})(
  typeof globalThis !== 'undefined'
    ? globalThis
    : this,
  function createNodeCenterRendererModule() {
    const STAGE_ORDER = Object.freeze([
      'register',
      'install',
      'connect',
      'verify',
      'operate'
    ]);

    const ACTION_UI = Object.freeze({
      LINK_WALLET: {
        statusType: 'warning',
        installTitle: 'Install Operator Node'
      },
      REGISTER: {
        statusType: 'setup',
        installTitle: 'Install Operator Node'
      },
      INSTALL: {
        statusType: 'warning',
        installTitle: 'Install Operator Node',
        installAction: 'install'
      },
      REPAIR: {
        statusType: 'danger',
        installTitle: 'Repair Operator Node',
        installAction: 'repair'
      },
      UPDATE: {
        statusType: 'warning',
        installTitle: 'Update Operator Node',
        installAction: 'update'
      },
      AUTHORIZE: {
        statusType: 'warning',
        installTitle: 'Install Operator Node',
        authorizeVisible: true
      },
      START: {
        statusType: 'warning',
        installTitle: 'Install Operator Node',
        authorizeVisible: true,
        startVisible: true
      },
      VERIFY: {
        statusType: 'warning',
        installTitle: 'Install Operator Node',
        authorizeVisible: true
      },
      OPERATE: {
        statusType: 'success',
        installTitle: 'Install Operator Node',
        authorizeVisible: true
      },
      ERROR: {
        statusType: 'danger',
        installTitle: 'Install Operator Node'
      }
    });

    function formatRemaining(authorization) {
      if (!authorization.valid) {
        return authorization.expired
          ? 'Expired'
          : '—';
      }

      if (
        !Number.isFinite(
          authorization.remainingSeconds
        )
      ) {
        return 'Active';
      }

      const hours = Math.floor(
        authorization.remainingSeconds / 3600
      );

      const minutes = Math.floor(
        (
          authorization.remainingSeconds %
          3600
        ) / 60
      );

      return `${hours}h ${minutes}m`;
    }

    function formatExpiry(value) {
      if (!value) return '—';

      const date = new Date(value);

      return Number.isNaN(date.getTime())
        ? '—'
        : date.toLocaleString();
    }

    function deriveRendererModel(
      state,
      {
        actionRunning = false
      } = {}
    ) {
      if (
        !state ||
        typeof state !== 'object'
      ) {
        throw new TypeError(
          'A Node Center state object is required'
        );
      }

      const actionUi =
        ACTION_UI[state.action] ||
        ACTION_UI.ERROR;

      const completed = new Set(
        state.completedStages || []
      );

      const stages = STAGE_ORDER.map(
        (stage, index) => {
          const complete =
            completed.has(stage);

          const active =
            state.stage === stage;

          return Object.freeze({
            stage,
            index,
            complete,
            active,
            locked:
              !complete && !active,
            stateLabel:
              complete
                ? 'Complete'
                : active
                  ? 'Current'
                  : 'Locked',
            icon:
              complete
                ? '✓'
                : String(index + 1)
          });
        }
      );

      const {
        installation,
        authorization,
        service,
        registration
      } = state.facts;

      const tier =
        registration.tier === 'Validator'
          ? 'Validator'
          : 'Operator';

      return Object.freeze({
        action: state.action,
        statusType:
          actionUi.statusType,
        banner: Object.freeze({
          eyebrow:
            state.view.eyebrow,
          title:
            state.view.title,
          message:
            state.view.message,
          currentStep:
            state.view.currentStep
        }),
        stages: Object.freeze(stages),
        install: Object.freeze({
          title:
            actionUi.installAction === 'repair'
              ? `Repair ${tier} Node`
              : actionUi.installAction === 'update'
                ? `Update ${tier} Node`
                : `Install ${tier} Node`,
          installVisible:
            actionUi.installAction ===
              'install' ||
            actionUi.installAction ===
              'repair',
          updateVisible:
            actionUi.installAction ===
            'update',
          upToDateVisible:
            installation.installed &&
            installation.healthy &&
            !installation.repairRequired &&
            !installation.updateAvailable,
          installText:
            actionUi.installAction ===
            'repair'
              ? `Repair ${tier} Node`
              : `Install ${tier} Node`,
          updateText:
            `Update ${tier} Node`,
          disabled:
            actionRunning === true
        }),
        authorization: Object.freeze({
          visible:
            actionUi.authorizeVisible === true,
          status:
            authorization.valid
              ? 'Authorized'
              : authorization.expired
                ? 'Expired'
                : 'Not Authorized',
          expires:
            formatExpiry(
              authorization.expiresAt
            ),
          remaining:
            formatRemaining(
              authorization
            ),
          buttonText:
            authorization.valid
              ? `Renew ${tier} 72-Hour Authorization`
              : `Authorize ${tier} Node for 72 Hours`,
          disabled:
            actionRunning === true
        }),
        serviceControls: Object.freeze({
          startVisible:
            actionUi.startVisible === true,
          restartVisible:
            service.running === true,
          stopVisible:
            service.running === true,
          disabled:
            actionRunning === true
        }),
        registration: Object.freeze({
          showOperator: true,
          showValidator: true,
          operatorText:
            registration.registered &&
            registration.tier === 'Operator'
              ? 'Operator Active'
              : 'Become Operator',
          validatorText:
            registration.registered &&
            registration.tier === 'Validator'
              ? 'Validator Active'
              : 'Become Validator',
          tierSelectionDisabled:
            registration.registered ||
            actionRunning === true,
          showDeregister:
            registration.registered,
          showClaim:
            registration.registered,
          tier
        })
      });
    }

    function setText(documentRef, id, value) {
      const element =
        documentRef.getElementById(id);

      if (!element) return;

      const text =
        value == null
          ? ''
          : String(value);

      if (element.textContent !== text) {
        element.textContent = text;
      }
    }

    function setVisible(
      documentRef,
      id,
      visible
    ) {
      const element =
        documentRef.getElementById(id);

      if (!element) return;

      element.style.display =
        visible ? '' : 'none';

      element.classList.toggle(
        'hidden',
        !visible
      );
    }

    function setDisabled(
      documentRef,
      id,
      disabled
    ) {
      const element =
        documentRef.getElementById(id);

      if (element) {
        element.disabled =
          disabled === true;
      }
    }

    function renderNodeCenter(
      documentRef,
      state,
      options = {}
    ) {
      const model =
        deriveRendererModel(
          state,
          options
        );

      const statusCard =
        documentRef.getElementById(
          'nexus-node-status'
        );

      if (statusCard) {
        statusCard.classList.remove(
          'setup',
          'success',
          'warning',
          'danger'
        );

        statusCard.classList.add(
          model.statusType
        );
      }

      setText(
        documentRef,
        'nexus-node-status-eyebrow',
        model.banner.eyebrow
      );
      setText(
        documentRef,
        'nexus-node-status-title',
        model.banner.title
      );
      setText(
        documentRef,
        'nexus-node-status-message',
        model.banner.message
      );
      setText(
        documentRef,
        'nexus-node-status-current-step',
        model.banner.currentStep
      );

      const registerCard =
        documentRef.getElementById(
          'nexus-step-card-register'
        );

      const registerHeading =
        registerCard?.querySelector(
          '.node-center-step-card-heading h4'
        );

      const registerDescription =
        registerCard?.querySelector(
          '.node-center-step-card-heading p'
        );

      if (registerHeading) {
        registerHeading.textContent =
          `Register Your ${model.registration.tier} Node`;
      }

      if (registerDescription) {
        registerDescription.textContent =
          `Stake wCryLo and register your ${model.registration.tier} identity.`;
      }

      setText(
        documentRef,
        'nexus-step-register-summary',
        `${model.registration.tier} registration is active.`
      );

      setText(
        documentRef,
        'nexus-step-install-summary',
        `The ${model.registration.tier} Node Service is installed.`
      );
      setText(
        documentRef,
        'nexus-current-step-title',
        model.banner.title
      );
      setText(
        documentRef,
        'nexus-current-step-description',
        model.banner.message
      );
      setText(
        documentRef,
        'nexus-node-action-status',
        model.banner.message
      );

      setText(
        documentRef,
        'nexus-node-status-icon',
        model.statusType === 'success'
          ? '✓'
          : model.statusType === 'danger'
            ? '!'
            : '●'
      );

      for (const stage of model.stages) {
        const progress =
          documentRef.getElementById(
            `nexus-stage-${stage.stage}`
          );

        const card =
          documentRef.getElementById(
            `nexus-step-card-${stage.stage}`
          );

        for (const element of [
          progress,
          card
        ]) {
          if (!element) continue;

          element.classList.toggle(
            'active',
            stage.active
          );
          element.classList.toggle(
            'complete',
            stage.complete
          );
          element.classList.toggle(
            'locked',
            stage.locked
          );
        }

        const progressNumber =
          progress?.querySelector(
            '.node-stage-number'
          );

        const cardIcon =
          card?.querySelector(
            '.node-center-step-card-icon'
          );

        if (progressNumber) {
          progressNumber.textContent =
            stage.icon;
        }

        if (cardIcon) {
          cardIcon.textContent =
            stage.icon;
        }

        setText(
          documentRef,
          `nexus-step-${stage.stage}-state`,
          stage.stateLabel
        );
      }

      setText(
        documentRef,
        'nexus-step-install-title',
        model.install.title
      );

      setVisible(
        documentRef,
        'nexus-install-operator-btn',
        model.install.installVisible
      );
      setVisible(
        documentRef,
        'nexus-update-operator-btn',
        model.install.updateVisible
      );
      setVisible(
        documentRef,
        'nexus-operator-up-to-date-btn',
        model.install.upToDateVisible
      );

      setText(
        documentRef,
        'nexus-install-operator-btn',
        model.install.installText
      );
      setText(
        documentRef,
        'nexus-update-operator-btn',
        model.install.updateText
      );

      setVisible(
        documentRef,
        'nexus-operator-authorization-panel',
        model.authorization.visible
      );
      setText(
        documentRef,
        'nexus-operator-authorization-status',
        model.authorization.status
      );
      setText(
        documentRef,
        'nexus-operator-authorization-expires',
        model.authorization.expires
      );
      setText(
        documentRef,
        'nexus-operator-authorization-remaining',
        model.authorization.remaining
      );
      setText(
        documentRef,
        'nexus-authorize-operator-btn',
        model.authorization.buttonText
      );

      setVisible(
        documentRef,
        'nexus-start-operator-btn',
        model.serviceControls.startVisible
      );
      setVisible(
        documentRef,
        'nexus-restart-operator-btn',
        model.serviceControls.restartVisible
      );
      setVisible(
        documentRef,
        'nexus-stop-operator-btn',
        model.serviceControls.stopVisible
      );

      setVisible(
        documentRef,
        'nexus-register-operator-btn',
        model.registration.showOperator
      );
      setVisible(
        documentRef,
        'nexus-register-validator-btn',
        model.registration.showValidator
      );
      setText(
        documentRef,
        'nexus-register-operator-btn',
        model.registration.operatorText
      );
      setText(
        documentRef,
        'nexus-register-validator-btn',
        model.registration.validatorText
      );
      setVisible(
        documentRef,
        'nexus-unregister-node-btn',
        model.registration.showDeregister
      );
      setVisible(
        documentRef,
        'nexus-claim-node-rewards-btn',
        model.registration.showClaim
      );

      for (const id of [
        'nexus-install-operator-btn',
        'nexus-update-operator-btn'
      ]) {
        setDisabled(
          documentRef,
          id,
          model.install.disabled
        );
      }

      setDisabled(
        documentRef,
        'nexus-authorize-operator-btn',
        model.authorization.disabled
      );

      setDisabled(
        documentRef,
        'nexus-register-operator-btn',
        model.registration.tierSelectionDisabled
      );
      setDisabled(
        documentRef,
        'nexus-register-validator-btn',
        model.registration.tierSelectionDisabled
      );

      for (const id of [
        'nexus-start-operator-btn',
        'nexus-restart-operator-btn',
        'nexus-stop-operator-btn'
      ]) {
        setDisabled(
          documentRef,
          id,
          model.serviceControls.disabled
        );
      }

      return model;
    }

    return Object.freeze({
      STAGE_ORDER,
      ACTION_UI,
      deriveRendererModel,
      renderNodeCenter
    });
  }
);
