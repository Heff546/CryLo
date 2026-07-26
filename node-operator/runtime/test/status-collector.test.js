'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  collectStatusEvidence
} = require('../src/evidence/status-collector');

function validStatus() {
  return {
    schemaVersion: '1.0.0',
    protocolVersion: '1.0.0',
    serviceVersion: '1.0.0',
    network: 'CryLoNexusV2',
    chainId: 5546,
    nodeId: 'operator-node-001',
    operatorAddress:
      '0x1111111111111111111111111111111111111111',
    startedAt:
      '2026-07-26T20:00:00.000Z',
    updatedAt:
      '2026-07-26T20:01:00.000Z',
    lastHeartbeatAt:
      '2026-07-26T20:01:00.000Z',
    connected: true,
    rpcHealthy: true,
    walletMatched: true,
    registered: true,
    tier: 'Operator',
    uptimeSeconds: 60,
    rewardEligible: false,
    verification: {
      connected: true,
      verified: false,
      verifiedAt: null,
      reasonCode:
        'UPTIME_VERIFICATION_PENDING'
    },
    metrics: {
      heartbeatCount: 1,
      successfulChecks: 2,
      failedChecks: 0,
      pendingRewardsBaseUnits:
        '12345678901'
    },
    workers: [],
    warnings: [],
    errors: []
  };
}

test(
  'collects an immutable evidence snapshot',
  () => {
    const evidence =
      collectStatusEvidence(validStatus());

    assert.deepEqual(evidence, {
      chainId: 5546,
      connected: true,
      rpcHealthy: true,
      walletMatched: true,
      registered: true,
      tier: 'Operator',
      uptimeSeconds: 60,
      rewardEligible: false,
      verification: {
        connected: true,
        verified: false,
        reasonCode:
          'UPTIME_VERIFICATION_PENDING'
      },
      metrics: {
        pendingRewardsBaseUnits:
          '12345678901'
      }
    });

    assert.equal(
      Object.isFrozen(evidence),
      true
    );

    assert.equal(
      Object.isFrozen(
        evidence.verification
      ),
      true
    );

    assert.equal(
      Object.isFrozen(evidence.metrics),
      true
    );
  }
);

test(
  'does not expose runtime internals',
  () => {
    const evidence =
      collectStatusEvidence(validStatus());

    for (const field of [
      'operatorAddress',
      'nodeId',
      'workers',
      'warnings',
      'errors',
      'startedAt',
      'updatedAt',
      'lastHeartbeatAt',
      'serviceVersion'
    ]) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(
          evidence,
          field
        ),
        false
      );
    }
  }
);

test(
  'returns a detached snapshot',
  () => {
    const status = validStatus();

    const evidence =
      collectStatusEvidence(status);

    status.connected = false;
    status.verification.reasonCode =
      'MODIFIED';
    status.metrics.pendingRewardsBaseUnits =
      '0';

    assert.equal(
      evidence.connected,
      true
    );

    assert.equal(
      evidence.verification.reasonCode,
      'UPTIME_VERIFICATION_PENDING'
    );

    assert.equal(
      evidence.metrics
        .pendingRewardsBaseUnits,
      '12345678901'
    );
  }
);

test(
  'accepts an unregistered operator',
  () => {
    const evidence =
      collectStatusEvidence({
        ...validStatus(),
        registered: false,
        tier: null
      });

    assert.equal(
      evidence.registered,
      false
    );

    assert.equal(
      evidence.tier,
      null
    );
  }
);

test(
  'accepts the Validator tier',
  () => {
    const evidence =
      collectStatusEvidence({
        ...validStatus(),
        tier: 'Validator'
      });

    assert.equal(
      evidence.tier,
      'Validator'
    );
  }
);

test(
  'rejects inconsistent registration tiers',
  () => {
    assert.throws(
      () =>
        collectStatusEvidence({
          ...validStatus(),
          registered: false,
          tier: 'Operator'
        }),
      /tier must be null/
    );

    assert.throws(
      () =>
        collectStatusEvidence({
          ...validStatus(),
          tier: null
        }),
      /Operator or Validator/
    );
  }
);

test(
  'rejects eligibility without verification',
  () => {
    assert.throws(
      () =>
        collectStatusEvidence({
          ...validStatus(),
          rewardEligible: true
        }),
      /verified uptime evidence/
    );
  }
);

test(
  'accepts verified reward eligibility',
  () => {
    const status = validStatus();

    status.rewardEligible = true;
    status.verification = {
      connected: true,
      verified: true,
      verifiedAt:
        '2026-07-26T20:01:00.000Z',
      reasonCode: 'UPTIME_VERIFIED'
    };

    const evidence =
      collectStatusEvidence(status);

    assert.equal(
      evidence.rewardEligible,
      true
    );

    assert.equal(
      evidence.verification.verified,
      true
    );
  }
);

test(
  'rejects malformed top-level status',
  () => {
    for (const value of [
      null,
      undefined,
      true,
      [],
      'status',
      42
    ]) {
      assert.throws(
        () => collectStatusEvidence(value),
        /must be a plain object/
      );
    }
  }
);

test(
  'rejects malformed field values',
  () => {
    assert.throws(
      () =>
        collectStatusEvidence({
          ...validStatus(),
          connected: 'yes'
        }),
      /connected must be a boolean/
    );

    assert.throws(
      () =>
        collectStatusEvidence({
          ...validStatus(),
          uptimeSeconds: -1
        }),
      /non-negative safe integer/
    );

    const badMetrics = validStatus();

    badMetrics.metrics = {
      ...badMetrics.metrics,
      pendingRewardsBaseUnits: '01'
    };

    assert.throws(
      () =>
        collectStatusEvidence(
          badMetrics
        ),
      /canonical non-negative integer string/
    );
  }
);
