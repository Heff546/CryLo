# CryLoNexus Operator Protocol

This directory defines the versioned data contract shared by:

- CryLo Electron
- the CryLoNexus operator installer
- the persistent Linux operator service
- the GitHub release pipeline

## Schemas

- `schemas/release-manifest.schema.json`
- `schemas/operator-config.schema.json`
- `schemas/operator-status.schema.json`

## Initial versions

- Release manifest schema: `1`
- Operator configuration schema: `1`
- Operator status schema: `1`
- Operator protocol: `1`

These files define contracts only. They do not install software, alter
staking, change contracts, or modify the production operator runtime.
