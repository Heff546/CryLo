'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { inspectLinuxInfrastructureRoles } = require('../release/linux-infrastructure-roles');

const source = fs.readFileSync(path.join(__dirname, '..', 'crylo.js'), 'utf8');
const anchorConfig = '/etc/crylo/crylo-anchor.conf';
const relayConfig = '/etc/crylo/crylo-relay.conf';

function inspect({ files = [], loaded = [], active = [], platform = 'linux' } = {}) {
  const present = new Set(files);
  const calls = [];
  const roles = inspectLinuxInfrastructureRoles({
    platform,
    exists: (file) => present.has(file),
    probe: (command, args) => {
      calls.push([command, ...args]);
      assert.equal(command, 'systemctl');
      if (args[0] === 'is-active') {
        return { ok: active.includes(args[2]), stdout: '' };
      }
      assert.deepEqual(args.slice(0, 1), ['show']);
      assert.equal(args[2], '--property=LoadState');
      assert.equal(args[3], '--value');
      const service = args[1];
      const state = loaded.includes(service) ? 'loaded' : 'not-found';
      return { ok: true, stdout: state };
    }
  });
  assert.ok(calls.every(([cmd, action]) => cmd === 'systemctl' &&
    ['is-active', 'show'].includes(action)), 'Detection must be observational');
  return roles;
}

test('ordinary Linux desktop is not mistaken for infrastructure', () => {
  assert.deepEqual(inspect(), []);
});

test('offline anchor configuration protects its host with systemctl reporting not-found', () => {
  const roles = inspect({ files: [anchorConfig] });
  assert.deepEqual(roles.map((r) => r.service), ['crylo-anchor.service']);
  assert.equal(roles[0].configured, true);
  assert.equal(roles[0].active, false);
});

test('offline relay unit protects host even without a readable config', () => {
  const roles = inspect({ loaded: ['crylo-relay.service'] });
  assert.deepEqual(roles.map((r) => r.service), ['crylo-relay.service']);
  assert.equal(roles[0].installed, true);
  assert.equal(roles[0].active, false);
});

test('unit file on disk protects host if systemctl cannot find it', () => {
  const roles = inspect({ files: ['/etc/systemd/system/crylo-anchor.service'] });
  assert.equal(roles.length, 1);
  assert.equal(roles[0].installed, true);
  assert.equal(roles[0].active, false);
});

test('active unit is detected for authenticated infrastructure deployment', () => {
  const roles = inspect({ active: ['crylo-anchor.service'] });
  assert.equal(roles.length, 1);
  assert.equal(roles[0].active, true);
});

test('both offline roles remain identifiable without selecting either for restart', () => {
  const roles = inspect({ files: [anchorConfig, relayConfig] });
  assert.equal(roles.length, 2);
  assert.equal(roles.filter((role) => role.active).length, 0);
});

test('non-Linux host does not query or detect Linux infrastructure', () => {
  assert.deepEqual(inspect({ files: [anchorConfig], platform: 'win32' }), []);
});

test('production deployment selects active roles only and fails closed on ambiguity', () => {
  const body = source.slice(source.indexOf('function deployInfrastructureRelease() {'),
    source.indexOf('\nconst releaseVerifierScript', source.indexOf('function deployInfrastructureRelease() {')));
  assert.match(body, /inspectLinuxInfrastructureRoles\(/);
  assert.match(body, /roles\.filter\(\(candidate\) => candidate\.active\)/);
  assert.match(body, /if \(activeRoles\.length > 1\)/);
  assert.match(body, /if \(!activeRoles\.length\) \{/);
  assert.ok(body.indexOf('if (!activeRoles.length)') < body.indexOf('restartSystemService(service)'));
});

test('desktop setup and standalone start reject offline infrastructure hosts', () => {
  const desktop = source.slice(source.indexOf('function installLinuxDesktopLaunchers() {'),
    source.indexOf('\nfunction install() {'));
  const start = source.slice(source.indexOf('function start() {'),
    source.indexOf('\nfunction stop() {'));
  assert.match(desktop, /inspectLinuxInfrastructureRoles\(/);
  assert.match(desktop, /if \(infrastructureRoles\.length\) \{/);
  assert.match(start, /inspectLinuxInfrastructureRoles\(/);
  assert.match(start, /if \(infrastructureRoles\.length\) \{/);
  assert.ok(start.indexOf('if (infrastructureRoles.length)') < start.indexOf('if (runningDaemon())'));
});
