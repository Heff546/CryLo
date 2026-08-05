'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ACTIONS,
  buildNodeCenterState,
  equalNodeCenterState
} = require(
  '../src/node-center/state'
);

function readyFacts(overrides = {}) {
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
      stake: '300',
      operatorRequirement: '300',
      validatorRequirement: '750'
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
        '2099-01-01T00:00:00.000Z'
    },
    service: {
      running: true,
      activeState: 'active',
      subState: 'running',
      statusFresh: true,
      statusAgeSeconds: 5
    },
    verification: {
      connected: true,
      verified: true,
      rewardEligible: true
    },
    rewards: {
      pending: '0'
    },
    ...overrides
  };
}

test(
  'requires a linked wallet first',
  () => {
    const state = buildNodeCenterState(
      readyFacts({
        wallet: {
          linked: false
        }
      })
    );

    assert.equal(
      state.action,
      ACTIONS.LINK_WALLET
    );
  }
);

test(
  'requires registration before installation',
  () => {
    const state = buildNodeCenterState(
      readyFacts({
        registration: {
          available: true,
          registered: false
        }
      })
    );

    assert.equal(
      state.action,
      ACTIONS.REGISTER
    );
  }
);

test(
  'repair has precedence over install and update',
  () => {
    const state = buildNodeCenterState(
      readyFacts({
        installation: {
          installed: true,
          healthy: false,
          repairRequired: true,
          updateAvailable: true
        }
      })
    );

    assert.equal(
      state.action,
      ACTIONS.REPAIR
    );
  }
);

test(
  'requires installation when runtime is absent',
  () => {
    const state = buildNodeCenterState(
      readyFacts({
        installation: {
          installed: false,
          healthy: false,
          repairRequired: false,
          updateAvailable: false
        }
      })
    );

    assert.equal(
      state.action,
      ACTIONS.INSTALL
    );
  }
);

test(
  'reopens Step 2 for an available update',
  () => {
    const state = buildNodeCenterState(
      readyFacts({
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

    assert.equal(
      state.action,
      ACTIONS.UPDATE
    );

    assert.equal(
      state.stage,
      'install'
    );

    assert.equal(
      state.view.currentStep,
      'Update Node'
    );
  }
);

test(
  'requires authorization before service start',
  () => {
    const state = buildNodeCenterState(
      readyFacts({
        authorization: {
          valid: false,
          expired: false
        },
        service: {
          running: false
        }
      })
    );

    assert.equal(
      state.action,
      ACTIONS.AUTHORIZE
    );
  }
);

test(
  'requires service start after authorization',
  () => {
    const state = buildNodeCenterState(
      readyFacts({
        service: {
          running: false,
          activeState: 'inactive',
          subState: 'dead'
        }
      })
    );

    assert.equal(
      state.action,
      ACTIONS.START
    );
  }
);

test(
  'requires verification after service start',
  () => {
    const state = buildNodeCenterState(
      readyFacts({
        verification: {
          connected: false,
          verified: false,
          rewardEligible: false
        }
      })
    );

    assert.equal(
      state.action,
      ACTIONS.VERIFY
    );
  }
);

test(
  'operates only after all requirements pass',
  () => {
    const state =
      buildNodeCenterState(
        readyFacts()
      );

    assert.equal(
      state.action,
      ACTIONS.OPERATE
    );
  }
);

test(
  'does not retain state history',
  () => {
    const first =
      buildNodeCenterState(
        readyFacts()
      );

    const second =
      buildNodeCenterState(
        readyFacts()
      );

    assert.notEqual(first, second);
    assert.equal(
      equalNodeCenterState(
        first,
        second
      ),
      true
    );
  }
);

test(
  'generated state is immutable',
  () => {
    const state =
      buildNodeCenterState(
        readyFacts()
      );

    assert.equal(
      Object.isFrozen(state),
      true
    );

    assert.equal(
      Object.isFrozen(state.facts),
      true
    );

    assert.equal(
      Object.isFrozen(
        state.facts.installation
      ),
      true
    );
  }
);
