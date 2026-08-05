'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildNodeCenterState
} = require(
  '../src/node-center/state'
);

const {
  deriveRendererModel
} = require(
  '../src/node-center/renderer'
);

function facts(overrides = {}) {
  return {
    wallet: {
      linked: true,
      address:
        '0x1111111111111111111111111111111111111111'
    },
    registration: {
      available: true,
      registered: true,
      tier: 'Operator',
      stake: '300'
    },
    installation: {
      supported: true,
      installed: true,
      healthy: true,
      repairRequired: false,
      updateAvailable: false,
      installedVersion: '2.0.1',
      availableVersion: '2.0.1'
    },
    authorization: {
      valid: true,
      expired: false,
      expiresAt:
        '2099-01-01T00:00:00.000Z',
      remainingSeconds: 7200
    },
    service: {
      running: true,
      activeState: 'active',
      subState: 'running'
    },
    verification: {
      connected: true,
      verified: true,
      rewardEligible: true
    },
    ...overrides
  };
}

test(
  'update action reopens Step 2 and shows only update',
  () => {
    const state =
      buildNodeCenterState(
        facts({
          installation: {
            installed: true,
            healthy: true,
            repairRequired: false,
            updateAvailable: true,
            installedVersion: '2.0.0',
            availableVersion: '2.0.1'
          }
        })
      );

    const model =
      deriveRendererModel(state);

    assert.equal(
      model.install.title,
      'Update Operator Node'
    );

    assert.equal(
      model.install.installVisible,
      false
    );

    assert.equal(
      model.install.updateVisible,
      true
    );

    assert.equal(
      model.serviceControls.startVisible,
      false
    );
  }
);

test(
  'repair action shows one repair control',
  () => {
    const state =
      buildNodeCenterState(
        facts({
          installation: {
            installed: true,
            healthy: false,
            repairRequired: true,
            updateAvailable: true
          }
        })
      );

    const model =
      deriveRendererModel(state);

    assert.equal(
      model.install.installVisible,
      true
    );

    assert.equal(
      model.install.updateVisible,
      false
    );

    assert.equal(
      model.install.installText,
      'Repair Operator Node'
    );
  }
);

test(
  'authorization precedes service start',
  () => {
    const state =
      buildNodeCenterState(
        facts({
          authorization: {
            valid: false,
            expired: false
          },
          service: {
            running: false
          }
        })
      );

    const model =
      deriveRendererModel(state);

    assert.equal(
      model.authorization.visible,
      true
    );

    assert.equal(
      model.serviceControls.startVisible,
      false
    );
  }
);

test(
  'start is shown only after valid authorization',
  () => {
    const state =
      buildNodeCenterState(
        facts({
          service: {
            running: false,
            activeState: 'inactive'
          }
        })
      );

    const model =
      deriveRendererModel(state);

    assert.equal(
      model.authorization.visible,
      true
    );

    assert.equal(
      model.serviceControls.startVisible,
      true
    );
  }
);

test(
  'running service exposes restart and stop',
  () => {
    const state =
      buildNodeCenterState(
        facts({
          verification: {
            connected: false,
            verified: false
          }
        })
      );

    const model =
      deriveRendererModel(state);

    assert.equal(
      model.serviceControls.startVisible,
      false
    );

    assert.equal(
      model.serviceControls.restartVisible,
      true
    );

    assert.equal(
      model.serviceControls.stopVisible,
      true
    );
  }
);

test(
  'action lock disables all mutating controls',
  () => {
    const state =
      buildNodeCenterState(
        facts({
          service: {
            running: false
          }
        })
      );

    const model =
      deriveRendererModel(
        state,
        {
          actionRunning: true
        }
      );

    assert.equal(
      model.install.disabled,
      true
    );

    assert.equal(
      model.authorization.disabled,
      true
    );

    assert.equal(
      model.serviceControls.disabled,
      true
    );
  }
);
