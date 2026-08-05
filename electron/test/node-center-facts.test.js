'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildNodeCenterFacts
} = require(
  '../src/node-center/facts'
);

function dashboard(overrides = {}) {
  return {
    registration: {
      available: true,
      registered: true,
      tier: '1',
      stake: '300',
      pending: '2.5',
      operatorStake: '300',
      validatorStake: '750'
    },
    authorization: {
      valid: true,
      expired: false,
      expiresAt:
        '2099-01-01T00:00:00.000Z',
      remainingSeconds: 7200
    },
    configuration: {
      exists: true,
      loaded: true,
      data: {
        operatorAddress:
          '0x1111111111111111111111111111111111111111'
      }
    },
    service: {
      installed: true,
      running: true,
      activeState: 'active',
      subState: 'running'
    },
    runtime: {
      nodeId: 'operator-node',
      updatedAt:
        '2026-08-01T12:00:00.000Z',
      ageSeconds: 4,
      stale: false
    },
    rewardVerification: {
      connected: true,
      verified: true,
      rewardEligible: true,
      status: 'Verified'
    },
    workers: [],
    metrics: {},
    ...overrides
  };
}

function installation(overrides = {}) {
  return {
    ok: true,
    supported: true,
    healthy: true,
    repairRequired: false,
    updateAvailable: false,
    installedVersion: '2.0.1',
    bundledVersion: '2.0.1',
    ...overrides
  };
}

test(
  'normalizes a healthy Operator node',
  () => {
    const facts =
      buildNodeCenterFacts({
        linkedAddress:
          '0x1111111111111111111111111111111111111111',
        dashboardResult:
          dashboard(),
        installationResult:
          installation()
      });

    assert.equal(
      facts.registration.tier,
      'Operator'
    );

    assert.equal(
      facts.configuration.walletMatched,
      true
    );

    assert.equal(
      facts.installation.installed,
      true
    );

    assert.equal(
      facts.service.running,
      true
    );

    assert.equal(
      facts.verification.verified,
      true
    );
  }
);

test(
  'maps tier 2 to Validator',
  () => {
    const facts =
      buildNodeCenterFacts({
        linkedAddress:
          '0x1111111111111111111111111111111111111111',
        dashboardResult:
          dashboard({
            registration: {
              available: true,
              registered: true,
              tier: '2',
              stake: '750'
            }
          }),
        installationResult:
          installation()
      });

    assert.equal(
      facts.registration.tier,
      'Validator'
    );
  }
);

test(
  'does not report service running when installation is unhealthy',
  () => {
    const facts =
      buildNodeCenterFacts({
        linkedAddress:
          '0x1111111111111111111111111111111111111111',
        dashboardResult:
          dashboard(),
        installationResult:
          installation({
            healthy: false,
            repairRequired: true
          })
      });

    assert.equal(
      facts.service.running,
      false
    );

    assert.equal(
      facts.installation.repairRequired,
      true
    );
  }
);

test(
  'detects an available runtime update',
  () => {
    const facts =
      buildNodeCenterFacts({
        linkedAddress:
          '0x1111111111111111111111111111111111111111',
        dashboardResult:
          dashboard(),
        installationResult:
          installation({
            installedVersion: '2.0.0',
            bundledVersion: '2.0.1',
            updateAvailable: true
          })
      });

    assert.equal(
      facts.installation.updateAvailable,
      true
    );

    assert.equal(
      facts.installation.installedVersion,
      '2.0.0'
    );

    assert.equal(
      facts.installation.availableVersion,
      '2.0.1'
    );
  }
);

test(
  'detects wallet mismatch',
  () => {
    const facts =
      buildNodeCenterFacts({
        linkedAddress:
          '0x2222222222222222222222222222222222222222',
        dashboardResult:
          dashboard(),
        installationResult:
          installation()
      });

    assert.equal(
      facts.configuration.walletMatched,
      false
    );
  }
);

test(
  'handles a missing linked wallet',
  () => {
    const facts =
      buildNodeCenterFacts({
        linkedAddress: null,
        dashboardResult: {},
        installationResult: {}
      });

    assert.equal(
      facts.wallet.linked,
      false
    );

    assert.equal(
      facts.registration.registered,
      false
    );
  }
);

test(
  'returns immutable normalized facts',
  () => {
    const facts =
      buildNodeCenterFacts({
        linkedAddress:
          '0x1111111111111111111111111111111111111111',
        dashboardResult:
          dashboard(),
        installationResult:
          installation()
      });

    assert.equal(
      Object.isFrozen(facts),
      true
    );

    assert.equal(
      Object.isFrozen(
        facts.installation
      ),
      true
    );
  }
);
