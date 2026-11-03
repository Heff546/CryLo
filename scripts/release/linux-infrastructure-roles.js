'use strict';

const fs = require('fs');
const path = require('path');

// Installed units and dedicated configuration identify an infrastructure
// host even when systemctl is inactive, unavailable, or the unit is masked.
const ROLES = Object.freeze([
  Object.freeze({
    service: 'crylo-anchor.service',
    label: 'Canonical Anchor',
    config: '/etc/crylo/crylo-anchor.conf'
  }),
  Object.freeze({
    service: 'crylo-relay.service',
    label: 'Public Relay',
    config: '/etc/crylo/crylo-relay.conf'
  })
]);

const SYSTEM_UNIT_DIRECTORIES = Object.freeze([
  '/etc/systemd/system',
  '/run/systemd/system',
  '/lib/systemd/system',
  '/usr/lib/systemd/system',
  '/usr/local/lib/systemd/system'
]);

function inspectLinuxInfrastructureRoles({
  platform = process.platform,
  exists = fs.existsSync,
  probe
} = {}) {
  if (platform !== 'linux') return [];
  if (typeof exists !== 'function' || typeof probe !== 'function') {
    throw new TypeError('Linux infrastructure detection requires filesystem and service probes.');
  }

  return ROLES.map((role) => {
    const configured = exists(role.config);
    const unitOnDisk = SYSTEM_UNIT_DIRECTORIES.some(
      (directory) => exists(path.join(directory, role.service))
    );

    // Both systemctl checks are observations; never enable/start/restart units.
    const serviceState = probe('systemctl', ['is-active', '--quiet', role.service]);
    const loadState = probe('systemctl', [
      'show', role.service, '--property=LoadState', '--value'
    ]);
    const active = serviceState?.ok === true;
    const installed = unitOnDisk || (
      loadState?.ok === true &&
      ['loaded', 'masked'].includes(loadState.stdout)
    );

    return { ...role, configured, installed, active };
  }).filter((role) => role.configured || role.installed || role.active);
}

module.exports = { inspectLinuxInfrastructureRoles };
